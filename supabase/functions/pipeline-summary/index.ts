import { createClient } from "npm:@supabase/supabase-js@2";

// ─── vpCompute.ts copied verbatim ─────────────────────────────────────────────
// Source of truth: src/lib/vpCompute.ts — do not edit here, edit there and sync.

const ACTIVE_SELLERS = [
  "Akshay Iyer",
  "Somya",
  "Maruti Peri",
  "Vitor Quirino",
  "Sahana",
  "Suvom Mitro",
] as const;

type SellerName = (typeof ACTIVE_SELLERS)[number];

const MATTER_STAGE_ORDER = [
  "1. Intro",
  "2. Qualification",
  "3. Capability",
  "4. Problem Scoping",
  "6. Commercial Proposal",
  "5. Contracting",
  "7. Win",
  "8. Loss",
];

const FUNNEL_ORDER = [
  "1. Intro",
  "2. Qualification",
  "3. Capability",
  "4. Problem Scoping",
  "6. Commercial Proposal",
  "5. Contracting",
  "7. Latent Pool - Monthly",
  "7. Win",
  "8. Loss",
  "9. Disqualified",
  "10. No Show/ Reschedule",
  "11. Latent Pool - Bi-monthly",
  "12. Latent Pool - Half yearly revisit",
];

const STAGE_MAP: Record<string, string> = {
  "Scheduled Intro calls": "1. Intro",
  Qualification: "2. Qualification",
  "Capabilities showcase": "3. Capability",
  "Problem Scoping": "4. Problem Scoping",
  Contracting: "5. Contracting",
  "Commercial Proposal": "6. Commercial Proposal",
  "Latent Pool - Monthly": "7. Latent Pool - Monthly",
  Won: "7. Win",
  Lost: "8. Loss",
  Disqualified: "9. Disqualified",
  "No Show/ Reschedule": "10. No Show/ Reschedule",
  "Latent Pool - Bi-monthly": "11. Latent Pool - Bi-monthly",
  "Latent Pool - Half yearly revisit": "12. Latent Pool - Half yearly revisit",
};

const SELLER_ALIASES: Record<string, string[]> = {
  "Akshay Iyer": ["akshay iyer", "akshay"],
  Somya: ["somya"],
  "Maruti Peri": ["maruti peri", "peri"],
  "Vitor Quirino": ["vitor quirino", "vitor"],
  Sahana: ["sahana"],
  "Suvom Mitro": ["suvom mitro", "suvom"],
};

const EMPIRICAL_STAGE: Record<number, { p: number; label: string }> = {
  1: { p: 0.08, label: "Intro" },
  2: { p: 0.10, label: "Qualification" },
  3: { p: 0.19, label: "Capability" },
  4: { p: 0.29, label: "Problem Scoping" },
  5: { p: 0.44, label: "Commercial Proposal" },
  6: { p: 0.90, label: "Contracting" },
};

const STALENESS_THRESHOLD: Record<number, number> = {
  1: 45, 2: 30, 3: 21, 4: 21, 5: 14, 6: 14,
};

interface DealRow {
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
  [key: string]: unknown;
}

interface QuarterTargets {
  [key: string]: { seller: string; quarter: string; revenue: number };
}

interface QuarterSummary {
  seller: string;
  quarter: { key: "current" | "next"; label: string };
  target: number;
  booked: number;
  committed: number;
  bookedCommitted: number;
  ev: number;
  flooredEv: number;
}

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
  const m = date.getMonth() + 1;
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
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
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

function buildQuarterLabels(referenceDate: string | null | undefined): { current: string; next: string } {
  const d = referenceDate ? (parseIsoDate(referenceDate) ?? new Date()) : new Date();
  const cur = fiscalQInfo(d);
  const nxt = cur.quarter < 4
    ? { quarter: cur.quarter + 1, fiscalYear: cur.fiscalYear }
    : { quarter: 1, fiscalYear: cur.fiscalYear + 1 };
  return { current: fiscalQText(cur), next: fiscalQText(nxt) };
}

