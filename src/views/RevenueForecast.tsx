import { Fragment, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useVersionData, useDealStaleness } from '@/lib/queries';
import type { DealStaleness } from '@/lib/queries';
import { useSessionState } from '@/lib/hooks';
import { useIndustry, INDUSTRY_OPTIONS } from '@/lib/industryContext';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { KpiCard } from '@/components/KpiCard';
import {
  CALIBRATION,
  dealDisplay,
  quarterPacedAmount,
  type QuarterTargets,
} from '@/lib/vpCompute';
import {
  buildForecast,
  type Basis,
  type ForecastDeal,
  type IndustryForecast,
  type QuarterForecast,
} from '@/lib/forecastModel';

interface SharedState {
  quarter_targets?: QuarterTargets;
  active_version_id?: string;
  versions_meta?: Array<{ id: string; created_at: string }>;
}
interface VersionData {
  all_deals_rows?: unknown[];
  scorecard_summary?: { as_of_date?: string };
  scorecard?: { as_of_date?: string };
  [key: string]: unknown;
}

const selectStyle: React.CSSProperties = {
  border: '0.5px solid var(--border-emphasis)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-card)',
  padding: '4px 8px',
  fontSize: 12,
  color: 'var(--text-primary)',
  outline: 'none',
};

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border-hairline)',
  borderRadius: 'var(--radius-lg)',
};

function pctOfTarget(value: number, target: number): string {
  if (target <= 0) return '—';
  return `${Math.round((value / target) * 100)}% of target`;
}

function coverageTone(x: number): string {
  if (x >= 3) return 'var(--status-green)';
  if (x >= 1.5) return 'var(--status-amber)';
  return 'var(--status-red)';
}

function hygieneTone(x: number): string {
  if (x >= 0.7) return 'var(--status-green)';
  if (x >= 0.5) return 'var(--status-amber)';
  return 'var(--status-red)';
}

// ── the call: three bands against target ────────────────────────────────────
function BandChart({ q }: { q: { target: number; booked: number; commit: number; base: number; upside: number } }) {
  const scale = Math.max(q.target, q.upside, q.base, q.commit, 1) * 1.06;
  const pct = (v: number) => Math.min(100, (v / scale) * 100);

  const bands: Array<{ label: string; value: number; fill: string }> = [
    { label: 'Commit', value: q.commit, fill: 'rgba(99,91,255,0.85)' },
    { label: 'Base case', value: q.base, fill: 'rgba(99,91,255,0.5)' },
    { label: 'Upside', value: q.upside, fill: 'rgba(99,91,255,0.22)' },
  ];

  return (
    <div>
      <div className="grid items-center gap-x-3 gap-y-2.5" style={{ gridTemplateColumns: '76px 1fr 150px' }}>
        {/* target marker — confined to the bar track so it lines up with the bars */}
        <div
          className="relative pointer-events-none self-stretch"
          style={{ gridColumn: 2, gridRow: `1 / ${bands.length + 1}`, zIndex: 5 }}
        >
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${pct(q.target)}%`, borderLeft: '1px dashed var(--text-primary)' }}
          />
        </div>

        {bands.map((b, i) => (
          <Fragment key={b.label}>
            <div className="text-12 text-text-secondary" style={{ gridColumn: 1, gridRow: i + 1 }}>{b.label}</div>
            <div
              className="h-[22px] rounded-sm relative"
              style={{ gridColumn: 2, gridRow: i + 1, background: 'var(--bg-surface)' }}
            >
              <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${pct(b.value)}%`, background: b.fill }} />
              {/* booked portion — always the darkest leading segment */}
              <div
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{ width: `${pct(Math.min(q.booked, b.value))}%`, background: 'var(--text-primary)' }}
              />
            </div>
            <div className="text-right" style={{ gridColumn: 3, gridRow: i + 1 }}>
              <span className="text-13 font-medium tabular-nums">{formatCurrency(b.value)}</span>
              <span className="text-11 text-text-tertiary tabular-nums ml-1.5">{pctOfTarget(b.value, q.target)}</span>
            </div>
          </Fragment>
        ))}

        <div className="relative h-[14px]" style={{ gridColumn: 2, gridRow: bands.length + 1 }}>
          <div
            className="absolute text-11 text-text-secondary tabular-nums whitespace-nowrap"
            style={{ left: `${pct(q.target)}%`, transform: 'translateX(-50%)' }}
          >
            target {formatCurrency(q.target)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 text-11 text-text-tertiary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--text-primary)' }} />
          booked {formatCurrency(q.booked)}
        </span>
        <span>Commit = late stage with a dated next step inside 30 days.</span>
      </div>
    </div>
  );
}

