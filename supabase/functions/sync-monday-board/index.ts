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

type MondayColumn = { id: string; title: string; type: string };
type MondayItem = { id: string; name: string; column_values: Array<{ id: string; text: string; value: string | null }> };

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
        columns { id title type }
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

function buildDataset(items: MondayItem[], columns: MondayColumn[], boardId: number, boardName: string) {
  const byId = (item: MondayItem, id: string | null) => {
    if (!id) return "";
    const x = item.column_values.find((v) => v.id === id);
    return (x?.text || "").trim();
  };
  const cutoffDate = parseDate(INTRO_DATE_CUTOFF)!;
  const introDateCol = pickColumnId(columns, [(t) => t.includes("intro") && t.includes("date"), (t) => t.includes("scheduled intro")]);
  const stageCol = pickColumnId(columns, [(t) => t.includes("deal stage"), (t) => t === "stage"]);
  const ownerCol = pickColumnId(columns, [(t) => t.includes("deal owner"), (t) => t.includes("owner")]);
  const nextStepCol = pickColumnId(columns, [(t) => t.includes("next step")]);
  const industryCol = pickColumnId(columns, [(t) => t.includes("industry")]);
  const logoCol = pickColumnId(columns, [(t) => t.includes("logo"), (t) => t.includes("account") || t.includes("company")]);
  const functionCol = pickColumnId(columns, [(t) => t.includes("business function"), (t) => t === "function"]);
  const adjContractNumCol = pickColumnId(columns, [(t) => t.includes("adjusted") && t.includes("contract") && (t.includes("num") || t.includes("number"))]);
  const adjContractCol = pickColumnId(columns, [(t) => t.includes("adjusted") && t.includes("contract")]);
  const tcvCol = pickColumnId(columns, [(t) => t.includes("tcv"), (t) => t.includes("contract value")]);

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
  ) => {
    bucket.stage_counts[stageLabel] = (bucket.stage_counts[stageLabel] || 0) + 1;
    const ageDays = Math.floor((todayDate().getTime() - createdDate.getTime()) / 86400000);
    const baseRecord = { deal: dealName, seller: sellerLabel, stage: stageLabel, created_month: createdMonth, age_days: ageDays, deal_size: dealSize };
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
    const stage = cleanStage(stageRaw);
    if (!stage || norm(stage) === "deal stage") continue;
    const stageNorm = norm(stage);
    const introDate = parseDate(introDateRaw);
    if (!introDate || introDate < cutoffDate) continue;

    const ownerNorm = norm(owner);
    const matchedSellers = SELLERS.filter(([k]) => ownerNorm.includes(k)).map(([, l]) => l);
    if (!matchedSellers.length) continue;

    const month = monthLabel(introDate);
    months.add(month);
    stageTotals[stage] = (stageTotals[stage] || 0) + 1;
    addCounter(allUnique, stage, month);
    addDetail(allUniqueDetails, stage, month, dealName);

    const nextStepDate = parseDate(nextStepRaw);
    const stageLabel = FUNNEL_STAGE_MAP[stageNorm] || stage;
    let dealSize = parseAmount(byId(item, adjContractNumCol));
    if (dealSize == null) dealSize = parseAmount(byId(item, adjContractCol));
    if (dealSize == null) dealSize = parseAmount(byId(item, tcvCol));
    const industry = primaryToken(byId(item, industryCol));
    const logo = primaryToken(byId(item, logoCol));
    const bizFn = primaryToken(byId(item, functionCol));

    addScorecard(scorecard["All (unique deals)"], dealName, "All (unique deals)", stageNorm, stageLabel, introDate, nextStepDate, month, dealSize);
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
      addScorecard(scorecard[label], dealName, label, stageNorm, stageLabel, introDate, nextStepDate, month, dealSize);
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
    const dataset = buildDataset(board.items, board.columns, boardId, board.boardName);
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
