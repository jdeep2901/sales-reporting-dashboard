# Skill: pipeline-email

**Invoke when:** JD asks for anything email-related to Anuj or sellers. Trigger phrases: "draft the email", "write to Anuj", "LT update", "pipeline email", "seller email", "weekly email", "send to Anuj", "compose in Outlook", "hygiene email". Also invoke for any Friday pipeline summary or Monday seller hygiene task.

---

## Terminology note

Use **"weighted pipeline"** everywhere — dashboard UI, emails to Anuj, emails to sellers. Never "EV", never "Expected value". This is a firm rule for consistency across all surfaces.

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

## Email 1: LT update (Friday, to Anuj — anuj@mathco.com)

**Subject:** `Pipeline update — [Day, Month DD]`

**Compose method:** Always write HTML to `/tmp/lt_email.html`, then load via AppleScript and set it as the message `content`.

**Critical — wrap the body in a full HTML document.** The content string MUST start with `<html><body ...>` and end with `</body></html>`. Without the document root, Outlook composes the draft as **plain text** and the recipient sees raw markup (`<div style=...`) instead of a formatted email. A bare leading `<div>` is NOT enough — this is the single most common failure and it looks like "html code" in the draft.

```applescript
set htmlBody to do shell script "cat /tmp/lt_email.html"
tell application "Microsoft Outlook"
  set ltMsg to make new outgoing message with properties {subject:"Pipeline update — [date]", content:htmlBody}
  make new recipient at ltMsg with properties {email address:{address:"anuj@mathco.com", name:"Anuj"}}
  open ltMsg
  activate
end tell
```
where `/tmp/lt_email.html` begins with `<html><body style="font-family:Calibri,sans-serif;">` and ends with `</body></html>`.

**Dead ends — do not use:**
- Never inline HTML into AppleScript string concatenation — it breaks on long bodies.
- Never fall back to System Events / clipboard paste (`pbcopy -Prefer rtf` + `keystroke "v"`). System Events UI enumeration times out on this machine (AppleEvent -1712), and screen capture / accessibility keystrokes are not reliably permitted. The wrapped-`content` object-model path above needs no permissions and is the only reliable method.

---

**Email structure (top to bottom):**

1. Greeting + one-line context
2. Metric definitions table
3. Team summary table
4. Q1 seller view table (verticals)
5. Q2 early view table (verticals)
6. Pipeline health (prose, one paragraph per notable vertical)
7. Actions I'm tracking (bullets)

---

**Metric definitions table** — always include at the top, in this order:

| Term | Definition |
|---|---|
| Weighted pipeline | Stage probability × deal size × quarter weight. S1–S4 floored at $100K. |
| Booked | Revenue from won deals, paced into the quarter by start date and duration. Recognized. |
| Committed | S5/S6 deals pacing into the quarter at full deal size. High-confidence, not yet won. |
| Forecast | Booked + Committed. Best-case floor for the quarter. |
| S3+ % | Share of weighted pipeline from S3 (Capability) and above. ≥65% green, 50–65% amber, <50% red. |
| Stale | No stage movement past threshold: S1 ≥45d, S2 ≥30d, S3/S4 ≥21d, S5/S6 ≥14d. |
| No NMD on committed | S5/S6 deals with no next meeting date set or NMD already passed. Highest-risk committed deals. |

---

**HTML formatting rules (locked):**

- **Banded rows**: alternate `background:#fff` and `background:#f5f7fa` on data rows. Header and Total rows use `background:#e8edf2`. Total row gets `border-top:1px solid #bbb; font-weight:bold`.
- **Mobile-safe**: wrap every data table in `<div style="overflow-x:auto;">`. Set `min-width` on wide tables (Q1 seller table: `min-width:520px`, Q2 table: `min-width:400px`). Every `<td>` and `<th>` gets `white-space:nowrap` so columns never word-wrap.
- **Column alignment**: vertical/label columns left-aligned, all number columns right-aligned.
- **S3+ color coding**: ≥65% → `color:#16a34a` (green), 50–65% → `color:#d97706` (amber) + &#9888; warning icon, <50% → `color:#dc2626` (red).
- **Font**: `font-family:Calibri,sans-serif` for prose and definitions; `font-family:Consolas,monospace` for data tables.
- **Max width**: outer div `max-width:680px`.

---

**Q1 seller view columns:** Vertical | Target | Booked | Committed | Wtd pipeline | S3+ | Stale

**Q2 early view columns:** Vertical | Target | Booked | Committed | Wtd pipeline

**Table rules (locked):**
- Use vertical names (Pharma, CPG, Engineering, EU, RoW, Retail), not seller names
- Always include a Total row at the bottom of each table
- S3+% is the quality descriptor for weighted pipeline — never show wtd pipeline / target as a ratio
- Weighted pipeline shown as "$X (Y% from S3+)" in team summary
- Forecast = booked + committed
- Compact currency throughout ($442K not $442,098)
- Omit Target cell for ramping/unassigned verticals (Retail, RoW) — use &mdash;

**Pipeline health rules:**
- One paragraph per notable vertical, most urgent first
- Always call out: S3+ <50% (red), S3+ 50–65% (amber), committed with no NMD (name the deals), stale >30% of active, zero booked for tenured sellers, Q2 wtd pipeline materially below target
- Be specific — name deals, name stages, name days stale. Never generic.

**Actions format:** `- Vertical (First name): specific deal-level action`

**Tone:** Direct, data-first. No throat-clearing. Bullets only for action items. Sentence case throughout.

---

## Email 2: Seller hygiene email (Monday, to individual sellers)

Send one email per seller. Do not aggregate or cross-reference other sellers' deals.

**Subject:** `Pipeline hygiene — week of [Mon date]`

**Format:**

```
[First name] —

Pipeline snapshot for [current_quarter]:

  Weighted pipeline: $[ev_cur]  |  Target: $[target_cur]  |  Coverage: [ev_ratio]×
  Booked: $[booked_cur]  |  Committed: $[committed_cur]  |  S3+: [s3_pct]%

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
5. **ev_ratio_cur < 1.0** for a tenured seller (Akshay, Somya, Maruti) → flag explicitly to Anuj.
6. **Andy Shankar (EU)** — took over Vitor Quirino's EU territory + target (Jun 2026). Ramping into the book; deals are being re-tagged from Vitor in Monday, so his count may climb week to week. Vitor was let go and removed from the roster.

---

## Validation

Before drafting, confirm the numbers match the VP dashboard:
- EV Q1 and booked Q1 per seller should match the "Vertical Performance" view.
- If there's a discrepancy > $10K, note it rather than hiding it.
- The edge function and dashboard run identical code (vpCompute.ts). Discrepancies indicate a data sync issue, not a computation bug.
