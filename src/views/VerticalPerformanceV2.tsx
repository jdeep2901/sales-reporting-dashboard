import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useVersionData, useDealStaleness } from '@/lib/queries';
import type { DealStaleness } from '@/lib/queries';
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

// ── types ────────────────────────────────────────────────────────────────────
interface SharedState {
  quarter_targets?: QuarterTargets;
  active_version_id?: string;
  latest_version_id?: string;
  versions_meta?: Array<{ id: string; created_at: string }>;
}
interface VersionData {
  all_deals_rows?: unknown[];
  scorecard_summary?: { as_of_date?: string };
  scorecard?: { as_of_date?: string };
  [key: string]: unknown;
}

type Tone = 'green' | 'amber' | 'red' | 'gray';
const toneColor: Record<Tone, string> = {
  green: 'var(--status-green)',
  amber: 'var(--status-amber)',
  red: 'var(--status-red)',
  gray: 'var(--text-tertiary)',
};

const selectStyle: React.CSSProperties = {
  border: '0.5px solid var(--border-emphasis)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-card)',
  padding: '4px 8px',
  fontSize: 12,
  color: 'var(--text-primary)',
  outline: 'none',
};

function todayDate() {
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  return t;
}

function isNoNmd(d: RichDealRow) {
  const today = todayDate();
  const m = d.next_meeting_date
    ? new Date(String(d.next_meeting_date).slice(0, 10) + 'T12:00:00')
    : null;
  return !m || m < today;
}

function dealStaleDays(d: RichDealRow, staleness: Map<string, DealStaleness>): number | null {
  return staleness.get(d.item_id ?? '')?.days_stale ?? null;
}

function isDealStale(d: RichDealRow, staleness: Map<string, DealStaleness>): boolean {
  const days = dealStaleDays(d, staleness);
  if (days == null) return false;
  const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
  const threshold = n != null ? (STALENESS_THRESHOLD[n] ?? 30) : 30;
  return days >= threshold;
}

// ── stage mix bar — deal count based, all open deals regardless of quarter pacing ──
function StageMixBar({ deals }: { deals: RichDealRow[] }) {
  let early = 0, mid = 0, late = 0;
  for (const d of deals) {
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    if (n == null) continue;
    if (n <= 2) early++;
    else if (n <= 4) mid++;
    else late++;
  }
  const total = early + mid + late;
  if (total === 0) return <span className="text-11 text-text-tertiary">—</span>;

  const ePct = (early / total) * 100;
  const mPct = (mid / total) * 100;
  const lPct = (late / total) * 100;

  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 100 }}>
      <div className="flex w-full rounded-full overflow-hidden" style={{ height: 6, gap: 1 }}>
        {early > 0 && <div style={{ width: `${ePct}%`, background: 'var(--text-tertiary)', opacity: 0.45 }} />}
        {mid > 0 && <div style={{ width: `${mPct}%`, background: 'var(--accent)', opacity: 0.7 }} />}
        {late > 0 && <div style={{ width: `${lPct}%`, background: 'var(--status-green)' }} />}
      </div>
      <div className="flex text-11 gap-1 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
        {early > 0 && <span style={{ color: ePct > 50 ? 'var(--status-amber)' : undefined }}>{early} S1/S2</span>}
        {mid > 0 && <><span>·</span><span style={{ color: 'var(--accent)' }}>{mid} S3/S4</span></>}
        {late > 0 && <><span>·</span><span style={{ color: 'var(--status-green)' }}>{late} S5/S6</span></>}
      </div>
    </div>
  );
}

