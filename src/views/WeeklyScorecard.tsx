import { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useVersionData } from '@/lib/queries';
import {
  ACTIVE_SELLERS,
  EMPIRICAL_STAGE,
  stageNumber,
  empiricalEv,
  dealRisk,
  daysStuck,
  buildQuarterLabels,
  getTarget,
} from '@/lib/vpCompute';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import type { DealRow, QuarterTargets } from '@/lib/vpCompute';

// ─── types ────────────────────────────────────────────────────────────────────

type Momentum = 'new' | 'advanced' | 'steady' | 'stuck' | 'at_risk';

interface StageStats {
  stage: string;
  stageN: number;
  count: number;
  prevCount: number;
  totalSize: number;
  totalEv: number;
  avgDays: number;
}

interface RankedDeal {
  row: DealRow;
  seller: string;
  stageN: number;
  stageName: string;
  ev: number;
  dealSize: number;
  momentum: Momentum;
  daysIdle: number | null;
  nextMeeting: string | null;
  introDate: string | null;
  dealLabel: string;
}

// ─── stage ordering ───────────────────────────────────────────────────────────

const STAGE_NORM: Record<string, string> = {
  'Scheduled Intro calls': '1. Intro',
  Qualification: '2. Qualification',
  'Capabilities showcase': '3. Capability',
  'Problem Scoping': '4. Problem Scoping',
  Contracting: '5. Contracting',
  'Commercial Proposal': '6. Commercial Proposal',
  Won: '7. Win',
  Lost: '8. Loss',
};

const ACTIVE_STAGES = [
  '1. Intro',
  '2. Qualification',
  '3. Capability',
  '4. Problem Scoping',
  '6. Commercial Proposal',
  '5. Contracting',
];

const STAGE_SHORT: Record<string, string> = {
  '1. Intro': 'Intro',
  '2. Qualification': 'Qual',
  '3. Capability': 'Capability',
  '4. Problem Scoping': 'Prob. scoping',
  '6. Commercial Proposal': 'Commercial proposal',
  '5. Contracting': 'Contracting',
};

function normStage(raw: string | null | undefined): string {
  return STAGE_NORM[String(raw ?? '').trim()] ?? String(raw ?? '').trim();
}

function isActiveStage(stage: string | null | undefined): boolean {
  const s = String(stage ?? '').toLowerCase();
  if (!s) return false;
  if (s.includes('latent') || s.includes('disqualified') || s.includes('no show') || s.includes('reschedule')) return false;
  if (s.includes('win') || s.includes('won') || s.includes('loss') || s.includes('lost')) return false;
  const n = stageNumber(stage);
  return n != null && n >= 1 && n <= 6;
}

// ─── seller matching ─────────────────────────────────────────────────────────

function matchSeller(row: DealRow, seller: string): boolean {
  if (!seller || seller === 'Overall') return ACTIVE_SELLERS.some((s) => matchSeller(row, s));
  const label = seller.trim().toLowerCase();
  const matched: string[] = Array.isArray(row.matched_sellers) ? row.matched_sellers as string[] : [];
  if (matched.some((s) => String(s).trim().toLowerCase() === label)) return true;
  return String(row.owner ?? row.seller ?? row.deal_owner ?? '').toLowerCase().includes(label);
}

function dealKey(row: DealRow): string {
  return `${String(row.deal ?? row.account ?? '').trim().toLowerCase()}||${String(row.intro_date ?? '').trim()}`;
}

// ─── fiscal quarter helpers ───────────────────────────────────────────────────

function fiscalQForDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(String(raw).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const m = d.getMonth() + 1;
  const fiscalMonth = ((m - 4 + 12) % 12) + 1;
  const quarter = Math.floor((fiscalMonth - 1) / 3) + 1;
  const fy = m >= 4 ? d.getFullYear() + 1 : d.getFullYear();
  return `Q${quarter}'${String(fy).slice(-2)}`;
}

// ─── deal size ────────────────────────────────────────────────────────────────

function resolveSize(row: DealRow): number {
  const n = Number(row.deal_size);
  return isFinite(n) && n > 0 ? n : 0;
}

