import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useVersionData, useDealStaleness } from '@/lib/queries';
import type { DealStaleness } from '@/lib/queries';
import { useSeller, SELLER_OPTIONS } from '@/lib/sellerContext';
import { useSessionState } from '@/lib/hooks';
import { formatCurrency } from '@/lib/formatters';
import {
  buildRows,
  aggregateSellers,
  buildQuarterLabels,
  ratioTone,
  stageLabel,
  dealDisplay,
  STALENESS_THRESHOLD,
  stageNumber,
  type SellerAggregate,
  type RichDealRow,
  type QuarterTargets,
} from '@/lib/vpCompute';

// ─── types from RPC shape ──────────────────────────────────────────────────

interface SharedState {
  quarter_targets?: QuarterTargets;
  active_version_id?: string;
  latest_version_id?: string;
  versions_meta?: Array<{ id: string; created_at: string }>;
  settings?: Record<string, unknown>;
}

interface VersionData {
  all_deals_rows?: unknown[];
  scorecard_summary?: { as_of_date?: string };
  scorecard?: { as_of_date?: string };
  [key: string]: unknown;
}

// ─── tiny sparkline ────────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  const pts = values.slice(-8);
  if (pts.length < 2) return <span className="text-text-tertiary text-11">—</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = Math.max(1, max - min);
  const points = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * 58;
    const y = 18 - ((v - min) / span) * 16;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = pts[pts.length - 1];
  const first = pts[0];
  const dir = Math.abs(last - first) < 1 ? 'flat' : last > first ? 'up' : 'down';
  const stroke = dir === 'up' ? 'var(--status-green)' : dir === 'down' ? 'var(--status-red)' : 'var(--text-tertiary)';
  return (
    <svg width="60" height="20" viewBox="0 0 60 20" aria-label="8-week trend">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dir === 'flat' ? '3 3' : undefined}
      />
    </svg>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────

type Tone = 'green' | 'amber' | 'red' | 'gray';

const toneClass: Record<Tone, string> = {
  green: 'text-status-green',
  amber: 'text-status-amber',
  red: 'text-status-red',
  gray: 'text-text-tertiary',
};

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: Tone }) {
  return (
    <div
      className="bg-bg-surface px-3 py-2 flex flex-col gap-0.5"
      style={{ border: '0.5px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', minWidth: 120 }}
    >
      <p className="text-11 text-text-secondary">{label}</p>
      <p className="text-22 font-medium text-text-primary tabular-nums leading-tight">{value}</p>
      <p className={`text-11 tabular-nums ${toneClass[tone]}`}>{sub}</p>
    </div>
  );
}

// ─── progress bar ─────────────────────────────────────────────────────────

function ProgressBar({ ratio, tone }: { ratio: number; tone: Tone }) {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const fill = tone === 'green' ? 'var(--status-green)' : tone === 'amber' ? 'var(--status-amber)' : 'var(--status-red)';
  return (
    <div className="w-full h-1 bg-bg-surface rounded-full overflow-hidden" style={{ minWidth: 60 }}>
      <div style={{ width: `${pct}%`, background: fill, height: '100%', transition: 'width 300ms' }} />
    </div>
  );
}

// ─── staleness badge ──────────────────────────────────────────────────────

