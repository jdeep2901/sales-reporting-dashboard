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

To aggregate across sellers or quarters, filter `summary` and reduce:
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
| `target` | Revenue target for seller+quarter | From `dashboard_state.quarter_targets` |

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

**DO NOT invent new stage mix metrics.** These two (top-of-funnel % and S3+ %) are the only pipeline quality metrics. They are exact complements and sum to 100%. Any new view that needs pipeline quality uses one of these two from `row.earlyEv` and `row.ev` on `SellerAggregate`.

---

## Seller → vertical mapping (LT Trends table only)

| Seller | Vertical |
|---|---|
| Akshay Iyer | Pharma |
| Somya | CPG |
| Suvom Mitro | Retail |
| Vitor Quirino | EU |
| Maruti Peri | Engineering |
| Sahana | RoW |

---

## FY definition

FY27 = Apr 2026 – Mar 2027. `FY27_Q = { current: "Q1'27", next: "Q2'27" }`.
FY_START = new Date('2026-04-01').
Snapshots grouped by ISO week since FY_START.

---

## KPI card order (all views must match)

Forecast → Booked → Committed → Weighted pipeline

This is the order in VP and LT Trends. Do not deviate without explicit instruction.
