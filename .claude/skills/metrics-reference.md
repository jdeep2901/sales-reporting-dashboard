# Skill: metrics-reference

**Invoke when:** any view touches EV / weighted pipeline / booked / committed / S3+ / top-of-funnel numbers; any metric mismatch or discrepancy question; adding a new pipeline KPI or chart. Trigger phrases: "why is the number wrong", "weighted pipeline", "S3+", "coverage", "booked", "committed", "EV", any question about how a pipeline metric is calculated.

Reference for how all pipeline metrics are computed in this dashboard. Read this before touching any view that shows EV, booked, committed, S3+, or top-of-funnel numbers.

---

## Single source of truth: vpCompute.ts

`buildRows(dataset, targets, FY27_Q)` in `src/lib/vpCompute.ts` returns:
```typescript
{ summary: QuarterSummary[], deals: RichDealRow[] }
```

Import it. Don't reimplement it. All pipeline metrics in all views derive from `summary`.

```typescript
import { buildRows } from '@/lib/vpCompute';
const { summary } = buildRows(dataset, targets, FY27_Q);
```

### New-sales exclusion (Prologis + Gilead)

`buildRows` skips any deal whose account is **Prologis** or **Gilead** (`isExcludedFromNewSales()` — matches `deal`/`logo`/`account`). These are ongoing delivery/extension, not new sales, per JD's agreed definition: *new sales = all deals except Prologis and Gilead.* So all `summary` metrics (booked, committed, weighted pipeline) are already on the new-sales basis. Q1 booked reads **$649K**, not the $764K all-in (the $115K difference is Gilead $47.5K + Prologis-Sahana $67.5K). To change the excluded set, edit `NEW_SALES_EXCLUDED_ACCOUNTS` in `vpCompute.ts`. Views that compute from raw rows (Deal movement, Operating metrics, Partnerships, Intro activity) apply the same exclusion at their row source.

To aggregate across industries or quarters, filter `summary` and reduce:
```typescript
const rows = summary.filter(s => s.quarter.key === 'current');
const ev = rows.reduce((a, s) => a + s.ev, 0);
```

---

## QuarterSummary fields

| Field | What it is | How computed |
|---|---|---|
| `ev` | Weighted pipeline — active S1–S6 deals only | `empiricalEv()`: calls `leadershipDealSize()` — S1–S4 floored at $100K, S5–S6 use actual deal_size. Null intro_date → returns 0. No start_date filter. |
| `earlyEv` | S1+S2 only EV | Same `empiricalEv()` path, filtered to stage ≤ 2 |
| `flooredEv` | S1–S4 with $100K floor | Leadership view only — same floor as `ev` (both use `leadershipDealSize`). Do not use for S3+ split. |
| `booked` | Won deals paced into quarter | start_date + duration → quarter fraction; won deals skip `ev` via `continue` |
| `committed` | S5+S6 paced into quarter | Same pacing path, actual deal size (no floor) |
| `target` | Revenue target for industry+quarter | From `dashboard_state.quarter_targets` (`pharma||Q2'27` keys) |

---

## The two computation paths — never mix them

**Path 1 — `empiricalEv()` (stage probability × size):**
- Used for: `ev`, `earlyEv`, `flooredEv`
- Scope: ALL active S1–S6 deals, regardless of start_date
- Stage probs: S1=0.08, S2=0.10, S3=0.19, S4=0.29, S5=0.44, S6=0.90

**Path 2 — pacing (start_date + duration → quarter weight):**
- Used for: `booked`, `committed`
- Scope: deals whose `quarterPacedAmount > 0` for the target quarter
- Won deals → `booked`; S5/S6 active → `committed`

**The mixing bug:** `evS3Plus` was once computed using Path 2 deals (filtered by `quarterPacedAmount > 0`) for the numerator against `summary.ev` (Path 1) for the denominator. Deals with future start_dates were in the denominator but not the numerator, collapsing the percentage.

**Correct approach — both sides on the same path:**
```typescript
const evS3Plus = summary.ev - summary.earlyEv;  // both from Path 1
const s3Pct = ev > 0 ? (evS3Plus / ev) * 100 : null;
```

---

## Metric naming conventions (UI labels)

| Internal name | UI label | Notes |
|---|---|---|
| `ev` | Weighted pipeline | Never "EV", never "Expected value" |
| `booked` | Booked | |
| `committed` | Committed | |
| `booked + committed` | Forecast | Sum, not a separate field |
| `earlyEv / ev` | % top-of-funnel | VP view — shown as warning when > 35% |
| `evS3Plus / ev` | % from S3+ | LT Trends — shown as KPI and table column |

`% top-of-funnel` and `% from S3+` are exact complements: they sum to 100%.

---

## Color thresholds for S3+ / top-of-funnel

**S3+ % (LT Trends — higher is healthier):**
- ≥ 65% → green (`var(--status-green)`)
- 50–65% → amber (`var(--status-amber)`)
- < 50% → red (`var(--status-red)`)

**Top-of-funnel % (VP and VP v2 — lower is healthier; always show in VP v2, show as warning in VP when > 35%):**
- ≤ 35% → green (healthy — most pipeline in S3+)
- 35–50% → amber
- > 50% → red

