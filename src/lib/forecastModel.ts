// Forecast model — the engine behind Pipeline health / Forecast / Gap to plan.
//
// Why this exists separately from buildRows(): buildRows powers the legacy metric family
// (EMPIRICAL_STAGE weights, "weighted pipeline"). Those stage weights are the vendor
// defaults and are 2–4x more optimistic than our own history. This module is the
// calibrated family — same primitives, honest probabilities — and is the only thing the
// three revamped screens read.

import {
  CALIBRATION,
  INDUSTRIES,
  STALENESS_THRESHOLD,
  industryOf,
  inSalesScope,
  isExcludedFromNewSales,
  getTarget,
  quarterPacedAmount,
  quarterSequence,
  quarterBounds,
  quarterForDate,
  stageNumber,
  type DealRow,
  type Industry,
  type QuarterTargets,
} from '@/lib/vpCompute';

export type Basis = 'bookings' | 'recognized';

// ── engagement signal (from relay call data; empty until the relay schema is exposed) ──
export interface EngagementSignal {
  lastMeetingDays?: number | null;          // days since last real client meeting
  intent?: 'Pull' | 'Push' | null;          // who is driving
  budget?: 'confirmed' | 'constrained' | null;
  nextStepDueDays?: number | null;          // days until the agreed next step
}
export type SignalMap = Map<string, EngagementSignal>;

export interface DealQuality {
  placeholderStart: boolean;  // start_date is a data-entry default, not a real date
  noNextStep: boolean;        // no future next_meeting_date
  stale: boolean;             // past its stage staleness threshold
  zombie: boolean;            // past 3x threshold — presumed dead until confirmed
  noSize: boolean;
}

export interface ForecastDeal {
  row: DealRow;
  itemId: string;
  name: string;
  industry: Industry;
  owner: string;
  stage: number;
  stageLabel: string;
  tcv: number;
  pWin: number;
  reasons: string[];          // why this probability — shown in the deal ledger
  closeQuarter: string;
  timingSource: 'start date' | 'cycle time';
  daysStale: number | null;
  quality: DealQuality;
  commitEligible: boolean;
}

export interface QuarterForecast {
  quarter: string;
  target: number;
  booked: number;      // already won
  commit: number;      // booked + commit-eligible face value
  base: number;        // booked + probability-weighted pipeline
  upside: number;      // booked + all late stage at face + weighted early stage
  gap: number;         // target - base
  coverageGap: number; // max(0, target - upside) — no pipeline exists for this
  conversionGap: number; // the rest of the gap — pipeline exists, must convert
  openFace: number;
  coverage: number;    // weighted pipeline / remaining target
  requiredNewPipeline: number;
  enterFunnelBy: string | null;
  /** False when the entry deadline has already passed — new pipeline cannot land in time,
   *  so only converting what already exists can move this quarter. */
  coverageGapAddressable: boolean;
  mustWin: ForecastDeal[];
  /** Late-stage deals that would be commit-eligible except for a missing/stale next step
   *  or a placeholder start date. This is the fastest gap-closing action there is: book
   *  the meeting and the deal becomes committable. */
  commitBlockers: Array<{ deal: ForecastDeal; blockers: string[] }>;
}

export interface IndustryForecast {
  industry: Industry;
  quarters: QuarterForecast[];
  deals: ForecastDeal[];
  blendedWinRate: number;
  hygiene: number;              // 0–1 composite; see hygieneScore()
  hygieneParts: { realDates: number; nextSteps: number; alive: number; sized: number };
  zombieValue: number;
}

/**
 * Composite hygiene, value-weighted. All-or-nothing scoring reads 0% for every industry
 * (almost every deal trips at least one flag), which tells you nothing about which
 * vertical to chase — so score each dimension and average.
 */
export function hygieneScore(deals: ForecastDeal[]) {
  const total = deals.reduce((a, d) => a + Math.max(d.tcv, 1), 0) || 1;
  const share = (ok: (d: ForecastDeal) => boolean) =>
    deals.reduce((a, d) => a + (ok(d) ? Math.max(d.tcv, 1) : 0), 0) / total;
  const parts = {
    realDates: share((d) => !d.quality.placeholderStart),
    nextSteps: share((d) => !d.quality.noNextStep),
    alive: share((d) => !d.quality.zombie),
    sized: share((d) => !d.quality.noSize),
  };
  return { score: (parts.realDates + parts.nextSteps + parts.alive + parts.sized) / 4, parts };
}

const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: unknown): Date | null => {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
};
const num = (v: unknown): number => { const n = Number(v); return isFinite(n) ? n : 0; };