function normalizeStage(stage: string): string {
  return STAGE_MAP[stage] ?? stage;
}

function stageNumber(stage: string | null | undefined): number | null {
  const raw = String(stage ?? "").trim();
  const normalized = normalizeStage(raw);
  const idxM = MATTER_STAGE_ORDER.indexOf(normalized);
  if (idxM >= 0) return idxM + 1;
  const idxF = FUNNEL_ORDER.indexOf(normalized);
  if (idxF >= 0) return idxF + 1;
  const m = normalized.match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

function isWonStage(stage: string | null | undefined): boolean {
  const ns = normalizeStage(String(stage ?? "").trim()).toLowerCase();
  return ns === "7. win" || ns === "won" || ns === "win";
}

function closureActiveStage(row: DealRow): boolean {
  const st = String(row.stage ?? row.deal_stage ?? row.dealStage ?? "").toLowerCase();
  if (!st) return false;
  if (st.includes("won") || st.includes("win") || st.includes("loss") || st.includes("lost")) return false;
  if (st.includes("disqualified") || st.includes("no show") || st.includes("reschedule") || st.includes("latent")) return false;
  const n = stageNumber(row.stage ?? row.deal_stage ?? row.dealStage);
  return n != null && n >= 1 && n <= 6;
}

function sellerAliases(seller: string): string[] {
  return SELLER_ALIASES[seller] ?? [seller.toLowerCase()].filter(Boolean);
}

function rowMatchesSeller(row: DealRow, seller: string): boolean {
  const label = String(seller ?? "").trim();
  if (!label || label === "Overall") return ACTIVE_SELLERS.some((s) => rowMatchesSeller(row, s));
  const aliases = sellerAliases(label).map((x) => x.toLowerCase());
  const matched: string[] = Array.isArray(row.matched_sellers) ? row.matched_sellers : [];
  if (matched.some((s) => String(s).trim().toLowerCase() === label.toLowerCase())) return true;
  if (matched.some((s) => aliases.includes(String(s).trim().toLowerCase()))) return true;
  const raw = String(row.owner ?? row.seller ?? row.deal_owner ?? "").toLowerCase();
  return aliases.some((a) => a && raw.includes(a));
}

function dealSizeValue(raw: unknown): number {
  const n = Number(raw);
  return isFinite(n) ? n : 0;
}

function leadershipDealSize(row: DealRow): number {
  const n = stageNumber(row.stage ?? row.deal_stage ?? row.dealStage);
  if (n != null && n <= 4 && !isWonStage(row.stage ?? row.deal_stage ?? row.dealStage)) return 100_000;
  return dealSizeValue(row.deal_size);
}

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

function empiricalEv(row: DealRow, qLabel: string): number {
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

function getTarget(targets: QuarterTargets, seller: string, quarter: string): number {
  const key = `${seller.trim().toLowerCase()}||${quarter.trim().toUpperCase()}`;
  const x = targets[key];
  return isFinite(Number(x?.revenue)) ? Number(x.revenue) : 0;
}

function buildRows(
  data: Record<string, unknown>,
  targets: QuarterTargets,
  quarterLabels: { current: string; next: string },
): { summary: QuarterSummary[]; deals: DealRow[] } {
  const rows: DealRow[] = Array.isArray(data.all_deals_rows) ? (data.all_deals_rows as DealRow[]) : [];
  const quarters = (
    [
      { key: "current" as const, label: quarterLabels.current },
      { key: "next" as const, label: quarterLabels.next },
    ]
  ).filter((q) => !!normalizeQuarterLabel(q.label));

  const summary: QuarterSummary[] = [];
  const openDeals: DealRow[] = [];

  for (const seller of ACTIVE_SELLERS) {
    for (const quarter of quarters) {
      const target = getTarget(targets, seller, quarter.label);
      let booked = 0;
      let committed = 0;
      let ev = 0;
      let flooredEv = 0;

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
          if (quarter.key === "current") openDeals.push(r);
          if (n != null && n >= 5) {
            committed += quarterPacedAmount(r, quarter.label, rawSize);
          }
        }
        const evContrib = empiricalEv(r, quarter.label);
        ev += evContrib;
        if (n != null && n <= 4) flooredEv += evContrib;
      }

      summary.push({ seller, quarter, target, booked, committed, bookedCommitted: booked + committed, ev, flooredEv });
    }
  }

  return { summary, deals: openDeals };
}

