# Skill: pipeline-email

Invoked when JD asks to draft the weekly LT email, seller email, or both.

---

## Data source

Call the edge function and parse the JSON:

```bash
curl -s "https://vqksytduqxpfcovijhko.supabase.co/functions/v1/pipeline-summary"
```

The response shape:
```
{
  meta: { current_quarter, next_quarter, version_date, generated_at },
  team_totals: { target_cur, target_both, booked_cur, committed_cur, ev_cur, ev_both,
                 active_count, stale_count, no_nmd_committed },
  sellers: [{
    seller,
    target_cur, target_nxt, target_both,
    booked_cur, booked_nxt,
    committed_cur, committed_nxt,
    ev_cur, ev_nxt, ev_both,
    ev_ratio_cur,          // ev_cur / target_cur (null if no target)
    active_count,
    stale_count,
    no_nmd_committed,      // committed S5/S6 deals with no future NMD
    stale_deals: [{ deal, stage, days_stale, no_nmd, nmd }],
    committed_deals: [{ deal, stage, size, ev_cur, ev_nxt, nmd, no_nmd, is_stale, days_stale, intro_date }],
    fy_won_count,
    fy_won_size,
  }]
}
```

Sellers with no `target_cur` (target = 0) are ramping / unassigned — omit from coverage % calculation.

---

## Metric definitions

| Field | Meaning |
|---|---|
| `ev_cur` | Expected value for current quarter — EV formula from vpCompute.ts (stage prob × deal size × quarter weight). Source of truth for pipeline health. |
| `booked_cur` | Won deals paced into current quarter by start_date + duration. Recognized revenue. |
| `committed_cur` | S5 (Commercial Proposal) + S6 (Contracting) deals pacing into current quarter, at actual deal size (no floor). |
| `target_cur` | Quarterly revenue target. Stored in `dashboard_state.quarter_targets`. |
| `stale_count` | Active deals (S1–S6) whose stage hasn't moved in ≥ threshold days: S1=45d, S2=30d, S3/S4=21d, S5/S6=14d. |
| `no_nmd_committed` | S5/S6 deals with no `next_meeting_date` or NMD in the past. Highest-risk committed deals. |

**Coverage ratio** = `ev_cur / target_cur`. Healthy ≥ 1.5×. Below 1.0× is at-risk.

**Stale % of active** = `stale_count / active_count`. Flag when > 30%.

---

## Staleness thresholds (for email context)

| Stage | Threshold |
|---|---|
| S1 Intro | 45 days |
| S2 Qualification | 30 days |
| S3 Capability | 21 days |
| S4 Problem Scoping | 21 days |
| S5 Commercial Proposal | 14 days |
| S6 Contracting | 14 days |

---

## Email 1: LT update (Friday, to Anuj)

**Subject:** `Pipeline update — [Day, Month DD]`

**Format:**

```
Anuj —

Quick pipeline snapshot as of [current_quarter], data pulled [version_date].

Team summary
  Target:     $[target_cur]
  EV (Q1):    $[ev_cur]  ([ev_ratio]× coverage)
  Booked:     $[booked_cur]
  Committed:  $[committed_cur]
  Active deals: [active_count]  |  Stale: [stale_count] ([stale_pct]%)  |  No NMD on committed: [no_nmd_committed]

Seller view ([current_quarter])

  Seller          Target    EV     Coverage  Booked  Committed  Stale
  ─────────────────────────────────────────────────────────────────────
  [per seller row, skip sellers with no target from coverage column]

Pipeline health
  [2–3 bullets on what's actually notable — e.g., Somya stale count, Sahana booked vs EV mismatch,
   Maruti no committed, specific at-risk committed deals with no NMD. Be specific, not generic.]

Actions I'm tracking:
  - [Specific seller-level follow-up items based on the data]

[JD]
```

**Tone:** Direct, data-first. No throat-clearing. Bullets only for action items, not for summary narrative. Sentence case throughout. Numbers in compact format ($442K not $442,098).

---

## Email 2: Seller hygiene email (Monday, to individual sellers)

Send one email per seller. Do not aggregate or cross-reference other sellers' deals.

**Subject:** `Pipeline hygiene — week of [Mon date]`

**Format:**

```
[First name] —

Pipeline snapshot for [current_quarter]:

  EV: $[ev_cur]  |  Target: $[target_cur]  |  Coverage: [ev_ratio]×
  Booked: $[booked_cur]  |  Committed: $[committed_cur]

Stale deals ([stale_count] flagged):
  [List each stale deal: deal name, stage, days stale, NMD status]
  [If stale_count = 0: "Nothing stale — good."]

Committed (S5/S6) — [committed_deals count] deals:
  [For each: deal name, stage, size, NMD, staleness flag]
  [Flag is_stale=true and no_nmd=true deals explicitly]

Action needed:
  [Deal-specific action items derived from the above — update NMD, advance stage, or mark loss]

[JD]
```

**Tone:** Collegial but direct. Not punitive. The ask is always specific — not "update your pipeline" but "Takeda/Daniel Eversole is 52 days stale at S3 — do you have a path forward or is this a loss?" Numbers compact format.

---

## When to use which email

- **Friday** → LT email (Anuj). Covers full team. Forward-looking framing.
- **Monday** → Seller emails. Individual. Hygiene focus, action-oriented.
- **Ad hoc** → JD may ask for just the data pull, just the LT email, or just one seller's email. Follow what's asked.

---

## Key things to watch for

1. **Somya stale ratio** — historically high (50+ stale / 76 active). Flag if > 60%.
2. **Committed with no NMD** — these are highest-risk closes. Always surface by name in LT email.
3. **Maruti / Suvom booked = $0** — both ramping, so expected. Do not frame as a gap unless JD asks.
4. **Sahana committed > EV** — unusual pattern (booked from prior wins). Note if it persists.
5. **ev_ratio_cur < 1.0** for a tenured seller (Akshay, Somya, Vitor) → flag explicitly to Anuj.

---

## Validation

Before drafting, confirm the numbers match the VP dashboard:
- EV Q1 and booked Q1 per seller should match the "Vertical Performance" view.
- If there's a discrepancy > $10K, note it rather than hiding it.
- The edge function and dashboard run identical code (vpCompute.ts). Discrepancies indicate a data sync issue, not a computation bug.