/**
 * Start dates that are data-entry defaults rather than real plans. Sellers park deals on a
 * round date (e.g. 25 open deals all on 2026-10-01), which silently drives quarter
 * assignment. Any date shared by >= 5 open deals is treated as a placeholder.
 */
export function detectPlaceholderDates(openRows: DealRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of openRows) {
    const d = String(r.start_date ?? '').slice(0, 10);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const out = new Set<string>();
  counts.forEach((n, d) => { if (n >= 5) out.add(d); });
  return out;
}

function qualityOf(row: DealRow, stage: number, daysStale: number | null, placeholders: Set<string>, today: Date): DealQuality {
  const threshold = STALENESS_THRESHOLD[stage] ?? 21;
  const nmd = parse(row.next_meeting_date);
  const start = String(row.start_date ?? '').slice(0, 10);
  return {
    placeholderStart: !start || placeholders.has(start),
    noNextStep: !nmd || nmd.getTime() < today.getTime(),
    stale: daysStale != null && daysStale > threshold,
    zombie: daysStale != null && daysStale > threshold * 3,
    noSize: num(row.deal_size) <= 0,
  };
}

/** Raw engagement multiplier — normalised to be mean-preserving within a stage below. */
function rawMultiplier(sig: EngagementSignal | undefined, q: DealQuality, stage: number, daysStale: number | null): { mult: number; reasons: string[]; stretch: number } {
  const reasons: string[] = [];
  let mult = 1;
  let stretch = 1;

  // Meeting recency beats stage staleness: sellers run calls without moving stages.
  const met = sig?.lastMeetingDays;
  if (met != null) {
    if (met <= 14) { mult *= 1.35; reasons.push(`met ${met}d ago`); }
    else if (met <= 30) { mult *= 1.1; reasons.push(`met ${met}d ago`); }
    else if (met <= 60) { mult *= 0.8; reasons.push(`no meeting in ${met}d`); stretch *= 1.2; }
    else { mult *= 0.5; reasons.push(`no meeting in ${met}d`); stretch *= 1.5; }
  } else if (daysStale != null) {
    const t = STALENESS_THRESHOLD[stage] ?? 21;
    const r = daysStale / t;
    if (r > 3) { mult *= 0.25; stretch *= 2; reasons.push(`${daysStale}d in stage — zombie`); }
    else if (r > 2) { mult *= 0.55; stretch *= 1.5; reasons.push(`${daysStale}d in stage`); }
    else if (r > 1) { mult *= 0.8; stretch *= 1.2; reasons.push(`${daysStale}d in stage`); }
  }

  if (sig?.intent === 'Pull') { mult *= 1.3; reasons.push('client-pull'); }
  if (sig?.intent === 'Push') { mult *= 0.75; reasons.push('we are pushing'); }
  if (sig?.budget === 'confirmed') { mult *= 1.25; reasons.push('budget confirmed'); }
  if (sig?.budget === 'constrained') { mult *= 0.5; reasons.push('budget blocked'); }
  if (q.noNextStep) { mult *= 0.7; reasons.push('no next step'); }
  return { mult, reasons, stretch };
}

/** Commit = late stage + a dated next step within 30 days + no blocking budget signal + real date. */
function isCommitEligible(stage: number, row: DealRow, q: DealQuality, sig: EngagementSignal | undefined, today: Date): boolean {
  if (stage < 5) return false;
  if (q.placeholderStart || q.noSize) return false;
  const nmd = parse(row.next_meeting_date);
  const withinWindow = !!nmd && nmd.getTime() >= today.getTime() && (nmd.getTime() - today.getTime()) / DAY <= 30;
  const dueSoon = sig?.nextStepDueDays != null && sig.nextStepDueDays <= 30;
  if (!withinWindow && !dueSoon) return false;
  if (sig?.budget === 'constrained') return false;
  return true;
}

export interface BuildForecastOpts {
  asOf?: string | null;
  quarters?: number;
  signals?: SignalMap;
  staleness?: Map<string, { days_stale: number }>;
  basis?: Basis;
}

