# Persistent Context Hand-Over (Sales Reporting App)

Version: `v1.0.3`  
Date: `February 12, 2026`  
Purpose: reusable context for Jaideep + any GenAI assistant to produce consistent results.

## 1. Business Objective
- Build and run a weekly sales reporting system that answers:
- Are we generating enough top-of-funnel volume?
- Are deals moving through stages healthily?
- Which deals are stuck / need intervention?
- What is likely to close this quarter and next quarter?

## 2. Product + Deployment
- App name: `MathCo Realtime Sales Reporting`
- Frontend: single-page app (`index.html`)
- Backend/store: Supabase (`dashboard_state`, `dashboard_versions`, RPCs, Edge Functions)
- Data ingest: Monday.com board sync via `sync-monday-board` function
- Hosting: GitHub Pages (`jdeep2901/sales-reporting-dashboard`)
- Current app version label in UI: `v1.0.3`

## 3. Data Sources
- Primary deals board: `https://themathcocrmtrial.monday.com/boards/6218900009`
- Industry enrichment source: Accounts board `6218900019` (mirrored Industry)
- Function enrichment source: Contacts board `6218900012` (mirrored Business Group)
- Historical/manual source used early: Excel dump (now replaced by Monday sync)

## 4. Canonical Stage Model
Use this exact stage order everywhere:
1. Intro  
2. Qualification  
3. Capability  
4. Problem Scoping  
5. Proposal  
6. Contracting  
7. Win  
8. Loss

Context tags:
- `9 Disqualified`, `10 No Show/Reschedule`, `11/12 Latent Pool` = “gone” stages for movement context unless explicitly included.

## 5. Core Business Rules Locked In
- FY definition: April–March
- Most dashboard views use Intro-date-based filtering logic.
- **Reporting dimension is industry, not seller (Sep 2026).** Every view reports and filters by `Pharma`, `CPG/Retail`, `Others`, derived from the deal's own Monday `industry` field (not its owner), so reporting stays stable as the roster changes.
  - Pharma = Pharma, Biotechnology, Health Care. CPG/Retail = CPG, Retail. Others = everything else, incl. blank.
  - Targets are per industry (`pharma||Q2'27` etc.). Seeded Sep 2026 from the old seller targets: Pharma = Akshay's; CPG/Retail = Somya + Suvom; Others = Maruti + Andy. Legacy per-seller target keys remain in storage for history only.
- Deal scope (which deals count) = new-sales team roster, matched on `deal owner` / `matched_sellers`: `Akshay Iyer`, `Maruti Peri`, `Raj Jha`, `Andy Shankar`, `Sahana`, plus departed `Somya` and `Suvom Mitro` (kept so their deals and wins stay counted). Defined as `SALES_TEAM` in `src/lib/vpCompute.ts` — add new joiners there.
  - Roster history: Jun 2026 — Suvom replaced Abhinav; Andy took over Vitor's EU territory. Sep 2026 — Somya and Suvom left; Raj Jha joined as CPG/Retail seller.
- Movement comparison uses versioned snapshots.
- Help Needed is user-editable and persisted to backend shared state.
- Historical versions are viewable; edits are intended for current/latest context.

## 6. Key Tabs and What They Mean
- `Weekly Scorecard`: funnel counts, movement deltas, closures this/next quarter, help-needed controls.
- `Call Trends`: intro call trend over time.
- `Revenue Forecast`: EV-style quarter outlook (custom rules implemented through app history).
- `Admin`: users, targets, Monday refresh, versioning, data quality checks.
- Additional/appendix analyses exist but main screen is intentionally simplified.

## 7. Movement Logic (Current Expected Behavior)
- Positive movement should be shown in destination stage.
- Negative movement should be shown in origin stage context.
- Popup tables include `From` and `To` stage columns.
- Movement markers:
- `▲` moved forward
- `▼` moved backward
- `+` new in current vs compare

## 8. Versioning + Compare
- Every Monday refresh creates a snapshot version.
- Active/latest version pointers are tracked in backend.
- Users can view historical versions.
- Compare supports current vs previous snapshot movement analysis.
- Version naming/notes are used in the UI dropdown.

## 9. Data Quality Framework
- Runs on each sync and stores status per version.
- Categories include schema presence, type/format, business rules, cross-tab reconciliation, comparative drift.
- Current known state has shown QA `FAIL` with gaps mostly tied to source completeness and reconciliation strictness.
- QA scope was adjusted to focus checks for records with intro date `>= 2024-10-01`.

## 10. Important Reporting Conventions
- Always specify:
- date basis (`Intro date` vs `Created date` vs `Start date`)
- intro cutoff used
- seller scope used
- stage inclusion/exclusion used
- For board-quarter closure lists, use start date to assign quarter.
- “Likely closures” should exclude clearly non-closing statuses unless asked otherwise.

## 11. Known Operational Constraints
- In restricted/sandbox runtime, DNS may fail (`Could not resolve host`).
- Outside sandbox/local shell, Supabase connectivity works.
- If Supabase CLI deploy fails in sandbox, run deploy locally with token.
- GitHub Pages build may occasionally throttle on Jekyll endpoints; static workflow path is preferred.

## 12. Runbook (Daily/Weekly)
- Refresh data in Admin from Monday.
- Verify QA status in Admin.
- Confirm latest version selected.
- Review Weekly Scorecard movement + closures.
- Review Call Trends and Revenue Forecast.
- Export/share board summary with explicit filter context.

## 13. Open/Deferred Feature
- Deferred concept: seller activity planning workflow on deals (comments, planned activities, ETA, done/not done) with backend persistence.

## 14. Prompt Template for Any Future GenAI Agent
Use this exact brief:
- “Use MathCo Realtime Sales Reporting context. FY is Apr–Mar. Stage order is Intro, Qualification, Capability, Problem Scoping, Proposal, Contracting, Win/Loss. Report by industry (Pharma, CPG/Retail, Others) from the deal's industry field; deal scope is the SALES_TEAM roster in src/lib/vpCompute.ts. Specify intro cutoff, industry filter, and stage filter in every analysis. Use start-date quarter for closure views. Include assumptions and caveats explicitly.”

## 15. Guardrails for Consistency
- Never change stage order implicitly.
- Never mix created-date and intro-date logic without explicitly calling it out.
- Never present quarter numbers without specifying date basis and filter basis.
- Always reconcile card counts vs table drilldowns before sharing externally.