function StaleBadge({ itemId, stageNum, staleness }: {
  itemId: string | null | undefined;
  stageNum: number | null;
  staleness: Map<string, DealStaleness>;
}) {
  if (!itemId || stageNum == null) return null;
  const s = staleness.get(itemId);
  if (s == null) return null;
  const threshold = STALENESS_THRESHOLD[stageNum] ?? 30;
  if (s.days_stale < threshold) return null;
  const isRed = s.days_stale > threshold * 1.5;
  return (
    <span
      className="text-11 tabular-nums"
      style={{
        background: isRed ? 'var(--status-red-bg)' : 'var(--status-amber-bg)',
        color: isRed ? 'var(--status-red-text)' : 'var(--status-amber-text)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      Stale {s.days_stale}d
    </span>
  );
}

function NoNextStepsBadge({ nextMeetingDate }: { nextMeetingDate: string | null | undefined }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const meeting = nextMeetingDate ? new Date(String(nextMeetingDate).slice(0, 10) + 'T12:00:00') : null;
  if (meeting && meeting >= today) return null;
  return (
    <span
      className="text-11"
      style={{
        background: 'var(--status-red-bg)',
        color: 'var(--status-red-text)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      No next steps
    </span>
  );
}

// ─── expandable seller row ────────────────────────────────────────────────

const PLAN_KEY = (seller: string) =>
  `vp_closure_plan__${seller.replace(/\s+/g, '_').toLowerCase()}`;

function SellerRow({
  row,
  quarterFocus,
  staleness,
}: {
  row: SellerAggregate;
  quarterFocus: 'both' | 'current' | 'next';
  staleness: Map<string, DealStaleness>;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(() => {
    try { return localStorage.getItem(PLAN_KEY(row.seller)) ?? ''; } catch { return ''; }
  });

  const tone = ratioTone(row.ratio);
  const sellerDeals = row.deals.filter(
    (d) => quarterFocus === 'both' || d.leadership_quarter.key === quarterFocus,
  );

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  // Staleness coaching counts
  const staleDeals = sellerDeals.filter((d) => {
    if (!d.item_id) return false;
    const s = staleness.get(d.item_id);
    if (!s) return false;
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    const threshold = n != null ? (STALENESS_THRESHOLD[n] ?? 30) : 30;
    return s.days_stale >= threshold;
  });
  const noNextStepsDeals = sellerDeals.filter((d) => {
    const meeting = d.next_meeting_date
      ? new Date(String(d.next_meeting_date).slice(0, 10) + 'T12:00:00')
      : null;
    return !meeting || meeting < today;
  });

  const hasRisk = staleDeals.length > 0 || noNextStepsDeals.length > 0;

  function savePlan(val: string) {
    setPlan(val);
    try { localStorage.setItem(PLAN_KEY(row.seller), val); } catch {}
  }

  // Quarter breakdown
  const quarters = row.quarters.filter(
    (q) => quarterFocus === 'both' || q.quarter.key === quarterFocus,
  );

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-bg-hover transition-colors"
        style={{ borderBottom: '0.5px solid var(--border-hairline)' }}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Seller */}
        <td className="py-2 pl-3 pr-4" style={{ borderLeft: `2px solid ${hasRisk ? 'var(--status-amber)' : 'transparent'}` }}>
          <div className="flex items-center gap-2">
            <span
              className="text-11 font-medium text-text-secondary flex-shrink-0 flex items-center justify-center"
              style={{
                width: 24, height: 24,
                background: 'var(--bg-surface)',
                border: '0.5px solid var(--border-emphasis)',
                borderRadius: '50%',
              }}
            >
              {row.seller[0]}
            </span>
            <div>
              <p className="text-13 font-medium text-text-primary">{row.seller}</p>
              <p className="text-11 text-text-tertiary">
                {row.open} open
                {staleDeals.length > 0 && (
                  <span style={{ color: 'var(--status-amber)' }}> · {staleDeals.length} stale</span>
                )}
                {noNextStepsDeals.length > 0 && (
                  <span style={{ color: 'var(--status-red)' }}> · {noNextStepsDeals.length} no next steps</span>
                )}
              </p>
            </div>
          </div>
        </td>
        {/* Target */}
        <td className="py-2 px-3 text-13 text-text-primary tabular-nums text-right">
          {row.target > 0 ? formatCurrency(row.target) : <span className="text-text-tertiary">—</span>}
        </td>
        {/* Booked + committed */}
        <td className="py-2 px-3 text-13 text-text-primary tabular-nums text-right">
          {formatCurrency(row.bookedCommitted)}
          {row.booked > 0 && (
            <p className="text-11 text-text-tertiary">{formatCurrency(row.booked)} booked</p>
          )}
        </td>
        {/* Weighted pipeline */}
        <td className="py-2 px-3 text-13 text-text-primary tabular-nums text-right">
          {formatCurrency(row.ev)}
          {row.flooredEv > 0 && row.ev > 0 && row.flooredEv / row.ev > 0.4 && (
            <p className="text-11" style={{ color: 'var(--status-amber)' }}>
              {Math.round(row.flooredEv / row.ev * 100)}% top-of-funnel
            </p>
          )}
        </td>
        {/* EV / target progress */}
        <td className="py-2 px-3" style={{ minWidth: 120 }}>
          <div className="flex flex-col gap-1">
            <span className={`text-11 tabular-nums ${toneClass[tone]}`}>
              {row.target > 0 ? `${row.ratio.toFixed(2)}x` : '—'}
            </span>
            {row.target > 0 && <ProgressBar ratio={row.ratio} tone={tone} />}
          </div>
        </td>
        {/* Risk coaching */}
        <td className="py-2 px-3">
          {staleDeals.length === 0 && noNextStepsDeals.length === 0 ? (
            <span className="text-11" style={{ color: 'var(--status-green)', background: 'var(--status-green-bg)', borderRadius: 'var(--radius-sm)', padding: '2px 7px' }}>
              On track
            </span>
          ) : (
            <div className="flex flex-col gap-0.5">
              {staleDeals.length > 0 && (
                <span className="text-11" style={{ color: 'var(--status-amber-text)' }}>
                  {staleDeals.length} stale
                </span>
              )}
              {noNextStepsDeals.length > 0 && (
                <span className="text-11" style={{ color: 'var(--status-red-text)' }}>
                  {noNextStepsDeals.length} no next steps
                </span>
              )}
            </div>
          )}
        </td>
        {/* Trend placeholder (8-wk sparkline – static for now) */}
        <td className="py-2 px-3">
          <Sparkline values={[row.ev * 0.6, row.ev * 0.7, row.ev * 0.75, row.ev * 0.8, row.ev * 0.85, row.ev * 0.9, row.ev * 0.95, row.ev]} />
        </td>
        {/* Expand chevron */}
        <td className="py-2 pr-3 text-text-tertiary text-11 text-right">
          {open ? '▲' : '▼'}
        </td>
      </tr>

      {open && (
        <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
          <td colSpan={8} className="p-0">
            <div className="bg-bg-surface p-4 flex flex-col gap-4">

              {/* Quarter breakdown */}
              {quarters.length > 0 && (
                <div>
                  <p className="text-11 text-text-secondary mb-2">Quarter breakdown</p>
                  <table className="w-full text-13">
                    <thead>
                      <tr className="text-11 text-text-tertiary">
                        <th className="text-left pb-1 pr-4 font-normal">Quarter</th>
                        <th className="text-right pb-1 px-3 font-normal">Target</th>
                        <th className="text-right pb-1 px-3 font-normal">Booked</th>
                        <th className="text-right pb-1 px-3 font-normal">Committed</th>
                        <th className="text-right pb-1 px-3 font-normal">Wtd pipeline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quarters.map((q) => (
                        <tr key={q.quarter.key} style={{ borderTop: '0.5px solid var(--border-hairline)' }}>
                          <td className="py-1 pr-4 text-text-primary">{q.quarter.label}</td>
                          <td className="py-1 px-3 text-right tabular-nums">
                            {q.target > 0 ? formatCurrency(q.target) : <span className="text-text-tertiary">—</span>}
                          </td>
                          <td className="py-1 px-3 text-right tabular-nums">{formatCurrency(q.booked)}</td>
                          <td className="py-1 px-3 text-right tabular-nums">{formatCurrency(q.committed)}</td>
                          <td className="py-1 px-3 text-right tabular-nums">{formatCurrency(q.ev)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Top deals */}
              {sellerDeals.length > 0 && (
                <div>
                  <p className="text-11 text-text-secondary mb-2">Open deals ({sellerDeals.length})</p>
                  <div className="flex flex-col gap-0">
                    {sellerDeals.slice(0, 8).map((d, i) => {
                      const stageN = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
                      const staleInfo = d.item_id ? staleness.get(d.item_id) : undefined;
                      const threshold = stageN != null ? (STALENESS_THRESHOLD[stageN] ?? 30) : 30;
                      const isStale = staleInfo != null && staleInfo.days_stale >= threshold;
                      const meetingDate = d.next_meeting_date
                        ? new Date(String(d.next_meeting_date).slice(0, 10) + 'T12:00:00')
                        : null;
                      const noNextSteps = !meetingDate || meetingDate < today;
                      const leftColor = isStale && noNextSteps ? 'var(--status-red)'
                        : isStale || noNextSteps ? 'var(--status-amber)'
                        : 'var(--border-hairline)';
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-3 py-1.5"
                          style={{ borderTop: i > 0 ? '0.5px solid var(--border-hairline)' : undefined }}
                        >
                          <span className="flex-shrink-0 w-0.5 self-stretch" style={{ background: leftColor }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-13 text-text-primary truncate">{dealDisplay(d)}</p>
                            <p className="text-11 text-text-tertiary">{stageLabel(d.stage ?? d.deal_stage ?? d.dealStage)} · {d.leadership_quarter.label}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {isStale && (
                              <StaleBadge itemId={d.item_id} stageNum={stageN} staleness={staleness} />
                            )}
                            {noNextSteps && (
                              <NoNextStepsBadge nextMeetingDate={d.next_meeting_date} />
                            )}
                            <span className="text-13 tabular-nums text-text-secondary">
                              {formatCurrency(d.leadership_contribution)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Closure plan */}
              <div>
                <p className="text-11 text-text-secondary mb-1">Closure plan</p>
                <textarea
                  className="w-full text-13 text-text-primary bg-bg-card p-2 resize-y"
                  style={{
                    border: '0.5px solid var(--border-emphasis)',
                    borderRadius: 'var(--radius-sm)',
                    minHeight: 64,
                    outline: 'none',
                  }}
                  placeholder="Add closure notes…"
                  value={plan}
                  onChange={(e) => savePlan(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── at-risk deals table ──────────────────────────────────────────────────

type RiskSortKey = 'seller' | 'deal' | 'stage' | 'days' | 'value';

function AtRiskTable({ deals, staleness }: { deals: RichDealRow[]; staleness: Map<string, DealStaleness> }) {
  const [sortKey, setSortKey] = useState<RiskSortKey>('value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: RiskSortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  const stalenessDays = (d: RichDealRow) => staleness.get(d.item_id ?? '')?.days_stale ?? null;

  const sorted = [...deals].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'seller') return a.leadership_seller.localeCompare(b.leadership_seller) * dir;
    if (sortKey === 'deal') return dealDisplay(a).localeCompare(dealDisplay(b)) * dir;
    if (sortKey === 'stage') return (stageLabel(a.stage ?? a.deal_stage) ?? '').localeCompare(stageLabel(b.stage ?? b.deal_stage) ?? '') * dir;
    if (sortKey === 'days') return ((stalenessDays(a) ?? 0) - (stalenessDays(b) ?? 0)) * dir;
    return ((a.leadership_contribution ?? 0) - (b.leadership_contribution ?? 0)) * dir;
  });

  function Th({ k, label }: { k: RiskSortKey; label: string }) {
    const active = sortKey === k;
    return (
      <th
        className={`text-left pb-2 pr-4 font-normal cursor-pointer select-none text-11 ${active ? 'text-text-primary' : 'text-text-tertiary'}`}
        onClick={() => toggleSort(k)}
      >
        {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    );
  }

  return (
    <div>
      <p className="text-13 font-medium text-text-primary mb-3">At-risk deals ({deals.length})</p>
      <table className="w-full text-13">
        <thead>
          <tr>
            <Th k="seller" label="Seller" />
            <Th k="deal" label="Deal" />
            <Th k="stage" label="Stage" />
            <Th k="days" label="Days stale" />
            <th className="text-left pb-2 pr-4 font-normal text-11 text-text-tertiary">Next meeting</th>
            <th className="text-left pb-2 pr-4 font-normal text-11 text-text-tertiary">Risk reason</th>
            <Th k="value" label="Contribution" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => {
            const days = stalenessDays(d);
            const stageN = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
            const threshold = stageN != null ? (STALENESS_THRESHOLD[stageN] ?? 30) : 30;
            const isStale = days != null && days >= threshold;
            const today = new Date(); today.setHours(12, 0, 0, 0);
            const meeting = d.next_meeting_date
              ? new Date(String(d.next_meeting_date).slice(0, 10) + 'T12:00:00')
              : null;
            const noNextSteps = !meeting || meeting < today;
            const leftColor = isStale && noNextSteps ? 'var(--status-red)'
              : isStale || noNextSteps ? 'var(--status-amber)'
              : 'var(--border-hairline)';
            return (
              <tr
                key={i}
                className="hover:bg-bg-hover"
                style={{
                  borderLeft: `2px solid ${leftColor}`,
                  borderTop: '0.5px solid var(--border-hairline)',
                }}
              >
                <td className="py-2 pr-4 text-text-primary pl-2">{d.leadership_seller}</td>
                <td className="py-2 pr-4 text-text-primary max-w-xs truncate">{dealDisplay(d)}</td>
                <td className="py-2 pr-4 text-text-secondary">{stageLabel(d.stage ?? d.deal_stage)}</td>
                <td className="py-2 pr-4 tabular-nums" style={{ color: isStale ? 'var(--status-amber)' : 'var(--text-secondary)' }}>
                  {days != null ? `${days}d` : '—'}
                </td>
                <td className="py-2 pr-4 tabular-nums" style={{ color: noNextSteps ? 'var(--status-red)' : 'var(--text-secondary)' }}>
                  {d.next_meeting_date ? String(d.next_meeting_date).slice(0, 10) : '—'}
                </td>
                <td className="py-2 pr-4 text-11 max-w-xs">
                  <div className="flex flex-wrap gap-1">
                    {isStale && <StaleBadge itemId={d.item_id} stageNum={stageN} staleness={staleness} />}
                    {noNextSteps && <NoNextStepsBadge nextMeetingDate={d.next_meeting_date} />}
                  </div>
                </td>
                <td className="py-2 pr-4 tabular-nums text-text-primary text-right">{formatCurrency(d.leadership_contribution)}</td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-11 text-text-tertiary">No at-risk deals in current filter.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── main view ────────────────────────────────────────────────────────────

export function VerticalPerformance() {
  const { credentials } = useAuth();
  const { seller: sellerFilter, setSeller: setSellerFilter } = useSeller();
  const [quarterFocus, setQuarterFocus] = useSessionState<'both' | 'current' | 'next'>('vp_quarter_focus', 'both');
  const [riskFilter, setRiskFilter] = useSessionState<'all' | 'risk' | 'partner' | 'nopartner'>('vp_risk_filter', 'all');

  // Shared store (targets + version IDs)
  const sharedStore = useSharedStore(credentials?.username ?? null, credentials?.password ?? null);
  const storeData = sharedStore.data as SharedState | null;

  const activeVersionId = storeData?.active_version_id ?? null;
  const targets: QuarterTargets = storeData?.quarter_targets ?? {};

  // Dataset for active version (credentials required by RPC signature)
  const versionQuery = useVersionData(
    credentials?.username ?? null,
    credentials?.password ?? null,
    activeVersionId,
  );
  // RPC returns { version_id, dataset: {...}, likelihood, created_at } — unwrap dataset
  const versionRow = versionQuery.data as { dataset?: VersionData } | null;
  const versionData = versionRow?.dataset ?? null;

  // Derive quarter labels from dataset as-of date
  const asOf = versionData?.scorecard_summary?.as_of_date
    ?? versionData?.scorecard?.as_of_date
    ?? (storeData?.versions_meta?.[0]?.created_at ?? null);
  const quarterLabels = buildQuarterLabels(asOf);

  // Compute derived data
  const { summary, deals } = useMemo(() => {
    if (!versionData) return { summary: [], deals: [] };
    return buildRows(versionData as Record<string, unknown>, targets, quarterLabels);
  }, [versionData, targets, quarterLabels]);

  // Filter summary rows
  const filteredSummary = summary.filter(
    (r) => sellerFilter === 'Overall' || r.seller === sellerFilter,
  ).filter(
    (r) => quarterFocus === 'both' || r.quarter.key === quarterFocus,
  );

  const allOpenForFilter = deals
    .filter((d) => sellerFilter === 'Overall' || d.leadership_seller === sellerFilter)
    .filter((d) => quarterFocus === 'both' || d.leadership_quarter.key === quarterFocus);

  const aggregates = useMemo(
    () => aggregateSellers(filteredSummary, allOpenForFilter),
    [filteredSummary, allOpenForFilter],
  );

  const totalTarget = aggregates.reduce((a, r) => a + r.target, 0);
  const totalEv = aggregates.reduce((a, r) => a + r.ev, 0);
  const totalActual = aggregates.reduce((a, r) => a + r.booked, 0);
  const totalActualEst = aggregates.reduce((a, r) => a + r.bookedCommitted, 0);
  const atRiskDeals = allOpenForFilter.filter((d) => d.leadership_risk.atRisk);
  const ratio = totalTarget > 0 ? totalEv / totalTarget : 0;
  const ratioT = ratioTone(ratio);

  const stalenessQuery = useDealStaleness();
  const staleness = stalenessQuery.data ?? new Map<string, DealStaleness>();

  const isLoading = sharedStore.isLoading || versionQuery.isLoading;
  const error = sharedStore.error ?? versionQuery.error;

  // Email summary
  function openEmail() {
    const week = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const subject = `Sales review — week of ${week}`;
    const lines = [
      `Sales review — week of ${week}`,
      '',
      `Target: ${formatCurrency(totalTarget)} | Wtd pipeline: ${formatCurrency(totalEv)} | Booked: ${formatCurrency(totalActual)}`,
      '',
      '| Seller | Target | Booked+committed | Wtd pipeline | Coverage | At risk |',
      '|---|---:|---:|---:|---:|---:|',
      ...aggregates.map((r) =>
        `| ${r.seller} | ${formatCurrency(r.target)} | ${formatCurrency(r.bookedCommitted)} | ${formatCurrency(r.ev)} | ${r.target ? `${r.ratio.toFixed(2)}x` : '—'} | ${r.atRisk}/${r.open} |`,
      ),
    ];
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
  }

  // ─── select style ──────────────────────────────────────────────────────

  const selectStyle: React.CSSProperties = {
    border: '0.5px solid var(--border-emphasis)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-card)',
    padding: '4px 8px',
    fontSize: 12,
    color: 'var(--text-primary)',
    outline: 'none',
  };

  return (
    <div className="flex flex-col gap-5">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-18 font-medium text-text-primary">Vertical performance</h1>
          {asOf && (
            <p className="text-11 text-text-tertiary mt-0.5">
              as of {new Date(asOf).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={openEmail}
          className="text-11 text-text-secondary px-3 py-1.5"
          style={{
            border: '0.5px solid var(--border-emphasis)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)',
          }}
        >
          Email summary
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="text-13 text-status-red-text px-3 py-2"
          style={{ background: 'var(--status-red-bg)', borderRadius: 'var(--radius-md)' }}
        >
          {error instanceof Error ? error.message : 'Failed to load data.'}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <p className="text-13 text-text-tertiary">Loading…</p>
      )}

      {!isLoading && !error && (
        <>
          {/* KPI strip */}
          <div className="flex gap-3 flex-wrap">
            <KpiCard
              label={quarterFocus === 'both' ? `Target ${quarterLabels.current}+${quarterLabels.next}` : `Target ${quarterFocus === 'current' ? quarterLabels.current : quarterLabels.next}`}
              value={totalTarget > 0 ? formatCurrency(totalTarget) : '—'}
              sub={`${allOpenForFilter.length} open deals`}
              tone="gray"
            />
            <KpiCard
              label={quarterFocus === 'both' ? `Booked (${quarterLabels.current}+${quarterLabels.next})` : 'Booked'}
              value={formatCurrency(totalActual)}
              sub={totalActual > 0 ? 'Closed revenue' : 'No closes yet'}
              tone={totalActual > 0 ? 'green' : 'gray'}
            />
            <KpiCard
              label={quarterFocus === 'both' ? `Wtd pipeline (${quarterLabels.current}+${quarterLabels.next})` : 'Weighted pipeline'}
              value={formatCurrency(totalEv)}
              sub={`${totalEv >= totalTarget ? '+' : ''}${formatCurrency(totalEv - totalTarget)} vs target`}
              tone={totalEv >= totalTarget ? 'green' : 'red'}
            />
            <KpiCard
              label="Forecast coverage"
              value={totalTarget > 0 ? `${ratio.toFixed(2)}x` : '—'}
              sub={ratio >= 0.6 ? 'At or above 0.6× bar' : 'Below 0.6× bar'}
              tone={ratioT}
            />
            <KpiCard
              label="At risk"
              value={`${atRiskDeals.length}/${allOpenForFilter.length}`}
              sub={`${formatCurrency(atRiskDeals.reduce((a, d) => a + (d.leadership_contribution ?? 0), 0))} exposure`}
              tone={atRiskDeals.length > 0 ? 'red' : 'green'}
            />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-11 text-text-secondary">Seller</label>
              <select style={selectStyle} value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)}>
                {SELLER_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-11 text-text-secondary">Quarter</label>
              <select style={selectStyle} value={quarterFocus} onChange={(e) => setQuarterFocus(e.target.value as typeof quarterFocus)}>
                <option value="both">Both quarters</option>
                <option value="current">{quarterLabels.current}</option>
                <option value="next">{quarterLabels.next}</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-11 text-text-secondary">Filter</label>
              <select style={selectStyle} value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as typeof riskFilter)}>
                <option value="all">All deals</option>
                <option value="risk">At risk only</option>
                <option value="partner">Partner involved</option>
                <option value="nopartner">No partner</option>
              </select>
            </div>
          </div>

          {/* Seller scorecard table */}
          <div
            className="bg-bg-card"
            style={{ border: '0.5px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}
          >
            <table className="w-full">
              <thead>
                <tr
                  className="text-11 text-text-tertiary"
                  style={{ borderBottom: '0.5px solid var(--border-hairline)' }}
                >
                  <th className="text-left py-2 pl-3 pr-4 font-normal">Seller</th>
                  <th className="text-right py-2 px-3 font-normal">Target</th>
                  <th className="text-right py-2 px-3 font-normal">
                    Booked + committed{quarterFocus === 'both' ? ` (${quarterLabels.current}+${quarterLabels.next})` : ''}
                  </th>
                  <th className="text-right py-2 px-3 font-normal">Wtd pipeline</th>
                  <th className="text-left py-2 px-3 font-normal" style={{ minWidth: 120 }}>Coverage</th>
                  <th className="text-left py-2 px-3 font-normal">Risk</th>
                  <th className="text-left py-2 px-3 font-normal">Trend</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {aggregates.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-11 text-text-tertiary">
                      No data for current filters.
                    </td>
                  </tr>
                ) : (
                  aggregates.map((r) => (
                    <SellerRow key={r.seller} row={r} quarterFocus={quarterFocus} staleness={staleness} />
                  ))
                )}
              </tbody>
              {/* Totals footer */}
              {aggregates.length > 1 && (
                <tfoot>
                  <tr
                    className="text-13 font-medium"
                    style={{ borderTop: '0.5px solid var(--border-emphasis)' }}
                  >
                    <td className="py-2 pl-3 pr-4 text-text-secondary">Total</td>
                    <td className="py-2 px-3 text-right tabular-nums">{totalTarget > 0 ? formatCurrency(totalTarget) : '—'}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(totalActualEst)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(totalEv)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-11 ${toneClass[ratioT]}`}>
                        {totalTarget > 0 ? `${ratio.toFixed(2)}x` : '—'}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-11" style={{
                        color: atRiskDeals.length > 0 ? 'var(--status-amber-text)' : 'var(--status-green)',
                        background: atRiskDeals.length > 0 ? 'var(--status-amber-bg)' : 'var(--status-green-bg)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px 7px',
                      }}>
                        {atRiskDeals.length > 0 ? `${atRiskDeals.length} flagged` : 'On track'}
                      </span>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* At-risk deals */}
          {atRiskDeals.length > 0 && (
            <div
              className="bg-bg-card p-4"
              style={{ border: '0.5px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}
            >
              <AtRiskTable deals={atRiskDeals} staleness={staleness} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
