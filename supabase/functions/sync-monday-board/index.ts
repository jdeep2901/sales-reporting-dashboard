import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const INTRO_DATE_CUTOFF = "2024-10-01";
const MATTER_STAGES = new Set([
  "scheduled intro calls",
  "qualification",
  "capabilities showcase",
  "problem scoping",
  "contracting",
  "commercial proposal",
]);
const FUNNEL_STAGE_MAP: Record<string, string> = {
  "scheduled intro calls": "1. Intro",
  "qualification": "2. Qualification",
  "capabilities showcase": "3. Capability",
  "problem scoping": "4. Problem Scoping",
  "contracting": "5. Contracting",
  "commercial proposal": "6. Commercial Proposal",
};
const FUNNEL_STAGES = [
  "1. Intro",
  "2. Qualification",
  "3. Capability",
  "4. Problem Scoping",
  "5. Contracting",
  "6. Commercial Proposal",
];
const SLA_DAYS: Record<string, number> = {
  "scheduled intro calls": 21,
  "qualification": 30,
  "capabilities showcase": 30,
  "problem scoping": 45,
  "contracting": 45,
  "commercial proposal": 45,
};
const SELLERS: Array<[string, string]> = [
  ["somya", "Somya"],
  ["akshay iyer", "Akshay Iyer"],
  ["abhinav kishore", "Abhinav Kishore"],
  ["maruti peri", "Maruti Peri"],
  ["vitor quirino", "Vitor Quirino"],
];

type MondayColumn = { id: string; title: string; type: string; settings_str?: string | null };
type MondayItem = { id: string; name: string; column_values: Array<{ id: string; text: string; value: string | null }> };

function smartTextFromMondayColumnValue(text: string | null | undefined, value: string | null | undefined): string {
  const direct = String(text || "").trim();
  if (direct) return direct;
  const raw = value;
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw);
    const pick = (o: any): string => {
      if (o == null) return "";
      if (typeof o === "string") return o.trim();
      if (typeof o === "number" || typeof o === "boolean") return String(o);
      if (typeof o !== "object") return "";
      const candidates = [
        o.display_value,
        o.displayValue,
        o.label,
        o.text,
        o.value,
        o.name,
        o.title,
      ];
      for (const c of candidates) {
        const s = pick(c);
        if (s) return s;
      }
      if (Array.isArray(o.mirrored_items)) {
        const parts = o.mirrored_items
          .map((mi: any) => {
            const v = mi?.mirrored_value ?? mi?.mirroredValue ?? mi?.value;
            if (typeof v === "string") {
              try {
                return pick(JSON.parse(v));
              } catch (_) {
                return pick(v);
              }
            }
            return pick(v);
          })
          .filter(Boolean);
        if (parts.length) return parts.join(", ");
      }
      if (Array.isArray(o.labels)) {
        const parts = o.labels.map((z: any) => pick(z)).filter(Boolean);
        if (parts.length) return parts.join(", ");
      }
      if (Array.isArray(o.ids)) {
        const parts = o.ids.map((z: any) => pick(z)).filter(Boolean);
        if (parts.length) return parts.join(", ");
      }
      return "";
    };
    return pick(obj).trim();
  } catch (_) {
    return "";
  }
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function j(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function norm(text: string | null | undefined): string {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanStage(text: string | null | undefined): string {
  return String(text || "").replace(/^\s*\d+\.\s*/g, "").trim().replace(/\s+/g, " ");
}

function parseDate(raw: string | null | undefined): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yy = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  const dt = new Date(yy, mm - 1, dd);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function parseAmount(raw: string | null | undefined): number | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseMonths(raw: string | null | undefined): number | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n));
}

