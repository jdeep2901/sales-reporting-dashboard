// Pure computation for Vertical Performance view.
// Ported from legacy/index.html renderLeadershipForecastV2 and helpers.

export const ACTIVE_SELLERS = [
  'Akshay Iyer',
  'Somya',
  'Maruti Peri',
  'Andy Shankar',
  'Sahana',
  'Suvom Mitro',
] as const;

export type SellerName = (typeof ACTIVE_SELLERS)[number];

// Stage ordering matching MATTER_STAGE_ORDER in legacy code
const MATTER_STAGE_ORDER = [
  '1. Intro',
  '2. Qualification',
  '3. Capability',
  '4. Problem Scoping',
  '6. Commercial Proposal',
  '5. Contracting',
  '7. Win',
  '8. Loss',
];

const FUNNEL_ORDER = [
  '1. Intro',
  '2. Qualification',
  '3. Capability',
  '4. Problem Scoping',
  '6. Commercial Proposal',
  '5. Contracting',
  '7. Latent Pool - Monthly',
  '7. Win',
  '8. Loss',
  '9. Disqualified',
  '10. No Show/ Reschedule',
  '11. Latent Pool - Bi-monthly',
  '12. Latent Pool - Half yearly revisit',
];

const STAGE_MAP: Record<string, string> = {
  'Scheduled Intro calls': '1. Intro',
  Qualification: '2. Qualification',
  'Capabilities showcase': '3. Capability',
  'Problem Scoping': '4. Problem Scoping',
  Contracting: '5. Contracting',
  'Commercial Proposal': '6. Commercial Proposal',
  'Latent Pool - Monthly': '7. Latent Pool - Monthly',
  Won: '7. Win',
  Lost: '8. Loss',
  Disqualified: '9. Disqualified',
  'No Show/ Reschedule': '10. No Show/ Reschedule',
  'Latent Pool - Bi-monthly': '11. Latent Pool - Bi-monthly',
  'Latent Pool - Half yearly revisit': '12. Latent Pool - Half yearly revisit',
};

const SELLER_ALIASES: Record<string, string[]> = {
  'Akshay Iyer': ['akshay iyer', 'akshay'],
  Somya: ['somya'],
  'Maruti Peri': ['maruti peri', 'peri'],
  'Andy Shankar': ['andy shankar', 'andy'],
  Sahana: ['sahana'],
  'Suvom Mitro': ['suvom mitro', 'suvom'],
};

// Empirical win probabilities for each stage (v2 — source of truth)
export const EMPIRICAL_STAGE: Record<number, { p: number; label: string }> = {
  1: { p: 0.08, label: 'Intro' },
  2: { p: 0.10, label: 'Qualification' },
  3: { p: 0.19, label: 'Capability' },
  4: { p: 0.29, label: 'Problem Scoping' },
  5: { p: 0.44, label: 'Commercial Proposal' },
  6: { p: 0.90, label: 'Contracting' },
};

export const STALENESS_THRESHOLD: Record<number, number> = {
  1: 45, 2: 30, 3: 21, 4: 21, 5: 14, 6: 14,
};

export interface DealRow {
  item_id?: string | null;
  stage?: string;
  deal_stage?: string;
  dealStage?: string;
  deal_size?: number | string | null;
  start_date?: string | null;
  intro_date?: string | null;
  duration_months?: number | string | null;
  next_meeting_date?: string | null;
  last_connect_date?: string | null;
  last_meeting_date?: string | null;
  last_call_date?: string | null;
  last_activity_date?: string | null;
  last_touch_date?: string | null;
  last_connected_date?: string | null;
  owner?: string | null;
  seller?: string | null;
  deal_owner?: string | null;
  matched_sellers?: string[];
  logo?: string | null;
  account?: string | null;
  deal?: string | null;
  tech_stack?: string | null;
  partner_source_type?: string | null;
  alliances_team_intro?: string | null;
  partner_registered_on_portal?: string | null;
  partner_approved_on_portal?: string | null;
  partner_funded?: string | null;
  partner_ae?: string | null;
  [key: string]: unknown;
}