// ── forecast vs target cell ───────────────────────────────────────────────
function ForecastCell({ booked, committed, target }: { booked: number; committed: number; target: number }) {
  const forecast = booked + committed;
  const pct = target > 0 ? forecast / target : null;
  const tone: Tone = pct == null ? 'gray' : pct >= 0.8 ? 'green' : pct >= 0.5 ? 'amber' : 'red';
  const gap = target > 0 ? forecast - target : null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-13 font-medium tabular-nums" style={{ color: toneColor[tone] }}>
        {forecast > 0 ? formatCurrency(forecast) : '—'}
      </span>
      {target > 0 && gap != null && (
        <span className="text-11 tabular-nums text-text-tertiary">
          {gap >= 0 ? '+' : ''}{formatCurrency(gap)} vs {formatCurrency(target)}
        </span>
      )}
      {target === 0 && <span className="text-11 text-text-tertiary">No target</span>}
    </div>
  );
}

// ── badges ───────────────────────────────────────────────────────────────
function StaleBadge({ days }: { days: number }) {
  const isRed = days > 21;
  return (
    <span className="text-11 tabular-nums" style={{
      background: isRed ? 'var(--status-red-bg)' : 'var(--status-amber-bg)',
      color: isRed ? 'var(--status-red-text)' : 'var(--status-amber-text)',
      borderRadius: 'var(--radius-sm)', padding: '1px 5px', whiteSpace: 'nowrap',
    }}>
      {days}d stale
    </span>
  );
}
function NoNmdBadge() {
  return (
    <span className="text-11" style={{
      background: 'var(--status-red-bg)', color: 'var(--status-red-text)',
      borderRadius: 'var(--radius-sm)', padding: '1px 5px', whiteSpace: 'nowrap',
    }}>
      No next step
    </span>
  );
}

// ── focus area label (auto-derived per seller) ────────────────────────────
function sellerFocusLabel(
  row: SellerAggregate,
  deals: RichDealRow[],
  staleness: Map<string, DealStaleness>,
  quarterFocus: 'both' | 'current' | 'next',
): { text: string; tone: Tone } | null {
  const sellerDeals = deals.filter(
    (d) => d.leadership_seller === row.seller &&
      (quarterFocus === 'both' || d.leadership_quarter.key === quarterFocus),
  );

  // Committed (S5/S6) with no NMD — highest urgency
  const noNmdCommitted = sellerDeals.filter((d) => {
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    return n != null && n >= 5 && isNoNmd(d);
  });
  if (noNmdCommitted.length > 0) {
    const totalEv = noNmdCommitted.reduce((a, d) => a + (d.leadership_contribution ?? 0), 0);
    return {
      text: `${noNmdCommitted.length} committed deal${noNmdCommitted.length > 1 ? 's' : ''} with no next step (${formatCurrency(totalEv)})`,
      tone: 'red',
    };
  }

  // Stale committed (S5/S6) — second priority
  const staleCommitted = sellerDeals.filter((d) => {
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    return n != null && n >= 5 && isDealStale(d, staleness);
  });
  if (staleCommitted.length > 0) {
    return {
      text: `${staleCommitted.length} committed deal${staleCommitted.length > 1 ? 's' : ''} stale — push to close`,
      tone: 'amber',
    };
  }

  // Very low coverage
  if (row.target > 0 && row.ratio < 0.5) {
    const needed = row.target * 1.5 - row.ev;
    return {
      text: `${row.ratio.toFixed(2)}× coverage — needs ${formatCurrency(needed)} pipeline to reach 1.5×`,
      tone: 'red',
    };
  }

  // Top-of-funnel heavy
  const earlyPct = row.ev > 0 ? row.earlyEv / row.ev : 0;
  if (earlyPct > 0.5) {
    return {
      text: `${Math.round(earlyPct * 100)}% top-of-funnel — push deals to S3+`,
      tone: 'amber',
    };
  }

  return null;
}

