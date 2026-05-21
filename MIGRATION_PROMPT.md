# Migration kickoff prompt — paste this into Claude Code on first run

Copy everything below the line into Claude Code after `cd`-ing into the repo. This is your Phase 0 + Phase 1 + Phase 2 brief in one. Don't try to do all 22 views in one session — that's Phase 3, async.

---

You are taking over from a previous agent (Codex) on this codebase. Read `CLAUDE.md` first. It captures the target architecture, design system, and conventions. Read `HANDOVER_CONTEXT.md` for business rules. Do not duplicate or contradict either file.

The current frontend is a single 14,516-line `index.html` containing 22 view divs, ~3,500 lines of inline CSS, and one massive inline `<script>` block. The Supabase backend (migrations, Edge Functions, RPCs) is in good shape and is **not** in scope for this migration. Leave it alone.

Goal of this session is to complete **Phase 0 (audit)**, **Phase 1 (foundations)**, and **Phase 2 (one canonical view)**. Phases 3 and 4 are for subsequent sessions.

## Phase 0 — Audit (open this as the first PR or as a markdown report)

Produce `MIGRATION_AUDIT.md` covering:

1. Full list of the 22 views in `index.html` with the line ranges of each `<div id="view-*" class="view">`, plus a one-sentence description of what each view shows. Use the existing `id` as the canonical name.
2. The inline CSS block: list every CSS variable currently defined and map each to a token in the new `src/styles/tokens.css` from CLAUDE.md (or mark "drop" if the new design system replaces it).
3. The inline `<script>` block: identify the top-level modules / responsibility areas (data loading, view rendering, admin actions, AI chat, version compare, etc.) and propose a `src/lib/` and `src/views/` decomposition.
4. List every Supabase RPC and Edge Function called from the frontend, with the calling JS function name and which view(s) consume it.
5. Any patterns that look broken or hand-rolled (the `view-leadershipforecast` / `view-leadershipforecast-v2` fork is one; flag others).

Stop after Phase 0 and ask me to review the audit before continuing. Do not modify `index.html` during Phase 0.

## Phase 1 — Foundations (one PR titled "Phase 1: Vite + React scaffold")

After audit approval:

1. Move the legacy file: `git mv index.html legacy/index.html`. Same for `crosstab_data.json`, `build_crosstab_data.py`, `deploy/`. The legacy version stays in `legacy/` for reference during migration. The `supabase/` and `assets/` directories stay where they are.
2. Scaffold Vite + React 18 + TypeScript at the repo root: `npm create vite@latest . -- --template react-ts`. Resolve any conflicts with existing files by keeping the existing config files (`.gitignore`, `README.md`, etc.).
3. Install Tailwind CSS, shadcn/ui, TanStack Query, Supabase JS SDK, React Router, Recharts, and Tabler icons. Configure Tailwind to consume CSS variables from `src/styles/tokens.css`.
4. Create `src/styles/tokens.css` with the exact tokens specified in CLAUDE.md.
5. Create `src/lib/supabase.ts` with a typed Supabase client. Read `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from env. Add `.env.example` documenting the required vars.
6. Create `src/lib/formatters.ts` with `formatCurrency`, `formatPercent`, `formatDelta`, all returning tabular-num-safe strings per the CLAUDE.md spec.
7. Create the shared components, each as its own file in `src/components/`:
   - `Tabs.tsx` — Linear-style underline tabs
   - `KpiCard.tsx` — label + number + sub-label
   - `SellerRow.tsx` — avatar + name + sub-label + numeric cells + bar + pill + sparkline
   - `Sparkline.tsx` — 60×20 SVG with directional color
   - `DealPill.tsx` — status pill with icon
   - `NarrativePanel.tsx` — text area + Edit / Regenerate / Copy buttons
   - `ExpandableRow.tsx` — generic row + inline expansion wrapper
8. Set up the router in `App.tsx`. Add routes for all 22 view ids from the audit. Each view file in `src/views/` starts as a stub: a `<div>Coming soon</div>` with the view name. This keeps the tab bar functional during incremental migration.
9. Set up GitHub Actions to build on push and deploy to `gh-pages` branch. The deployed output is `dist/`.
10. Confirm: `npm run dev` serves the app, tab bar shows all 22 routes, no console errors. `npm run build && npm run preview` produces a clean build.

Open PR for review.

## Phase 2 — Canonical view (one PR titled "Phase 2: Vertical Performance migration")

After Phase 1 approval, migrate `view-leadershipforecast-v2` (the "Vertical Performance" view) into `src/views/VerticalPerformance.tsx`. This is the reference implementation for the other 21 views.

Design target: executive-clean, Stripe / Linear aesthetic. Specifications:

- **Header**: page title "Sales review", week-of subtitle, right-aligned "as of" timestamp
- **Filter row**: seller dropdown, quarter (default Q1+Q2 current FY), risk filter. Right-aligned "Email summary" button.
- **KPI strip — 4 equal cards**: Target Q1+Q2 (total $, deal count below) / Empirical forecast (EV $, gap-to-target in semantic color below) / EV / target ratio (with "below 0.6x benchmark" semantic sub-label) / At-risk count (N/total format, $ exposure below). Card height ~80px, 22px numbers, 12px labels.
- **Seller scorecard table — one row per seller, Q1+Q2 aggregated**. Columns in order: Seller (avatar + name + "N open · M at risk" sub-label) / Target / Actual + Est / EV / EV / target (hairline progress bar + ratio) / Risk (pill) / 8-wk trend (sparkline). The gap between Actual+Est and EV is the seller-discipline signal — keep both columns; when the discount exceeds 20% or $200K, show a small `−$XX` connector between them.
- **Click seller row** → inline expanded narrative panel: left column is editable closure-plan text area (with Edit / Regenerate / Copy buttons; Regenerate is stubbed for now — wire to the chat-analyst Edge Function in a follow-up). Right column lists open deals (sorted by contribution desc, at-risk pinned top), each with 2px colored left border by risk, deal name, $ contribution, stage, status pill. Inside the expansion also show the Q1 vs Q2 split as a small sub-table.
- **At-risk deals table** below the seller scorecard. Replace the legacy giant "At risk: no next meeting date" pills with 2px red left-edge border + short tag. Columns: seller, deal, stage, value, days stuck, last touch, next action. Sortable, default sort by gap-to-target desc.

Data: pull from the same RPCs the legacy view uses (see audit). If a required field doesn't exist in the current schema, flag it and propose either a derived computation in the frontend or a backend change — don't silently invent data.

After Phase 2, the Vertical Performance view in the new app should look and feel materially better than its legacy counterpart and serve as the visual reference everything else gets compared against.

## What to do after Phase 2

Open the PR, summarize what's done, and **stop**. Phase 3 (propagating the pattern to the other 21 views) is a separate session per batch of 3–4 views. Don't try to do it all today.

## Operating norms

- Plan first, then implement. State the plan, ask for clarification on ambiguities, then execute.
- One PR per phase. Don't bundle.
- Never push to `main` directly. Work on `claude-migration` branch with sub-branches per PR.
- After any visual change, take a screenshot of the running dev server and include it in the PR description so reviewer doesn't have to run locally.
- Don't touch `supabase/` migrations or Edge Functions in this session.
- Don't fork views with `-v2` suffixes. If a view needs a redesign, edit the existing component.
- If a Codex artifact (`AGENTS.md`, `.codex/`, beige palette, lowercase headings) appears anywhere, remove or normalize it.

Start with Phase 0. Begin by reading `CLAUDE.md` and `HANDOVER_CONTEXT.md`, then producing `MIGRATION_AUDIT.md`. Ask me anything you need before you start.