export function buildForecast(
  dataset: Record<string, unknown> | null,
  targets: QuarterTargets,
  opts: BuildForecastOpts = {},
): { industries: IndustryForecast[]; quarters: string[]; placeholderDates: Set<string>; asOf: string } {
  const basis: Basis = opts.basis ?? 'bookings';
  const asOf = opts.asOf ?? iso(new Date());
  const today = parse(asOf) ?? new Date();
  const qLabels = quarterSequence(asOf, opts.quarters ?? 3);
  const signals = opts.signals ?? new Map<string, EngagementSignal>();
  const staleness = opts.staleness ?? new Map<string, { days_stale: number }>();

  const all: DealRow[] = Array.isArray(dataset?.all_deals_rows) ? (dataset!.all_deals_rows as DealRow[]) : [];
  const scoped = all.filter((r) => inSalesScope(r) && !isExcludedFromNewSales(r));
  const isWon = (r: DealRow) => String(r.stage ?? r.deal_stage ?? '').toLowerCase().includes('win');
  const openRows = scoped.filter((r) => { const n = stageNumber(r.stage ?? r.deal_stage); return n != null && n >= 1 && n <= 6 && !isWon(r); });
  const wonRows = scoped.filter(isWon);
  const placeholders = detectPlaceholderDates(openRows);

  // ── score every open deal ──
  const scoredByIndustry = new Map<Industry, ForecastDeal[]>();
  INDUSTRIES.forEach((i) => scoredByIndustry.set(i, []));
  const pending: Array<{ d: ForecastDeal; raw: number; stretch: number }> = [];

  for (const row of openRows) {
    const stage = stageNumber(row.stage ?? row.deal_stage);
    if (stage == null || stage < 1 || stage > 6) continue;
    const itemId = String(row.item_id ?? '');
    const daysStale = staleness.get(itemId)?.days_stale ?? null;
    const q = qualityOf(row, stage, daysStale, placeholders, today);
    const sig = signals.get(itemId);
    const { mult, reasons, stretch } = rawMultiplier(sig, q, stage, daysStale);
    const cal = CALIBRATION.stage[stage];

    const d: ForecastDeal = {
      row, itemId,
      name: String(row.deal ?? row.account ?? row.logo ?? '—'),
      industry: industryOf(row),
      owner: String(row.owner ?? row.seller ?? '—'),
      stage,
      stageLabel: cal.label,
      tcv: num(row.deal_size),
      pWin: cal.p,
      reasons: [`${cal.label} base ${Math.round(cal.p * 100)}%`, ...reasons],
      closeQuarter: qLabels[0],
      timingSource: 'cycle time',
      daysStale,
      quality: q,
      commitEligible: false,
    };
    pending.push({ d, raw: mult, stretch });
  }

  // Mean-preserving normalisation within stage: engagement redistributes probability to the
  // right deals, it does not inflate the total. Keeps the stage prior honest.
  for (let stage = 1; stage <= 6; stage++) {
    const group = pending.filter((x) => x.d.stage === stage);
    const w = group.reduce((a, x) => a + Math.max(x.d.tcv, 1), 0);
    const wm = w > 0 ? group.reduce((a, x) => a + Math.max(x.d.tcv, 1) * x.raw, 0) / w : 1;
    for (const x of group) {
      // Normalisation keeps the stage aggregate near its calibrated prior, but in a group
      // where most deals are stale it would otherwise push the healthy minority far above
      // the prior (a Contracting deal with no next step reading 95%). Bound it.
      const norm = Math.min(1.15, Math.max(0.4, wm > 0 ? x.raw / wm : 1));
      x.d.pWin = Math.min(0.93, Math.max(0.005, CALIBRATION.stage[stage].p * norm));
    }
  }

  // ── timing: measured cycle time, stretched for staleness; a real start date wins ──
  for (const { d, stretch } of pending) {
    const start = String(d.row.start_date ?? '').slice(0, 10);
    const startDate = parse(start);
    if (startDate && !d.quality.placeholderStart && startDate.getTime() >= today.getTime() - 45 * DAY) {
      d.closeQuarter = quarterForDate(startDate);
      d.timingSource = 'start date';
    } else {
      const days = CALIBRATION.cycleDays[d.stage] * stretch;
      d.closeQuarter = quarterForDate(new Date(today.getTime() + days * DAY));
      d.timingSource = 'cycle time';
    }
    d.commitEligible = isCommitEligible(d.stage, d.row, d.quality, signals.get(d.itemId), today);
    scoredByIndustry.get(d.industry)!.push(d);
  }

  // ── roll up ──
  const industries: IndustryForecast[] = INDUSTRIES.map((industry) => {
    const deals = (scoredByIndustry.get(industry) ?? []).sort((a, b) => b.pWin * b.tcv - a.pWin * a.tcv);
    const won = wonRows.filter((r) => industryOf(r) === industry);

    const openFaceAll = deals.reduce((a, d) => a + d.tcv, 0);
    const weightedAll = deals.reduce((a, d) => a + d.pWin * d.tcv, 0);
    const hyg = hygieneScore(deals);
    const blendedWinRate = openFaceAll > 0 ? weightedAll / openFaceAll : 0;

    const quarters: QuarterForecast[] = qLabels.map((qLabel) => {
      const target = getTarget(targets, industry, qLabel);

      // Booked. bookings = full TCV in the quarter of its start date (board convention);
      // recognized = the paced portion that lands inside the quarter.
      const booked = won.reduce((a, r) => {
        if (basis === 'recognized') return a + quarterPacedAmount(r, qLabel, num(r.deal_size));
        const sd = parse(r.start_date);
        return a + (sd && quarterForDate(sd) === qLabel ? num(r.deal_size) : 0);
      }, 0);

      const inQ = deals.filter((d) => d.closeQuarter === qLabel);
      const valueOf = (d: ForecastDeal) => basis === 'recognized' ? quarterPacedAmount(d.row, qLabel, d.tcv) : d.tcv;
      const pool = basis === 'recognized' ? deals : inQ;      // paced basis spreads across quarters

      const weighted = pool.reduce((a, d) => a + d.pWin * valueOf(d), 0);
      const commitFace = pool.filter((d) => d.commitEligible).reduce((a, d) => a + valueOf(d), 0);
      const lateFace = pool.filter((d) => d.stage >= 5).reduce((a, d) => a + valueOf(d), 0);
      const earlyWeighted = pool.filter((d) => d.stage < 5).reduce((a, d) => a + d.pWin * valueOf(d), 0);
      const openFace = pool.reduce((a, d) => a + valueOf(d), 0);

      const base = booked + weighted;
      const commit = booked + commitFace;
      const upside = booked + lateFace + earlyWeighted;
      const gap = Math.max(0, target - base);
      const coverageGap = Math.max(0, target - upside);
      const conversionGap = Math.max(0, gap - coverageGap);
      const remaining = Math.max(0, target - booked);

      // New pipeline has to clear a full sales cycle before quarter end to count. Use the
      // Capability-stage cycle: that is where a genuinely new qualified opportunity starts.
      const entryCycle = CALIBRATION.cycleDays[3];
      const bounds = quarterBounds(qLabel);
      const enterByDate = bounds ? new Date(bounds.end.getTime() - entryCycle * DAY) : null;
      const addressable = !!enterByDate && enterByDate.getTime() >= today.getTime();
      const enterBy = enterByDate ? iso(enterByDate) : null;
      // Floor the conversion rate so a thin vertical does not produce a fantasy number.
      const rate = Math.max(blendedWinRate, 0.05);

      return {
        quarter: qLabel, target, booked, commit, base, upside, gap, coverageGap, conversionGap,
        openFace,
        coverage: remaining > 0 ? weighted / remaining : (weighted > 0 ? 99 : 0),
        requiredNewPipeline: coverageGap > 0 && addressable ? coverageGap / rate : 0,
        enterFunnelBy: coverageGap > 0 ? enterBy : null,
        coverageGapAddressable: addressable,
        mustWin: inQ.filter((d) => d.stage >= 4).slice(0, 5),
        commitBlockers: pool
          .filter((d) => d.stage >= 5 && !d.commitEligible)
          .map((d) => {
            const blockers: string[] = [];
            if (d.quality.noNextStep) blockers.push('no future next step');
            if (d.quality.placeholderStart) blockers.push('placeholder start date');
            if (d.quality.noSize) blockers.push('no deal size');
            if (signals.get(d.itemId)?.budget === 'constrained') blockers.push('budget blocked');
            return { deal: d, blockers };
          })
          .filter((x) => x.blockers.length > 0)
          .sort((a, b) => b.deal.tcv - a.deal.tcv),
      };
    });

    return {
      industry, quarters, deals, blendedWinRate,
      hygiene: hyg.score, hygieneParts: hyg.parts,
      zombieValue: deals.filter((d) => d.quality.zombie).reduce((a, d) => a + d.tcv, 0),
    };
  });

  return { industries, quarters: qLabels, placeholderDates: placeholders, asOf };
}

/** Team roll-up across industries for a given quarter index. */
export function teamTotals(industries: IndustryForecast[], qIndex: number) {
  const q = (f: IndustryForecast) => f.quarters[qIndex];
  const sum = (k: keyof QuarterForecast) => industries.reduce((a, f) => a + (Number(q(f)?.[k]) || 0), 0);
  const target = sum('target');
  const base = sum('base');
  return {
    quarter: industries[0]?.quarters[qIndex]?.quarter ?? '',
    target, base,
    booked: sum('booked'), commit: sum('commit'), upside: sum('upside'),
    gap: Math.max(0, target - base),
    coverageGap: sum('coverageGap'), conversionGap: sum('conversionGap'),
    openFace: sum('openFace'), requiredNewPipeline: sum('requiredNewPipeline'),
  };
}