function monthLabel(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function weekStartISO(d: Date): string {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function primaryToken(text: string | null | undefined, fallback = "(blank)"): string {
  const s = String(text || "").trim();
  if (!s) return fallback;
  return (s.split(",")[0] || "").trim() || fallback;
}

function normalizeChannel(sourceOfLead: string | null | undefined, revenueSource: string | null | undefined): string {
  const raw = `${String(sourceOfLead || "").trim()} | ${String(revenueSource || "").trim()}`.toLowerCase();
  if (!raw.replace(/\|/g, "").trim()) return "Unknown";
  if (raw.includes("refer")) return "Reference";
  if (raw.includes("partner") || raw.includes("alliance")) return "Partner";
  if (raw.includes("inbound") || raw.includes("website") || raw.includes("conference") || raw.includes("event") || raw.includes("webinar") || raw.includes("newsletter")) return "Inbound/Marketing";
  if (raw.includes("existing") || raw.includes("upsell") || raw.includes("cross sell") || raw.includes("cross-sell") || raw.includes("renewal")) return "Existing Account";
  if (raw.includes("outbound") || raw.includes("cold") || raw.includes("prospecting") || raw.includes("sdr") || raw.includes("bdr")) return "Cold/Outbound";
  return "Other";
}

function stageNum(stage: string) {
  const m = stage.match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

function todayDate(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function pickColumnId(columns: MondayColumn[], candidates: Array<(t: string) => boolean>): string | null {
  for (const c of columns) {
    const t = norm(c.title);
    if (candidates.some((fn) => fn(t))) return c.id;
  }
  return null;
}

function pickColumnIds(columns: MondayColumn[], candidates: Array<(t: string) => boolean>): string[] {
  return columns
    .filter((c) => {
      const t = norm(c.title);
      return candidates.some((fn) => fn(t));
    })
    .map((c) => c.id);
}

function pickBestColumnIdByFillRate(
  items: MondayItem[],
  colIds: string[],
  getText: (item: MondayItem, id: string) => string,
  sampleLimit = 200,
): { best: string | null; sampleCounts: Record<string, number> } {
  const counts: Record<string, number> = {};
  if (!colIds.length) return { best: null, sampleCounts: counts };
  const sample = items.slice(0, Math.max(0, sampleLimit));
  for (const id of colIds) counts[id] = 0;
  for (const it of sample) {
    for (const id of colIds) {
      const v = getText(it, id);
      if (String(v || "").trim()) counts[id] += 1;
    }
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const id of colIds) {
    const c = counts[id] || 0;
    if (c > bestCount) {
      bestCount = c;
      best = id;
    }
  }
  return { best, sampleCounts: counts };
}

type ColumnFillStat = {
  id: string;
  title: string;
  type: string;
  non_empty: number;
  sample_size: number;
  example: string | null;
};

function inspectColumnFill(
  items: MondayItem[],
  columns: MondayColumn[],
  getText: (item: MondayItem, id: string) => string,
  sampleLimit = 200,
): ColumnFillStat[] {
  const sample = items.slice(0, Math.max(0, sampleLimit));
  const stats: ColumnFillStat[] = columns.map((c) => ({
    id: c.id,
    title: c.title,
    type: c.type,
    non_empty: 0,
    sample_size: sample.length,
    example: null,
  }));
  const idxById: Record<string, number> = Object.fromEntries(stats.map((s, i) => [s.id, i]));
  for (const it of sample) {
    for (const c of columns) {
      const v = String(getText(it, c.id) || "").trim();
      if (!v) continue;
      const s = stats[idxById[c.id]];
      s.non_empty += 1;
      if (!s.example) s.example = v.length > 120 ? `${v.slice(0, 117)}...` : v;
    }
  }
  return stats;
}

function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function extractLinkedItemIdsFromConnectValue(raw: string | null | undefined): string[] {
  // Connect boards column_values.value commonly includes linkedPulseIds.
  // Example: {"linkedPulseIds":[{"linkedPulseId":6218900123}]} or {"item_ids":[...]}.
  const obj = parseJsonSafe(raw);
  if (!obj || typeof obj !== "object") return [];
  const ids: Array<string | number> = [];
  const lp = obj.linkedPulseIds || obj.linked_pulse_ids || obj.linkedItemIds || obj.linked_item_ids;
  if (Array.isArray(lp)) {
    for (const x of lp) {
      const v = (x && typeof x === "object") ? (x.linkedPulseId ?? x.linked_pulse_id ?? x.id ?? x.itemId) : x;
      if (v != null) ids.push(v);
    }
  }
  const itemIds = obj.itemIds || obj.item_ids || obj.item_ids_array || obj.items;
  if (Array.isArray(itemIds)) {
    for (const v of itemIds) if (v != null) ids.push(v);
  }
  // Dedup + normalize to string.
  const out: string[] = [];
  for (const v of ids) {
    const s = String(v).trim();
    if (s && /^\d+$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function findConnectColumnToBoard(columns: MondayColumn[], targetBoardId: number): string | null {
  const target = String(Math.trunc(targetBoardId));
  for (const c of columns) {
    const type = norm(c.type);
    // Monday connect boards column type is commonly "board-relation".
    if (!(type.includes("relation") || type.includes("connect"))) continue;
    const st = parseJsonSafe(c.settings_str || null);
    if (!st || typeof st !== "object") continue;
    const boardIds = st.boardIds || st.board_ids || st.connectedBoardIds || st.connected_board_ids || st.board_ids_array;
    if (Array.isArray(boardIds) && boardIds.map((x: any) => String(x)).includes(target)) return c.id;
    const boardId = st.boardId || st.board_id || st.connectedBoardId || st.connected_board_id;
    if (boardId != null && String(boardId) === target) return c.id;
    const boards = st.boards || st.linkedBoards;
    if (Array.isArray(boards) && boards.some((b: any) => String(b?.id || b?.boardId || b?.board_id || "") === target)) return c.id;
  }
  return null;
}

async function fetchItemsByIds(
  token: string,
  itemIds: string[],
  columnIds: string[] | null,
): Promise<Array<{ id: string; name: string; column_values: Array<{ id: string; text: string; value: string | null }> }>> {
  const ids = itemIds.filter(Boolean);
  if (!ids.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const out: any[] = [];
  const q = `
    query ($ids: [ID!], $colIds: [String!]) {
      items(ids: $ids) {
        id
        name
        column_values(ids: $colIds) { id text value }
      }
    }
  `;
  for (const ch of chunks) {
    const data = await mondayGraphql(token, q, { ids: ch, colIds: columnIds || [] });
    out.push(...((data?.items || []) as any[]));
  }
  return out as any;
}

async function mondayGraphql(token: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(body.errors || body)}`);
  }
  return body.data;
}

async function fetchBoard(token: string, boardId: number) {
  const firstQuery = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        id
        name
        columns { id title type settings_str }
        items_page(limit: 500) {
          cursor
          items { id name column_values { id text value } }
        }
      }
    }
  `;
  const first = await mondayGraphql(token, firstQuery, { boardId: [boardId] });
  const board = first?.boards?.[0];
  if (!board) throw new Error(`Board ${boardId} not found.`);

  const items: MondayItem[] = [...(board.items_page?.items || [])];
  let cursor: string | null = board.items_page?.cursor || null;

  const nextQuery = `
    query ($cursor: String!) {
      next_items_page(limit: 500, cursor: $cursor) {
        cursor
        items { id name column_values { id text value } }
      }
    }
  `;

  while (cursor) {
    const next = await mondayGraphql(token, nextQuery, { cursor });
    const page = next?.next_items_page;
    if (!page) break;
    items.push(...(page.items || []));
    cursor = page.cursor || null;
  }

  return { boardName: board.name, columns: board.columns as MondayColumn[], items };
}

function initScorecard() {
  return {
    stage_counts: {} as Record<string, number>,
    stage_1_2_count: 0,
    stage_3_4_count: 0,
    stage_1_6_count: 0,
    stage_5_6_count: 0,
    stage_7_8_count: 0,
    missing_next_step_2_6: 0,
    over_sla_2_6: 0,
    stuck_proxy_2_6: 0,
    stage_1_2_records: [] as Array<Record<string, unknown>>,
    stage_3_4_records: [] as Array<Record<string, unknown>>,
    stage_1_6_records: [] as Array<Record<string, unknown>>,
    stage_5_6_records: [] as Array<Record<string, unknown>>,
    stage_7_8_records: [] as Array<Record<string, unknown>>,
    missing_next_step_records: [] as Array<Record<string, unknown>>,
    over_sla_records: [] as Array<Record<string, unknown>>,
    stuck_records: [] as Array<Record<string, unknown>>,
  };
}

async function buildDataset(
  items: MondayItem[],
  columns: MondayColumn[],
  boardId: number,
  boardName: string,
  opts?: {
    industry_col_id?: string | null;
    accounts_board_id?: number | null;
    accounts_industry_col_id?: string | null;
    accounts_relation_col_id?: string | null; // deals-board connect column pointing to accounts
    monday_token?: string | null;
  },
) {
  const colById: Record<string, MondayColumn> = Object.fromEntries(columns.map((c) => [c.id, c]));
  const byId = (item: MondayItem, id: string | null) => {
    if (!id) return "";
    const x = item.column_values.find((v) => v.id === id);
    return (x?.text || "").trim();
  };
  const byIdSmartText = (item: MondayItem, id: string | null) => {
    if (!id) return "";
    const x = item.column_values.find((v) => v.id === id);
    return smartTextFromMondayColumnValue(x?.text, x?.value);
  };
  const byIdDate = (item: MondayItem, id: string | null) => {
    if (!id) return "";
    const x = item.column_values.find((v) => v.id === id);
    const txt = (x?.text || "").trim();
    if (txt) return txt;
    const raw = x?.value;
    if (!raw) return "";
    try {
      const obj = JSON.parse(raw);
      const candidate = String(
        obj?.date ||
        obj?.start_date ||
        obj?.startDate ||
        obj?.value ||
        ""
      ).trim();
      return candidate;
    } catch (_) {
      return "";
    }
  };
  const byIdValue = (item: MondayItem, id: string | null) => {
    if (!id) return null;
    const x = item.column_values.find((v) => v.id === id);
    return x?.value || null;
  };
  const cutoffDate = parseDate(INTRO_DATE_CUTOFF)!;
  const introDateCol = pickColumnId(columns, [(t) => t.includes("intro") && t.includes("date"), (t) => t.includes("scheduled intro")]);
  const startDateCol = pickColumnId(columns, [(t) => t === "start date", (t) => t.includes("start date"), (t) => t.includes("deal start")]);
  const durationCol = pickColumnId(columns, [
    (t) => t === "duration",
    (t) => t.includes("duration"),
    (t) => t.includes("engagement duration"),
    (t) => t.includes("duration months"),
  ]);
  const durationCandidateCols = Array.from(new Set([
    ...(durationCol ? [durationCol] : []),
    ...pickColumnIds(columns, [
      (t) => t.includes("duration"),
      (t) => t.includes("engagement") && t.includes("month"),
      (t) => t.includes("term") && t.includes("month"),
      (t) => t === "months",
    ]),
  ]));
  const stageCol = pickColumnId(columns, [(t) => t.includes("deal stage"), (t) => t === "stage"]);
  const ownerCol = pickColumnId(columns, [(t) => t.includes("deal owner"), (t) => t.includes("owner")]);
  const nextStepCol = pickColumnId(columns, [(t) => t.includes("next step")]);

  // Only apply fill-rate-based auto selection to Industry, since this is commonly a Mirror/Connect column with blank `text`.
  const industryCandidates = pickColumnIds(columns, [(t) => t.includes("industry")]);
  const industryPick = pickBestColumnIdByFillRate(items, industryCandidates, (it, id) => byIdSmartText(it, id));
  const industryColAuto = industryPick.best || pickColumnId(columns, [(t) => t.includes("industry")]);
  const industryColPinned = String(opts?.industry_col_id || "").trim() || null;
  const industryCol = industryColPinned || industryColAuto;

  const logoCol = pickColumnId(columns, [(t) => t.includes("logo"), (t) => t.includes("account") || t.includes("company")]);
  const functionCol = pickColumnId(columns, [(t) => t.includes("business function"), (t) => t === "function"]);
  const sourceLeadCol = pickColumnId(columns, [(t) => t.includes("source of lead"), (t) => t === "source", (t) => t.includes("lead source")]);
  const revenueSourceCol = pickColumnId(columns, [(t) => t.includes("revenue source mapping"), (t) => t.includes("revenue source")]);
  const adjContractNumCol = pickColumnId(columns, [(t) => t.includes("adjusted") && t.includes("contract") && (t.includes("num") || t.includes("number"))]);
  const adjContractCol = pickColumnId(columns, [(t) => t.includes("adjusted") && t.includes("contract")]);
  const tcvCol = pickColumnId(columns, [(t) => t.includes("tcv"), (t) => t.includes("contract value")]);

  // If Industry is mirrored from Accounts board, resolve it via join:
  // Deals board -> connect/relation column -> account item id(s) -> Accounts board industry column.
  const industryColType = industryCol ? (colById[industryCol]?.type || "") : "";
  const mirrorSettings = industryCol ? parseJsonSafe(colById[industryCol]?.settings_str || null) : null;
  const relationColFromMirror: string | null =
    (mirrorSettings && (mirrorSettings.relation_column_id || mirrorSettings.relationColumnId || mirrorSettings.board_relation_column_id || mirrorSettings.boardRelationColumnId)) ? String(
      mirrorSettings.relation_column_id || mirrorSettings.relationColumnId || mirrorSettings.board_relation_column_id || mirrorSettings.boardRelationColumnId,
    ) : null;
  const accountsBoardId = (opts?.accounts_board_id && Number.isFinite(Number(opts.accounts_board_id))) ? Number(opts.accounts_board_id) : null;
  const accountsIndustryColPinned = String(opts?.accounts_industry_col_id || "").trim() || null;
  const accountsRelationColPinned = String(opts?.accounts_relation_col_id || "").trim() || null;
  const accountsRelationColAuto = (accountsBoardId ? findConnectColumnToBoard(columns, accountsBoardId) : null);
  const accountsRelationColId = accountsRelationColPinned || relationColFromMirror || accountsRelationColAuto;

  let accountsIndustryColId: string | null = accountsIndustryColPinned;
  const accountIndustryById: Record<string, string> = {};
  let accountsJoinEnabled = false;
  let accountsJoinStats = {
    account_ids_found: 0,
    account_items_fetched: 0,
    account_industry_mapped: 0,
    deals_with_account_link: 0,
    deals_with_joined_industry: 0,
  };

  if (accountsBoardId && accountsRelationColId && opts?.monday_token) {
    accountsJoinEnabled = true;
    // Collect linked account item ids from deals items.
    const accountIds: string[] = [];
    for (const it of items) {
      const cv = it.column_values.find((v) => v.id === accountsRelationColId);
      const linked = extractLinkedItemIdsFromConnectValue(cv?.value || null);
      for (const id of linked) if (!accountIds.includes(id)) accountIds.push(id);
      if (accountIds.length > 5000) break;
    }
    accountsJoinStats.account_ids_found = accountIds.length;
    if (accountIds.length) {
      // If account industry column isn't pinned, infer from Accounts board columns.
      if (!accountsIndustryColId) {
        const accBoard = await fetchBoard(opts.monday_token, accountsBoardId);
        const candidates = accBoard.columns.filter((c) => norm(c.title).includes("industry")).map((c) => c.id);
        if (candidates.length) {
          const pick = pickBestColumnIdByFillRate(
            accBoard.items,
            candidates,
            (it, id) => {
              const cv = it.column_values.find((v) => v.id === id);
              return smartTextFromMondayColumnValue(cv?.text, cv?.value);
            },
            200,
          );
          accountsIndustryColId = pick.best || candidates[0] || null;
        }
      }

      if (accountsIndustryColId) {
        // Fetch account items by ids with only the industry column.
        const accountItems = await fetchItemsByIds(opts.monday_token, accountIds, [accountsIndustryColId]);
        accountsJoinStats.account_items_fetched = accountItems.length;
        for (const ai of accountItems) {
          const cv = (ai.column_values || []).find((v) => v.id === accountsIndustryColId);
          const val = smartTextFromMondayColumnValue(cv?.text, cv?.value);
          if (val) accountIndustryById[String(ai.id)] = val;
        }
        accountsJoinStats.account_industry_mapped = Object.keys(accountIndustryById).length;
      }
    }
  }

  const allUnique: Record<string, Record<string, number>> = {};
  const allUniqueDetails: Record<string, Record<string, string[]>> = {};
  const perSeller: Record<string, Record<string, Record<string, number>>> = Object.fromEntries(SELLERS.map(([, l]) => [l, {}]));
  const perSellerDetails: Record<string, Record<string, Record<string, string[]>>> = Object.fromEntries(SELLERS.map(([, l]) => [l, {}]));
  const perSellerFunnel: Record<string, Record<string, number>> = Object.fromEntries(SELLERS.map(([, l]) => [l, {}]));
  const scorecard: Record<string, ReturnType<typeof initScorecard>> = {
    "All (unique deals)": initScorecard(),
    ...Object.fromEntries(SELLERS.map(([, l]) => [l, initScorecard()])),
  };
  const months = new Set<string>();
  const stageTotals: Record<string, number> = {};
  const industryAction: Record<string, { total: number; industries: Record<string, { total: number; logos: Record<string, number>; functions: Record<string, number> }> }> =
    Object.fromEntries(SELLERS.map(([, l]) => [l, { total: 0, industries: {} }]));
  const winLossOverall = { won_total: 0, lost_total: 0, combos: {} as Record<string, { won: number; lost: number }> };
  const winLossPerSeller: Record<string, typeof winLossOverall> = Object.fromEntries(SELLERS.map(([, l]) => [l, { won_total: 0, lost_total: 0, combos: {} }]));
  const introTrendOverall: Record<string, number> = {};
  const introTrendPerSeller: Record<string, Record<string, number>> = Object.fromEntries(SELLERS.map(([, l]) => [l, {}]));
  const introDetailOverall: Record<string, Array<{ deal: string; stage: string; intro_date: string; seller: string }>> = {};
  const introDetailPerSeller: Record<string, Record<string, Array<{ deal: string; stage: string; intro_date: string; seller: string }>>> =
    Object.fromEntries(SELLERS.map(([, l]) => [l, {}]));
  const allDealsRows: Array<Record<string, unknown>> = [];
  const cycleTimeRows: Array<Record<string, unknown>> = [];
  let durationDetectedCount = 0;

  const addCounter = (table: Record<string, Record<string, number>>, stage: string, month: string) => {
    table[stage] ||= {};
    table[stage][month] = (table[stage][month] || 0) + 1;
  };
  const addDetail = (table: Record<string, Record<string, string[]>>, stage: string, month: string, deal: string) => {
    table[stage] ||= {};
    table[stage][month] ||= [];
    if (!table[stage][month].includes(deal)) table[stage][month].push(deal);
  };
  const addIndustryAction = (seller: string, industry: string, logo: string, bizFn: string) => {
    const root = industryAction[seller];
    root.total += 1;
    root.industries[industry] ||= { total: 0, logos: {}, functions: {} };
    const x = root.industries[industry];
    x.total += 1;
    x.logos[logo] = (x.logos[logo] || 0) + 1;
    x.functions[bizFn] = (x.functions[bizFn] || 0) + 1;
  };
  const addWinLoss = (bucket: typeof winLossOverall, industry: string, logo: string, bizFn: string, outcome: "won" | "lost") => {
    const key = `${industry}||${logo}||${bizFn}`;
    bucket.combos[key] ||= { won: 0, lost: 0 };
    bucket.combos[key][outcome] += 1;
    if (outcome === "won") bucket.won_total += 1;
    else bucket.lost_total += 1;
  };
  const addIntro = (scope: string, week: string, rec: { deal: string; stage: string; intro_date: string; seller: string }) => {
    if (scope === "Overall (unique)") {
      introTrendOverall[week] = (introTrendOverall[week] || 0) + 1;
      introDetailOverall[week] ||= [];
      introDetailOverall[week].push(rec);
      return;
    }
    introTrendPerSeller[scope][week] = (introTrendPerSeller[scope][week] || 0) + 1;
    introDetailPerSeller[scope][week] ||= [];
    introDetailPerSeller[scope][week].push(rec);
  };

  const addScorecard = (
    bucket: ReturnType<typeof initScorecard>,
    dealName: string,
    sellerLabel: string,
    stageNorm: string,
    stageLabel: string,
    createdDate: Date,
    nextStepDate: Date | null,
    createdMonth: string,
    dealSize: number | null,
    startDateIso: string | null,
    durationMonths: number | null,
    industry: string,
    sourceOfLead: string,
    revenueSource: string,
    channel: string,
  ) => {
    bucket.stage_counts[stageLabel] = (bucket.stage_counts[stageLabel] || 0) + 1;
    const ageDays = Math.floor((todayDate().getTime() - createdDate.getTime()) / 86400000);
    const baseRecord = {
      deal: dealName,
      seller: sellerLabel,
      stage: stageLabel,
      intro_date: createdDate.toISOString().slice(0, 10),
      created_month: createdMonth,
      start_date: startDateIso,
      duration_months: durationMonths,
      age_days: ageDays,
      deal_size: dealSize,
      industry,
      source_of_lead: sourceOfLead,
      revenue_source_mapping: revenueSource,
      channel,
    };
    if (stageNorm === "scheduled intro calls" || stageNorm === "qualification") {
      bucket.stage_1_2_count += 1;
      bucket.stage_1_2_records.push(baseRecord);
    }
    if (stageNorm === "capabilities showcase" || stageNorm === "problem scoping") {
      bucket.stage_3_4_count += 1;
      bucket.stage_3_4_records.push(baseRecord);
    }
    if (MATTER_STAGES.has(stageNorm)) {
      bucket.stage_1_6_count += 1;
      bucket.stage_1_6_records.push(baseRecord);
    }
    if (stageNorm === "contracting" || stageNorm === "commercial proposal") {
      bucket.stage_5_6_count += 1;
      bucket.stage_5_6_records.push(baseRecord);
    }
    if (stageNorm === "won" || stageNorm === "lost") {
      bucket.stage_7_8_count += 1;
      bucket.stage_7_8_records.push(baseRecord);
    }
    if (MATTER_STAGES.has(stageNorm) && stageNorm !== "scheduled intro calls") {
      const missing = !nextStepDate;
      const overSla = ageDays > (SLA_DAYS[stageNorm] || 9999);
      if (missing) {
        bucket.missing_next_step_2_6 += 1;
        bucket.missing_next_step_records.push({ ...baseRecord, reason: "no next step" });
      }
      if (overSla) {
        bucket.over_sla_2_6 += 1;
        bucket.over_sla_records.push({ ...baseRecord, reason: "over SLA" });
      }
      if (missing || overSla) {
        bucket.stuck_proxy_2_6 += 1;
        bucket.stuck_records.push({ ...baseRecord, missing_next_step: missing, over_sla: overSla });
      }
    }
  };

  for (const item of items) {
    const dealName = item.name?.trim() || "(Unnamed deal)";
    const owner = byId(item, ownerCol);
    const stageRaw = byId(item, stageCol);
    const nextStepRaw = byId(item, nextStepCol);
    const introDateRaw = byId(item, introDateCol);
    const startDateRaw = byIdDate(item, startDateCol);
    let durationMonths: number | null = null;
    for (const cid of durationCandidateCols) {
      const txt = byId(item, cid);
      durationMonths = parseMonths(txt);
      if (durationMonths != null) break;
      const rawVal = byIdValue(item, cid);
      if (rawVal) {
        try {
          const obj = JSON.parse(rawVal);
          const candidates = [
            obj?.number,
            obj?.value,
            obj?.duration,
            obj?.duration_months,
            obj?.text,
          ];
          for (const c of candidates) {
            durationMonths = parseMonths(c == null ? "" : String(c));
            if (durationMonths != null) break;
          }
          if (durationMonths != null) break;
        } catch (_) {}
      }
    }
    const stage = cleanStage(stageRaw);
    if (!stage || norm(stage) === "deal stage") continue;
    const stageNorm = norm(stage);
    const introDate = parseDate(introDateRaw);
    const startDate = parseDate(startDateRaw);
    const startDateIso = startDate ? startDate.toISOString().slice(0, 10) : null;
    if (durationMonths != null) durationDetectedCount += 1;
    const month = introDate ? monthLabel(introDate) : null;
    const stageLabel = FUNNEL_STAGE_MAP[stageNorm] || stage;
    let dealSize = parseAmount(byId(item, adjContractNumCol));
    if (dealSize == null) dealSize = parseAmount(byId(item, adjContractCol));
    if (dealSize == null) dealSize = parseAmount(byId(item, tcvCol));
    let industryRawText = byIdSmartText(item, industryCol);
    if (accountsJoinEnabled && accountsRelationColId) {
      const cv = item.column_values.find((v) => v.id === accountsRelationColId);
      const linked = extractLinkedItemIdsFromConnectValue(cv?.value || null);
      if (linked.length) accountsJoinStats.deals_with_account_link += 1;
      for (const aid of linked) {
        const v = accountIndustryById[String(aid)] || "";
        if (v && v.trim()) {
          // Prefer authoritative Industry from Accounts board when available.
          industryRawText = v;
          accountsJoinStats.deals_with_joined_industry += 1;
          break;
        }
      }
    }
    const industry = primaryToken(industryRawText);
    const logo = primaryToken(byIdSmartText(item, logoCol));
    const bizFn = primaryToken(byIdSmartText(item, functionCol));
    const sourceOfLead = byIdSmartText(item, sourceLeadCol);
    const revenueSource = byIdSmartText(item, revenueSourceCol);
    const channel = normalizeChannel(sourceOfLead, revenueSource);
    const ownerNorm = norm(owner);
    const matchedSellers = SELLERS.filter(([k]) => ownerNorm.includes(k)).map(([, l]) => l);
    allDealsRows.push({
      deal: dealName,
      item_id: item.id,
      stage: stageLabel,
      owner: owner || "(blank)",
      matched_sellers: matchedSellers,
      intro_date: introDate ? introDate.toISOString().slice(0, 10) : null,
      created_month: month,
      start_date: startDateIso,
      duration_months: durationMonths,
      deal_size: dealSize,
      industry,
      logo,
      function: bizFn,
      source_of_lead: sourceOfLead,
      revenue_source_mapping: revenueSource,
      channel,
    });
    if (stageNorm === "won" || stageNorm === "lost") {
      cycleTimeRows.push({
        deal: dealName,
        stage: stageLabel,
        seller: owner || "(blank)",
        matched_sellers: matchedSellers,
        intro_date: introDate ? introDate.toISOString().slice(0, 10) : null,
        created_month: month,
        start_date: startDateIso,
        duration_months: durationMonths,
        deal_size: dealSize,
        industry,
        source_of_lead: sourceOfLead,
        revenue_source_mapping: revenueSource,
        channel,
      });
    }
    if (!introDate || introDate < cutoffDate) continue;
    if (!matchedSellers.length) continue;

    months.add(month as string);
    stageTotals[stage] = (stageTotals[stage] || 0) + 1;
    addCounter(allUnique, stage, month);
    addDetail(allUniqueDetails, stage, month, dealName);

    const nextStepDate = parseDate(nextStepRaw);

    addScorecard(scorecard["All (unique deals)"], dealName, "All (unique deals)", stageNorm, stageLabel, introDate, nextStepDate, month, dealSize, startDateIso, durationMonths, industry, sourceOfLead, revenueSource, channel);
    if (stageNorm === "won" || stageNorm === "lost") {
      addWinLoss(winLossOverall, industry, logo, bizFn, stageNorm as "won" | "lost");
    }
    if (stageNorm !== "no show/ reschedule") {
      const wk = weekStartISO(introDate);
      addIntro("Overall (unique)", wk, { deal: dealName, stage, intro_date: introDate.toISOString().slice(0, 10), seller: "Overall (unique)" });
    }

    for (const label of matchedSellers) {
      perSeller[label][stage] ||= {};
      perSeller[label][stage][month] = (perSeller[label][stage][month] || 0) + 1;
      perSellerDetails[label][stage] ||= {};
      perSellerDetails[label][stage][month] ||= [];
      if (!perSellerDetails[label][stage][month].includes(dealName)) perSellerDetails[label][stage][month].push(dealName);
      if (FUNNEL_STAGE_MAP[stageNorm]) {
        const fs = FUNNEL_STAGE_MAP[stageNorm];
        perSellerFunnel[label][fs] = (perSellerFunnel[label][fs] || 0) + 1;
      }
      addScorecard(scorecard[label], dealName, label, stageNorm, stageLabel, introDate, nextStepDate, month, dealSize, startDateIso, durationMonths, industry, sourceOfLead, revenueSource, channel);
      if (MATTER_STAGES.has(stageNorm)) addIndustryAction(label, industry, logo, bizFn);
      if (stageNorm === "won" || stageNorm === "lost") addWinLoss(winLossPerSeller[label], industry, logo, bizFn, stageNorm as "won" | "lost");
      if (stageNorm !== "no show/ reschedule") {
        const wk = weekStartISO(introDate);
        addIntro(label, wk, { deal: dealName, stage, intro_date: introDate.toISOString().slice(0, 10), seller: label });
      }
    }
  }

  const orderedMonths = Array.from(months).sort();
  const stages = Object.keys(stageTotals).sort((a, b) => {
    const da = stageTotals[a] || 0;
    const db = stageTotals[b] || 0;
    if (db !== da) return db - da;
    return a.localeCompare(b);
  });
  const sellers = ["All (unique deals)", ...SELLERS.map(([, l]) => l)];

  const data: Record<string, unknown> = {
    sellers,
    months: orderedMonths,
    stages,
    tables: {
      "All (unique deals)": Object.fromEntries(stages.map((s) => [s, allUnique[s] || {}])),
      ...Object.fromEntries(SELLERS.map(([, l]) => [l, Object.fromEntries(stages.map((s) => [s, perSeller[l][s] || {}]))])),
    },
    details: {
      "All (unique deals)": Object.fromEntries(stages.map((s) => [s, allUniqueDetails[s] || {}])),
      ...Object.fromEntries(SELLERS.map(([, l]) => [l, Object.fromEntries(stages.map((s) => [s, perSellerDetails[l][s] || {}]))])),
    },
    carry_in: {
      "All (unique deals)": Object.fromEntries(stages.map((s) => [s, {}])),
      ...Object.fromEntries(SELLERS.map(([, l]) => [l, Object.fromEntries(stages.map((s) => [s, {}]))])),
    },
    meta: {
      intro_date_cutoff: INTRO_DATE_CUTOFF,
      cutoff_month_bucket: INTRO_DATE_CUTOFF.slice(0, 7),
      date_basis: "Intro Meeting Date (Monday board)",
      source: "monday.com",
      monday_board_id: String(boardId),
      monday_board_name: boardName,
      column_ids: {
        intro_date: introDateCol,
        start_date: startDateCol,
        duration: durationCol,
        stage: stageCol,
        owner: ownerCol,
        industry: industryCol,
        logo: logoCol,
        function: functionCol,
        source_of_lead: sourceLeadCol,
        revenue_source_mapping: revenueSourceCol,
      },
      column_pick_debug: {
        industry_candidates: industryCandidates,
        industry_sample_counts: industryPick.sampleCounts,
      },
      column_types: {
        industry: industryCol ? (colById[industryCol]?.type || null) : null,
        logo: logoCol ? (colById[logoCol]?.type || null) : null,
        function: functionCol ? (colById[functionCol]?.type || null) : null,
      },
      column_pins: {
        industry_col_id: industryColPinned,
      },
      accounts_join: {
        enabled: accountsJoinEnabled,
        accounts_board_id: accountsBoardId,
        accounts_relation_col_id: accountsRelationColId,
        accounts_industry_col_id: accountsIndustryColId,
        industry_col_type: industryColType || null,
        relation_col_from_mirror: relationColFromMirror,
        relation_col_auto: accountsRelationColAuto,
        stats: accountsJoinStats,
      },
      duration_column_id: durationCol,
      duration_candidate_column_ids: durationCandidateCols,
      duration_detected_rows: durationDetectedCount,
    },
  };

  const funnelMetrics: Record<string, unknown> = { stages: FUNNEL_STAGES, sellers: {} };
  for (const [, label] of SELLERS) {
    const counts = FUNNEL_STAGES.map((s) => Number(perSellerFunnel[label][s] || 0));
    const reached = counts.map((_, i) => counts.slice(i).reduce((a, b) => a + b, 0));
    const conv = FUNNEL_STAGES.map((_, i) => {
      if (i === FUNNEL_STAGES.length - 1) return null;
      const denom = reached[i];
      return denom ? reached[i + 1] / denom : null;
    });
    (funnelMetrics.sellers as Record<string, unknown>)[label] = { counts, reached, conversion_to_next: conv, total_stage_1_6: counts.reduce((a, b) => a + b, 0) };
  }
  data.funnel_metrics = funnelMetrics;

  const scoreOut: Record<string, unknown> = { as_of_date: new Date().toISOString().slice(0, 10), sellers: {} };
  for (const [label, p] of Object.entries(scorecard)) {
    p.stuck_records.sort((a, b) => {
      const ax = Number(a.age_days || 0);
      const bx = Number(b.age_days || 0);
      if (bx !== ax) return bx - ax;
      return String(a.deal || "").localeCompare(String(b.deal || ""));
    });
    const s16 = p.stage_1_6_count;
    const missPct = s16 ? p.missing_next_step_2_6 / s16 : 0;
    const slaPct = s16 ? p.over_sla_2_6 / s16 : 0;
    (scoreOut.sellers as Record<string, unknown>)[label] = {
      stage_1_2_count: p.stage_1_2_count,
      stage_3_4_count: p.stage_3_4_count,
      stage_1_6_count: s16,
      stage_5_6_count: p.stage_5_6_count,
      stage_7_8_count: p.stage_7_8_count,
      missing_next_step_2_6: p.missing_next_step_2_6,
      missing_next_step_pct_1_6: missPct,
      over_sla_2_6: p.over_sla_2_6,
      over_sla_pct_1_6: slaPct,
      stuck_proxy_2_6: p.stuck_proxy_2_6,
      stuck_top10: p.stuck_records.slice(0, 10),
      kpi_details: {
        stage_1_2: p.stage_1_2_records,
        stage_3_4: p.stage_3_4_records,
        stage_1_6: p.stage_1_6_records,
        stage_5_6: p.stage_5_6_records,
        stage_7_8: p.stage_7_8_records,
        missing_next_step_2_6: p.missing_next_step_records,
        over_sla_2_6: p.over_sla_records,
        stuck_proxy_2_6: p.stuck_records,
      },
    };
  }
  data.scorecard = scoreOut;

  const industryOut: Record<string, unknown> = { sellers: {} };
  for (const [, label] of SELLERS) {
    const raw = industryAction[label];
    const industries = Object.entries(raw.industries).map(([industry, p]) => ({
      industry,
      total: p.total,
      logos: p.logos,
      functions: p.functions,
    })).sort((a, b) => b.total - a.total || a.industry.localeCompare(b.industry));
    (industryOut.sellers as Record<string, unknown>)[label] = { total: raw.total, industries };
  }
  data.industry_action = industryOut;

  const finalizeWinLoss = (bucket: typeof winLossOverall) => {
    const rows = Object.entries(bucket.combos).map(([k, v]) => {
      const [industry, logo, fn] = k.split("||");
      const total = v.won + v.lost;
      return {
        industry, logo, function: fn, won: v.won, lost: v.lost, total,
        win_rate: total ? v.won / total : 0,
        loss_rate: total ? v.lost / total : 0,
      };
    }).sort((a, b) => b.total - a.total || b.lost - a.lost || a.industry.localeCompare(b.industry));
    const total = bucket.won_total + bucket.lost_total;
    return {
      won_total: bucket.won_total,
      lost_total: bucket.lost_total,
      total,
      overall_win_rate: total ? bucket.won_total / total : 0,
      rows,
    };
  };
  data.win_loss_sources = {
    overall_unique: finalizeWinLoss(winLossOverall),
    sellers: Object.fromEntries(SELLERS.map(([, l]) => [l, finalizeWinLoss(winLossPerSeller[l])])),
    note: "Scope is limited to included deals after active filters.",
  };

  const weeks = Object.keys(introTrendOverall).sort();
  data.intro_trend = {
    weeks,
    series: {
      "Overall (unique)": Object.fromEntries(weeks.map((w) => [w, introTrendOverall[w] || 0])),
      ...Object.fromEntries(SELLERS.map(([, l]) => [l, Object.fromEntries(weeks.map((w) => [w, introTrendPerSeller[l][w] || 0]))])),
    },
    details: {
      "Overall (unique)": Object.fromEntries(weeks.map((w) => [w, (introDetailOverall[w] || []).sort((a, b) => a.deal.localeCompare(b.deal) || a.intro_date.localeCompare(b.intro_date))])),
      ...Object.fromEntries(SELLERS.map(([, l]) => [l, Object.fromEntries(weeks.map((w) => [w, (introDetailPerSeller[l][w] || []).sort((a, b) => a.deal.localeCompare(b.deal) || a.intro_date.localeCompare(b.intro_date))]))])),
    },
    note: "Weekly trend uses Intro Meeting Date, excludes deals currently in No Show/ Reschedule.",
  };

  data.cycle_time_rows = cycleTimeRows;
  data.all_deals_rows = allDealsRows;

  return data;
}

function boardIdFromInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/boards\/(\d+)/i);
  if (m) return Number(m[1]);
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const mondayToken = Deno.env.get("MONDAY_API_TOKEN");
    if (!supabaseUrl || !serviceRole) return j({ error: "Missing Supabase environment." }, 500);
    if (!mondayToken) return j({ error: "Missing MONDAY_API_TOKEN secret in Supabase Edge Function." }, 500);

    const body = await req.json();
    const username = String(body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const boardId = boardIdFromInput(body?.board_id || body?.board_url);
    if (!username || !password) return j({ error: "username and password are required." }, 400);
    if (!boardId) return j({ error: "board_id (or board URL) is required." }, 400);

    const supabase = createClient(supabaseUrl, serviceRole);
    const login = await supabase.rpc("get_dashboard_state", { p_username: username, p_password: password });
    if (login.error) return j({ error: login.error.message }, 401);
    const st = Array.isArray(login.data) ? login.data[0] : login.data;
    if (!st || st.role !== "admin") return j({ error: "Admin access required." }, 403);

    const board = await fetchBoard(mondayToken, boardId);
    const pinnedIndustryCol = (st.settings && (st.settings as any).monday_industry_col_id) ? String((st.settings as any).monday_industry_col_id) : null;
    const accountsBoardId = (st.settings && (st.settings as any).monday_accounts_board_id) ? Number((st.settings as any).monday_accounts_board_id) : 6218900019;
    const accountsIndustryColId = (st.settings && (st.settings as any).monday_accounts_industry_col_id) ? String((st.settings as any).monday_accounts_industry_col_id) : null;
    const accountsRelationColId = (st.settings && (st.settings as any).monday_deals_accounts_relation_col_id) ? String((st.settings as any).monday_deals_accounts_relation_col_id) : null;
    const dataset = await buildDataset(board.items, board.columns, boardId, board.boardName, {
      industry_col_id: pinnedIndustryCol,
      accounts_board_id: accountsBoardId,
      accounts_industry_col_id: accountsIndustryColId,
      accounts_relation_col_id: accountsRelationColId,
      monday_token: mondayToken,
    });
    const datasetHash = await sha256Hex(JSON.stringify(dataset));
    const settings = {
      ...(st.settings || {}),
      monday_board_id: String(boardId),
      monday_board_url: `https://themathcocrmtrial.monday.com/boards/${boardId}`,
      monday_last_sync_at: new Date().toISOString(),
      monday_last_sync_by: username,
      monday_last_sync_rows: board.items.length,
      monday_board_name: board.boardName,
    };

    const inserted = await supabase.from("dashboard_versions").insert({
      created_by: username,
      source: "monday_sync",
      board_id: String(boardId),
      board_name: board.boardName,
      dataset,
      likelihood: st.likelihood || {},
      dataset_hash: datasetHash,
      item_count: Number(board.items.length || 0),
      notes: null,
    }).select("id").single();
    if (inserted.error || !inserted.data?.id) return j({ error: inserted.error?.message || "Failed to create version snapshot." }, 500);
    const versionId = inserted.data.id;

    const prune = await supabase.rpc("save_dashboard_state", {
      p_username: username,
      p_password: password,
      p_likelihood: st.likelihood || {},
      p_quarter_targets: st.quarter_targets || {},
      p_users: st.users || {},
      p_settings: settings,
      p_dataset: dataset,
      p_active_version_id: versionId,
    });
    if (prune.error) return j({ error: prune.error.message }, 500);

    const upd = await supabase.from("dashboard_state")
      .update({ latest_version_id: versionId, active_version_id: versionId })
      .eq("id", "main");
    if (upd.error) return j({ error: upd.error.message }, 500);

    const old = await supabase
      .from("dashboard_versions")
      .select("id")
      .order("created_at", { ascending: false })
      .range(52, 10000);
    if (old.error) return j({ error: old.error.message }, 500);
    const oldIds = (old.data || []).map((x: any) => x.id).filter(Boolean);
    if (oldIds.length) {
      const del = await supabase.from("dashboard_versions").delete().in("id", oldIds);
      if (del.error) return j({ error: del.error.message }, 500);
    }

    const latestState = await supabase.rpc("get_dashboard_state", {
      p_username: username,
      p_password: password,
    });
    if (latestState.error) return j({ error: latestState.error.message }, 500);
    const out = Array.isArray(latestState.data) ? latestState.data[0] : latestState.data;
    return j({
      ok: true,
      board_id: String(boardId),
      board_name: board.boardName,
      item_count: board.items.length,
      version_id: versionId,
      state: out,
    });
  } catch (e) {
    return j({ error: (e as Error).message || "Unexpected error" }, 500);
  }
});