// ── deal ledger inside an expanded vertical ─────────────────────────────────
function DealLedger({
  deals, quarter, basis,
}: { deals: ForecastDeal[]; quarter: string; basis: Basis }) {
  const valueOf = (d: ForecastDeal) =>
    basis === 'recognized' ? quarterPacedAmount(d.row, quarter, d.tcv) : d.tcv;

  const rows = deals
    .map((d) => ({ d, value: valueOf(d) }))
    .filter((x) => (basis === 'recognized' ? x.value > 0 : x.d.closeQuarter === quarter))
    .sort((a, b) => b.d.pWin * b.value - a.d.pWin * a.value);

  if (!rows.length) {
    return <div className="text-12 text-text-tertiary px-[14px] py-3">No open deals land in {quarter} on this basis.</div>;
  }

  const flagsOf = (d: ForecastDeal) => {
    const f: string[] = [];
    if (d.quality.placeholderStart) f.push('placeholder date');
    if (d.quality.noNextStep) f.push('no next step');
    if (d.quality.zombie) f.push('zombie');
    else if (d.quality.stale) f.push('stale');
    if (d.quality.noSize) f.push('no size');
    return f;
  };

  return (
    <div className="max-h-[420px] overflow-y-auto">
      <table className="w-full text-12">
        <thead className="sticky top-0" style={{ background: 'var(--bg-surface)' }}>
          <tr className="text-11 text-text-secondary">
            <th className="text-left font-normal px-[14px] py-2">Deal</th>
            <th className="text-left font-normal py-2">Owner</th>
            <th className="text-left font-normal py-2">Stage</th>
            <th className="text-right font-normal py-2">{basis === 'recognized' ? 'In-quarter value' : 'TCV'}</th>
            <th className="text-right font-normal py-2">P(win)</th>
            <th className="text-right font-normal py-2">Weighted</th>
            <th className="text-left font-normal pl-4 py-2">Timing</th>
            <th className="text-left font-normal py-2">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, value }) => {
            const flags = flagsOf(d);
            return (
              <tr
                key={d.itemId || d.name}
                style={{
                  borderTop: '0.5px solid var(--border-hairline)',
                  borderLeft: d.commitEligible ? '2px solid var(--status-green)' : '2px solid transparent',
                }}
              >
                <td className="px-[14px] py-2 text-text-primary">{dealDisplay(d.row)}</td>
                <td className="py-2 text-text-secondary">{d.owner}</td>
                <td className="py-2 text-text-secondary">{d.stageLabel}</td>
                <td className="py-2 text-right tabular-nums">{formatCurrency(value)}</td>
                <td className="py-2 text-right tabular-nums" title={d.reasons.join(' · ')}>
                  {Math.round(d.pWin * 100)}%
                </td>
                <td className="py-2 text-right tabular-nums font-medium">{formatCurrency(d.pWin * value)}</td>
                <td className="pl-4 py-2 text-text-tertiary">
                  {d.closeQuarter} <span className="text-11">({d.timingSource})</span>
                </td>
                <td className="py-2">
                  {flags.length === 0 ? (
                    <span className="text-11 text-text-tertiary">clean</span>
                  ) : (
                    <span className="text-11" style={{ color: 'var(--status-amber-text)' }}>{flags.join(', ')}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── main view ───────────────────────────────────────────────────────────────
export function RevenueForecast() {
  const { credentials } = useAuth();
  const { industry, setIndustry } = useIndustry();
  const [basis, setBasis] = useSessionState<Basis>('fc_basis', 'bookings');
  const [qIndex, setQIndex] = useSessionState<number>('fc_quarter_index', 0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sharedStore = useSharedStore(credentials?.username ?? null, credentials?.password ?? null);
  const storeData = sharedStore.data as SharedState | null;
  const activeVersionId = storeData?.active_version_id ?? null;
  const targets: QuarterTargets = storeData?.quarter_targets ?? {};

  const versionQuery = useVersionData(
    credentials?.username ?? null,
    credentials?.password ?? null,
    activeVersionId,
  );
  const versionRow = versionQuery.data as { dataset?: VersionData } | null;
  const versionData = versionRow?.dataset ?? null;
  const dataAsOf = versionData?.scorecard_summary?.as_of_date
    ?? versionData?.scorecard?.as_of_date
    ?? null;

  const stalenessQuery = useDealStaleness();
  const staleness = stalenessQuery.data ?? new Map<string, DealStaleness>();

  const forecast = useMemo(() => {
    if (!versionData) return null;
    return buildForecast(versionData as Record<string, unknown>, targets, {
      quarters: 3,
      staleness,
      basis,
    });
  }, [versionData, targets, staleness, basis]);

  if (versionQuery.isLoading || sharedStore.isLoading) {
    return <div className="text-13 text-text-secondary">Loading forecast…</div>;
  }
  if (!forecast) {
    return <div className="text-13 text-text-secondary">No active snapshot. Load a version in Admin.</div>;
  }

  const { industries, quarters } = forecast;
  const qi = Math.min(Math.max(qIndex, 0), quarters.length - 1);
  const quarter = quarters[qi];

  const shown: IndustryForecast[] = industry === 'Overall'
    ? industries
    : industries.filter((f) => f.industry === industry);

  // Roll up whatever is in scope — one industry or all three.
  const roll = (qIdx: number) => {
    const qs = shown.map((f) => f.quarters[qIdx]).filter(Boolean) as QuarterForecast[];
    const sum = (k: keyof QuarterForecast) => qs.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    const target = sum('target');
    const base = sum('base');
    const upside = sum('upside');
    return {
      quarter: quarters[qIdx],
      target, base, upside,
      booked: sum('booked'),
      commit: sum('commit'),
      openFace: sum('openFace'),
      gap: Math.max(0, target - base),
      coverageGap: Math.max(0, target - upside),
      conversionGap: Math.max(0, Math.max(0, target - base) - Math.max(0, target - upside)),
      requiredNewPipeline: sum('requiredNewPipeline'),
      enterFunnelBy: qs.find((x) => x.enterFunnelBy)?.enterFunnelBy ?? null,
      addressable: qs.some((x) => x.coverageGapAddressable),
    };
  };

  const head = roll(qi);

  const openFaceAll = shown.reduce((a, f) => a + f.deals.reduce((s, d) => s + d.tcv, 0), 0);
  const weightedAll = shown.reduce((a, f) => a + f.deals.reduce((s, d) => s + d.pWin * d.tcv, 0), 0);
  const scopeWinRate = openFaceAll > 0 ? weightedAll / openFaceAll : 0;
  const scopeHygiene = openFaceAll > 0
    ? shown.reduce((a, f) => a + f.hygiene * f.deals.reduce((s, d) => s + d.tcv, 0), 0) / openFaceAll
    : 0;

  const blockers = shown.flatMap((f) => f.quarters[qi]?.commitBlockers ?? []);
  const blockerValue = blockers.reduce((a, b) => a + b.deal.tcv, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-18 font-medium text-text-primary">Forecast</h1>
          <p className="text-12 text-text-secondary mt-1">
            What each vertical is expected to close, on probabilities measured from our own history.
            {dataAsOf && <> Pipeline as of {formatDate(dataAsOf, true)}.</>}
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="text-11 text-text-secondary">Vertical</span>
            <select style={selectStyle} value={industry} onChange={(e) => setIndustry(e.target.value)}>
              {INDUSTRY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-11 text-text-secondary">Quarter</span>
            <select style={selectStyle} value={qi} onChange={(e) => setQIndex(Number(e.target.value))}>
              {quarters.map((q, i) => <option key={q} value={i}>{q}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-11 text-text-secondary">Basis</span>
            <select style={selectStyle} value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              <option value="bookings">Bookings (TCV at win)</option>
              <option value="recognized">Recognized revenue (paced)</option>
            </select>
          </label>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label={`${quarter} target`} value={formatCurrency(head.target)} sub={industry === 'Overall' ? 'all verticals' : industry} />
        <KpiCard label="Booked" value={formatCurrency(head.booked)} sub={pctOfTarget(head.booked, head.target)} />
        <KpiCard label="Commit" value={formatCurrency(head.commit)} sub={pctOfTarget(head.commit, head.target)} />
        <KpiCard
          label="Base case"
          value={formatCurrency(head.base)}
          sub={pctOfTarget(head.base, head.target)}
          subColor={head.target > 0 && head.base / head.target >= 0.9 ? 'green' : head.base / head.target >= 0.7 ? 'amber' : 'red'}
        />
        <KpiCard label="Upside" value={formatCurrency(head.upside)} sub={pctOfTarget(head.upside, head.target)} />
        <KpiCard
          label="Gap to plan"
          value={formatCurrency(head.gap)}
          sub={head.gap > 0 ? `${formatCurrency(head.conversionGap)} convert · ${formatCurrency(head.coverageGap)} cover` : 'plan covered'}
          subColor={head.gap > 0 ? 'red' : 'green'}
        />
      </div>

      {/* the call */}
      <div style={card} className="p-[14px]">
        <div className="text-14 font-medium text-text-primary mb-1">The call for {quarter}</div>
        <div className="text-12 text-text-secondary mb-4">
          {basis === 'bookings'
            ? 'Bookings basis — full contract value credited in the quarter the deal starts.'
            : 'Recognized revenue basis — contract value paced across its delivery months.'}
        </div>
        <BandChart q={head} />
      </div>

      {/* by vertical */}
      <div style={card}>
        <div className="px-[14px] py-3" style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
          <div className="text-14 font-medium text-text-primary">Forecast by vertical — {quarter}</div>
          <div className="text-12 text-text-secondary mt-0.5">Click a row for the deal ledger behind the number.</div>
        </div>
        <table className="w-full text-13">
          <thead>
            <tr className="text-11 text-text-secondary" style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
              <th className="text-left font-normal px-[14px] py-2">Vertical</th>
              <th className="text-right font-normal py-2">Target</th>
              <th className="text-right font-normal py-2">Booked</th>
              <th className="text-right font-normal py-2">Commit</th>
              <th className="text-right font-normal py-2">Base case</th>
              <th className="text-right font-normal py-2">Upside</th>
              <th className="text-right font-normal py-2">Gap to plan</th>
              <th className="text-right font-normal py-2">Coverage</th>
              <th className="text-right font-normal py-2">Win rate</th>
              <th className="text-right font-normal py-2 pr-[14px]">Hygiene</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => {
              const q = f.quarters[qi];
              if (!q) return null;
              const isOpen = expanded === f.industry;
              const tone = q.target > 0 && q.base / q.target >= 0.9
                ? 'var(--status-green)'
                : q.target > 0 && q.base / q.target >= 0.7
                  ? 'var(--status-amber)'
                  : 'var(--status-red)';
              return (
                <Fragment key={f.industry}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : f.industry)}
                    className="cursor-pointer hover:bg-bg-hover"
                    style={{ borderBottom: '0.5px solid var(--border-hairline)', borderLeft: `2px solid ${tone}` }}
                  >
                    <td className="px-[14px] py-2.5 font-medium">{f.industry}</td>
                    <td className="py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(q.target)}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatCurrency(q.booked)}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatCurrency(q.commit)}</td>
                    <td className="py-2.5 text-right tabular-nums font-medium" style={{ color: tone }}>{formatCurrency(q.base)}</td>
                    <td className="py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(q.upside)}</td>
                    <td className="py-2.5 text-right tabular-nums">{q.gap > 0 ? formatCurrency(q.gap) : '—'}</td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: coverageTone(q.coverage) }}>
                      {q.coverage >= 99 ? '—' : `${q.coverage.toFixed(1)}x`}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-text-secondary">{Math.round(f.blendedWinRate * 100)}%</td>
                    <td className="py-2.5 text-right tabular-nums pr-[14px]" style={{ color: hygieneTone(f.hygiene) }}>
                      {Math.round(f.hygiene * 100)}%
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={10} style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border-hairline)' }}>
                        <div className="px-[14px] pt-3 text-12 text-text-secondary">
                          Hygiene detail — real dates {Math.round(f.hygieneParts.realDates * 100)}% ·
                          {' '}next steps {Math.round(f.hygieneParts.nextSteps * 100)}% ·
                          {' '}alive {Math.round(f.hygieneParts.alive * 100)}% ·
                          {' '}sized {Math.round(f.hygieneParts.sized * 100)}%.
                          {f.zombieValue > 0 && <> {formatCurrency(f.zombieValue)} sits in deals past three times their stage staleness threshold.</>}
                        </div>
                        <div className="mt-2">
                          <DealLedger deals={f.deals} quarter={quarter} basis={basis} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {industry === 'Overall' && (
              <tr style={{ background: 'var(--bg-surface)' }}>
                <td className="px-[14px] py-2.5 font-medium">Team</td>
                <td className="py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(head.target)}</td>
                <td className="py-2.5 text-right tabular-nums">{formatCurrency(head.booked)}</td>
                <td className="py-2.5 text-right tabular-nums">{formatCurrency(head.commit)}</td>
                <td className="py-2.5 text-right tabular-nums font-medium">{formatCurrency(head.base)}</td>
                <td className="py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(head.upside)}</td>
                <td className="py-2.5 text-right tabular-nums">{head.gap > 0 ? formatCurrency(head.gap) : '—'}</td>
                <td className="py-2.5 text-right tabular-nums text-text-tertiary">—</td>
                <td className="py-2.5 text-right tabular-nums text-text-secondary">{Math.round(scopeWinRate * 100)}%</td>
                <td className="py-2.5 text-right tabular-nums pr-[14px]" style={{ color: hygieneTone(scopeHygiene) }}>
                  {Math.round(scopeHygiene * 100)}%
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* fastest move */}
      {blockers.length > 0 && (
        <div style={card} className="p-[14px]">
          <div className="text-14 font-medium text-text-primary">Fastest way to move the commit number</div>
          <div className="text-12 text-text-secondary mt-1 mb-3">
            {blockers.length} late-stage {blockers.length === 1 ? 'deal' : 'deals'} worth {formatCurrency(blockerValue)} are one
            fix away from being committable. Commit stays at booked until these clear.
          </div>
          <table className="w-full text-12">
            <thead>
              <tr className="text-11 text-text-secondary" style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                <th className="text-left font-normal py-2">Deal</th>
                <th className="text-left font-normal py-2">Owner</th>
                <th className="text-left font-normal py-2">Stage</th>
                <th className="text-right font-normal py-2">TCV</th>
                <th className="text-left font-normal pl-4 py-2">What is missing</th>
              </tr>
            </thead>
            <tbody>
              {blockers.slice(0, 12).map(({ deal, blockers: bs }) => (
                <tr key={deal.itemId || deal.name} style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                  <td className="py-2">{dealDisplay(deal.row)}</td>
                  <td className="py-2 text-text-secondary">{deal.owner}</td>
                  <td className="py-2 text-text-secondary">{deal.stageLabel}</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(deal.tcv)}</td>
                  <td className="pl-4 py-2" style={{ color: 'var(--status-amber-text)' }}>{bs.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {blockers.length > 12 && (
            <div className="text-11 text-text-tertiary mt-2">+{blockers.length - 12} more.</div>
          )}
        </div>
      )}

      {/* horizon */}
      <div style={card}>
        <div className="px-[14px] py-3" style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
          <div className="text-14 font-medium text-text-primary">Three-quarter horizon</div>
          <div className="text-12 text-text-secondary mt-0.5">
            {industry === 'Overall' ? 'All verticals' : industry} · {basis === 'bookings' ? 'bookings' : 'recognized revenue'} basis.
          </div>
        </div>
        <table className="w-full text-13">
          <thead>
            <tr className="text-11 text-text-secondary" style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
              <th className="text-left font-normal px-[14px] py-2">Quarter</th>
              <th className="text-right font-normal py-2">Target</th>
              <th className="text-right font-normal py-2">Booked</th>
              <th className="text-right font-normal py-2">Commit</th>
              <th className="text-right font-normal py-2">Base case</th>
              <th className="text-right font-normal py-2">Upside</th>
              <th className="text-right font-normal py-2">Gap to plan</th>
              <th className="text-right font-normal py-2">New pipeline needed</th>
              <th className="text-left font-normal pl-4 py-2 pr-[14px]">Must enter funnel by</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((qLabel, i) => {
              const r = roll(i);
              return (
                <tr
                  key={qLabel}
                  style={{
                    borderBottom: '0.5px solid var(--border-hairline)',
                    background: i === qi ? 'var(--bg-surface)' : undefined,
                  }}
                >
                  <td className="px-[14px] py-2.5 font-medium">{qLabel}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(r.target)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatCurrency(r.booked)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatCurrency(r.commit)}</td>
                  <td className="py-2.5 text-right tabular-nums font-medium">{formatCurrency(r.base)}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(r.upside)}</td>
                  <td className="py-2.5 text-right tabular-nums" style={{ color: r.gap > 0 ? 'var(--status-red)' : 'var(--status-green)' }}>
                    {r.gap > 0 ? formatCurrency(r.gap) : '—'}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {r.coverageGap <= 0
                      ? <span className="text-text-tertiary">none needed</span>
                      : r.addressable
                        ? formatCurrency(r.requiredNewPipeline)
                        : <span className="text-text-tertiary">cannot be sourced in time</span>}
                  </td>
                  <td className="pl-4 py-2.5 pr-[14px] text-text-secondary">
                    {r.coverageGap <= 0
                      ? <span className="text-text-tertiary">pipeline exists</span>
                      : r.addressable
                        ? formatDate(r.enterFunnelBy, true)
                        : <span style={{ color: 'var(--status-red)' }}>too late to source</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* methodology */}
      <div style={card} className="p-[14px]">
        <div className="text-14 font-medium text-text-primary mb-2">How this number is built</div>
        <ul className="text-12 text-text-secondary flex flex-col gap-1.5">
          <li>
            <span className="text-text-primary">Probabilities are measured, not assumed.</span> P(win | reached stage) from
            {' '}{CALIBRATION.window}, resolved deals only: {[1, 2, 3, 4, 5, 6].map((s) => `${CALIBRATION.stage[s].label} ${Math.round(CALIBRATION.stage[s].p * 100)}%`).join(', ')}.
            The legacy weighted pipeline on other screens uses the vendor defaults, which run two to four times higher.
          </li>
          <li>
            <span className="text-text-primary">Timing comes from cycle time when the date is not trustworthy.</span> A start date
            shared by five or more open deals is treated as a data-entry default, and the deal is placed by median stage cycle time instead.
          </li>
          <li>
            <span className="text-text-primary">Base case</span> is booked plus probability-weighted pipeline.
            {' '}<span className="text-text-primary">Commit</span> is booked plus late-stage deals with a dated next step inside 30 days.
            {' '}<span className="text-text-primary">Upside</span> assumes every late-stage deal lands.
          </li>
          <li>
            <span className="text-text-primary">The gap splits two ways.</span> Conversion gap means the pipeline exists and has to
            convert. Coverage gap means no pipeline exists for it and new deals have to be sourced, which only works if they can clear a
            full sales cycle before the quarter closes.
          </li>
          <li>
            <span className="text-text-primary">Prologis and Gilead are excluded</span> as ongoing delivery, matching every other screen.
          </li>
        </ul>
      </div>
    </div>
  );
}