export interface RichDealRow extends DealRow {
  leadership_seller: string;
  leadership_quarter: { key: 'current' | 'next'; label: string };
  leadership_contribution: number;
  leadership_total_size: number;
  leadership_risk: RiskInfo;
  leadership_partner: PartnerInfo;
  leadership_action: string;
}

export interface QuarterSummary {
  seller: string;
  quarter: { key: 'current' | 'next'; label: string };
  target: number;
  booked: number;
  committed: number;
  bookedCommitted: number;
  ev: number;
  flooredEv: number;
  earlyEv: number; // S1+S2 only — complement of S3+ (earlyEv/ev + s3PlusPct = 1)
}

export interface SellerAggregate {
  seller: string;
  target: number;
  booked: number;
  committed: number;
  bookedCommitted: number;
  ev: number;
  flooredEv: number;
  earlyEv: number;
  open: number;
  atRisk: number;
  riskExposure: number;
  ratio: number;
  gap: number;
  quarters: QuarterSummary[];
  deals: RichDealRow[];
}

export interface RiskInfo {
  atRisk: boolean;
  label: string;
  lastConnect: string;
}

export interface PartnerInfo {
  involved: boolean;
  text: string;
}

export interface QuarterTargets {
  [key: string]: { seller: string; quarter: string; revenue: number };
}

// ─── date helpers ────────────────────────────────────────────────────────────

function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

interface FiscalQInfo { quarter: number; fiscalYear: number }

function fiscalQInfo(date: Date): FiscalQInfo {
  const m = date.getMonth() + 1; // 1-based
  const fiscalMonth = ((m - 4 + 12) % 12) + 1;
  const quarter = Math.floor((fiscalMonth - 1) / 3) + 1;
  const fiscalYear = m >= 4 ? date.getFullYear() + 1 : date.getFullYear();
  return { quarter, fiscalYear };
}

function fiscalQText({ quarter, fiscalYear }: FiscalQInfo): string {
  return `Q${quarter}'${String(fiscalYear).slice(-2)}`;
}

function fiscalQIndex({ quarter, fiscalYear }: FiscalQInfo): number {
  return fiscalYear * 4 + (quarter - 1);
}

function normalizeQuarterLabel(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^Q([1-4])'?(\d{2})$/);
  if (m) return `Q${m[1]}'${m[2]}`;
  const fy = s.match(/^Q([1-4])FY(\d{2})$/);
  if (fy) return `Q${fy[1]}'${fy[2]}`;
  return null;
}