// Age since intro_date — always populated, unlike last-connect fields.
function ageDaysFromIntro(row: DealRow): number | null {
  const raw = row.intro_date as string | null | undefined;
  if (!raw) return null;
  const d = new Date(String(raw).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86_400_000));
}

// EV for closure outlook: stage_probability × deal_size (no quarter-timing weight).
// The timing weight in empiricalEv requires intro_date and is designed to answer
// "which quarter does this deal land in?" For closure deals we already know the
// quarter from start_date, so we just want probability-adjusted deal value.
function closureEv(row: DealRow): number {
  const stageNorm = STAGE_NORM[String(row.stage ?? row.deal_stage ?? '').trim()] ?? String(row.stage ?? row.deal_stage ?? '').trim();
  const n = stageNumber(stageNorm);
  const cfg = n != null ? EMPIRICAL_STAGE[n] : undefined;
  if (!cfg) return 0;
  const size = n != null && n <= 4 ? 100_000 : resolveSize(row);
  if (size <= 0) return 0;
  return size * cfg.p;
}

// ─── main computations ────────────────────────────────────────────────────────

function buildStageStats(
  rows: DealRow[],
  prevRows: DealRow[],
  seller: string,
  currentQLabel: string,
): StageStats[] {
  const curr = rows.filter((r) => matchSeller(r, seller) && isActiveStage(r.stage ?? r.deal_stage));
  const prev = prevRows.filter((r) => matchSeller(r, seller) && isActiveStage(r.stage ?? r.deal_stage));

  const prevCountByStage: Record<string, number> = {};
  prev.forEach((r) => {
    const s = normStage(r.stage ?? r.deal_stage);
    prevCountByStage[s] = (prevCountByStage[s] ?? 0) + 1;
  });

  const byStage: Record<string, { rows: DealRow[] }> = {};
  curr.forEach((r) => {
    const s = normStage(r.stage ?? r.deal_stage);
    if (!byStage[s]) byStage[s] = { rows: [] };
    byStage[s].rows.push(r);
  });

  return ACTIVE_STAGES.map((stage) => {
    const entry = byStage[stage] ?? { rows: [] };
    const stRows = entry.rows;
    const n = stageNumber(stage) ?? 0;
    const totalSize = stRows.reduce((acc, r) => acc + resolveSize(r), 0);
    const totalEv = stRows.reduce((acc, r) => acc + empiricalEv(r, currentQLabel), 0);
    const daysList = stRows.map((r) => ageDaysFromIntro(r)).filter((d): d is number => d != null);
    const avgDays = daysList.length ? Math.round(daysList.reduce((a, b) => a + b, 0) / daysList.length) : 0;
    return {
      stage,
      stageN: n,
      count: stRows.length,
      prevCount: prevCountByStage[stage] ?? 0,
      totalSize,
      totalEv,
      avgDays,
    };
  });
}

function classifyMomentum(row: DealRow, prevStageN: number | null): Momentum {
  const currentN = stageNumber(row.stage ?? row.deal_stage) ?? 0;
  if (prevStageN == null) return 'new';
  if (currentN > prevStageN) return 'advanced';
  // Risk/stuck signals only apply from stage 3 (Capability) upward.
  // Early-stage deals (Intro/Qual) don't yet have meeting cadence expectations.
  if (currentN >= 3) {
    const risk = dealRisk(row);
    if (risk.atRisk) {
      const label = risk.label.toLowerCase();
      if (label.includes('no next') || label.includes('overdue')) return 'at_risk';
      return 'stuck';
    }
    const d = daysStuck(row);
    if (d != null && d > 14) return 'stuck';
  }
  return 'steady';
}