**DO NOT invent new stage mix metrics.** These two (top-of-funnel % and S3+ %) are the only pipeline quality metrics. They are exact complements and sum to 100%. Any new view that needs pipeline quality uses one of these two from `row.earlyEv` and `row.ev` on `IndustryAggregate`.

---

## Industry model (replaces seller reporting, Sep 2026)

`buildRows` loops over `INDUSTRIES = ['Pharma', 'CPG/Retail', 'Others']`, not sellers. `QuarterSummary.industry`, `IndustryAggregate` (`aggregateIndustries`), `RichDealRow.leadership_industry`. A deal's industry comes from `industryOf(row)` (its Monday `industry` field); scope comes from `inSalesScope(row)` (the `SALES_TEAM` roster). Views filter with the single helper `rowMatchesIndustry(row, industry)` — never write a local seller matcher. Buckets are mutually exclusive, so team totals no longer double-count co-owned deals the way summing seller rows did. Targets: `getTarget(targets, industry, quarter)` against `pharma||Q2'27`-style keys; Overall = sum of the three.

## FY definition

FY27 = Apr 2026 – Mar 2027. `FY27_Q = { current: "Q1'27", next: "Q2'27" }`.
FY_START = new Date('2026-04-01').
Snapshots grouped by ISO week since FY_START.

---

## KPI card order (all views must match)

Forecast → Booked → Committed → Weighted pipeline

This is the order in VP and LT Trends. Do not deviate without explicit instruction.

---

## "Committed deals needing action" vs "At-risk deals" — not the same

These two panels appear in Pipeline health and are often confused:

**"Committed deals needing action this week"** (top-level widget, above the main table):
- Fires before any row is expanded — team-wide proactive alert
- Scope: S5/S6 only, across the whole team
- Two buckets: no NMD at all, and stale-but-has-NMD
- Intent: what does JD need to unblock before this week's review?

**"At-risk deals"** (inside an expanded industry row):
- Only visible when a specific vertical row is drilled into
- Scope: S3–S6 — three tiers: committed no next step, committed stale, mid-funnel stuck (S3/S4)
- Intent: per-industry diagnostic

Committed-no-NMD deals appear in both — the top widget is the early warning, the expanded panel is the drill-down. The panel adds S3/S4 stale that the top widget deliberately omits (those are not committed revenue yet).

---

## Calibrated forecast family (Forecast screen, Sep 2026)

There are now **two metric families**. Do not mix them in one number.

| Family | Entry point | Powers | Stage probabilities |
|---|---|---|---|
| Legacy | `buildRows()` in `vpCompute.ts` | every screen except Forecast | `EMPIRICAL_STAGE` — vendor defaults, S1 8% … S6 90% |
| Calibrated | `buildForecast()` in `forecastModel.ts` | Forecast screen | `CALIBRATION.stage` — measured P(win \| ever reached stage), S1 2% … S6 88% |

The legacy weights run two to four times more optimistic than our own history. They stay in place because every existing view, narrative and past email is built on them; changing them silently would break continuity with what has already been reported. New forecast work uses `buildForecast()`.

**`CALIBRATION` (in `vpCompute.ts`)** carries its own provenance: `measuredOn`, `window`, and per stage `p` (bounded), `raw` (as measured), `n` (resolved deals). Regenerate with `node scripts/calibrate.mjs` monthly and update the constant in the same commit. Stage 6 shows `raw: 1.000` on n=15 — that is why `p` is bounded to 0.88 rather than taken raw.

### Bands

- **Base case** = booked + Σ(pWin × value). The call.
- **Commit** = booked + face value of commit-eligible deals. Commit-eligible = stage ≥ 5, a dated next meeting inside 30 days, a non-placeholder start date, a deal size, and no budget-blocked signal.
- **Upside** = booked + all late-stage face + weighted early stage.

Commit can sit below base — it is a stricter test, not a higher band. As of Sep 2026 commit equals booked for every vertical because no late-stage deal has a future next meeting date. `commitBlockers` on each `QuarterForecast` lists what is missing.

### Gap decomposition

- `coverageGap` = max(0, target − upside). No pipeline exists for this; it has to be sourced.
- `conversionGap` = gap − coverageGap. Pipeline exists and has to convert.
- `requiredNewPipeline` = coverageGap ÷ blended win rate (floored at 5%), and is only reported when `coverageGapAddressable` — i.e. a new deal entering today could still clear a full Capability-stage cycle before quarter end.

### Data-quality guards

- `detectPlaceholderDates()` — any `start_date` shared by five or more open deals is a data-entry default. Roughly two thirds of open deals trip this. Such deals are timed by median stage cycle time instead of their stated date.
- `hygieneScore()` — value-weighted across four components (real dates, next steps, alive, sized). All-or-nothing scoring reads 0% for every vertical and tells you nothing.
- Engagement signals re-rank deals through a **mean-preserving** normalisation bounded to [0.4, 1.15] with a 0.93 cap, so a signal moves probability between deals without inflating the stage total.

### Basis

`Basis` is `'bookings'` (full TCV credited in the quarter the deal starts) or `'recognized'` (TCV paced across delivery months). **Quarter targets are recognized-revenue targets** — the same basis `buildRows` paces against and the finance reconciliation uses. The Forecast screen defaults to recognized and warns when bookings is selected, because bookings against a paced target reads roughly 80% high.
