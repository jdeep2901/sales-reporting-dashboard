import { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useVersionData } from '@/lib/queries';
import { useSeller, SELLER_OPTIONS } from '@/lib/sellerContext';
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
import { formatCurrency, formatDelta, formatPercent } from '@/lib/formatters';
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
  prevTotalSize: number;
  prevTotalEv: number;
}

interface RankedDeal {
  row: DealRow;
  seller: string;
  stageN: number;
  stageName: string;
  ev: number;
  dealSize: number;
  momentum: Momentum;
  nextMeeting: string | null;
  introDate: string | null;
  dealLabel: string;
  daysInStage: number | null;
  daysInStageIsMin: boolean;
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

// ─── seller matching ──────────────────────────────────────────────────────────

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

function dateToFiscalQ(d: Date): string {
  const m = d.getMonth() + 1;
  const fiscalMonth = ((m - 4 + 12) % 12) + 1;
  const quarter = Math.floor((fiscalMonth - 1) / 3) + 1;
  const fy = m >= 4 ? d.getFullYear() + 1 : d.getFullYear();
  return `Q${quarter}'${String(fy).slice(-2)}`;
}

function fiscalQForDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(String(raw).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return dateToFiscalQ(d);
}

// ─── deal size ────────────────────────────────────────────────────────────────

function resolveSize(row: DealRow): number {
  const n = Number(row.deal_size);
  return isFinite(n) && n > 0 ? n : 0;
}

// EV for closure outlook: stage_probability × deal_size (no quarter-timing weight).
function closureEv(row: DealRow): number {
  const stageNorm = STAGE_NORM[String(row.stage ?? row.deal_stage ?? '').trim()] ?? String(row.stage ?? row.deal_stage ?? '').trim();
  const n = stageNumber(stageNorm);
  const cfg = n != null ? EMPIRICAL_STAGE[n] : undefined;
  if (!cfg) return 0;
  const size = n != null && n <= 4 ? 100_000 : resolveSize(row);
  if (size <= 0) return 0;
  return size * cfg.p;
}

// Won revenue paced to a fiscal quarter from start_date + duration_months.
function wonRevenuePacedToQ(rows: DealRow[], seller: string, qLabel: string): number {
  const won = rows.filter((r) => {
    if (!matchSeller(r, seller)) return false;
    const s = String(r.stage ?? r.deal_stage ?? '').toLowerCase();
    return s.includes('7. win') || s === 'won' || s === 'win';
  });
  const deduped = new Map<string, DealRow>();
  won.forEach((r) => { const k = dealKey(r); if (!deduped.has(k)) deduped.set(k, r); });
  let total = 0;
  deduped.forEach((r) => {
    const startRaw = r.start_date as string | null | undefined;
    if (!startRaw) return;
    const start = new Date(String(startRaw).slice(0, 10) + 'T00:00:00');
    if (isNaN(start.getTime())) return;
    const dealTotal = resolveSize(r);
    if (dealTotal <= 0) return;
    const dur = Math.round(Number(r.duration_months ?? 1)) || 1;
    for (let i = 0; i < dur; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      if (dateToFiscalQ(d) === qLabel) total += dealTotal / dur;
    }
  });
  return total;
}

// ─── won stats (FY) ──────────────────────────────────────────────────────────

interface WonStats {
  count: number;
  prevCount: number;
  totalSize: number;
  prevTotalSize: number;
}

function fyStartFromQLabel(qLabel: string): string {
  const m = qLabel.match(/^Q\d'(\d{2})$/);
  const fy = m ? 2000 + parseInt(m[1]) : 2027;
  return `${fy - 1}-04-01`;
}

function buildWonStats(rows: DealRow[], prevRows: DealRow[], seller: string, currentQLabel: string): WonStats {
  const fyStart = fyStartFromQLabel(currentQLabel);
  const filterWon = (r: DealRow): boolean => {
    if (!matchSeller(r, seller)) return false;
    if (normStage(r.stage ?? r.deal_stage) !== '7. Win') return false;
    return String(r.start_date ?? '').slice(0, 10) >= fyStart;
  };
  const dedup = (rs: DealRow[]) => {
    const m = new Map<string, DealRow>();
    rs.filter(filterWon).forEach((r) => { const k = dealKey(r); if (!m.has(k)) m.set(k, r); });
    return Array.from(m.values());
  };
  const curr = dedup(rows);
  const prev = dedup(prevRows);
  return {
    count: curr.length,
    prevCount: prev.length,
    totalSize: curr.reduce((a, r) => a + resolveSize(r), 0),
    prevTotalSize: prev.reduce((a, r) => a + resolveSize(r), 0),
  };
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
  const prevSizeByStage: Record<string, number> = {};
  const prevEvByStage: Record<string, number> = {};
  prev.forEach((r) => {
    const s = normStage(r.stage ?? r.deal_stage);
    prevCountByStage[s] = (prevCountByStage[s] ?? 0) + 1;
    prevSizeByStage[s] = (prevSizeByStage[s] ?? 0) + resolveSize(r);
    prevEvByStage[s] = (prevEvByStage[s] ?? 0) + empiricalEv(r, currentQLabel);
  });

  const byStage: Record<string, { rows: DealRow[] }> = {};
  curr.forEach((r) => {
    const s = normStage(r.stage ?? r.deal_stage);
    if (!byStage[s]) byStage[s] = { rows: [] };
    byStage[s].rows.push(r);
  });

  return ACTIVE_STAGES.map((stage) => {
    const stRows = (byStage[stage] ?? { rows: [] }).rows;
    const n = stageNumber(stage) ?? 0;
    const totalSize = stRows.reduce((acc, r) => acc + resolveSize(r), 0);
    const totalEv = stRows.reduce((acc, r) => acc + empiricalEv(r, currentQLabel), 0);
    return {
      stage,
      stageN: n,
      count: stRows.length,
      prevCount: prevCountByStage[stage] ?? 0,
      totalSize,
      totalEv,
      prevTotalSize: prevSizeByStage[stage] ?? 0,
      prevTotalEv: prevEvByStage[stage] ?? 0,
    };
  });
}

function classifyMomentum(row: DealRow, prevStageN: number | null): Momentum {
  const currentN = stageNumber(row.stage ?? row.deal_stage) ?? 0;
  if (prevStageN == null) return 'new';
  if (currentN > prevStageN) return 'advanced';
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
  compareSnapshotDate?: string | null,
): RankedDeal[] {
  const prevByKey = new Map<string, number>();
  prevRows.forEach((r) => {
    const k = dealKey(r);
    const n = stageNumber(r.stage ?? r.deal_stage);
    if (n != null) prevByKey.set(k, n);
  });

  const snapDate = compareSnapshotDate ? new Date(compareSnapshotDate) : null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const daysSinceSnap = snapDate
    ? Math.max(0, Math.round((today.getTime() - snapDate.getTime()) / 86_400_000))
    : null;

  const active = rows.filter((r) => matchSeller(r, seller) && isActiveStage(r.stage ?? r.deal_stage));
  const deduped = new Map<string, DealRow>();
  active.forEach((r) => { const k = dealKey(r); if (!deduped.has(k)) deduped.set(k, r); });

  const deals: RankedDeal[] = [];
  deduped.forEach((r, k) => {
    const stageNorm = normStage(r.stage ?? r.deal_stage);
    const stageN = stageNumber(stageNorm) ?? 0;
    const prevStageN = prevByKey.has(k) ? (prevByKey.get(k) ?? null) : null;
    const ev = empiricalEv(r, currentQLabel);
    const momentum = classifyMomentum(r, prevStageN);

    let daysInStage: number | null = null;
    let daysInStageIsMin = false;
    if (daysSinceSnap != null) {
      if (!prevByKey.has(k)) {
        daysInStage = null; // new deal — momentum badge covers this
      } else if (prevStageN === stageN) {
        daysInStage = daysSinceSnap;
        daysInStageIsMin = true;
      } else {
        daysInStage = daysSinceSnap;
        daysInStageIsMin = false;
      }
    }

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
      nextMeeting: r.next_meeting_date ? String(r.next_meeting_date).slice(0, 10) : null,
      introDate: r.intro_date ? String(r.intro_date).slice(0, 10) : null,
      dealLabel: String(r.deal ?? r.account ?? r.logo ?? '—'),
      daysInStage,
      daysInStageIsMin,
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

function buildClosureDeals(rows: DealRow[], seller: string, qLabel: string): RankedDeal[] {
  const active = rows.filter((r) => {
    if (!matchSeller(r, seller)) return false;
    if (!isActiveStage(r.stage ?? r.deal_stage)) return false;
    return fiscalQForDate(r.start_date as string | null) === qLabel;
  });
  const deduped = new Map<string, DealRow>();
  active.forEach((r) => { const k = dealKey(r); if (!deduped.has(k)) deduped.set(k, r); });

  const deals: RankedDeal[] = [];
  deduped.forEach((r) => {
    const stageNorm = normStage(r.stage ?? r.deal_stage);
    const stageN = stageNumber(stageNorm) ?? 0;
    const sellerOwner = seller === 'Overall'
      ? (Array.isArray(r.matched_sellers) && r.matched_sellers.length > 0 ? String(r.matched_sellers[0]) : String(r.owner ?? r.seller ?? '—'))
      : seller;
    deals.push({
      row: r,
      seller: sellerOwner,
      stageN,
      stageName: STAGE_SHORT[stageNorm] ?? stageNorm,
      ev: closureEv(r),
      dealSize: resolveSize(r),
      momentum: classifyMomentum(r, null),
      nextMeeting: r.next_meeting_date ? String(r.next_meeting_date).slice(0, 10) : null,
      introDate: r.intro_date ? String(r.intro_date).slice(0, 10) : null,
      dealLabel: String(r.deal ?? r.account ?? r.logo ?? '—'),
      daysInStage: null,
      daysInStageIsMin: false,
    });
  });
  return deals.sort((a, b) => b.ev - a.ev || b.stageN - a.stageN);
}

// ─── stage delta computation ──────────────────────────────────────────────────

interface DeltaDeal {
  dealLabel: string;
  seller: string;
  dealSize: number;
  prevDealSize?: number;     // size-changed deals: what size was in prev snapshot
  fromStage: string | null;  // entered: where they came from (null = brand new deal)
  toStage: string | null;    // exited: where they went (null = not found in current data)
}

interface StageDelta {
  exited: DeltaDeal[];      // were at this stage in prev, not now
  entered: DeltaDeal[];     // are at this stage now, weren't in prev
  sizeChanged: DeltaDeal[]; // stayed at this stage but deal_size changed
}

function buildStageDelta(
  allRows: DealRow[],
  prevRows: DealRow[],
  seller: string,
  stage: string,
): StageDelta {
  const resolveSeller = (r: DealRow): string => {
    if (seller !== 'Overall') return seller;
    return Array.isArray(r.matched_sellers) && r.matched_sellers.length > 0
      ? String(r.matched_sellers[0])
      : String(r.owner ?? r.seller ?? '—');
  };

  // Index ALL rows by dealKey → first matching row (any stage/seller)
  const allCurrByKey = new Map<string, DealRow>();
  allRows.forEach((r) => { const k = dealKey(r); if (!allCurrByKey.has(k)) allCurrByKey.set(k, r); });

  const allPrevByKey = new Map<string, DealRow>();
  prevRows.forEach((r) => { const k = dealKey(r); if (!allPrevByKey.has(k)) allPrevByKey.set(k, r); });

  const stageLabelOf = (raw: string | null | undefined): string => {
    if (!raw) return 'Unknown';
    const norm = normStage(raw);
    return STAGE_SHORT[norm] ?? norm;
  };

  // Exited: was at this stage in prev, is at a different stage (or gone) now
  const seenExited = new Set<string>();
  const exited: DeltaDeal[] = [];
  prevRows.forEach((r) => {
    if (!matchSeller(r, seller)) return;
    if (normStage(r.stage ?? r.deal_stage) !== stage) return;
    const k = dealKey(r);
    if (seenExited.has(k)) return;
    seenExited.add(k);
    const curr = allCurrByKey.get(k);
    const currStageNorm = curr ? normStage(curr.stage ?? curr.deal_stage) : null;
    if (currStageNorm === stage) return; // still here, not exited
    let toStage: string;
    if (!curr) {
      toStage = 'Removed from data';
    } else {
      const s = String(curr.stage ?? curr.deal_stage ?? '').toLowerCase();
      if (s.includes('7. win') || s === 'won' || s === 'win') toStage = 'Won ✓';
      else if (s.includes('lost') || s.includes('loss')) toStage = 'Lost';
      else toStage = stageLabelOf(curr.stage ?? curr.deal_stage);
    }
    exited.push({ dealLabel: String(r.deal ?? r.account ?? r.logo ?? '—'), seller: resolveSeller(r), dealSize: resolveSize(r), fromStage: null, toStage });
  });

  // Entered: is at this stage now, was at a different stage (or absent) in prev
  const seenEntered = new Set<string>();
  const entered: DeltaDeal[] = [];
  allRows.forEach((r) => {
    if (!matchSeller(r, seller)) return;
    if (normStage(r.stage ?? r.deal_stage) !== stage) return;
    const k = dealKey(r);
    if (seenEntered.has(k)) return;
    seenEntered.add(k);
    const prev = allPrevByKey.get(k);
    const prevStageNorm = prev ? normStage(prev.stage ?? prev.deal_stage) : null;
    if (prevStageNorm === stage) return; // was already here
    const fromStage = prev ? stageLabelOf(prev.stage ?? prev.deal_stage) : null;
    entered.push({ dealLabel: String(r.deal ?? r.account ?? r.logo ?? '—'), seller: resolveSeller(r), dealSize: resolveSize(r), fromStage, toStage: null });
  });

  // Size changed: stayed at this stage but deal_size was edited
  const seenSizeChanged = new Set<string>();
  const sizeChanged: DeltaDeal[] = [];
  allRows.forEach((r) => {
    if (!matchSeller(r, seller)) return;
    if (normStage(r.stage ?? r.deal_stage) !== stage) return;
    const k = dealKey(r);
    if (seenSizeChanged.has(k)) return;
    seenSizeChanged.add(k);
    const prev = allPrevByKey.get(k);
    if (!prev) return;
    if (normStage(prev.stage ?? prev.deal_stage) !== stage) return;
    const currSize = resolveSize(r);
    const prevSize = resolveSize(prev);
    if (currSize === prevSize) return;
    sizeChanged.push({
      dealLabel: String(r.deal ?? r.account ?? r.logo ?? '—'),
      seller: resolveSeller(r),
      dealSize: currSize,
      prevDealSize: prevSize,
      fromStage: null,
      toStage: null,
    });
  });

  return { exited, entered, sizeChanged };
}

// ─── badges ───────────────────────────────────────────────────────────────────

const MOMENTUM_CONFIG: Record<Momentum, { label: string; dot: string; bg: string; text: string }> = {
  at_risk:  { label: 'At risk',   dot: '●', bg: 'var(--status-red-bg)',   text: 'var(--status-red-text)' },
  stuck:    { label: 'Stuck',     dot: '◐', bg: 'var(--status-amber-bg)', text: 'var(--status-amber-text)' },
  new:      { label: 'New',       dot: '✦', bg: '#EEF2FF',                text: 'var(--accent)' },
  advanced: { label: 'Advancing', dot: '↑', bg: 'var(--status-green-bg)', text: 'var(--status-green-text)' },
  steady:   { label: 'Steady',    dot: '○', bg: 'var(--bg-surface)',       text: 'var(--text-tertiary)' },
};

function MomentumBadge({ m }: { m: Momentum }) {
  const c = MOMENTUM_CONFIG[m];
  return (
    <span className="text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: c.bg, color: c.text }}>
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

// ─── won row (FY) ────────────────────────────────────────────────────────────

function WonRow({ wonStats, maxCount, cols, allRows, prevRows, fyStart }: {
  wonStats: WonStats; maxCount: number; cols: string;
  allRows: DealRow[]; prevRows: DealRow[]; fyStart: string;
}) {
  const [open, setOpen] = useState(false);
  const wonDelta = wonStats.count - wonStats.prevCount;
  const wonSizeDelta = wonStats.totalSize - wonStats.prevTotalSize;
  const widthPct = maxCount > 0 ? Math.max(4, (wonStats.count / maxCount) * 100) : 4;
  const hasDelta = prevRows.length > 0;

  // All FY won deals, annotated with whether they're new since last snapshot
  const allWonDeals = useMemo(() => {
    const prevByKey = new Map<string, DealRow>();
    prevRows.forEach((r) => { const k = dealKey(r); if (!prevByKey.has(k)) prevByKey.set(k, r); });
    const seen = new Set<string>();
    const deals: Array<{ dealLabel: string; seller: string; dealSize: number; startDate: string | null; isNew: boolean }> = [];
    allRows.forEach((r) => {
      if (normStage(r.stage ?? r.deal_stage) !== '7. Win') return;
      if (String(r.start_date ?? '').slice(0, 10) < fyStart) return;
      const k = dealKey(r);
      if (seen.has(k)) return; seen.add(k);
      const prev = prevByKey.get(k);
      const isNew = !prev || normStage(prev.stage ?? prev.deal_stage) !== '7. Win';
      const sellerLabel = Array.isArray(r.matched_sellers) && r.matched_sellers.length > 0
        ? String(r.matched_sellers[0]) : String(r.owner ?? r.seller ?? '—');
      deals.push({ dealLabel: String(r.deal ?? r.account ?? '—'), seller: sellerLabel, dealSize: resolveSize(r), startDate: r.start_date ? String(r.start_date).slice(0, 10) : null, isNew });
    });
    return deals.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  }, [allRows, prevRows, fyStart]);

  const toggleOpen = () => setOpen((v) => !v);
  const stopAndToggle = (e: React.MouseEvent) => { e.stopPropagation(); toggleOpen(); };

  return (
    <div>
      <div
        onClick={toggleOpen}
        className="grid px-4 py-2.5 items-center hover:brightness-95 cursor-pointer"
        style={{ gridTemplateColumns: cols, borderTop: '1.5px solid var(--border-emphasis)', borderLeft: '2px solid var(--status-green)', background: open ? 'rgba(22,163,74,0.12)' : 'var(--status-green-bg)' }}
      >
        <span className="text-12 font-medium" style={{ color: 'var(--status-green-text)' }}>Won (FY)</span>
        <div className="pr-4">
          <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: 'rgba(22,163,74,0.15)' }}>
            <div className="h-full rounded-sm" style={{ width: `${widthPct}%`, background: 'var(--status-green)' }} />
          </div>
        </div>
        <div className="text-right">
          <span className="text-13 font-medium tabular-nums" style={{ color: 'var(--status-green-text)' }}>{wonStats.count}</span>
          {hasDelta && wonDelta !== 0 && (
            <button onClick={stopAndToggle} className="ml-1 text-11 tabular-nums underline decoration-dotted"
              title="Click to see won deals"
              style={{ color: wonDelta > 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
              {wonDelta > 0 ? `+${wonDelta}` : wonDelta}
            </button>
          )}
        </div>
        <div className="text-right">
          <div className="text-12 tabular-nums font-medium" style={{ color: 'var(--status-green-text)' }}>
            {wonStats.totalSize > 0 ? formatCurrency(wonStats.totalSize) : '—'}
          </div>
          {hasDelta && wonSizeDelta !== 0 && (
            <button onClick={stopAndToggle} className="text-11 tabular-nums underline decoration-dotted"
              style={{ color: wonSizeDelta > 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
              {formatDelta(wonSizeDelta)}
            </button>
          )}
        </div>
        <div className="text-right text-11 text-text-tertiary">—</div>
      </div>

      {open && (
        <div style={{ borderBottom: '0.5px solid var(--border-hairline)', background: 'var(--bg-card)' }}>
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="text-11 font-medium text-text-secondary">
              Won this FY — {allWonDeals.length} deal{allWonDeals.length !== 1 ? 's' : ''}
            </span>
            <button onClick={() => setOpen(false)} className="text-11 text-text-tertiary hover:text-text-primary">Close ×</button>
          </div>
          <table className="w-full text-12">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                <th className="text-left py-1.5 px-4 text-text-secondary font-medium">Deal</th>
                <th className="text-left py-1.5 px-2 text-text-secondary font-medium">Seller</th>
                <th className="text-right py-1.5 px-2 text-text-secondary font-medium">Size</th>
                <th className="text-right py-1.5 px-4 text-text-secondary font-medium">Start date</th>
              </tr>
            </thead>
            <tbody>
              {allWonDeals.map((d, i) => (
                <tr key={i} className="hover:bg-bg-hover" style={{ borderBottom: '0.5px solid var(--border-hairline)', borderLeft: d.isNew ? '2px solid var(--status-green)' : '2px solid transparent' }}>
                  <td className="py-1.5 px-4">
                    <span className="text-text-primary font-medium">{d.dealLabel}</span>
                    {d.isNew && <span className="ml-2 text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--status-green-bg)', color: 'var(--status-green-text)' }}>New</span>}
                  </td>
                  <td className="py-1.5 px-2 text-text-secondary">{d.seller}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums font-medium text-text-primary">{d.dealSize > 0 ? formatCurrency(d.dealSize) : '—'}</td>
                  <td className="py-1.5 px-4 text-right text-text-secondary">{d.startDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── funnel shape section ─────────────────────────────────────────────────────

function FunnelSection({
  stats,
  maxCount,
  onStageClick,
  activeStage,
  allRows,
  prevRows,
  seller,
  wonStats,
  fyStart,
}: {
  stats: StageStats[];
  maxCount: number;
  onStageClick?: (stage: string | null) => void;
  activeStage?: string | null;
  allRows: DealRow[];
  prevRows: DealRow[];
  seller: string;
  wonStats: WonStats;
  fyStart: string;
}) {
  const [expandedDelta, setExpandedDelta] = useState<string | null>(null);
  const deltaData = useMemo(() => {
    if (!expandedDelta) return null;
    return buildStageDelta(allRows, prevRows, seller, expandedDelta);
  }, [expandedDelta, allRows, prevRows, seller]);

  const totalEv = stats.reduce((a, s) => a + s.totalEv, 0);
  const cols = '140px 1fr 80px 110px 110px';

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '0.5px solid var(--border-hairline)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2">
          <span className="text-13 font-medium text-text-primary">Pipeline shape</span>
          {activeStage && (
            <button
              onClick={() => onStageClick?.(null)}
              className="text-11 px-2 py-0.5 rounded font-medium"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {STAGE_SHORT[activeStage] ?? activeStage} ×
            </button>
          )}
        </div>
        <span className="text-12 text-text-tertiary tabular-nums">Total EV {formatCurrency(totalEv)}</span>
      </div>
      <div className="bg-bg-card">
        <div className="grid px-4 py-2 text-11 text-text-tertiary font-medium"
          style={{ gridTemplateColumns: cols, borderBottom: '0.5px solid var(--border-hairline)' }}>
          <span>Stage</span>
          <span>Shape</span>
          <span className="text-right">Deals</span>
          <span className="text-right">Pipeline $</span>
          <span className="text-right">EV</span>
        </div>
        {stats.map((s) => {
          const delta = s.count - s.prevCount;
          const sizeDelta = s.totalSize - s.prevTotalSize;
          const evDeltaVal = s.totalEv - s.prevTotalEv;
          const widthPct = maxCount > 0 ? Math.max(4, (s.count / maxCount) * 100) : 4;
          const evShare = totalEv > 0 ? s.totalEv / totalEv : 0;
          const isLate = s.stageN >= 5;
          const isMid = s.stageN >= 3;
          const barColor = isLate ? 'var(--status-green)' : isMid ? 'var(--accent)' : 'var(--text-tertiary)';
          const isActive = activeStage === s.stage;

          const isDeltaOpen = expandedDelta === s.stage;
          const hasDelta = delta !== 0 && prevRows.length > 0;
          const hasSizeDelta = sizeDelta !== 0 && prevRows.length > 0 && (s.totalSize > 0 || s.prevTotalSize > 0);
          const hasEvDelta = evDeltaVal !== 0 && prevRows.length > 0 && (s.totalEv > 0 || s.prevTotalEv > 0);
          const openDelta = (e: React.MouseEvent) => { e.stopPropagation(); setExpandedDelta(isDeltaOpen ? null : s.stage); };

          return (
            <div key={s.stage}>
              <div
                onClick={() => onStageClick?.(isActive ? null : s.stage)}
                className={`grid px-4 py-2.5 items-center ${!isActive ? 'hover:bg-bg-hover' : ''}`}
                style={{
                  gridTemplateColumns: cols,
                  borderBottom: isDeltaOpen ? 'none' : '0.5px solid var(--border-hairline)',
                  borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  background: isActive ? 'rgba(99,91,255,0.04)' : undefined,
                  cursor: onStageClick ? 'pointer' : undefined,
                }}
              >
                <span className="text-12 text-text-primary font-medium">{STAGE_SHORT[s.stage] ?? s.stage}</span>
                <div className="flex items-center gap-2 pr-4">
                  <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
                    <div className="h-full rounded-sm transition-all"
                      style={{ width: `${widthPct}%`, background: barColor, opacity: isActive ? 1 : 0.7 }} />
                  </div>
                  {evShare > 0.02 && (
                    <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
                      <div className="h-full rounded-full" style={{ width: `${evShare * 100}%`, background: 'var(--accent)', opacity: 0.5 }} />
                    </div>
                  )}
                </div>
                {/* Deals + clickable delta */}
                <div className="text-right">
                  <span className="text-13 font-medium text-text-primary tabular-nums">{s.count}</span>
                  {hasDelta && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedDelta(isDeltaOpen ? null : s.stage); }}
                      className="ml-1 text-11 tabular-nums underline decoration-dotted"
                      title="Click to see what changed"
                      style={{ color: delta > 0 ? 'var(--status-green)' : 'var(--status-red)' }}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  )}
                </div>
                {/* Pipeline $ + clickable delta */}
                <div className="text-right">
                  <div className="text-12 tabular-nums text-text-secondary">
                    {s.totalSize > 0 ? formatCurrency(s.totalSize) : '—'}
                  </div>
                  {hasSizeDelta && (
                    <button
                      onClick={openDelta}
                      className="text-11 tabular-nums underline decoration-dotted"
                      title="Click to see what changed"
                      style={{ color: sizeDelta > 0 ? 'var(--status-green)' : 'var(--status-red)' }}
                    >
                      {formatDelta(sizeDelta)}
                    </button>
                  )}
                </div>
                {/* EV + clickable delta */}
                <div className="text-right">
                  <div className="text-12 tabular-nums font-medium"
                    style={{ color: s.totalEv > 0 ? (isLate ? 'var(--status-green)' : 'var(--text-primary)') : 'var(--text-tertiary)' }}>
                    {s.totalEv > 0 ? formatCurrency(s.totalEv) : '—'}
                  </div>
                  {hasEvDelta && (
                    <button
                      onClick={openDelta}
                      className="text-11 tabular-nums underline decoration-dotted"
                      title="Click to see what changed"
                      style={{ color: evDeltaVal > 0 ? 'var(--status-green)' : 'var(--status-red)' }}
                    >
                      {formatDelta(evDeltaVal)}
                    </button>
                  )}
                </div>
              </div>

              {/* Delta breakdown expansion */}
              {isDeltaOpen && deltaData && (
                <div className="px-4 py-3" style={{ borderBottom: '0.5px solid var(--border-hairline)', background: 'var(--bg-surface)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-11 font-medium text-text-secondary">
                      What changed — {STAGE_SHORT[s.stage] ?? s.stage}
                    </span>
                    <button onClick={() => setExpandedDelta(null)} className="text-11 text-text-tertiary hover:text-text-primary">Close ×</button>
                  </div>
                  <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                    {/* Exited */}
                    <div>
                      <div className="text-11 font-medium mb-1.5" style={{ color: 'var(--status-red)' }}>
                        Exited ({deltaData.exited.length})
                      </div>
                      {deltaData.exited.length === 0 ? (
                        <div className="text-11 text-text-tertiary">None</div>
                      ) : (
                        <div className="space-y-1">
                          {deltaData.exited.map((d, i) => {
                            const isWon = d.toStage?.includes('Won');
                            const isLostDeal = d.toStage === 'Lost';
                            const color = isWon ? 'var(--status-green)' : isLostDeal ? 'var(--status-red)' : 'var(--status-amber)';
                            return (
                              <div key={i} className="text-11 space-y-0.5">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-text-primary font-medium truncate">{d.dealLabel}</span>
                                  <span className="shrink-0 font-medium" style={{ color }}>→ {d.toStage}</span>
                                </div>
                                <div className="text-text-tertiary tabular-nums">{d.dealSize > 0 ? formatCurrency(d.dealSize) : '—'}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {/* Size changes */}
                    <div>
                      <div className="text-11 font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                        Size edits ({deltaData.sizeChanged.length})
                      </div>
                      {deltaData.sizeChanged.length === 0 ? (
                        <div className="text-11 text-text-tertiary">None</div>
                      ) : (
                        <div className="space-y-1">
                          {deltaData.sizeChanged.map((d, i) => {
                            const diff = d.dealSize - (d.prevDealSize ?? 0);
                            return (
                              <div key={i} className="text-11 space-y-0.5">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-text-primary font-medium truncate">{d.dealLabel}</span>
                                  <span className="shrink-0 font-medium tabular-nums"
                                    style={{ color: diff > 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
                                    {diff > 0 ? `+${formatCurrency(diff)}` : formatDelta(diff)}
                                  </span>
                                </div>
                                <div className="text-text-tertiary tabular-nums">
                                  {formatCurrency(d.prevDealSize ?? 0)} → {d.dealSize > 0 ? formatCurrency(d.dealSize) : '—'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {/* Entered */}
                    <div>
                      <div className="text-11 font-medium mb-1.5" style={{ color: 'var(--status-green)' }}>
                        Entered ({deltaData.entered.length})
                      </div>
                      {deltaData.entered.length === 0 ? (
                        <div className="text-11 text-text-tertiary">None</div>
                      ) : (
                        <div className="space-y-1">
                          {deltaData.entered.map((d, i) => (
                            <div key={i} className="text-11 space-y-0.5">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-text-primary font-medium truncate">{d.dealLabel}</span>
                                <span className="shrink-0" style={{ color: d.fromStage ? 'var(--status-amber)' : 'var(--accent)' }}>
                                  {d.fromStage ? `← ${d.fromStage}` : '✦ New deal'}
                                </span>
                              </div>
                              <div className="text-text-tertiary tabular-nums">{d.dealSize > 0 ? formatCurrency(d.dealSize) : '—'}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Won row — FY to date */}
        <WonRow wonStats={wonStats} maxCount={maxCount} cols={cols} allRows={allRows} prevRows={prevRows} fyStart={fyStart} />
      </div>
    </div>
  );
}

// ─── closure section ──────────────────────────────────────────────────────────

function ClosureSection({ qLabel, deals, target, collapsed }: { qLabel: string; deals: RankedDeal[]; target: number; collapsed: boolean }) {
  const totalEv = deals.reduce((a, d) => a + d.ev, 0);
  const coverage = target > 0 ? totalEv / target : 0;
  const coverageColor = coverage >= 0.8 ? 'var(--status-green)' : coverage >= 0.5 ? 'var(--status-amber)' : 'var(--status-red)';

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
      <div className="px-4 py-3"
        style={{ borderBottom: collapsed ? 'none' : '0.5px solid var(--border-hairline)', background: 'var(--bg-surface)' }}>
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
        {target > 0 && (
          <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border-hairline)' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, coverage * 100)}%`, background: coverageColor }} />
          </div>
        )}
      </div>

      {!collapsed && (
        deals.length === 0 ? (
          <div className="px-4 py-4 text-12 text-text-tertiary">No deals with expected start in {qLabel}.</div>
        ) : (
          <table className="w-full text-12">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                <th className="text-left py-2 px-4 text-text-secondary font-medium">Deal</th>
                <th className="text-left py-2 px-2 text-text-secondary font-medium">Stage</th>
                <th className="text-right py-2 px-2 text-text-secondary font-medium">EV</th>
                <th className="text-right py-2 px-2 text-text-secondary font-medium">Size</th>
                <th className="text-right py-2 px-2 text-text-secondary font-medium">Start date</th>
                <th className="text-right py-2 px-4 text-text-secondary font-medium">Next meeting</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d, i) => {
                const risk = dealRisk(d.row);
                const overdue = d.nextMeeting && new Date(d.nextMeeting) < new Date();
                const startDate = d.row.start_date ? String(d.row.start_date).slice(0, 10) : null;
                return (
                  <tr key={i}
                    style={{ borderBottom: '0.5px solid var(--border-hairline)', borderLeft: `2px solid ${risk.atRisk ? 'var(--status-amber)' : 'transparent'}` }}
                    className="hover:bg-bg-hover">
                    <td className="py-2 px-4">
                      <div className="text-text-primary font-medium">{d.dealLabel}</div>
                      {d.seller && <div className="text-11 text-text-tertiary">{d.seller}</div>}
                    </td>
                    <td className="py-2 px-2"><StageBadge n={d.stageN} label={d.stageName} /></td>
                    <td className="py-2 px-2 text-right tabular-nums font-medium text-text-primary">{formatCurrency(d.ev)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-text-secondary">{d.dealSize > 0 ? formatCurrency(d.dealSize) : '—'}</td>
                    <td className="py-2 px-2 text-right text-text-secondary">{startDate ?? '—'}</td>
                    <td className="py-2 px-4 text-right" style={{ color: overdue ? 'var(--status-red)' : 'var(--text-secondary)' }}>
                      {d.nextMeeting ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

// ─── deal momentum section ────────────────────────────────────────────────────

function DealMomentumSection({
  deals,
  stageFilter,
  onClearStageFilter,
}: {
  deals: RankedDeal[];
  stageFilter?: string | null;
  onClearStageFilter?: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<Momentum | 'all'>('all');

  const stageFilterN = stageFilter != null ? stageNumber(stageFilter) : null;
  const stageFiltered = stageFilterN != null ? deals.filter((d) => d.stageN === stageFilterN) : deals;

  const counts = useMemo(() => {
    const c: Partial<Record<Momentum, number>> = {};
    stageFiltered.forEach((d) => { c[d.momentum] = (c[d.momentum] ?? 0) + 1; });
    return c;
  }, [stageFiltered]);

  const visible = filter === 'all' ? stageFiltered : stageFiltered.filter((d) => d.momentum === filter);

  const filters: Array<{ key: Momentum | 'all'; label: string }> = [
    { key: 'all', label: `All ${stageFiltered.length}` },
    { key: 'at_risk', label: `At risk ${counts.at_risk ?? 0}` },
    { key: 'stuck', label: `Stuck ${counts.stuck ?? 0}` },
    { key: 'advanced', label: `Advancing ${counts.advanced ?? 0}` },
    { key: 'new', label: `New ${counts.new ?? 0}` },
    { key: 'steady', label: `Steady ${counts.steady ?? 0}` },
  ];

  const displayDaysInStage = (d: RankedDeal): string => {
    if (d.daysInStage == null) return d.momentum === 'new' ? 'New' : '—';
    if (d.daysInStageIsMin) return `≥${d.daysInStage}d`;
    return `<${d.daysInStage}d`;
  };

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
      <div className="px-4 py-3"
        style={{ borderBottom: '0.5px solid var(--border-hairline)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-13 font-medium text-text-primary">Deal momentum</span>
            {stageFilter && (
              <span className="text-12 text-text-secondary">
                · <span className="font-medium text-text-primary">{STAGE_SHORT[stageFilter] ?? stageFilter}</span>
                <button onClick={onClearStageFilter} className="ml-1 text-text-tertiary hover:text-text-primary">×</button>
              </span>
            )}
          </div>
          <div className="flex gap-1 flex-wrap justify-end">
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
              <th className="text-right py-2 px-2 text-text-secondary font-medium">EV</th>
              <th className="text-right py-2 px-2 text-text-secondary font-medium">Size</th>
              <th className="text-right py-2 px-2 text-text-secondary font-medium">Days in stage</th>
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
              const stageAge = d.daysInStage ?? 0;
              const stageAgeColor = d.daysInStageIsMin && stageAge > 21 ? 'var(--status-amber)' : 'var(--text-secondary)';

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
                    <td className="py-2 px-2 text-right tabular-nums font-medium text-text-primary">
                      {d.ev > 0 ? formatCurrency(d.ev) : '—'}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-text-secondary">
                      {d.dealSize > 0 ? formatCurrency(d.dealSize) : '—'}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums" style={{ color: stageAgeColor }}>
                      {displayDaysInStage(d)}
                    </td>
                    <td className="py-2 px-4 text-right" style={{ color: overdue ? 'var(--status-red)' : 'var(--text-secondary)' }}>
                      {d.nextMeeting ?? '—'}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={key + '-exp'} style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                      <td colSpan={7} className="px-4 py-3" style={{ background: 'var(--bg-surface)' }}>
                        <div className="text-12 text-text-secondary space-y-1">
                          <p><span className="text-text-tertiary">Intro date:</span> {d.introDate ?? '—'}</p>
                          {d.row.start_date && (
                            <p>
                              <span className="text-text-tertiary">Expected start:</span>{' '}
                              {String(d.row.start_date).slice(0, 10)} ({fiscalQForDate(d.row.start_date as string | null) ?? '—'})
                            </p>
                          )}
                          {d.row.duration_months && (
                            <p><span className="text-text-tertiary">Duration:</span> {d.row.duration_months} months</p>
                          )}
                          {risk.atRisk && (
                            <p className="font-medium" style={{ color: 'var(--status-amber)' }}>{risk.label}</p>
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

// ─── main component ───────────────────────────────────────────────────────────

export function WeeklyScorecard() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};
  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;

  const dataset = (storeData?.dataset as Record<string, unknown> | null) ?? null;
  const allRows: DealRow[] = Array.isArray(dataset?.all_deals_rows) ? dataset!.all_deals_rows as DealRow[] : [];
  const asOfDate = String(
    (dataset?.scorecard as Record<string, unknown> | null)?.as_of_date ??
    (dataset?.scorecard_summary as Record<string, unknown> | null)?.as_of_date ?? ''
  );
  const quarterTargets = ((storeData?.quarter_targets ?? {}) as QuarterTargets);

  const versionsMeta = useMemo(() => {
    const v = storeData?.versions_meta ?? storeData?.versions;
    return Array.isArray(v) ? (v as Array<{ id: string; created_at: string }>) : [];
  }, [storeData]);

  const latestId = String(storeData?.latest_version_id ?? storeData?.active_version_id ?? '');

  const allVersionsSortedAsc = useMemo(() => {
    return [...versionsMeta].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [versionsMeta]);

  const versionNumber = (id: string) => allVersionsSortedAsc.findIndex((v) => v.id === id) + 1;

  const sortedVersions = useMemo(() => {
    return [...versionsMeta]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .filter((v) => v.id !== latestId);
  }, [versionsMeta, latestId]);

  const autoPrevId = sortedVersions[0]?.id ?? null;
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const effectiveCompareId = compareVersionId ?? autoPrevId;

  const compareVersionMeta = versionsMeta.find((v) => v.id === effectiveCompareId);
  const compareSnapshotDate = compareVersionMeta?.created_at ?? null;

  const prevQuery = useVersionData(username ?? null, password ?? null, effectiveCompareId);
  const prevRow = prevQuery.data as { dataset?: { all_deals_rows?: DealRow[] } } | null;
  const prevRows: DealRow[] = prevRow?.dataset?.all_deals_rows ?? [];

  const { seller, setSeller } = useSeller();
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [closuresCollapsed, setClosuresCollapsed] = useState(false);

  const handleStageClick = (stage: string | null) => {
    setStageFilter(stage);
    if (stage !== null) setClosuresCollapsed(true);
    else setClosuresCollapsed(false);
  };
  const quarterLabels = useMemo(() => buildQuarterLabels(asOfDate || null), [asOfDate]);

  const stageStats = useMemo(
    () => buildStageStats(allRows, prevRows, seller, quarterLabels.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, prevRows, seller, quarterLabels.current],
  );

  const rankedDeals = useMemo(
    () => buildRankedDeals(allRows, prevRows, seller, quarterLabels.current, compareSnapshotDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, prevRows, seller, quarterLabels.current, compareSnapshotDate],
  );

  const wonStats = useMemo(
    () => buildWonStats(allRows, prevRows, seller, quarterLabels.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, prevRows, seller, quarterLabels.current],
  );

  const closureCurrent = useMemo(
    () => buildClosureDeals(allRows, seller, quarterLabels.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, seller, quarterLabels.current],
  );
  const closureNext = useMemo(
    () => buildClosureDeals(allRows, seller, quarterLabels.next),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, seller, quarterLabels.next],
  );

  // ── KPI aggregates ──
  const totalEv = stageStats.reduce((a, s) => a + s.totalEv, 0);
  const prevTotalEvAll = stageStats.reduce((a, s) => a + s.prevTotalEv, 0);
  const evDeltaKpi = prevRows.length > 0 ? totalEv - prevTotalEvAll : 0;

  const totalActiveDeals = stageStats.reduce((a, s) => a + s.count, 0);
  const prevTotalDeals = stageStats.reduce((a, s) => a + s.prevCount, 0);
  const dealsDelta = totalActiveDeals - prevTotalDeals;

  const lateStageStats = stageStats.filter((s) => s.stageN >= 5);
  const lateCount = lateStageStats.reduce((a, s) => a + s.count, 0);
  const lateEv = lateStageStats.reduce((a, s) => a + s.totalEv, 0);
  const prevLateCount = lateStageStats.reduce((a, s) => a + s.prevCount, 0);
  const lateCountDelta = prevRows.length > 0 ? lateCount - prevLateCount : 0;

  const atRiskCount = rankedDeals.filter((d) => d.momentum === 'at_risk' || d.momentum === 'stuck').length;
  const advancingCount = rankedDeals.filter((d) => d.momentum === 'advanced').length;

  const currentActuals = useMemo(
    () => wonRevenuePacedToQ(allRows, seller, quarterLabels.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, seller, quarterLabels.current],
  );
  const prevActuals = useMemo(
    () => wonRevenuePacedToQ(prevRows, seller, quarterLabels.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prevRows, seller, quarterLabels.current],
  );
  const actualsDelta = prevRows.length > 0 ? currentActuals - prevActuals : 0;

  const overallTarget = seller === 'Overall'
    ? ACTIVE_SELLERS.reduce((acc, s) => acc + getTarget(quarterTargets, s, quarterLabels.current), 0)
    : getTarget(quarterTargets, seller, quarterLabels.current);
  const coverage = overallTarget > 0 ? totalEv / overallTarget : 0;
  const coverageTone = coverage >= 1.5 ? 'green' : coverage >= 0.8 ? 'amber' : 'red';
  const coverageColor = `var(--status-${coverageTone})`;

  const nextTarget = seller === 'Overall'
    ? ACTIVE_SELLERS.reduce((acc, s) => acc + getTarget(quarterTargets, s, quarterLabels.next), 0)
    : getTarget(quarterTargets, seller, quarterLabels.next);

  const maxCount = Math.max(1, wonStats.count, ...stageStats.map((s) => s.count));

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
                  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                  return <option key={v.id} value={v.id}>v{versionNumber(v.id)} — {date} {time}</option>;
                })}
              </select>
            </div>
          )}
          <select
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            className="text-13 px-3 py-1.5 rounded-md bg-bg-surface text-text-primary"
            style={{ border: '0.5px solid var(--border-emphasis)' }}
          >
            {SELLER_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* KPI strip — 6 cards, 3 per row */}
      <div className="grid grid-cols-3 gap-3">
        {/* Coverage */}
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: `2px solid ${coverageColor}` }}>
          <div className="text-11 text-text-secondary mb-1">{quarterLabels.current} coverage</div>
          <div className="text-22 font-medium tabular-nums" style={{ color: coverageColor }}>
            {coverage > 0 ? `${coverage.toFixed(1)}x` : '—'}
          </div>
          <div className="text-11 text-text-tertiary mt-1">
            EV {formatCurrency(totalEv)} · T {formatCurrency(overallTarget)}
          </div>
        </div>

        {/* Active pipeline */}
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
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: lateCount > 0 ? '2px solid var(--status-green)' : undefined }}>
          <div className="text-11 text-text-secondary mb-1">Late stage (5–6)</div>
          <div className="flex items-baseline gap-2">
            <span className="text-22 font-medium text-text-primary tabular-nums">{lateCount}</span>
            {lateCountDelta !== 0 && prevRows.length > 0 && (
              <span className="text-13 font-medium tabular-nums"
                style={{ color: lateCountDelta > 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
                {lateCountDelta > 0 ? `+${lateCountDelta}` : lateCountDelta}
              </span>
            )}
          </div>
          <div className="text-11 text-text-tertiary mt-1">
            {lateEv > 0 ? `${formatCurrency(lateEv)} EV` : 'no deals'}
          </div>
        </div>

        {/* Pipeline EV */}
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)' }}>
          <div className="text-11 text-text-secondary mb-1">Pipeline EV</div>
          <div className="flex items-baseline gap-2">
            <span className="text-22 font-medium text-text-primary tabular-nums">
              {totalEv > 0 ? formatCurrency(totalEv) : '—'}
            </span>
            {evDeltaKpi !== 0 && prevRows.length > 0 && (
              <span className="text-13 font-medium tabular-nums"
                style={{ color: evDeltaKpi > 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
                {formatDelta(evDeltaKpi)}
              </span>
            )}
          </div>
          <div className="text-11 text-text-tertiary mt-1">expected value, all stages</div>
        </div>

        {/* Actuals */}
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: currentActuals > 0 ? '2px solid var(--status-green)' : undefined }}>
          <div className="text-11 text-text-secondary mb-1">{quarterLabels.current} actuals</div>
          <div className="flex items-baseline gap-2">
            <span className="text-22 font-medium text-text-primary tabular-nums">
              {currentActuals > 0 ? formatCurrency(currentActuals) : '—'}
            </span>
            {actualsDelta !== 0 && prevRows.length > 0 && (
              <span className="text-13 font-medium tabular-nums"
                style={{ color: actualsDelta > 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
                {formatDelta(actualsDelta)}
              </span>
            )}
          </div>
          <div className="text-11 text-text-tertiary mt-1">won revenue, quarter-paced</div>
        </div>

        {/* Movement signals */}
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: atRiskCount > 0 ? '2px solid var(--status-amber)' : undefined }}>
          <div className="text-11 text-text-secondary mb-1">Movement signals</div>
          <div className="flex items-baseline gap-3">
            <span className="text-22 font-medium tabular-nums"
              style={{ color: atRiskCount > 0 ? 'var(--status-amber)' : 'var(--text-primary)' }}>
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
      <FunnelSection
        stats={stageStats}
        maxCount={maxCount}
        onStageClick={handleStageClick}
        activeStage={stageFilter}
        allRows={allRows}
        prevRows={prevRows}
        seller={seller}
        wonStats={wonStats}
        fyStart={fyStartFromQLabel(quarterLabels.current)}
      />

      {/* Closure outlook */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-13 font-medium text-text-secondary">Closure outlook</span>
          <button
            onClick={() => setClosuresCollapsed(!closuresCollapsed)}
            className="text-12 text-text-tertiary hover:text-text-primary flex items-center gap-1"
          >
            {closuresCollapsed ? '▸ Expand' : '▾ Collapse'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <ClosureSection qLabel={quarterLabels.current} deals={closureCurrent} target={overallTarget} collapsed={closuresCollapsed} />
          <ClosureSection qLabel={quarterLabels.next} deals={closureNext} target={nextTarget} collapsed={closuresCollapsed} />
        </div>
      </div>

      {/* Deal momentum */}
      <DealMomentumSection
        deals={rankedDeals}
        stageFilter={stageFilter}
        onClearStageFilter={() => handleStageClick(null)}
      />
    </div>
  );
}