function buildRankedDeals(
  rows: DealRow[],
  prevRows: DealRow[],
  seller: string,
  currentQLabel: string,
): RankedDeal[] {
  const prevByKey = new Map<string, number>();
  prevRows.forEach((r) => {
    const k = dealKey(r);
    const n = stageNumber(r.stage ?? r.deal_stage);
    if (n != null) prevByKey.set(k, n);
  });

  const active = rows.filter((r) => matchSeller(r, seller) && isActiveStage(r.stage ?? r.deal_stage));

  const deduped = new Map<string, DealRow>();
  active.forEach((r) => {
    const k = dealKey(r);
    if (!deduped.has(k)) deduped.set(k, r);
  });

  const deals: RankedDeal[] = [];
  deduped.forEach((r, k) => {
    const stageNorm = normStage(r.stage ?? r.deal_stage);
    const stageN = stageNumber(stageNorm) ?? 0;
    const prevStageN = prevByKey.get(k) ?? null;
    const ev = empiricalEv(r, currentQLabel);
    const momentum = classifyMomentum(r, prevStageN);

    const sellerOwner = seller === 'Overall'
      ? (Array.isArray(r.matched_sellers) && r.matched_sellers.length > 0
        ? String(r.matched_sellers[0])
        : String(r.owner ?? r.seller ?? '—'))
      : seller;

    deals.push({
      row: r,
      seller: sellerOwner,
      stageN,
      stageName: STAGE_SHORT[stageNorm] ?? stageNorm,
      ev,
      dealSize: resolveSize(r),
      momentum,
      daysIdle: daysStuck(r),
      nextMeeting: r.next_meeting_date ? String(r.next_meeting_date).slice(0, 10) : null,
      introDate: r.intro_date ? String(r.intro_date).slice(0, 10) : null,
      dealLabel: String(r.deal ?? r.account ?? r.logo ?? '—'),
    });
  });

  const order: Record<Momentum, number> = { at_risk: 0, stuck: 1, new: 2, advanced: 3, steady: 4 };
  deals.sort((a, b) => {
    const mo = order[a.momentum] - order[b.momentum];
    if (mo !== 0) return mo;
    return b.ev - a.ev;
  });

  return deals;
}

function buildClosureDeals(
  rows: DealRow[],
  seller: string,
  qLabel: string,
): RankedDeal[] {
  const active = rows.filter((r) => {
    if (!matchSeller(r, seller)) return false;
    if (!isActiveStage(r.stage ?? r.deal_stage)) return false;
    const startQ = fiscalQForDate(r.start_date as string | null);
    return startQ === qLabel;
  });

  const deduped = new Map<string, DealRow>();
  active.forEach((r) => {
    const k = dealKey(r);
    if (!deduped.has(k)) deduped.set(k, r);
  });

  const deals: RankedDeal[] = [];
  deduped.forEach((r) => {
    const stageNorm = normStage(r.stage ?? r.deal_stage);
    const stageN = stageNumber(stageNorm) ?? 0;
    const ev = closureEv(r);
    const sellerOwner = seller === 'Overall'
      ? (Array.isArray(r.matched_sellers) && r.matched_sellers.length > 0 ? String(r.matched_sellers[0]) : String(r.owner ?? r.seller ?? '—'))
      : seller;
    deals.push({
      row: r,
      seller: sellerOwner,
      stageN,
      stageName: STAGE_SHORT[stageNorm] ?? stageNorm,
      ev,
      dealSize: resolveSize(r),
      momentum: classifyMomentum(r, null),
      daysIdle: daysStuck(r),
      nextMeeting: r.next_meeting_date ? String(r.next_meeting_date).slice(0, 10) : null,
      introDate: r.intro_date ? String(r.intro_date).slice(0, 10) : null,
      dealLabel: String(r.deal ?? r.account ?? r.logo ?? '—'),
    });
  });

  return deals.sort((a, b) => b.ev - a.ev || b.stageN - a.stageN);
}

// ─── momentum badge ───────────────────────────────────────────────────────────

const MOMENTUM_CONFIG: Record<Momentum, { label: string; dot: string; bg: string; text: string }> = {
  at_risk:  { label: 'At risk',  dot: '●', bg: 'var(--status-red-bg)',   text: 'var(--status-red-text)' },
  stuck:    { label: 'Stuck',    dot: '◐', bg: 'var(--status-amber-bg)', text: 'var(--status-amber-text)' },
  new:      { label: 'New',      dot: '✦', bg: '#EEF2FF',               text: 'var(--accent)' },
  advanced: { label: 'Advancing',dot: '↑', bg: 'var(--status-green-bg)', text: 'var(--status-green-text)' },
  steady:   { label: 'Steady',   dot: '○', bg: 'var(--bg-surface)',      text: 'var(--text-tertiary)' },
};