function quarterLabelToInfo(qLabel: string): FiscalQInfo | null {
  const q = normalizeQuarterLabel(qLabel);
  if (!q) return null;
  const m = q.match(/^Q([1-4])'(\d{2})$/);
  if (!m) return null;
  return { quarter: Number(m[1]), fiscalYear: 2000 + Number(m[2]) };
}

function quarterLabelForDate(date: Date): string {
  return fiscalQText(fiscalQInfo(date));
}

export function buildQuarterLabels(referenceDate: string | null | undefined): { current: string; next: string } {
  const d = referenceDate ? (parseIsoDate(referenceDate) ?? new Date()) : new Date();
  const cur = fiscalQInfo(d);
  const nxt = cur.quarter < 4
    ? { quarter: cur.quarter + 1, fiscalYear: cur.fiscalYear }
    : { quarter: 1, fiscalYear: cur.fiscalYear + 1 };
  return { current: fiscalQText(cur), next: fiscalQText(nxt) };
}

// ─── stage helpers ────────────────────────────────────────────────────────────

function normalizeStage(stage: string): string {
  return STAGE_MAP[stage] ?? stage;
}

export function stageNumber(stage: string | null | undefined): number | null {
  const raw = String(stage ?? '').trim();
  const normalized = normalizeStage(raw);
  const idxM = MATTER_STAGE_ORDER.indexOf(normalized);
  if (idxM >= 0) return idxM + 1;
  const idxF = FUNNEL_ORDER.indexOf(normalized);
  if (idxF >= 0) return idxF + 1;
  const m = normalized.match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

export function stageLabel(stage: string | null | undefined): string {
  const n = stageNumber(stage);
  if (n == null) return String(stage ?? '—');
  return EMPIRICAL_STAGE[n]?.label ?? String(stage ?? '—');
}

function isWonStage(stage: string | null | undefined): boolean {
  const ns = normalizeStage(String(stage ?? '').trim()).toLowerCase();
  return ns === '7. win' || ns === 'won' || ns === 'win';
}

function closureActiveStage(row: DealRow): boolean {
  const st = String(row.stage ?? row.deal_stage ?? row.dealStage ?? '').toLowerCase();
  if (!st) return false;
  if (st.includes('won') || st.includes('win') || st.includes('loss') || st.includes('lost')) return false;
  if (st.includes('disqualified') || st.includes('no show') || st.includes('reschedule') || st.includes('latent')) return false;
  const n = stageNumber(row.stage ?? row.deal_stage ?? row.dealStage);
  return n != null && n >= 1 && n <= 6;
}

// ─── seller matching ─────────────────────────────────────────────────────────

function sellerAliases(seller: string): string[] {
  return SELLER_ALIASES[seller] ?? [seller.toLowerCase()].filter(Boolean);
}

function rowMatchesSeller(row: DealRow, seller: string): boolean {
  const label = String(seller ?? '').trim();
  if (!label || label === 'Overall') {
    return ACTIVE_SELLERS.some((s) => rowMatchesSeller(row, s));
  }
  const aliases = sellerAliases(label).map((x) => x.toLowerCase());
  const matched: string[] = Array.isArray(row.matched_sellers) ? row.matched_sellers : [];
  if (matched.some((s) => String(s).trim().toLowerCase() === label.toLowerCase())) return true;
  if (matched.some((s) => aliases.includes(String(s).trim().toLowerCase()))) return true;
  const raw = String(row.owner ?? row.seller ?? row.deal_owner ?? '').toLowerCase();
  return aliases.some((a) => a && raw.includes(a));
}

// ─── deal size ───────────────────────────────────────────────────────────────

function dealSizeValue(raw: unknown): number {
  const n = Number(raw);
  return isFinite(n) ? n : 0;
}

function leadershipDealSize(row: DealRow): number {
  const n = stageNumber(row.stage ?? row.deal_stage ?? row.dealStage);
  if (n != null && n <= 4 && !isWonStage(row.stage ?? row.deal_stage ?? row.dealStage)) return 100_000;
  return dealSizeValue(row.deal_size);
}

// ─── quarter pacing ──────────────────────────────────────────────────────────

function quarterPacedAmount(row: DealRow, qKey: string, amountOverride?: number): number {
  const start = parseIsoDate(row.start_date);
  const total = Number(amountOverride ?? dealSizeValue(row.deal_size));
  if (!start || !isFinite(total) || total <= 0) return 0;
  const durRaw = Number(row.duration_months ?? 0);
  const duration = isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : 1;
  const monthly = total / duration;
  let out = 0;
  for (let i = 0; i < duration; i++) {
    if (quarterLabelForDate(addMonths(start, i)) === qKey) out += monthly;
  }
  return out;
}

// ─── empirical EV ────────────────────────────────────────────────────────────

export function empiricalEv(row: DealRow, qLabel: string): number {
  const n = stageNumber(row.stage ?? row.deal_stage ?? row.dealStage);
  const cfg = n != null ? EMPIRICAL_STAGE[n] : undefined;
  if (!cfg) return 0;
  const intro = parseIsoDate(row.intro_date);
  const targetInfo = quarterLabelToInfo(qLabel);
  if (!intro || !targetInfo) return 0;
  const introIdx = fiscalQIndex(fiscalQInfo(intro));
  const targetIdx = fiscalQIndex(targetInfo);
  const offset = targetIdx - introIdx;
  if (offset < 0) return 0;
  const weight = offset === 0 ? 0.21 : offset === 1 ? 0.53 : 0.26;
  return leadershipDealSize(row) * cfg.p * weight;
}

// ─── risk ────────────────────────────────────────────────────────────────────

function lastConnectDate(row: DealRow): string {
  const keys: (keyof DealRow)[] = [
    'last_connect_date', 'last_meeting_date', 'last_call_date',
    'last_activity_date', 'last_touch_date', 'last_connected_date',
  ];
  for (const k of keys) {
    if (row[k]) return String(row[k]).slice(0, 10);
  }
  return '';
}

export function dealRisk(row: DealRow): RiskInfo {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const reasons: string[] = [];
  const next = parseIsoDate(row.next_meeting_date);
  if (!next) {
    reasons.push('No next meeting date');
  } else {
    const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) reasons.push(`Next meeting ${Math.abs(days)}d overdue`);
  }
  const lastRaw = lastConnectDate(row);
  const last = parseIsoDate(lastRaw);
  if (last) {
    const daysSince = Math.round((today.getTime() - last.getTime()) / 86_400_000);
    if (daysSince > 14) reasons.push(`Last connect ${daysSince}d ago`);
  }
  return {
    atRisk: reasons.length > 0,
    label: reasons.length ? `At risk: ${reasons.join('; ')}` : 'On track',
    lastConnect: lastRaw || '—',
  };
}

export function daysStuck(row: DealRow): number | null {
  const last = parseIsoDate(lastConnectDate(row));
  if (!last) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - last.getTime()) / 86_400_000));
}