// ─── deal-level helpers for the email ─────────────────────────────────────────

function dealKey(row: DealRow): string {
  return `${String(row.deal ?? row.account ?? "").trim().toLowerCase()}||${String(row.intro_date ?? "").trim()}`;
}

function dealLabel(row: DealRow): string {
  const acct = String(row.logo ?? row.account ?? "").trim() || "—";
  const deal = String(row.deal ?? "").trim() || "—";
  return `${acct} / ${deal}`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// ─── per-seller deal-level summary ────────────────────────────────────────────

function buildSellerDealSummary(
  rows: DealRow[],
  seller: string,
  quarterLabels: { current: string; next: string },
  today: Date,
) {
  const sellerRows = rows.filter((r) => rowMatchesSeller(r, seller));

  // Active pipeline
  const active = sellerRows.filter((r) => closureActiveStage(r));
  const won = sellerRows.filter((r) => isWonStage(r.stage ?? r.deal_stage ?? r.dealStage));

  // Deduplicated won (WS-style) — for FY won count
  const wonDeduped = new Map<string, DealRow>();
  won.forEach((r) => { const k = dealKey(r); if (!wonDeduped.has(k)) wonDeduped.set(k, r); });

  // Committed deals (S5+S6) with NMD check
  const committed = active.filter((r) => {
    const n = stageNumber(r.stage ?? r.deal_stage ?? r.dealStage);
    return n != null && n >= 5;
  });

  // No next steps: NMD null or in the past
  const noNmd = (r: DealRow) => {
    if (!r.next_meeting_date) return true;
    const nmd = parseIsoDate(r.next_meeting_date);
    return !nmd || nmd < today;
  };

  // Stale: stage-dependent threshold
  const isStale = (r: DealRow, daysSinceStageChange: number | null) => {
    if (daysSinceStageChange == null) return false;
    const n = stageNumber(r.stage ?? r.deal_stage ?? r.dealStage);
    if (n == null || !STALENESS_THRESHOLD[n]) return false;
    return daysSinceStageChange >= STALENESS_THRESHOLD[n];
  };

  return {
    active_count: active.length,
    committed_deals: committed.map((r) => ({
      deal: dealLabel(r),
      stage: r.stage,
      size: dealSizeValue(r.deal_size),
      ev_cur: empiricalEv(r, quarterLabels.current),
      ev_nxt: empiricalEv(r, quarterLabels.next),
      nmd: r.next_meeting_date ?? null,
      no_nmd: noNmd(r),
      intro_date: r.intro_date ?? null,
    })),
    fy_won_count: wonDeduped.size,
    fy_won_size: Array.from(wonDeduped.values()).reduce((s, r) => s + dealSizeValue(r.deal_size), 0),
    no_nmd_committed: committed.filter(noNmd).length,
  };
}

// ─── CORS + response helpers ──────────────────────────────────────────────────

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function j(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// ─── handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Latest version dataset
    const { data: versionRow, error: vErr } = await supabase
      .from("dashboard_versions")
      .select("id, dataset, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (vErr || !versionRow) return j({ error: "No version found", detail: vErr?.message }, 500);

    const versionData = versionRow.dataset as Record<string, unknown>;

    // 2. Targets from dashboard_state
    const { data: stateRow, error: sErr } = await supabase
      .from("dashboard_state")
      .select("quarter_targets")
      .limit(1)
      .single();
    if (sErr || !stateRow) return j({ error: "No state found", detail: sErr?.message }, 500);

    const targets = (stateRow.quarter_targets ?? {}) as QuarterTargets;

    // 3. Run the exact same computation as the dashboard
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const asOf = (versionData?.scorecard_summary as Record<string, unknown> | undefined)?.as_of_date
      ?? (versionData?.scorecard as Record<string, unknown> | undefined)?.as_of_date;
    const quarterLabels = buildQuarterLabels(asOf as string | undefined);
    const { summary, deals: openDeals } = buildRows(versionData, targets, quarterLabels);

    // 4. Per-seller aggregates (mirrors aggregateSellers logic)
    const allRows: DealRow[] = Array.isArray(versionData.all_deals_rows)
      ? (versionData.all_deals_rows as DealRow[])
      : [];

    const sellers = ACTIVE_SELLERS.map((seller) => {
      const sellerSummary = summary.filter((s) => s.seller === seller);
      const curQ = sellerSummary.find((s) => s.quarter.key === "current");
      const nxtQ = sellerSummary.find((s) => s.quarter.key === "next");

      const target_cur = curQ?.target ?? 0;
      const target_nxt = nxtQ?.target ?? 0;
      const booked_cur = curQ?.booked ?? 0;
      const booked_nxt = nxtQ?.booked ?? 0;
      const committed_cur = curQ?.committed ?? 0;
      const committed_nxt = nxtQ?.committed ?? 0;
      const ev_cur = curQ?.ev ?? 0;
      const ev_nxt = nxtQ?.ev ?? 0;
      const ev_both = ev_cur + ev_nxt;

      const dealDetail = buildSellerDealSummary(allRows, seller, quarterLabels, today);

      return {
        seller,
        target_cur,
        target_nxt,
        target_both: target_cur + target_nxt,
        booked_cur,
        booked_nxt,
        committed_cur,
        committed_nxt,
        ev_cur: Math.round(ev_cur),
        ev_nxt: Math.round(ev_nxt),
        ev_both: Math.round(ev_both),
        ev_ratio_cur: target_cur > 0 ? Math.round((ev_cur / target_cur) * 100) / 100 : null,
        ev_ratio_both: (target_cur + target_nxt) > 0
          ? Math.round((ev_both / (target_cur + target_nxt)) * 100) / 100
          : null,
        ...dealDetail,
      };
    });

    // 5. Team totals
    const team = sellers.reduce(
      (acc, s) => ({
        target_cur: acc.target_cur + s.target_cur,
        target_both: acc.target_both + s.target_both,
        booked_cur: acc.booked_cur + s.booked_cur,
        committed_cur: acc.committed_cur + s.committed_cur,
        ev_cur: acc.ev_cur + s.ev_cur,
        ev_both: acc.ev_both + s.ev_both,
        fy_won_count: acc.fy_won_count + s.fy_won_count,
        fy_won_size: acc.fy_won_size + s.fy_won_size,
        active_count: acc.active_count + s.active_count,
        no_nmd_committed: acc.no_nmd_committed + s.no_nmd_committed,
      }),
      { target_cur: 0, target_both: 0, booked_cur: 0, committed_cur: 0, ev_cur: 0, ev_both: 0, fy_won_count: 0, fy_won_size: 0, active_count: 0, no_nmd_committed: 0 },
    );

    return j({
      meta: {
        version_id: versionRow.id,
        version_date: versionRow.created_at,
        current_quarter: quarterLabels.current,
        next_quarter: quarterLabels.next,
        generated_at: new Date().toISOString(),
      },
      team_totals: team,
      sellers,
    });
  } catch (err) {
    return j({ error: String(err) }, 500);
  }
});