// ── focus this week panel ─────────────────────────────────────────────────
function FocusPanel({
  deals,
  staleness,
  quarterFocus,
}: {
  deals: RichDealRow[];
  staleness: Map<string, DealStaleness>;
  quarterFocus: 'both' | 'current' | 'next';
}) {
  const committedNoNmd = deals.filter((d) => {
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    return n != null && n >= 5 && isNoNmd(d) &&
      (quarterFocus === 'both' || d.leadership_quarter.key === quarterFocus);
  }).sort((a, b) => (b.leadership_contribution ?? 0) - (a.leadership_contribution ?? 0));

  // Committed stale but HAS NMD (not already in committedNoNmd)
  const committedStaleWithNmd = deals.filter((d) => {
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    if (n == null || n < 5) return false;
    if (quarterFocus !== 'both' && d.leadership_quarter.key !== quarterFocus) return false;
    if (isNoNmd(d)) return false;
    return isDealStale(d, staleness);
  }).sort((a, b) => (b.leadership_contribution ?? 0) - (a.leadership_contribution ?? 0));

  const totalItems = committedNoNmd.length + committedStaleWithNmd.length;
  if (totalItems === 0) return null;

  return (
    <div
      className="p-4 flex flex-col gap-3"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border-hairline)',
        borderLeft: '2px solid var(--status-red)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <p className="text-12 font-medium text-text-primary">
        Committed deals needing action this week
        <span className="ml-2 text-11 font-normal" style={{ color: 'var(--status-red)' }}>
          {committedNoNmd.length} with no next step · {committedStaleWithNmd.length} stale
        </span>
      </p>

      {committedNoNmd.length > 0 && (
        <div className="flex flex-col gap-0">
          {committedNoNmd.map((d, i) => {
            const days = dealStaleDays(d, staleness);
            const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
            const threshold = n != null ? (STALENESS_THRESHOLD[n] ?? 14) : 14;
            const stale = days != null && days >= threshold;
            return (
              <div key={i} className="flex items-center gap-3 py-1.5"
                style={{ borderTop: i > 0 ? '0.5px solid var(--border-hairline)' : undefined }}>
                <span className="text-11 text-text-tertiary w-16 flex-shrink-0">{d.leadership_seller.split(' ')[0]}</span>
                <span className="text-13 text-text-primary flex-1 min-w-0 truncate">{dealDisplay(d)}</span>
                <span className="text-11 text-text-secondary flex-shrink-0">{stageLabel(d.stage ?? d.deal_stage)}</span>
                {stale && days != null && <StaleBadge days={days} />}
                <NoNmdBadge />
                <span className="text-13 tabular-nums text-text-primary flex-shrink-0">{formatCurrency(d.leadership_contribution)}</span>
              </div>
            );
          })}
        </div>
      )}

      {committedStaleWithNmd.length > 0 && (
        <div className="flex flex-col gap-0">
          <p className="text-11 text-text-tertiary mb-1">Stale committed (has NMD but no stage movement)</p>
          {committedStaleWithNmd.map((d, i) => {
            const days = dealStaleDays(d, staleness);
            return (
              <div key={i} className="flex items-center gap-3 py-1.5"
                style={{ borderTop: i > 0 ? '0.5px solid var(--border-hairline)' : undefined }}>
                <span className="text-11 text-text-tertiary w-16 flex-shrink-0">{d.leadership_seller.split(' ')[0]}</span>
                <span className="text-13 text-text-primary flex-1 min-w-0 truncate">{dealDisplay(d)}</span>
                <span className="text-11 text-text-secondary flex-shrink-0">{stageLabel(d.stage ?? d.deal_stage)}</span>
                {days != null && <StaleBadge days={days} />}
                <span className="text-13 tabular-nums text-text-primary flex-shrink-0">{formatCurrency(d.leadership_contribution)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── expandable seller row (v2) ────────────────────────────────────────────
const PLAN_KEY = (seller: string) => `vp2_closure_plan__${seller.replace(/\s+/g, '_').toLowerCase()}`;

function SellerRowV2({
  row,
  allDeals,
  quarterFocus,
  staleness,
}: {
  row: SellerAggregate;
  allDeals: RichDealRow[];
  quarterFocus: 'both' | 'current' | 'next';
  staleness: Map<string, DealStaleness>;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(() => {
    try { return localStorage.getItem(PLAN_KEY(row.seller)) ?? ''; } catch { return ''; }
  });

  const focus = sellerFocusLabel(row, allDeals, staleness, quarterFocus);

  const sellerDeals = allDeals.filter(
    (d) => d.leadership_seller === row.seller &&
      (quarterFocus === 'both' || d.leadership_quarter.key === quarterFocus),
  );

  // Sort deals by urgency: S5/S6 no-NMD → S5/S6 stale → S5/S6 healthy → S3/S4 → S1/S2
  const sortedDeals = [...sellerDeals].sort((a, b) => {
    const nA = stageNumber(a.stage ?? a.deal_stage ?? a.dealStage) ?? 0;
    const nB = stageNumber(b.stage ?? b.deal_stage ?? b.dealStage) ?? 0;
    const urgencyA = nA >= 5 ? (isNoNmd(a) ? 0 : isDealStale(a, staleness) ? 1 : 2) : nA >= 3 ? 3 : 4;
    const urgencyB = nB >= 5 ? (isNoNmd(b) ? 0 : isDealStale(b, staleness) ? 1 : 2) : nB >= 3 ? 3 : 4;
    if (urgencyA !== urgencyB) return urgencyA - urgencyB;
    return (b.leadership_contribution ?? 0) - (a.leadership_contribution ?? 0);
  });

  const hasRisk = focus != null;

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-bg-hover transition-colors"
        style={{ borderBottom: '0.5px solid var(--border-hairline)' }}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Seller */}
        <td className="py-2.5 pl-3 pr-4" style={{ borderLeft: `2px solid ${hasRisk ? (focus?.tone === 'red' ? 'var(--status-red)' : 'var(--status-amber)') : 'transparent'}` }}>
          <div className="flex items-center gap-2">
            <span className="text-11 font-medium flex-shrink-0 flex items-center justify-center"
              style={{ width: 24, height: 24, background: 'var(--bg-surface)', border: '0.5px solid var(--border-emphasis)', borderRadius: '50%', color: 'var(--text-secondary)' }}>
              {row.seller[0]}
            </span>
            <div>
              <p className="text-13 font-medium text-text-primary">{row.seller}</p>
              <p className="text-11 text-text-tertiary">{row.open} open</p>
            </div>
          </div>
        </td>

        {/* Forecast vs target */}
        <td className="py-2.5 px-3" style={{ minWidth: 130 }}>
          <ForecastCell booked={row.booked} committed={row.committed} target={row.target} />
        </td>

        {/* Stage mix — all open deals for seller, unfiltered by quarter */}
        <td className="py-2.5 px-3">
          <StageMixBar deals={allDeals.filter(d => d.leadership_seller === row.seller)} />
        </td>

        {/* Booked */}
        <td className="py-2.5 px-3 text-13 tabular-nums text-right">
          <span style={{ color: row.booked > 0 ? 'var(--status-green)' : 'var(--text-tertiary)' }}>
            {row.booked > 0 ? formatCurrency(row.booked) : '—'}
          </span>
        </td>

        {/* Committed */}
        <td className="py-2.5 px-3 text-13 tabular-nums text-right">
          <span style={{ color: row.committed > 0 ? 'var(--accent)' : 'var(--text-tertiary)' }}>
            {row.committed > 0 ? formatCurrency(row.committed) : '—'}
          </span>
        </td>

        {/* Wtd pipeline */}
        <td className="py-2.5 px-3 text-13 text-text-primary tabular-nums text-right">
          {row.ev > 0 ? formatCurrency(row.ev) : '—'}
        </td>

        {/* Focus area (auto-derived) */}
        <td className="py-2.5 px-3" style={{ minWidth: 220 }}>
          {focus ? (
            <p className="text-11" style={{ color: toneColor[focus.tone] }}>{focus.text}</p>
          ) : (
            <span className="text-11" style={{ color: 'var(--status-green)', background: 'var(--status-green-bg)', borderRadius: 'var(--radius-sm)', padding: '1px 7px' }}>
              On track
            </span>
          )}
        </td>

        {/* Expand */}
        <td className="py-2.5 pr-3 text-text-tertiary text-11 text-right">{open ? '▲' : '▼'}</td>
      </tr>

      {open && (
        <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
          <td colSpan={8} className="p-0">
            <div className="bg-bg-surface p-4 flex flex-col gap-4">

              {/* Quarter breakdown */}
              {row.quarters.filter(q => quarterFocus === 'both' || q.quarter.key === quarterFocus).length > 0 && (
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
                        <th className="text-right pb-1 px-3 font-normal">Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.quarters
                        .filter(q => quarterFocus === 'both' || q.quarter.key === quarterFocus)
                        .map((q) => {
                          const qRatio = q.target > 0 ? q.ev / q.target : null;
                          const qTone = qRatio != null ? ratioTone(qRatio) : 'gray';
                          return (
                            <tr key={q.quarter.key} style={{ borderTop: '0.5px solid var(--border-hairline)' }}>
                              <td className="py-1 pr-4 text-text-primary">{q.quarter.label}</td>
                              <td className="py-1 px-3 text-right tabular-nums">
                                {q.target > 0 ? formatCurrency(q.target) : <span className="text-text-tertiary">—</span>}
                              </td>
                              <td className="py-1 px-3 text-right tabular-nums text-status-green">{q.booked > 0 ? formatCurrency(q.booked) : '—'}</td>
                              <td className="py-1 px-3 text-right tabular-nums" style={{ color: 'var(--accent)' }}>{q.committed > 0 ? formatCurrency(q.committed) : '—'}</td>
                              <td className="py-1 px-3 text-right tabular-nums">{formatCurrency(q.ev)}</td>
                              <td className="py-1 px-3 text-right tabular-nums" style={{ color: qRatio != null ? toneColor[qTone] : 'var(--text-tertiary)' }}>
                                {qRatio != null ? `${qRatio.toFixed(2)}×` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Deal list — sorted by urgency */}
              {sortedDeals.length > 0 && (
                <div>
                  <p className="text-11 text-text-secondary mb-2">Open deals ({sortedDeals.length}) — sorted by urgency</p>
                  <div className="flex flex-col gap-0">
                    {sortedDeals.map((d, i) => {
                      const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
                      const days = dealStaleDays(d, staleness);
                      const threshold = n != null ? (STALENESS_THRESHOLD[n] ?? 30) : 30;
                      const stale = days != null && days >= threshold;
                      const noNmd = isNoNmd(d);
                      const leftColor = (stale && noNmd) ? 'var(--status-red)'
                        : (stale || noNmd) ? 'var(--status-amber)'
                        : 'var(--border-hairline)';
                      return (
                        <div key={i} className="flex items-center gap-3 py-1.5"
                          style={{ borderTop: i > 0 ? '0.5px solid var(--border-hairline)' : undefined }}>
                          <span className="flex-shrink-0 w-0.5 self-stretch" style={{ background: leftColor }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-13 text-text-primary truncate">{dealDisplay(d)}</p>
                            <p className="text-11 text-text-tertiary">{stageLabel(d.stage ?? d.deal_stage)} · {d.leadership_quarter.label}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {stale && days != null && <StaleBadge days={days} />}
                            {noNmd && <NoNmdBadge />}
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
                  style={{ border: '0.5px solid var(--border-emphasis)', borderRadius: 'var(--radius-sm)', minHeight: 56, outline: 'none' }}
                  placeholder="Add closure notes…"
                  value={plan}
                  onChange={(e) => { setPlan(e.target.value); try { localStorage.setItem(PLAN_KEY(row.seller), e.target.value); } catch {} }}
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

// ── tiered at-risk section ────────────────────────────────────────────────
interface DealTierProps {
  title: string;
  tone: Tone;
  deals: RichDealRow[];
  staleness: Map<string, DealStaleness>;
}

function DealTier({ title, tone, deals, staleness }: DealTierProps) {
  if (deals.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: toneColor[tone] }} />
        <p className="text-12 font-medium" style={{ color: toneColor[tone] }}>{title}</p>
        <span className="text-11 text-text-tertiary">({deals.length})</span>
      </div>
      <table className="w-full text-13 mb-4">
        <thead>
          <tr className="text-11 text-text-tertiary">
            <th className="text-left pb-1.5 pr-4 font-normal">Seller</th>
            <th className="text-left pb-1.5 pr-4 font-normal">Deal</th>
            <th className="text-left pb-1.5 pr-4 font-normal">Stage</th>
            <th className="text-left pb-1.5 pr-4 font-normal">Days stale</th>
            <th className="text-left pb-1.5 pr-4 font-normal">Next meeting</th>
            <th className="text-right pb-1.5 font-normal">EV</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d, i) => {
            const days = dealStaleDays(d, staleness);
            const noNmd = isNoNmd(d);
            const stale = isDealStale(d, staleness);
            const leftColor = stale && noNmd ? 'var(--status-red)' : stale || noNmd ? 'var(--status-amber)' : 'var(--border-hairline)';
            return (
              <tr key={i} className="hover:bg-bg-hover"
                style={{ borderTop: '0.5px solid var(--border-hairline)', borderLeft: `2px solid ${leftColor}` }}>
                <td className="py-1.5 pr-4 text-text-secondary pl-2">{d.leadership_seller}</td>
                <td className="py-1.5 pr-4 text-text-primary max-w-xs truncate">{dealDisplay(d)}</td>
                <td className="py-1.5 pr-4 text-text-secondary">{stageLabel(d.stage ?? d.deal_stage)}</td>
                <td className="py-1.5 pr-4 tabular-nums" style={{ color: days != null ? toneColor[tone] : 'var(--text-tertiary)' }}>
                  {days != null ? `${days}d` : '—'}
                </td>
                <td className="py-1.5 pr-4 tabular-nums" style={{ color: noNmd ? 'var(--status-red)' : 'var(--text-secondary)' }}>
                  {d.next_meeting_date ? String(d.next_meeting_date).slice(0, 10) : '—'}
                </td>
                <td className="py-1.5 tabular-nums text-text-primary text-right">{formatCurrency(d.leadership_contribution)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AtRiskTiered({
  deals,
  staleness,
  quarterFocus,
}: {
  deals: RichDealRow[];
  staleness: Map<string, DealStaleness>;
  quarterFocus: 'both' | 'current' | 'next';
}) {
  const scoped = deals.filter(
    (d) => quarterFocus === 'both' || d.leadership_quarter.key === quarterFocus,
  );

  // Tier 1: S5/S6 with no NMD (committed, no next step — highest urgency)
  const tier1 = scoped.filter((d) => {
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    return n != null && n >= 5 && isNoNmd(d);
  }).sort((a, b) => (b.leadership_contribution ?? 0) - (a.leadership_contribution ?? 0));

  // Tier 2: S5/S6 stale (committed but stuck — still has NMD or not in tier1)
  const tier2 = scoped.filter((d) => {
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    if (n == null || n < 5) return false;
    if (isNoNmd(d)) return false; // already in tier 1
    return isDealStale(d, staleness);
  }).sort((a, b) => (b.leadership_contribution ?? 0) - (a.leadership_contribution ?? 0));

  // Tier 3: S3/S4 stale (mid-funnel stuck)
  const tier3 = scoped.filter((d) => {
    const n = stageNumber(d.stage ?? d.deal_stage ?? d.dealStage);
    return n != null && n >= 3 && n <= 4 && isDealStale(d, staleness);
  }).sort((a, b) => (b.leadership_contribution ?? 0) - (a.leadership_contribution ?? 0));

  const total = tier1.length + tier2.length + tier3.length;
  if (total === 0) return (
    <p className="text-13 text-text-tertiary py-2">No at-risk deals in current filter.</p>
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-13 font-medium text-text-primary">At-risk deals</p>
        <span className="text-11 text-text-tertiary">{total} total</span>
      </div>
      <DealTier title="Committed with no next step" tone="red" deals={tier1} staleness={staleness} />
      <DealTier title="Committed — stale in stage" tone="amber" deals={tier2} staleness={staleness} />
      <DealTier title="Mid-funnel stuck (S3/S4)" tone="amber" deals={tier3} staleness={staleness} />
    </div>
  );
}

// ── main view ─────────────────────────────────────────────────────────────
export function VerticalPerformanceV2() {
  const { credentials } = useAuth();
  const [quarterFocus, setQuarterFocus] = useSessionState<'both' | 'current' | 'next'>('vp2_quarter_focus', 'both');

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

  const asOf = versionData?.scorecard_summary?.as_of_date
    ?? versionData?.scorecard?.as_of_date
    ?? (storeData?.versions_meta?.[0]?.created_at ?? null);
  const quarterLabels = buildQuarterLabels(asOf);

  const { summary, deals } = useMemo(() => {
    if (!versionData) return { summary: [], deals: [] };
    return buildRows(versionData as Record<string, unknown>, targets, quarterLabels);
  }, [versionData, targets, quarterLabels]);

  const filteredSummary = summary.filter(
    (r) => quarterFocus === 'both' || r.quarter.key === quarterFocus,
  );

  const allOpenForFilter = deals.filter(
    (d) => quarterFocus === 'both' || d.leadership_quarter.key === quarterFocus,
  );

  const aggregates = useMemo(
    () => aggregateSellers(filteredSummary, allOpenForFilter),
    [filteredSummary, allOpenForFilter],
  );

  const stalenessQuery = useDealStaleness();
  const staleness = stalenessQuery.data ?? new Map<string, DealStaleness>();

  const totalTarget = aggregates.reduce((a, r) => a + r.target, 0);
  const totalEv = aggregates.reduce((a, r) => a + r.ev, 0);
  const totalBooked = aggregates.reduce((a, r) => a + r.booked, 0);
  const totalCommitted = aggregates.reduce((a, r) => a + r.committed, 0);
  const forecast = totalBooked + totalCommitted;

  const atRiskDeals = allOpenForFilter.filter((d) => d.leadership_risk.atRisk);

  const forecastTone: Tone = totalTarget === 0 ? 'green'
    : forecast >= totalTarget ? 'green'
    : forecast >= totalTarget * 0.7 ? 'amber' : 'red';

  const quarterScopeLabel = quarterFocus === 'both'
    ? `${quarterLabels.current}+${quarterLabels.next}`
    : quarterFocus === 'current' ? quarterLabels.current : quarterLabels.next;

  const asOfLabel = asOf
    ? new Date(asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  const isLoading = sharedStore.isLoading || versionQuery.isLoading;
  const error = sharedStore.error ?? versionQuery.error;

  return (
    <div className="flex flex-col gap-5">

      {/* Header + summary line */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-18 font-medium text-text-primary">Vertical performance</h1>
          <div className="flex items-center gap-2 mt-1 text-13 text-text-secondary flex-wrap">
            <span className="font-medium text-text-primary">{quarterScopeLabel}</span>
            <span className="text-text-tertiary">·</span>
            <span>
              Forecast{' '}
              <span className="font-medium tabular-nums" style={{ color: toneColor[forecastTone] }}>
                {forecast > 0 ? formatCurrency(forecast) : '—'}
              </span>
              {totalTarget > 0 && (
                <span className="text-text-tertiary"> vs {formatCurrency(totalTarget)} target</span>
              )}
            </span>
            <span className="text-text-tertiary">·</span>
            <span>Wtd pipeline <span className="tabular-nums">{totalEv > 0 ? formatCurrency(totalEv) : '—'}</span></span>
            {asOfLabel && <><span className="text-text-tertiary">·</span><span className="text-text-tertiary">as of {asOfLabel}</span></>}
          </div>
        </div>

        {/* Quarter filter only — this is a team view */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <label className="text-11 text-text-secondary">Quarter</label>
          <select style={selectStyle} value={quarterFocus} onChange={(e) => setQuarterFocus(e.target.value as typeof quarterFocus)}>
            <option value="both">Both quarters</option>
            <option value="current">{quarterLabels.current}</option>
            <option value="next">{quarterLabels.next}</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="text-13 px-3 py-2" style={{ background: 'var(--status-red-bg)', color: 'var(--status-red-text)', borderRadius: 'var(--radius-md)' }}>
          {error instanceof Error ? error.message : 'Failed to load data.'}
        </div>
      )}
      {isLoading && <p className="text-13 text-text-tertiary">Loading…</p>}

      {!isLoading && !error && (
        <>
          {/* Focus panel — committed deals needing action */}
          <FocusPanel deals={allOpenForFilter} staleness={staleness} quarterFocus={quarterFocus} />

          {/* Seller table */}
          <div className="bg-bg-card" style={{ border: '0.5px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}>
            <table className="w-full">
              <thead>
                <tr className="text-11 text-text-tertiary" style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                  <th className="text-left py-2 pl-3 pr-4 font-normal">Seller</th>
                  <th className="text-left py-2 px-3 font-normal" style={{ minWidth: 130 }}>Forecast vs target</th>
                  <th className="text-left py-2 px-3 font-normal">Stage mix (all open)</th>
                  <th className="text-right py-2 px-3 font-normal">Booked</th>
                  <th className="text-right py-2 px-3 font-normal">Committed</th>
                  <th className="text-right py-2 px-3 font-normal">Wtd pipeline</th>
                  <th className="text-left py-2 px-3 font-normal">Focus area</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {aggregates.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-11 text-text-tertiary">No data.</td>
                  </tr>
                ) : (
                  aggregates.map((r) => (
                    <SellerRowV2
                      key={r.seller}
                      row={r}
                      allDeals={allOpenForFilter}
                      quarterFocus={quarterFocus}
                      staleness={staleness}
                    />
                  ))
                )}
              </tbody>
              {aggregates.length > 1 && (
                <tfoot>
                  <tr className="text-13 font-medium" style={{ borderTop: '0.5px solid var(--border-emphasis)' }}>
                    <td className="py-2 pl-3 pr-4 text-text-secondary">Total</td>
                    <td className="py-2 px-3">
                      {totalTarget > 0 && (
                        <span className="text-13 font-medium tabular-nums" style={{ color: toneColor[ratioTone(totalEv / totalTarget)] }}>
                          {(totalEv / totalTarget).toFixed(2)}×
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3" />
                    <td className="py-2 px-3 text-right tabular-nums" style={{ color: 'var(--status-green)' }}>
                      {totalBooked > 0 ? formatCurrency(totalBooked) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums" style={{ color: 'var(--accent)' }}>
                      {totalCommitted > 0 ? formatCurrency(totalCommitted) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-text-primary">{formatCurrency(totalEv)}</td>
                    <td className="py-2 px-3">
                      {atRiskDeals.length > 0 && (
                        <span className="text-11" style={{
                          color: 'var(--status-amber-text)', background: 'var(--status-amber-bg)',
                          borderRadius: 'var(--radius-sm)', padding: '2px 7px',
                        }}>
                          {atRiskDeals.length} flagged
                        </span>
                      )}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* At-risk deals — tiered by urgency */}
          {atRiskDeals.length > 0 && (
            <div className="bg-bg-card p-4" style={{ border: '0.5px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}>
              <AtRiskTiered deals={atRiskDeals} staleness={staleness} quarterFocus={quarterFocus} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