// ─── partner summary ─────────────────────────────────────────────────────────

function partnerIsFilled(v: unknown): boolean {
  const s = String(v ?? '').trim();
  return !!s && s !== '-' && s !== 'N/A' && s !== 'n/a';
}

function partnerDisplay(v: unknown): string {
  const s = String(v ?? '').trim();
  return s || '—';
}

function partnerSummary(row: DealRow): PartnerInfo {
  const parts: string[] = [];
  const add = (label: string, val: unknown) => { if (partnerIsFilled(val)) parts.push(`${label}: ${partnerDisplay(val)}`); };
  add('Tech', row.tech_stack);
  add('Source', row.partner_source_type);
  add('Alliances', row.alliances_team_intro);
  add('Registered', row.partner_registered_on_portal);
  add('Approved', row.partner_approved_on_portal);
  add('Funded', row.partner_funded);
  add('Partner AE', row.partner_ae);
  return { involved: parts.length > 0, text: parts.length ? parts.join(' | ') : 'None captured' };
}

function recommendedAction(risk: RiskInfo, partner: PartnerInfo): string {
  if (risk.atRisk && !partner.involved) return 'Book buyer connect and add partner/exec lever.';
  if (risk.atRisk) return 'Book buyer connect; use captured partner motion to force next step.';
  if (!partner.involved) return 'Validate whether partner lever can accelerate close.';
  return 'Drive mutual close plan and confirm signed-start path.';
}

export function dealDisplay(row: DealRow): string {
  const account = partnerDisplay(row.logo ?? row.account);
  const deal = partnerDisplay(row.deal);
  return `${account} / ${deal}`;
}

// ─── target lookup ───────────────────────────────────────────────────────────

export function getTarget(targets: QuarterTargets, seller: string, quarter: string): number {
  const key = `${seller.trim().toLowerCase()}||${quarter.trim().toUpperCase()}`;
  const x = targets[key];
  return isFinite(Number(x?.revenue)) ? Number(x.revenue) : 0;
}

// ─── main data transform ──────────────────────────────────────────────────────

