# Skill: add-view

**Invoke when:** JD asks to add a view, build a new tab/page, or migrate a legacy view. Trigger phrases: "add a view", "new tab for", "migrate X view", "build the [name] page", "add [name] to the dashboard".

Use this skill when adding a new view to the dashboard, or when migrating an existing legacy view from `legacy/index.html` into the new component-based app.

## Procedure

1. **Pick the view id**. Lowercase, no hyphens if avoidable (match the legacy `view-*` id convention without the `view-` prefix). Example: `weeklyscorecard`, `calltrends`, `verticalperformance`.

2. **Create the view file** at `src/views/<PascalCaseName>.tsx`. The file exports a default React component named after the file. Component-internal styling uses Tailwind classes consuming the design tokens — never hardcoded hex.

3. **Register the route** in `src/App.tsx`. Add a `<Route path="/<id>" element={<ViewName />} />` and add the view to the `Tabs` config so it appears in the tab bar in the correct order. Tab order is defined in `src/lib/tabs.ts`.

4. **Wire data** via a TanStack Query hook in `src/lib/queries.ts`. Hook naming: `use<ViewName>Data` returning `{ data, isLoading, error }`. The hook calls a Supabase RPC where possible — list of RPCs is in `MIGRATION_AUDIT.md`. Never instantiate a Supabase client inside a view; always import from `src/lib/supabase.ts`.

5. **Compose from shared components**, not hand-rolled markup. Reach for `KpiCard`, `SellerRow`, `Tabs`, `Sparkline`, `DealPill`, `ExpandableRow`, `NarrativePanel` before writing new layout primitives. If a new primitive is needed across views, add it to `src/components/` and document it in CLAUDE.md.

6. **Apply the design system without deviation**:
   - Sentence case for headings, labels, columns, buttons. Never lowercase, never ALL CAPS, never Title Case.
   - Currency via `formatCurrency()` from `src/lib/formatters.ts`. No `$442,098`-style numbers anywhere.
   - Tabular numerals via Tailwind `tabular-nums` on every numeric span.
   - Status indicators: 2px colored left border on rows; pills are short text labels, not the primary signal.
   - Cards: 0.5px hairline border, no shadow, 8–12px radius.
   - KPI cards: ~80px tall, 12px label, 22px number weight 500.

7. **Empty and loading states are required**, not optional:
   - Loading: skeleton matching the final layout, never a spinner that hides structure
   - Empty: specific copy that explains what's missing and what action will fix it. E.g. "No closes yet — N deals open worth $X." Never just "No data."
   - Error: short message + a retry button calling the TanStack Query `refetch`.

8. **Verify before claiming done**:
   - `npm run dev` and visit the route. Confirm: no console errors, all states render (loading via React Query devtools, empty via filter manipulation, success).
   - `npm run build && npm run preview` produces a clean build.
   - Take a screenshot of the running view and include it in the PR description.

9. **Update CLAUDE.md** if the migration surfaced a new convention worth codifying. Add a one-line entry under the relevant section. Don't re-explain existing conventions.

## When migrating from `legacy/index.html`

- Locate the legacy view by its `id="view-*"`. Read the surrounding markup, the inline CSS that targets the view's classes, and the inline JS functions referenced.
- Identify the Supabase RPCs / Edge Functions the legacy view calls. Reuse them — don't reimplement business logic in the frontend.
- The legacy CSS is the *previous* design, not the target design. Match the new design system specified in CLAUDE.md; the legacy styling is reference for *what data is shown*, not *how it looks*.
- If logic in the legacy JS is unclear (e.g. complex date filtering, snapshot diffing), trace it back to the RPC where possible. The RPC is the contract; the JS is an implementation.
- Flag in the PR description any logic that didn't survive migration cleanly so the reviewer can confirm intent.

## Anti-patterns

- Creating a `-v2` or `-new` variant of an existing view. Edit the existing component and use git branches for variants.
- Hardcoding hex colors anywhere in a view file. All color goes through tokens.
- Duplicating business rules already encoded in `HANDOVER_CONTEXT.md`. Reference, don't restate.
- Querying Supabase from inside a component. Always via a hook in `src/lib/queries.ts`.
- Marking a view "done" without running the dev server and screenshot-verifying.