function MomentumBadge({ m }: { m: Momentum }) {
  const c = MOMENTUM_CONFIG[m];
  return (
    <span className="text-11 px-1.5 py-0.5 rounded font-medium"
      style={{ background: c.bg, color: c.text }}>
      {c.dot} {c.label}
    </span>
  );
}

function StageBadge({ n, label }: { n: number; label: string }) {
  const isLate = n >= 5;
  const isMid = n >= 3;
  return (
    <span className="text-11 px-1.5 py-0.5 rounded tabular-nums"
      style={{
        background: isLate ? 'var(--status-green-bg)' : isMid ? '#EEF2FF' : 'var(--bg-surface)',
        color: isLate ? 'var(--status-green-text)' : isMid ? 'var(--accent)' : 'var(--text-secondary)',
      }}>
      {label}
    </span>
  );
}

// ─── funnel shape section ─────────────────────────────────────────────────────

function FunnelSection({ stats, maxCount }: { stats: StageStats[]; maxCount: number }) {
  const totalEv = stats.reduce((a, s) => a + s.totalEv, 0);

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '0.5px solid var(--border-hairline)', background: 'var(--bg-surface)' }}>
        <span className="text-13 font-medium text-text-primary">Pipeline shape</span>
        <span className="text-12 text-text-tertiary tabular-nums">Total EV {formatCurrency(totalEv)}</span>
      </div>
      <div className="bg-bg-card">
        {/* Column headers */}
        <div className="grid px-4 py-2 text-11 text-text-tertiary font-medium"
          style={{ gridTemplateColumns: '140px 1fr 80px 80px 72px 72px', borderBottom: '0.5px solid var(--border-hairline)' }}>
          <span>Stage</span>
          <span>Shape</span>
          <span className="text-right">Deals</span>
          <span className="text-right">Pipeline $</span>
          <span className="text-right">EV</span>
          <span className="text-right">Avg age</span>
        </div>
        {stats.map((s) => {
          const delta = s.count - s.prevCount;
          const widthPct = maxCount > 0 ? Math.max(4, (s.count / maxCount) * 100) : 4;
          const evShare = totalEv > 0 ? s.totalEv / totalEv : 0;
          const isLate = s.stageN >= 5;
          const isMid = s.stageN >= 3;
          const barColor = isLate ? 'var(--status-green)' : isMid ? 'var(--accent)' : 'var(--text-tertiary)';

          return (
            <div key={s.stage}
              className="grid px-4 py-2.5 items-center hover:bg-bg-hover"
              style={{ gridTemplateColumns: '140px 1fr 80px 80px 72px 72px', borderBottom: '0.5px solid var(--border-hairline)' }}>
              <span className="text-12 text-text-primary font-medium">{STAGE_SHORT[s.stage] ?? s.stage}</span>
              {/* Visual bar */}
              <div className="flex items-center gap-2 pr-4">
                <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
                  <div className="h-full rounded-sm transition-all"
                    style={{ width: `${widthPct}%`, background: barColor, opacity: 0.7 }} />
                </div>
                {/* EV share mini bar */}
                {evShare > 0.02 && (
                  <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
                    <div className="h-full rounded-full" style={{ width: `${evShare * 100}%`, background: 'var(--accent)', opacity: 0.5 }} />
                  </div>
                )}
              </div>
              {/* Deals + delta */}
              <div className="text-right">
                <span className="text-13 font-medium text-text-primary tabular-nums">{s.count}</span>
                {delta !== 0 && (
                  <span className="ml-1 text-11 tabular-nums"
                    style={{ color: delta > 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                )}
              </div>
              <span className="text-right text-12 tabular-nums text-text-secondary">
                {s.totalSize > 0 ? formatCurrency(s.totalSize) : '—'}
              </span>
              <span className="text-right text-12 tabular-nums font-medium"
                style={{ color: s.totalEv > 0 ? (isLate ? 'var(--status-green)' : 'var(--text-primary)') : 'var(--text-tertiary)' }}>
                {s.totalEv > 0 ? formatCurrency(s.totalEv) : '—'}
              </span>
              <span className="text-right text-12 tabular-nums text-text-secondary">
                {s.avgDays > 0 ? `${s.avgDays}d` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── closure section ──────────────────────────────────────────────────────────

function ClosureSection({
  qLabel,
  deals,
  target,
}: {
  qLabel: string;
  deals: RankedDeal[];
  target: number;
}) {
  const totalEv = deals.reduce((a, d) => a + d.ev, 0);
  const coverage = target > 0 ? totalEv / target : 0;
  const coverageColor = coverage >= 0.8 ? 'var(--status-green)' : coverage >= 0.5 ? 'var(--status-amber)' : 'var(--status-red)';

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: '0.5px solid var(--border-hairline)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center justify-between">
          <span className="text-13 font-medium text-text-primary">Closures — {qLabel}</span>
          <span className="text-12 text-text-secondary">{deals.length} deals</span>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-22 font-medium tabular-nums" style={{ color: coverageColor }}>{formatCurrency(totalEv)}</span>
          <span className="text-12 text-text-tertiary">EV</span>
          {target > 0 && (
            <>
              <span className="text-12 text-text-tertiary">·</span>
              <span className="text-12 text-text-secondary">Target {formatCurrency(target)}</span>
              <span className="text-12 font-medium tabular-nums" style={{ color: coverageColor }}>
                ({formatPercent(coverage, 0)} of target)
              </span>
            </>
          )}
        </div>
        {/* Coverage bar */}
        {target > 0 && (
          <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, coverage * 100)}%`, background: coverageColor }} />
          </div>
        )}
      </div>

      {/* Deal list */}
      {deals.length === 0 ? (
        <div className="px-4 py-4 text-12 text-text-tertiary">No deals with expected start in {qLabel}.</div>
      ) : (
        <table className="w-full text-12">
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
              <th className="text-left py-2 px-4 text-text-secondary font-medium">Deal</th>
              <th className="text-left py-2 px-2 text-text-secondary font-medium">Stage</th>
              <th className="text-right py-2 px-2 text-text-secondary font-medium tabular-nums">EV</th>
              <th className="text-right py-2 px-2 text-text-secondary font-medium tabular-nums">Size</th>
              <th className="text-right py-2 px-4 text-text-secondary font-medium">Next meeting</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d, i) => {
              const risk = dealRisk(d.row);
              const overdue = d.nextMeeting && new Date(d.nextMeeting) < new Date();
              return (
                <tr key={i} style={{ borderBottom: '0.5px solid var(--border-hairline)', borderLeft: `2px solid ${risk.atRisk ? 'var(--status-amber)' : 'transparent'}` }}
                  className="hover:bg-bg-hover">
                  <td className="py-2 px-4">
                    <div className="text-text-primary font-medium">{d.dealLabel}</div>
                    {d.seller && <div className="text-11 text-text-tertiary">{d.seller}</div>}
                  </td>
                  <td className="py-2 px-2"><StageBadge n={d.stageN} label={d.stageName} /></td>
                  <td className="py-2 px-2 text-right tabular-nums font-medium text-text-primary">{formatCurrency(d.ev)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-text-secondary">{d.dealSize > 0 ? formatCurrency(d.dealSize) : '—'}</td>
                  <td className="py-2 px-4 text-right" style={{ color: overdue ? 'var(--status-red)' : 'var(--text-secondary)' }}>
                    {d.nextMeeting ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── deal momentum section ────────────────────────────────────────────────────

function DealMomentumSection({ deals }: { deals: RankedDeal[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<Momentum | 'all'>('all');

  const counts = useMemo(() => {
    const c: Partial<Record<Momentum, number>> = {};
    deals.forEach((d) => { c[d.momentum] = (c[d.momentum] ?? 0) + 1; });
    return c;
  }, [deals]);

  const visible = filter === 'all' ? deals : deals.filter((d) => d.momentum === filter);

  const filters: Array<{ key: Momentum | 'all'; label: string }> = [
    { key: 'all', label: `All ${deals.length}` },
    { key: 'at_risk', label: `At risk ${counts.at_risk ?? 0}` },
    { key: 'stuck', label: `Stuck ${counts.stuck ?? 0}` },
    { key: 'advanced', label: `Advancing ${counts.advanced ?? 0}` },
    { key: 'new', label: `New ${counts.new ?? 0}` },
    { key: 'steady', label: `Steady ${counts.steady ?? 0}` },
  ];

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '0.5px solid var(--border-hairline)', background: 'var(--bg-surface)' }}>
        <span className="text-13 font-medium text-text-primary">Deal momentum</span>
        <div className="flex gap-1">
          {filters.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="text-11 px-2 py-0.5 rounded"
              style={{
                background: filter === key ? 'var(--text-primary)' : 'var(--bg-card)',
                color: filter === key ? '#fff' : 'var(--text-secondary)',
                border: '0.5px solid var(--border-hairline)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="px-4 py-4 text-12 text-text-tertiary">No deals in this category.</div>
      ) : (
        <table className="w-full text-12">
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
              <th className="text-left py-2 px-4 text-text-secondary font-medium">Deal</th>
              <th className="text-left py-2 px-2 text-text-secondary font-medium">Status</th>
              <th className="text-left py-2 px-2 text-text-secondary font-medium">Stage</th>
              <th className="text-right py-2 px-2 text-text-secondary font-medium tabular-nums">EV</th>
              <th className="text-right py-2 px-2 text-text-secondary font-medium tabular-nums">Size</th>
              <th className="text-right py-2 px-4 text-text-secondary font-medium">Last connect</th>
              <th className="text-right py-2 px-4 text-text-secondary font-medium">Next meeting</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => {
              const key = dealKey(d.row);
              const isOpen = expanded === key;
              const isRisky = d.momentum === 'at_risk' || d.momentum === 'stuck';
              const overdue = d.nextMeeting && new Date(d.nextMeeting) < new Date();
              const risk = dealRisk(d.row);

              return (
                <>
                  <tr
                    key={key}
                    onClick={() => setExpanded(isOpen ? null : key)}
                    style={{
                      borderBottom: isOpen ? 'none' : '0.5px solid var(--border-hairline)',
                      borderLeft: `2px solid ${isRisky ? (d.momentum === 'at_risk' ? 'var(--status-red)' : 'var(--status-amber)') : 'transparent'}`,
                      cursor: 'pointer',
                    }}
                    className="hover:bg-bg-hover"
                  >
                    <td className="py-2 px-4">
                      <div className="text-text-primary font-medium">{d.dealLabel}</div>
                      <div className="text-11 text-text-tertiary">{d.seller}</div>
                    </td>
                    <td className="py-2 px-2"><MomentumBadge m={d.momentum} /></td>
                    <td className="py-2 px-2"><StageBadge n={d.stageN} label={d.stageName} /></td>
                    <td className="py-2 px-2 text-right tabular-nums font-medium text-text-primary">{d.ev > 0 ? formatCurrency(d.ev) : '—'}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-text-secondary">{d.dealSize > 0 ? formatCurrency(d.dealSize) : '—'}</td>
                    <td className="py-2 px-4 text-right" style={{ color: d.daysIdle && d.daysIdle > 14 ? 'var(--status-amber)' : 'var(--text-secondary)' }}>
                      {d.daysIdle != null ? `${d.daysIdle}d ago` : '—'}
                    </td>
                    <td className="py-2 px-4 text-right" style={{ color: overdue ? 'var(--status-red)' : 'var(--text-secondary)' }}>
                      {d.nextMeeting ?? '—'}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={key + '-exp'} style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                      <td colSpan={7} className="px-4 py-3"
                        style={{ background: 'var(--bg-surface)' }}>
                        <div className="text-12 text-text-secondary space-y-1">
                          <p><span className="text-text-tertiary">Intro date:</span> {d.introDate ?? '—'}</p>
                          {d.row.start_date && <p><span className="text-text-tertiary">Expected start:</span> {String(d.row.start_date).slice(0, 10)} ({fiscalQForDate(d.row.start_date as string | null) ?? '—'})</p>}
                          {d.row.duration_months && <p><span className="text-text-tertiary">Duration:</span> {d.row.duration_months} months</p>}
                          {risk.atRisk && (
                            <p className="font-medium" style={{ color: 'var(--status-amber)' }}>
                              {risk.label}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export function WeeklyScorecard() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};
  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;

  const dataset = (storeData?.dataset as Record<string, unknown> | null) ?? null;
  const allRows: DealRow[] = Array.isArray(dataset?.all_deals_rows) ? dataset!.all_deals_rows as DealRow[] : [];
  const asOfDate = String((dataset?.scorecard as Record<string, unknown> | null)?.as_of_date ?? (dataset?.scorecard_summary as Record<string, unknown> | null)?.as_of_date ?? '');
  const quarterTargets = ((storeData?.quarter_targets ?? {}) as QuarterTargets);

  // Find previous version for comparison
  const versionsMeta = useMemo(() => {
    const v = storeData?.versions_meta ?? storeData?.versions;
    return Array.isArray(v) ? (v as Array<{ id: string; created_at: string }>) : [];
  }, [storeData]);

  const latestId = String(storeData?.latest_version_id ?? storeData?.active_version_id ?? '');

  const sortedVersions = useMemo(() => {
    return [...versionsMeta]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .filter((v) => v.id !== latestId);
  }, [versionsMeta, latestId]);

  const autoPrevId = sortedVersions[0]?.id ?? null;
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const effectiveCompareId = compareVersionId ?? autoPrevId;

  const prevQuery = useVersionData(username ?? null, password ?? null, effectiveCompareId);
  const prevRow = prevQuery.data as { dataset?: { all_deals_rows?: DealRow[] } } | null;
  const prevRows: DealRow[] = prevRow?.dataset?.all_deals_rows ?? [];

  const [seller, setSeller] = useState('Overall');
  const quarterLabels = useMemo(() => buildQuarterLabels(asOfDate || null), [asOfDate]);

  const stageStats = useMemo(
    () => buildStageStats(allRows, prevRows, seller, quarterLabels.current),
    [allRows, prevRows, seller, quarterLabels.current],
  );

  const rankedDeals = useMemo(
    () => buildRankedDeals(allRows, prevRows, seller, quarterLabels.current),
    [allRows, prevRows, seller, quarterLabels.current],
  );

  const closureCurrent = useMemo(
    () => buildClosureDeals(allRows, seller, quarterLabels.current),
    [allRows, seller, quarterLabels.current],
  );
  const closureNext = useMemo(
    () => buildClosureDeals(allRows, seller, quarterLabels.next),
    [allRows, seller, quarterLabels.next],
  );

  // Aggregate KPIs
  const totalEv = stageStats.reduce((a, s) => a + s.totalEv, 0);
  const totalActiveDeals = stageStats.reduce((a, s) => a + s.count, 0);
  const prevTotalDeals = stageStats.reduce((a, s) => a + s.prevCount, 0);
  const dealsDelta = totalActiveDeals - prevTotalDeals;
  const lateStageDeals = stageStats.filter((s) => s.stageN >= 5);
  const lateCount = lateStageDeals.reduce((a, s) => a + s.count, 0);
  const lateEv = lateStageDeals.reduce((a, s) => a + s.totalEv, 0);
  const atRiskCount = rankedDeals.filter((d) => d.momentum === 'at_risk' || d.momentum === 'stuck').length;
  const advancingCount = rankedDeals.filter((d) => d.momentum === 'advanced').length;

  const target = getTarget(quarterTargets, seller === 'Overall' ? 'Overall' : seller, quarterLabels.current);
  const overallTarget = seller === 'Overall'
    ? ACTIVE_SELLERS.reduce((acc, s) => acc + getTarget(quarterTargets, s, quarterLabels.current), 0)
    : target;
  const coverage = overallTarget > 0 ? totalEv / overallTarget : 0;
  const coverageTone = coverage >= 1.5 ? 'green' : coverage >= 0.8 ? 'amber' : 'red';
  const coverageColor = `var(--status-${coverageTone})`;

  const maxCount = Math.max(1, ...stageStats.map((s) => s.count));

  const sellerOptions = ['Overall', ...ACTIVE_SELLERS];

  const nextTarget = seller === 'Overall'
    ? ACTIVE_SELLERS.reduce((acc, s) => acc + getTarget(quarterTargets, s, quarterLabels.next), 0)
    : getTarget(quarterTargets, seller, quarterLabels.next);

  if (storeQuery.isLoading) return <div className="p-6 text-13 text-text-secondary">Loading scorecard...</div>;
  if (storeQuery.isError) return <div className="p-6 text-13 text-status-red">Failed to load data.</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-18 font-medium text-text-primary">Weekly scorecard</h2>
          {asOfDate && <p className="text-12 text-text-tertiary mt-0.5">As of {asOfDate}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Version comparison selector */}
          {sortedVersions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-12 text-text-tertiary whitespace-nowrap">Compare vs</span>
              <select
                value={compareVersionId ?? ''}
                onChange={(e) => setCompareVersionId(e.target.value || null)}
                className="text-12 px-2.5 py-1.5 rounded-md bg-bg-surface text-text-primary"
                style={{ border: '0.5px solid var(--border-emphasis)' }}
              >
                <option value="">Auto (previous)</option>
                {sortedVersions.slice(0, 20).map((v) => {
                  const d = new Date(v.created_at);
                  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) +
                    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                  return <option key={v.id} value={v.id}>{label}</option>;
                })}
              </select>
            </div>
          )}
          {/* Seller selector */}
          <select
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            className="text-13 px-3 py-1.5 rounded-md bg-bg-surface text-text-primary"
            style={{ border: '0.5px solid var(--border-emphasis)' }}
          >
            {sellerOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        {/* Coverage */}
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: `0.5px solid var(--border-hairline)`, borderLeft: `2px solid ${coverageColor}` }}>
          <div className="text-11 text-text-secondary mb-1">{quarterLabels.current} coverage</div>
          <div className="text-22 font-medium tabular-nums" style={{ color: coverageColor }}>
            {coverage > 0 ? `${coverage.toFixed(1)}x` : '—'}
          </div>
          <div className="text-11 text-text-tertiary mt-1">
            EV {formatCurrency(totalEv)} · T {formatCurrency(overallTarget)}
          </div>
        </div>

        {/* Active deals */}
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)' }}>
          <div className="text-11 text-text-secondary mb-1">Active pipeline</div>
          <div className="flex items-baseline gap-2">
            <span className="text-22 font-medium text-text-primary tabular-nums">{totalActiveDeals}</span>
            {dealsDelta !== 0 && prevRows.length > 0 && (
              <span className="text-13 font-medium tabular-nums"
                style={{ color: dealsDelta > 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
                {dealsDelta > 0 ? `+${dealsDelta}` : dealsDelta}
              </span>
            )}
          </div>
          <div className="text-11 text-text-tertiary mt-1">deals in stages 1–6</div>
        </div>

        {/* Late stage */}
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: lateCount > 0 ? '2px solid var(--status-green)' : '0.5px solid var(--border-hairline)' }}>
          <div className="text-11 text-text-secondary mb-1">Late stage (5–6)</div>
          <div className="text-22 font-medium text-text-primary tabular-nums">{lateCount}</div>
          <div className="text-11 text-text-tertiary mt-1">
            {lateEv > 0 ? `${formatCurrency(lateEv)} EV` : 'no deals'}
          </div>
        </div>

        {/* At risk / advancing */}
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: atRiskCount > 0 ? '2px solid var(--status-amber)' : '0.5px solid var(--border-hairline)' }}>
          <div className="text-11 text-text-secondary mb-1">Movement signals</div>
          <div className="flex items-baseline gap-3">
            <span className="text-22 font-medium tabular-nums" style={{ color: atRiskCount > 0 ? 'var(--status-amber)' : 'var(--text-primary)' }}>
              {atRiskCount}
            </span>
            <span className="text-12 text-text-tertiary">at risk / stuck</span>
          </div>
          <div className="text-11 mt-1" style={{ color: advancingCount > 0 ? 'var(--status-green)' : 'var(--text-tertiary)' }}>
            {advancingCount} advancing
          </div>
        </div>
      </div>

      {/* Funnel shape */}
      <FunnelSection stats={stageStats} maxCount={maxCount} />

      {/* Closure outlook: current Q + next Q */}
      <div className="grid grid-cols-2 gap-4">
        <ClosureSection qLabel={quarterLabels.current} deals={closureCurrent} target={overallTarget} />
        <ClosureSection qLabel={quarterLabels.next} deals={closureNext} target={nextTarget} />
      </div>

      {/* Deal momentum table */}
      <DealMomentumSection deals={rankedDeals} />
    </div>
  );
}