export function buildRows(
  data: Record<string, unknown>,
  targets: QuarterTargets,
  quarterLabels: { current: string; next: string },
): { summary: QuarterSummary[]; deals: RichDealRow[] } {
  const rows: DealRow[] = Array.isArray(data.all_deals_rows) ? (data.all_deals_rows as DealRow[]) : [];
  const quarters = (
    [
      { key: 'current' as const, label: quarterLabels.current },
      { key: 'next' as const, label: quarterLabels.next },
    ] as { key: 'current' | 'next'; label: string }[]
  ).filter((q) => !!normalizeQuarterLabel(q.label));

  const summary: QuarterSummary[] = [];
  const deals: RichDealRow[] = [];

  for (const seller of ACTIVE_SELLERS) {
    for (const quarter of quarters) {
      const target = getTarget(targets, seller, quarter.label);
      let booked = 0;
      let committed = 0;
      let ev = 0;
      let flooredEv = 0;
      let earlyEv = 0;

      for (const r of rows) {
        if (!rowMatchesSeller(r, seller)) continue;
        if (isWonStage(r.stage ?? r.deal_stage ?? r.dealStage)) {
          booked += quarterPacedAmount(r, quarter.label, dealSizeValue(r.deal_size));
          continue;
        }
        if (!closureActiveStage(r)) continue;
        const n = stageNumber(r.stage ?? r.deal_stage ?? r.dealStage);
        const rawSize = dealSizeValue(r.deal_size);
        const displaySize = leadershipDealSize(r);
        const contrib = quarterPacedAmount(r, quarter.label, displaySize);
        if (contrib > 0) {
          const risk = dealRisk(r);
          const partner = partnerSummary(r);
          deals.push({
            ...r,
            leadership_seller: seller,
            leadership_quarter: quarter,
            leadership_contribution: contrib,
            leadership_total_size: displaySize,
            leadership_risk: risk,
            leadership_partner: partner,
            leadership_action: recommendedAction(risk, partner),
          });
          // committed = stages 5-6 only (commercial + contracting), at actual face value
          if (n != null && n >= 5) {
            committed += quarterPacedAmount(r, quarter.label, rawSize);
          }
        }
        const evContrib = empiricalEv(r, quarter.label);
        ev += evContrib;
        if (n != null && n <= 4) flooredEv += evContrib;
        if (n != null && n <= 2) earlyEv += evContrib;
      }

      summary.push({ seller, quarter, target, booked, committed, bookedCommitted: booked + committed, ev, flooredEv, earlyEv });
    }
  }

  deals.sort((a, b) => {
    const sr = a.leadership_seller.localeCompare(b.leadership_seller);
    if (sr) return sr;
    const qr = a.leadership_quarter.key.localeCompare(b.leadership_quarter.key);
    if (qr) return qr;
    if (a.leadership_risk.atRisk !== b.leadership_risk.atRisk) return a.leadership_risk.atRisk ? -1 : 1;
    return (b.leadership_contribution ?? 0) - (a.leadership_contribution ?? 0);
  });

  return { summary, deals };
}

export function aggregateSellers(
  summaryRows: QuarterSummary[],
  deals: RichDealRow[],
): SellerAggregate[] {
  const map = new Map<string, SellerAggregate>();

  for (const r of summaryRows) {
    if (!map.has(r.seller)) {
      map.set(r.seller, {
        seller: r.seller,
        target: 0, booked: 0, committed: 0, bookedCommitted: 0, ev: 0, flooredEv: 0, earlyEv: 0,
        open: 0, atRisk: 0, riskExposure: 0, ratio: 0, gap: 0,
        quarters: [], deals: [],
      });
    }
    const s = map.get(r.seller)!;
    s.target += r.target;
    s.booked += r.booked;
    s.committed += r.committed;
    s.bookedCommitted += r.bookedCommitted;
    s.ev += r.ev;
    s.flooredEv += r.flooredEv;
    s.earlyEv += r.earlyEv;
    s.quarters.push(r);
  }

  for (const d of deals) {
    map.get(d.leadership_seller)?.deals.push(d);
  }

  return Array.from(map.values()).map((s) => {
    s.open = s.deals.length;
    s.atRisk = s.deals.filter((d) => d.leadership_risk.atRisk).length;
    s.riskExposure = s.deals
      .filter((d) => d.leadership_risk.atRisk)
      .reduce((acc, d) => acc + (d.leadership_contribution ?? 0), 0);
    s.ratio = s.target > 0 ? s.ev / s.target : 0;
    s.gap = s.target - s.ev;
    return s;
  }).sort((a, b) => (b.gap - a.gap) || a.seller.localeCompare(b.seller));
}

export function ratioTone(ratio: number): 'green' | 'amber' | 'red' {
  if (ratio >= 0.6) return 'green';
  if (ratio >= 0.4) return 'amber';
  return 'red';
}

export function riskTone(row: RichDealRow): 'red' | 'amber' | 'green' {
  if (!row.leadership_risk.atRisk) return 'green';
  const label = row.leadership_risk.label.toLowerCase();
  if (label.includes('no next') || label.includes('overdue')) return 'red';
  return 'amber';
}
