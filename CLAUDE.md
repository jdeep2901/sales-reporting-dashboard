# MathCo Realtime Sales Reporting — Claude Code context

This file is loaded automatically at the start of every Claude Code session in this repo. Keep it tight (under 250 lines). For business rules and reporting conventions, see `HANDOVER_CONTEXT.md` — that file is the source of truth for stage models, FY definitions, seller scope, movement logic. This file is the source of truth for *how to build and maintain the codebase*.

## What this app is

A weekly sales reporting dashboard for MathCo. Frontend is hosted on GitHub Pages. Backend is Supabase (Postgres + Edge Functions). Data flows from Monday.com → `sync-monday-board` Edge Function → Supabase → frontend. There is also a `chat-analyst` Edge Function that powers an in-app AI assistant.

The dashboard has ~22 views (Weekly Scorecard, Vertical Performance, Call Trends, Operating, Forecast, Compare, Momentum, Admin, etc.). Views read versioned snapshots written by the Monday sync.

## Target architecture (migration in progress)

The frontend is being migrated from a single 14K-line `index.html` to a component-based app. The target stack is:

- **Vite + React 18 + TypeScript** — build tool and framework
- **Tailwind CSS** + **shadcn/ui** — styling and component primitives
- **TanStack Query** — data fetching against Supabase
- **Supabase JS SDK** — backend client, configured in `src/lib/supabase.ts`
- **React Router** — view routing via URL paths (so views are deep-linkable)
- **Recharts** — charts and sparklines
- **GitHub Actions** — build and deploy to `gh-pages` branch

Backend (Supabase migrations, Edge Functions) is **not** being migrated. It is in good shape and only changes when business logic requires it.

## Directory layout (target)

```
src/
  views/              one file per view (VerticalPerformance.tsx etc.)
  components/         shared components (KpiCard, SellerRow, DealPill, Sparkline, NarrativePanel, Tabs)
  lib/
    supabase.ts       Supabase client + typed query helpers
    queries.ts        TanStack Query hooks per data shape
    formatters.ts     currency, dates, percentages
  styles/
    tokens.css        CSS variables — the design system source of truth
    globals.css       base styles, Tailwind imports
  types/              shared TypeScript types
  App.tsx             router shell with Tabs
  main.tsx            entry point
supabase/             unchanged — backend lives here
HANDOVER_CONTEXT.md   business rules (do not delete or duplicate here)
CLAUDE.md             this file
.claude/skills/       codified procedures (see below)
```

During migration, the legacy `index.html` is preserved at `legacy/index.html` for reference. Don't edit it; copy patterns out of it into new components.

## Design system (Stripe / Linear executive-clean)

Apply this everywhere. No exceptions, no "creative" deviations per component.

### Tokens (in `src/styles/tokens.css`)

```css
:root {
  --bg-page: #FAFAFA;
  --bg-card: #FFFFFF;
  --bg-surface: #F4F4F5;          /* KPI cards, expanded rows */
  --bg-hover: #F9FAFB;

  --text-primary: #0A0A0A;
  --text-secondary: #6B7280;
  --text-tertiary: #9CA3AF;

  --border-hairline: rgba(0,0,0,0.08);
  --border-emphasis: rgba(0,0,0,0.14);

  --accent: #635BFF;              /* one accent, used sparingly */

  --status-red: #DC2626;
  --status-red-bg: #FEE2E2;
  --status-red-text: #B91C1C;
  --status-amber: #D97706;
  --status-amber-bg: #FEF3C7;
  --status-amber-text: #92400E;
  --status-green: #16A34A;
  --status-green-bg: #DCFCE7;
  --status-green-text: #166534;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

Tailwind theme in `tailwind.config.ts` must consume these tokens via `var(--token)`. Never hardcode hex values inside components.

### Type and case rules

- Font: Inter, system-ui fallback. Two weights only — 400 regular, 500 medium. Never 600 or 700.
- **Sentence case for everything.** Headings, KPI labels, column headers, button labels, filter labels. Never Title Case. Never ALL CAPS. Never lowercase headings (that reads like a typo, not a style).
- Headings: 18px section, 14px subsection, 12px label.
- Body: 13px default. Tabular numbers anywhere a number is shown: `font-variant-numeric: tabular-nums` (Tailwind: `tabular-nums`).

### Layout rules

- Borders: always 0.5px solid `var(--border-hairline)`. Never heavier. No card shadows.
- Radii: 8px components, 12px cards.
- Backgrounds: `--bg-page` on body, `--bg-card` on cards, `--bg-surface` on KPI cards and expanded panels. Never cream, beige, or any warm tone.
- Density: tight. KPI cards ~80px tall, not 120px. Padding `12px 14px` not `24px`.

### Currency formatting

Always use compact format via `formatters.formatCurrency()`:
- `<$1K` → exact, e.g. `$850`
- `$1K–$999K` → `$XXXK`, e.g. `$442K`
- `$1M+` → `$X.XXM`, e.g. `$1.07M`

Never show `$442,098`. That's a CFO number, not a scan number. Apply tabular-nums on every currency span.

### Component patterns (source of truth: VerticalPerformance.tsx)

- **KPI card**: 12px label, 22px number weight 500, 11px sub-label in semantic color
- **Tabs**: Linear-style underline, no filled background on active tab — just 1.5px black bottom border and weight 500
- **Pills**: 11px text, 2px×7px padding, ~20–24px wide for counts. Status pills get a leading Tabler icon.
- **Sparklines**: 60×20px SVG polyline, 1.5px stroke, color reflects direction (green up / red down / gray dashed flat)
- **Status indicators on rows**: 2px colored left border, never large color fills
- **Tables**: 0.5px hairline row dividers, row hover `--bg-hover`, click-to-expand pattern for narrative panels

## Don't do this (drift the previous agent produced)

- Lowercase headings ("seller scorecard"). Use sentence case.
- ALL CAPS filter labels ("SELLER", "QUARTER"). Use sentence case.
- Beige / cream / warm-tone backgrounds. Use the neutral grays in tokens.
- KPI cards taller than ~80px or numbers larger than 22px.
- Verbose currency (`$442,098`). Use `formatCurrency()`.
- Font weight 600 or 700. Only 400 and 500.
- Status as pills alone. Pair with 2px colored left border on the row.
- Forking views with `-v2` suffixes. Edit the existing component or branch in git.

## Supabase patterns

- Client lives in `src/lib/supabase.ts`. Use the typed client. Never instantiate ad-hoc clients in components.
- All queries go through TanStack Query hooks in `src/lib/queries.ts`. Name hooks `useXxx`.
- RPCs are the preferred read path — the existing `get_dashboard_state`, snapshot, and compare functions encapsulate business logic. Don't reimplement that logic in the frontend.
- Never check service-role keys into the repo. Use `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars only.
- RLS is enabled on every table. If a query returns empty unexpectedly, check policies before changing the query.

## Working with this codebase

- Plan before implementing. State what you'll change, ask before touching shared components like `KpiCard` or `SellerRow` since those affect many views.
- One PR per phase or per view migration. Keep diffs reviewable.
- After any change, run `npm run build && npm run preview` and confirm the changed view loads. Don't claim "done" without verification.
- If a view's logic in the legacy `index.html` is unclear, read the surrounding context and the relevant Edge Function — don't guess. The 2,467-line `sync-monday-board/index.ts` is often the answer.
- Business questions (FY definition, seller scope, stage model, movement logic) → check `HANDOVER_CONTEXT.md`. Don't rederive.

## Skills available

Read the matching skill file **before** starting any task that fits the triggers below. The skill is the execution spec — do not rederive its procedure from scratch.

| Skill file | Invoke when JD says... |
|---|---|
| `add-view.md` | "add a view", "migrate X view", "build the [name] page", "new tab for..." |
| `metrics-reference.md` | touching any view that shows EV / weighted pipeline / booked / committed / S3+ / top-of-funnel; any metric mismatch question; any new pipeline KPI |
| `pipeline-email.md` | "draft the email", "write to Anuj", "LT update", "seller email", "pipeline email", "weekly email", "send to Anuj" |
| `supabase/SKILL.md` | any Supabase task — schema change, RLS, Edge Function, migration, auth, storage |
| `supabase-postgres-best-practices/SKILL.md` | writing or reviewing SQL, query performance, schema design, index decisions |

**At session start:** scan this list against what JD has asked. If the task matches a skill, read that file first before touching code or data.
