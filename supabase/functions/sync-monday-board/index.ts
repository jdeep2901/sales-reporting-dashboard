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
type MondayItem = {
  id: string;
  name: string;
  column_values: Array<{ id: string; text: string; display_value?: string | null; value: string | null }>;
};

type QaSeverity = "pass" | "warn" | "fail" | "na";
type QaCategory = "schema_presence" | "type_format" | "business_rules" | "cross_tab" | "comparative";
type QaCheck = {
  id: string;
  category: QaCategory;
  name: string;
  severity: QaSeverity;
  metric?: string;
  threshold?: string;
  result?: string;
  details?: string;
  affected_rows?: number;
  affected_pct?: number;
  samples?: string[];
};

type QaResult = {
  status: "pass" | "warn" | "fail";
  score: number;
  summary: Record<string, unknown>;
  report: Record<string, unknown>;
};

function smartTextFromMondayColumnValue(
  text: string | null | undefined,
  displayValue: string | null | undefined,
  value: string | null | undefined,
): string {
  const direct = String(text || "").trim() || String(displayValue || "").trim();
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

function qaNormStage(stage: string | null | undefined): string {
  return norm(String(stage || "").trim().replace(/^\s*\d+\.\s*/g, ""));
}

function qaCanonicalDealKey(r: Record<string, any>): string {
  const itemId = String(r.item_id || "").trim();
  if (itemId) return `id:${itemId}`;
  const nm = norm(r.deal || r.name || "");
  const intro = String(r.intro_date || "").slice(0, 10);
  return `nm:${nm}||intro:${intro}`;
}

function qaSafeDate(raw: string | null | undefined): Date | null {
  return parseDate(raw);
}

function qaBlank(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return !s || s === "-" || s === "(blank)";
}

function qaPct(num: number, den: number): number {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(1));
}

function qaRound(v: number, n = 2): number {
  const p = 10 ** n;
  return Math.round(v * p) / p;
}

function runDataQualityChecks(currentDataset: Record<string, any>, previousDataset: Record<string, any> | null): QaResult {
  const checks: QaCheck[] = [];
  const allRows = Array.isArray(currentDataset?.all_deals_rows) ? currentDataset.all_deals_rows : [];
  const allPrevRows = Array.isArray(previousDataset?.all_deals_rows) ? previousDataset?.all_deals_rows : [];
  const cutoff = parseDate(INTRO_DATE_CUTOFF);
  const inScope = (r: any) => {
    if (!cutoff) return true;
    const d = qaSafeDate(r?.intro_date);
    return !!d && d.getTime() >= cutoff.getTime();
  };
  // QA scope: only intro_date >= configured cutoff (currently 2024-10-01).
  const rows = allRows.filter((r: any) => inScope(r));
  const prevRows = allPrevRows.filter((r: any) => inScope(r));
  const total = rows.length;
  const now = todayDate();

  const addCheck = (c: QaCheck) => checks.push(c);

  const fields: Array<{ keys: string[]; required: boolean; label: string; warnBlankPct?: number; failBlankPct?: number }> = [
    { keys: ["deal", "name"], required: true, label: "Deal", warnBlankPct: 1, failBlankPct: 5 },
    { keys: ["stage", "deal_stage"], required: true, label: "Stage", warnBlankPct: 1, failBlankPct: 5 },
    { keys: ["intro_date"], required: true, label: "Intro Date", warnBlankPct: 1, failBlankPct: 5 },
    { keys: ["seller", "owner", "deal_owner"], required: false, label: "Seller", warnBlankPct: 10, failBlankPct: 35 },
    { keys: ["industry"], required: false, label: "Industry", warnBlankPct: 15, failBlankPct: 40 },
    { keys: ["logo"], required: false, label: "Logo", warnBlankPct: 10, failBlankPct: 30 },
    { keys: ["function", "business_group"], required: false, label: "Business Function", warnBlankPct: 15, failBlankPct: 40 },
    { keys: ["deal_size"], required: false, label: "Deal Size", warnBlankPct: 20, failBlankPct: 45 },
    { keys: ["start_date"], required: false, label: "Start Date", warnBlankPct: 40, failBlankPct: 70 },
    { keys: ["duration_months"], required: false, label: "Duration (months)", warnBlankPct: 35, failBlankPct: 70 },
    { keys: ["source_of_lead"], required: false, label: "Source of Lead", warnBlankPct: 20, failBlankPct: 50 },
    { keys: ["revenue_source_mapping"], required: false, label: "Revenue Source Mapping", warnBlankPct: 20, failBlankPct: 50 },
    { keys: ["channel"], required: false, label: "Channel", warnBlankPct: 10, failBlankPct: 30 },
    { keys: ["matched_sellers"], required: false, label: "Matched Sellers", warnBlankPct: 15, failBlankPct: 40 },
  ];

  for (const f of fields) {
    const getVal = (r: any): any => {
      for (const k of f.keys) {
        if (Object.prototype.hasOwnProperty.call(r || {}, k)) return r ? r[k] : null;
      }
      return undefined;
    };
    const presentCount = rows.filter((r: any) => f.keys.some((k) => Object.prototype.hasOwnProperty.call(r || {}, k))).length;
    const missingFieldRows = total - presentCount;
    const blankRows = rows.filter((r: any) => {
      const v = getVal(r);
      if (typeof v === "undefined") return false; // count as missing, not blank
      if (Array.isArray(v)) return v.length === 0;
      return qaBlank(v);
    }).length;
    const distinct = new Set(rows.map((r: any) => {
      const v = getVal(r);
      if (Array.isArray(v)) return JSON.stringify(v);
      return String(v ?? "");
    })).size;
    const blankPct = qaPct(blankRows, total);

    let sev: QaSeverity = "pass";
    if (f.required && missingFieldRows > 0) sev = "fail";
    else if (f.required && blankRows > 0 && blankPct >= 1) sev = "fail";
    else if (f.failBlankPct != null && blankPct >= f.failBlankPct) sev = "fail";
    else if (f.warnBlankPct != null && blankPct >= f.warnBlankPct) sev = "warn";

    addCheck({
      id: `presence_${f.keys[0]}`,
      category: "schema_presence",
      name: `${f.label}: presence + blank-rate`,
      severity: sev,
      metric: `blank=${blankRows}/${total}, distinct=${distinct}`,
      threshold: f.required ? "required + non-blank" : `warn>=${f.warnBlankPct}% fail>=${f.failBlankPct}%`,
      result: `present_rows=${presentCount}; blank_pct=${blankPct}%`,
      affected_rows: Math.min(total, blankRows + missingFieldRows),
      affected_pct: qaPct(Math.min(total, blankRows + missingFieldRows), total),
    });
  }

  const parseFail = (key: string, label: string, parser: (x: string | null | undefined) => unknown, required = false) => {
    const bad: string[] = [];
    rows.forEach((r: any) => {
      const raw = r ? r[key] : null;
      if (qaBlank(raw)) {
        if (required) bad.push(String(r?.deal || r?.item_id || "(unknown)"));
        return;
      }
      if (parser(String(raw)) == null) bad.push(String(r?.deal || r?.item_id || "(unknown)"));
    });
    addCheck({
      id: `type_${key}`,
      category: "type_format",
      name: `${label}: format validation`,
      severity: bad.length ? (required ? "fail" : "warn") : "pass",
      metric: `${bad.length}/${total} invalid`,
      threshold: required ? "0 invalid (required field)" : "low invalid ratio",
      result: bad.length ? "invalid values found" : "valid",
      affected_rows: bad.length,
      affected_pct: qaPct(bad.length, total),
      samples: bad.slice(0, 5),
    });
  };
  parseFail("intro_date", "Intro Date", qaSafeDate, true);
  parseFail("start_date", "Start Date", qaSafeDate, false);
  parseFail("next_step_date", "Next Step Date", qaSafeDate, false);
  parseFail("deal_size", "Deal Size", parseAmount, false);
  parseFail("duration_months", "Duration Months", parseMonths, false);
  parseFail("age_days", "Age (days)", (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }, false);

  const knownStageNorm = new Set([
    ...Object.keys(FUNNEL_STAGE_MAP).map((k) => qaNormStage(k)),
    ...Object.values(FUNNEL_STAGE_MAP).map((k) => qaNormStage(k)),
    "win", "won", "loss", "lost", "disqualified", "no show/ reschedule",
    "latent pool - monthly", "latent pool - bi-monthly", "latent pool - half yearly revisit",
  ]);
  const unknownStages = rows.filter((r: any) => !knownStageNorm.has(qaNormStage(r?.stage))).map((r: any) => String(r?.deal || r?.stage || "(unknown)"));
  addCheck({
    id: "biz_unknown_stage",
    category: "business_rules",
    name: "Stage normalization coverage",
    severity: unknownStages.length ? "fail" : "pass",
    metric: `${unknownStages.length}/${total} unknown stages`,
    threshold: "0 unknown stage labels",
    result: unknownStages.length ? "unknown labels present" : "all recognized",
    affected_rows: unknownStages.length,
    affected_pct: qaPct(unknownStages.length, total),
    samples: unknownStages.slice(0, 5),
  });

  const stage4plusMissingStart = rows.filter((r: any) => {
    const n = stageNum(String(r?.stage || ""));
    if (n == null || n < 4) return false;
    return qaBlank(r?.start_date);
  });
  addCheck({
    id: "biz_stage4plus_missing_start",
    category: "business_rules",
    name: "Stage >= 4 should have Start Date",
    severity: stage4plusMissingStart.length ? "warn" : "pass",
    metric: `${stage4plusMissingStart.length}/${total} missing`,
    threshold: "0 missing recommended",
    result: stage4plusMissingStart.length ? "missing start date in late stages" : "ok",
    affected_rows: stage4plusMissingStart.length,
    affected_pct: qaPct(stage4plusMissingStart.length, total),
    samples: stage4plusMissingStart.slice(0, 5).map((r: any) => String(r.deal || r.item_id || "(unknown)")),
  });

  const wonMissingStart = rows.filter((r: any) => qaNormStage(r?.stage).includes("win") && qaBlank(r?.start_date));
  addCheck({
    id: "biz_won_missing_start",
    category: "business_rules",
    name: "Won deals must have Start Date",
    severity: wonMissingStart.length ? "fail" : "pass",
    metric: `${wonMissingStart.length} won deals missing start date`,
    threshold: "0",
    result: wonMissingStart.length ? "missing values" : "ok",
    affected_rows: wonMissingStart.length,
    affected_pct: qaPct(wonMissingStart.length, total),
    samples: wonMissingStart.slice(0, 5).map((r: any) => String(r.deal || r.item_id || "(unknown)")),
  });

  const badDuration = rows.filter((r: any) => !qaBlank(r?.start_date) && (parseMonths(String(r?.duration_months || "")) == null));
  addCheck({
    id: "biz_duration_with_start",
    category: "business_rules",
    name: "Duration must be positive when Start Date exists",
    severity: badDuration.length ? "fail" : "pass",
    metric: `${badDuration.length}/${total} invalid duration`,
    threshold: "0 invalid",
    result: badDuration.length ? "invalid durations found" : "ok",
    affected_rows: badDuration.length,
    affected_pct: qaPct(badDuration.length, total),
    samples: badDuration.slice(0, 5).map((r: any) => String(r.deal || r.item_id || "(unknown)")),
  });

  const negativeDeal = rows.filter((r: any) => {
    const n = parseAmount(String(r?.deal_size || ""));
    return n != null && n < 0;
  });
  addCheck({
    id: "biz_negative_deal_size",
    category: "business_rules",
    name: "Deal Size must be non-negative",
    severity: negativeDeal.length ? "fail" : "pass",
    metric: `${negativeDeal.length}/${total} negative`,
    threshold: "0 negative",
    result: negativeDeal.length ? "negative values found" : "ok",
    affected_rows: negativeDeal.length,
    affected_pct: qaPct(negativeDeal.length, total),
    samples: negativeDeal.slice(0, 5).map((r: any) => String(r.deal || r.item_id || "(unknown)")),
  });

  const introFuture = rows.filter((r: any) => {
    const d = qaSafeDate(r?.intro_date);
    if (!d) return false;
    const diffDays = Math.floor((d.getTime() - now.getTime()) / (24 * 3600 * 1000));
    return diffDays > 14;
  });
  addCheck({
    id: "biz_intro_future",
    category: "business_rules",
    name: "Intro Date too far in future",
    severity: introFuture.length ? "warn" : "pass",
    metric: `${introFuture.length}/${total} > 14 days future`,
    threshold: "<=14 days future tolerance",
    result: introFuture.length ? "future-dated records found" : "ok",
    affected_rows: introFuture.length,
    affected_pct: qaPct(introFuture.length, total),
    samples: introFuture.slice(0, 5).map((r: any) => `${String(r.deal || r.item_id || "(unknown)")} | ${String(r.intro_date || "-")}`),
  });

  const badDateOrderWarn: string[] = [];
  const badDateOrderFail: string[] = [];
  rows.forEach((r: any) => {
    const intro = qaSafeDate(r?.intro_date);
    const start = qaSafeDate(r?.start_date);
    if (!intro || !start) return;
    const diff = Math.floor((intro.getTime() - start.getTime()) / (24 * 3600 * 1000));
    if (diff > 30) badDateOrderFail.push(String(r.deal || r.item_id || "(unknown)"));
    else if (diff > 0) badDateOrderWarn.push(String(r.deal || r.item_id || "(unknown)"));
  });
  addCheck({
    id: "biz_start_before_intro",
    category: "business_rules",
    name: "Start Date before Intro Date",
    severity: badDateOrderFail.length ? "fail" : (badDateOrderWarn.length ? "warn" : "pass"),
    metric: `${badDateOrderWarn.length + badDateOrderFail.length}/${total} affected`,
    threshold: "warn if >0 days; fail if >30 days",
    result: badDateOrderFail.length ? "severe violations" : (badDateOrderWarn.length ? "minor violations" : "ok"),
    affected_rows: badDateOrderWarn.length + badDateOrderFail.length,
    affected_pct: qaPct(badDateOrderWarn.length + badDateOrderFail.length, total),
    samples: [...badDateOrderFail, ...badDateOrderWarn].slice(0, 5),
  });

  const keySeen = new Map<string, number>();
  rows.forEach((r: any) => {
    const key = qaCanonicalDealKey(r || {});
    keySeen.set(key, (keySeen.get(key) || 0) + 1);
  });
  const dupCount = Array.from(keySeen.values()).filter((v) => v > 1).reduce((a, b) => a + (b - 1), 0);
  addCheck({
    id: "biz_duplicate_keys",
    category: "business_rules",
    name: "Canonical duplicate deals",
    severity: dupCount > 0 ? "warn" : "pass",
    metric: `${dupCount} duplicate row(s)`,
    threshold: "0 duplicates preferred",
    result: dupCount > 0 ? "duplicates found" : "ok",
    affected_rows: dupCount,
    affected_pct: qaPct(dupCount, total),
  });

  const emptyMatchedWithOwner = rows.filter((r: any) => {
    const ms = Array.isArray(r?.matched_sellers) ? r.matched_sellers : [];
    const owner = String(r?.seller || r?.owner || r?.deal_owner || "").trim();
    return owner && ms.length === 0;
  });
  addCheck({
    id: "biz_matched_sellers_empty",
    category: "business_rules",
    name: "Matched Sellers empty while owner exists",
    severity: emptyMatchedWithOwner.length ? "warn" : "pass",
    metric: `${emptyMatchedWithOwner.length}/${total}`,
    threshold: "0 preferred",
    result: emptyMatchedWithOwner.length ? "mapping gaps detected" : "ok",
    affected_rows: emptyMatchedWithOwner.length,
    affected_pct: qaPct(emptyMatchedWithOwner.length, total),
    samples: emptyMatchedWithOwner.slice(0, 5).map((r: any) => String(r.deal || r.item_id || "(unknown)")),
  });

  const scoreAll = currentDataset?.scorecard?.sellers?.["All (unique deals)"] || {};
  const kpi = scoreAll?.kpi_details || {};
  const checkEq = (id: string, name: string, left: number, right: number) => {
    const ok = Number(left || 0) === Number(right || 0);
    addCheck({
      id,
      category: "cross_tab",
      name,
      severity: ok ? "pass" : "fail",
      metric: `${left} vs ${right}`,
      threshold: "exact equality",
      result: ok ? "ok" : "mismatch",
      affected_rows: ok ? 0 : Math.abs(Number(left || 0) - Number(right || 0)),
      affected_pct: ok ? 0 : qaPct(Math.abs(Number(left || 0) - Number(right || 0)), Math.max(Number(left || 0), Number(right || 0), 1)),
    });
  };
  checkEq("cross_12", "Scorecard Stage 1-2 count reconciles", Number(scoreAll.stage_1_2_count || 0), Array.isArray(kpi.stage_1_2) ? kpi.stage_1_2.length : 0);
  checkEq("cross_34", "Scorecard Stage 3-4 count reconciles", Number(scoreAll.stage_3_4_count || 0), Array.isArray(kpi.stage_3_4) ? kpi.stage_3_4.length : 0);
  checkEq("cross_56", "Scorecard Stage 5-6 count reconciles", Number(scoreAll.stage_5_6_count || 0), Array.isArray(kpi.stage_5_6) ? kpi.stage_5_6.length : 0);
  checkEq("cross_78", "Scorecard Stage 7-8 count reconciles", Number(scoreAll.stage_7_8_count || 0), Array.isArray(kpi.stage_7_8) ? kpi.stage_7_8.length : 0);
  checkEq("cross_16", "Scorecard Stage 1-6 count reconciles", Number(scoreAll.stage_1_6_count || 0), Array.isArray(kpi.stage_1_6) ? kpi.stage_1_6.length : 0);

  const wlRows = rows.filter((r: any) => {
    const st = qaNormStage(r?.stage);
    return st === "won" || st === "win" || st === "lost" || st === "loss";
  }).length;
  const wlTotals = Number(currentDataset?.win_loss_sources?.overall_unique?.total || 0);
  checkEq("cross_winloss", "Win/Lost source totals reconcile with raw rows", wlTotals, wlRows);

  const introSeriesOverall = (currentDataset?.intro_trend?.series && (currentDataset.intro_trend.series["Overall (unique)"] || currentDataset.intro_trend.series["Overall"])) || {};
  const introSeriesTotal = Object.values(introSeriesOverall || {}).reduce((a: number, b: any) => a + Number(b || 0), 0);
  const introRowsTotal = rows.filter((r: any) => !qaNormStage(r?.stage).includes("no show/ reschedule") && qaSafeDate(r?.intro_date)).length;
  checkEq("cross_introtrend", "Call trend total reconciles with eligible intro rows", introSeriesTotal, introRowsTotal);

  const crosstabAll = currentDataset?.series?.["All (unique deals)"] || currentDataset?.series?.Overall || {};
  let crossDiff = 0;
  Object.keys(crosstabAll || {}).forEach((stage) => {
    const monthMap = crosstabAll[stage] || {};
    const summed = Object.values(monthMap || {}).reduce((a: number, b: any) => a + Number(b || 0), 0);
    const raw = rows.filter((r: any) => qaNormStage(String(r?.stage || "")) === qaNormStage(stage)).length;
    crossDiff += Math.abs(summed - raw);
  });
  addCheck({
    id: "cross_crosstab_vs_rows",
    category: "cross_tab",
    name: "Crosstab stage totals reconcile with raw rows",
    severity: crossDiff > 0 ? "warn" : "pass",
    metric: `total absolute mismatch=${crossDiff}`,
    threshold: "0 ideal",
    result: crossDiff > 0 ? "minor mismatch" : "ok",
    affected_rows: crossDiff,
    affected_pct: qaPct(crossDiff, Math.max(total, 1)),
  });

  addCheck({
    id: "cross_revenue_forecast_drilldown",
    category: "cross_tab",
    name: "Revenue forecast row totals = drilldown contributions",
    severity: "na",
    metric: "not computed in backend dataset",
    threshold: "n/a",
    result: "requires frontend computed artifacts",
  });

  if (!previousDataset || !prevRows.length) {
    addCheck({
      id: "cmp_previous_available",
      category: "comparative",
      name: "Previous snapshot available for drift checks",
      severity: "na",
      metric: "no previous version",
      threshold: "n/a",
      result: "comparative checks skipped",
    });
  } else {
    const prevTotal = prevRows.length;
    const rowDeltaPct = prevTotal ? qaRound(((total - prevTotal) / prevTotal) * 100, 1) : 0;
    addCheck({
      id: "cmp_row_count_delta",
      category: "comparative",
      name: "Total row count drift vs previous version",
      severity: Math.abs(rowDeltaPct) >= 35 ? "fail" : (Math.abs(rowDeltaPct) >= 20 ? "warn" : "pass"),
      metric: `${prevTotal} -> ${total} (${rowDeltaPct}%)`,
      threshold: "warn>=20%, fail>=35%",
      result: "row volume drift",
      affected_rows: Math.abs(total - prevTotal),
      affected_pct: Math.abs(rowDeltaPct),
    });

    const blankRate = (datasetRows: any[], key: string) => qaPct(datasetRows.filter((r: any) => qaBlank(r?.[key])).length, datasetRows.length || 1);
    ["industry", "function", "logo", "start_date", "deal_size"].forEach((key) => {
      const bNow = blankRate(rows, key);
      const bPrev = blankRate(prevRows, key);
      const diff = qaRound(bNow - bPrev, 1);
      addCheck({
        id: `cmp_blank_drift_${key}`,
        category: "comparative",
        name: `${key} blank-rate drift`,
        severity: diff >= 20 ? "fail" : (diff >= 10 ? "warn" : "pass"),
        metric: `${bPrev}% -> ${bNow}% (Δ ${diff}pp)`,
        threshold: "warn>=+10pp, fail>=+20pp",
        result: "blank-rate drift",
        affected_rows: Math.max(0, Math.round((diff / 100) * total)),
        affected_pct: Math.max(0, diff),
      });
    });

    const dist = (datasetRows: any[], keyFn: (r: any) => string) => {
      const out: Record<string, number> = {};
      datasetRows.forEach((r: any) => {
        const k = keyFn(r);
        out[k] = (out[k] || 0) + 1;
      });
      return out;
    };
    const maxShareDrift = (a: Record<string, number>, b: Record<string, number>) => {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      let max = 0;
      keys.forEach((k) => {
        const sa = (a[k] || 0) / Math.max(prevTotal, 1);
        const sb = (b[k] || 0) / Math.max(total, 1);
        max = Math.max(max, Math.abs(sb - sa));
      });
      return qaRound(max * 100, 1);
    };
    const stageDrift = maxShareDrift(
      dist(prevRows, (r: any) => qaNormStage(String(r?.stage || ""))),
      dist(rows, (r: any) => qaNormStage(String(r?.stage || ""))),
    );
    addCheck({
      id: "cmp_stage_distribution",
      category: "comparative",
      name: "Stage distribution drift",
      severity: stageDrift >= 30 ? "fail" : (stageDrift >= 15 ? "warn" : "pass"),
      metric: `max stage share drift=${stageDrift}pp`,
      threshold: "warn>=15pp fail>=30pp",
      result: "distribution drift",
      affected_pct: stageDrift,
    });

    const sellerDrift = maxShareDrift(
      dist(prevRows, (r: any) => String(r?.seller || "(blank)")),
      dist(rows, (r: any) => String(r?.seller || "(blank)")),
    );
    addCheck({
      id: "cmp_seller_distribution",
      category: "comparative",
      name: "Seller distribution drift",
      severity: sellerDrift >= 25 ? "warn" : "pass",
      metric: `max seller share drift=${sellerDrift}pp`,
      threshold: "warn>=25pp",
      result: "distribution drift",
      affected_pct: sellerDrift,
    });

    const channelDrift = maxShareDrift(
      dist(prevRows, (r: any) => String(r?.channel || "(blank)")),
      dist(rows, (r: any) => String(r?.channel || "(blank)")),
    );
    addCheck({
      id: "cmp_channel_distribution",
      category: "comparative",
      name: "Channel distribution drift",
      severity: channelDrift >= 30 ? "warn" : "pass",
      metric: `max channel share drift=${channelDrift}pp`,
      threshold: "warn>=30pp",
      result: "distribution drift",
      affected_pct: channelDrift,
    });

    const wonLostCount = (datasetRows: any[]) => datasetRows.filter((r: any) => {
      const s = qaNormStage(r?.stage);
      return s === "won" || s === "win" || s === "lost" || s === "loss";
    }).length;
    const prevWL = wonLostCount(prevRows);
    const nowWL = wonLostCount(rows);
    const wlPct = prevWL ? qaRound(((nowWL - prevWL) / prevWL) * 100, 1) : 0;
    addCheck({
      id: "cmp_won_lost_drift",
      category: "comparative",
      name: "Won/Lost row drift",
      severity: Math.abs(wlPct) >= 50 ? "warn" : "pass",
      metric: `${prevWL} -> ${nowWL} (${wlPct}%)`,
      threshold: "warn>=50%",
      result: "won/lost drift",
      affected_rows: Math.abs(nowWL - prevWL),
      affected_pct: Math.abs(wlPct),
    });

    const prevKeys = new Set(prevRows.map((r: any) => qaCanonicalDealKey(r || {})));
    const nowKeys = new Set(rows.map((r: any) => qaCanonicalDealKey(r || {})));
    let added = 0;
    let removed = 0;
    nowKeys.forEach((k) => { if (!prevKeys.has(k)) added += 1; });
    prevKeys.forEach((k) => { if (!nowKeys.has(k)) removed += 1; });
    addCheck({
      id: "cmp_key_add_drop",
      category: "comparative",
      name: "Canonical key additions/removals",
      severity: (added + removed) > Math.max(50, prevTotal * 0.35) ? "warn" : "pass",
      metric: `added=${added}, removed=${removed}`,
      threshold: "warn on unusually high churn",
      result: "key churn measured",
      affected_rows: added + removed,
      affected_pct: qaPct(added + removed, Math.max(prevTotal, total)),
    });

    const prevUnknown = prevRows.filter((r: any) => !knownStageNorm.has(qaNormStage(r?.stage))).length;
    const nowUnknown = rows.filter((r: any) => !knownStageNorm.has(qaNormStage(r?.stage))).length;
    const unknownSpike = nowUnknown - prevUnknown;
    addCheck({
      id: "cmp_unknown_stage_spike",
      category: "comparative",
      name: "Unknown stage label spike",
      severity: unknownSpike > 0 ? "warn" : "pass",
      metric: `${prevUnknown} -> ${nowUnknown}`,
      threshold: "no increase preferred",
      result: "unknown stage tracking",
      affected_rows: Math.max(0, unknownSpike),
      affected_pct: qaPct(Math.max(0, unknownSpike), total),
    });

    const prevIndFnBlank = prevRows.filter((r: any) => qaBlank(r?.industry) || qaBlank(r?.function)).length;
    const nowIndFnBlank = rows.filter((r: any) => qaBlank(r?.industry) || qaBlank(r?.function)).length;
    const drift = nowIndFnBlank - prevIndFnBlank;
    addCheck({
      id: "cmp_join_blank_spike",
      category: "comparative",
      name: "Industry/Function blank spike after joins",
      severity: drift > 20 ? "warn" : "pass",
      metric: `${prevIndFnBlank} -> ${nowIndFnBlank}`,
      threshold: "warn if +20 rows",
      result: "join-coverage drift",
      affected_rows: Math.max(0, drift),
      affected_pct: qaPct(Math.max(0, drift), total),
    });

    const monthCounts = dist(rows, (r: any) => String(r?.intro_date || "").slice(0, 7) || "(blank)");
    const prevMonthCounts = dist(prevRows, (r: any) => String(r?.intro_date || "").slice(0, 7) || "(blank)");
    const monthDrift = maxShareDrift(prevMonthCounts, monthCounts);
    addCheck({
      id: "cmp_intro_window_drift",
      category: "comparative",
      name: "Intro-date window drift",
      severity: monthDrift >= 35 ? "warn" : "pass",
      metric: `max month-share drift=${monthDrift}pp`,
      threshold: "warn>=35pp",
      result: "intro window drift",
      affected_pct: monthDrift,
    });
  }

  let score = 100;
  let failCount = 0;
  let warnCount = 0;
  const categoryCounts: Record<string, { pass: number; warn: number; fail: number; na: number }> = {};
  let affectedRowsTotal = 0;
  checks.forEach((c) => {
    const cat = c.category || "schema_presence";
    categoryCounts[cat] ||= { pass: 0, warn: 0, fail: 0, na: 0 };
    categoryCounts[cat][c.severity] += 1;
    if (c.severity === "fail") {
      failCount += 1;
      score -= (c.category === "schema_presence" || c.category === "type_format") ? 10 : 7;
    } else if (c.severity === "warn") {
      warnCount += 1;
      score -= 3;
    }
    if (Number.isFinite(Number(c.affected_rows || 0))) affectedRowsTotal += Number(c.affected_rows || 0);
  });
  score = Math.max(0, Math.min(100, score));
  const status: "pass" | "warn" | "fail" =
    (failCount > 0 || score < 70) ? "fail"
      : ((warnCount > 0 || score < 90) ? "warn" : "pass");

  return {
    status,
    score,
    summary: {
      status,
      score,
      total_checks: checks.length,
      fail_count: failCount,
      warn_count: warnCount,
      pass_count: checks.filter((c) => c.severity === "pass").length,
      na_count: checks.filter((c) => c.severity === "na").length,
      affected_rows_total: affectedRowsTotal,
      row_count: total,
      row_count_all: allRows.length,
      compared_previous: !!(previousDataset && prevRows.length),
      intro_cutoff: INTRO_DATE_CUTOFF,
      category_counts: categoryCounts,
    },
    report: {
      generated_at: new Date().toISOString(),
      row_count: total,
      row_count_all: allRows.length,
      previous_row_count: prevRows.length,
      previous_row_count_all: allPrevRows.length,
      intro_cutoff: INTRO_DATE_CUTOFF,
      checks,
    },
  };
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

function normalizeOutcomeStage(stageNorm: string): "won" | "lost" | null {
  const s = stageNorm;
  if (s === "won" || s === "win" || s === "closed won" || s === "closed-won" || s === "closed won (100%)") return "won";
  if (s === "lost" || s === "loss" || s === "closed lost" || s === "closed-lost" || s === "closed lost (0%)") return "lost";
  return null;
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

  const pushId = (v: any) => {
    if (v == null) return;
    if (typeof v === "number" && Number.isFinite(v)) ids.push(Math.trunc(v));
    else if (typeof v === "string") {
      const s = v.trim();
      if (/^\d+$/.test(s)) ids.push(s);
    }
  };

  // Common top-level shapes.
  const lp = (obj as any).linkedPulseIds || (obj as any).linked_pulse_ids || (obj as any).linkedItemIds || (obj as any).linked_item_ids;
  if (Array.isArray(lp)) {
    for (const x of lp) {
      if (x && typeof x === "object") {
        pushId((x as any).linkedPulseId ?? (x as any).linked_pulse_id ?? (x as any).id ?? (x as any).itemId ?? (x as any).item_id);
      } else {
        pushId(x);
      }
    }
  }

  const itemIds = (obj as any).itemIds || (obj as any).item_ids || (obj as any).item_ids_array || (obj as any).items;
  if (Array.isArray(itemIds)) for (const v of itemIds) pushId(v);

  // Deep fallback: some Monday shapes nest linked ids.
  const seen = new Set<any>();
  const walk = (x: any) => {
    if (x == null) return;
    if (seen.has(x)) return;
    if (typeof x === "string" || typeof x === "number") return;
    if (typeof x !== "object") return;
    seen.add(x);
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    for (const [k, v] of Object.entries(x)) {
      const kk = String(k).toLowerCase();
      if (kk === "linkedpulseid" || kk === "linked_pulse_id" || kk === "itemid" || kk === "item_id" || kk === "pulseid" || kk === "pulse_id") {
        pushId(v);
      }
      walk(v);
    }
  };
  walk(obj);

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

function relationValueNonEmpty(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  if (s === "null" || s === "{}" || s === "[]") return false;
  return true;
}

function pickBestRelationColumnByFill(
  items: MondayItem[],
  columns: MondayColumn[],
  predicate: (c: MondayColumn) => boolean,
  sampleLimit = 200,
): { best: string | null; counts: Record<string, number> } {
  const candidates = columns.filter(predicate).map((c) => c.id);
  const counts: Record<string, number> = {};
  for (const id of candidates) counts[id] = 0;
  const sample = items.slice(0, Math.max(0, sampleLimit));
  for (const it of sample) {
    for (const id of candidates) {
      const cv = it.column_values.find((v) => v.id === id);
      if (relationValueNonEmpty(cv?.value)) counts[id] += 1;
    }
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const id of candidates) {
    const c = counts[id] || 0;
    if (c > bestCount) { bestCount = c; best = id; }
  }
  return { best, counts };
}

async function fetchItemsByIds(
  token: string,
  itemIds: string[],
  columnIds: string[] | null,
): Promise<Array<{ id: string; name: string; column_values: Array<{ id: string; text: string; display_value?: string | null; value: string | null }> }>> {
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
        column_values(ids: $colIds) {
          id
          text
          value
          ... on BoardRelationValue { display_value }
          ... on MirrorValue { display_value }
          ... on FormulaValue { display_value }
          ... on DependencyValue { display_value }
          ... on SubtasksValue { display_value }
        }
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
    // Avoid hanging until the edge runtime kills the request (which surfaces as 546 upstream).
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(body.errors || body)}`);
  }
  return body.data;
}

async function fetchBoardColumns(token: string, boardId: number) {
  const q = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        id
        name
        columns { id title type settings_str }
      }
    }
  `;
  const data = await mondayGraphql(token, q, { boardId: [boardId] });
  const board = data?.boards?.[0];
  if (!board) throw new Error(`Board ${boardId} not found.`);
  return { boardName: board.name as string, columns: board.columns as MondayColumn[] };
}

async function fetchBoardItems(token: string, boardId: number, colIds: string[]) {
  const firstQuery = `
    query ($boardId: [ID!], $colIds: [String!]) {
      boards(ids: $boardId) {
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values(ids: $colIds) {
              id
              text
              value
              ... on BoardRelationValue { display_value }
              ... on MirrorValue { display_value }
              ... on FormulaValue { display_value }
              ... on DependencyValue { display_value }
              ... on SubtasksValue { display_value }
            }
          }
        }
      }
    }
  `;
  const first = await mondayGraphql(token, firstQuery, { boardId: [boardId], colIds });
  const board = first?.boards?.[0];
  if (!board) throw new Error(`Board ${boardId} not found (items).`);

  const items: MondayItem[] = [...(board.items_page?.items || [])];
  let cursor: string | null = board.items_page?.cursor || null;

  const nextQuery = `
    query ($cursor: String!, $colIds: [String!]) {
      next_items_page(limit: 500, cursor: $cursor) {
        cursor
        items {
          id
          name
          column_values(ids: $colIds) {
            id
            text
            value
            ... on BoardRelationValue { display_value }
            ... on MirrorValue { display_value }
            ... on FormulaValue { display_value }
            ... on DependencyValue { display_value }
            ... on SubtasksValue { display_value }
          }
        }
      }
    }
  `;

  while (cursor) {
    const next = await mondayGraphql(token, nextQuery, { cursor, colIds });
    const page = next?.next_items_page;
    if (!page) break;
    items.push(...(page.items || []));
    cursor = page.cursor || null;
  }
  return items;
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
    business_group_col_id?: string | null; // deals-board mirrored column (from Contacts board)
    contacts_board_id?: number | null;
    contacts_business_group_col_id?: string | null;
    contacts_relation_col_id?: string | null; // deals-board connect column pointing to contacts
    monday_token?: string | null;
  },
) {
  const colById: Record<string, MondayColumn> = Object.fromEntries(columns.map((c) => [c.id, c]));
  const byId = (item: MondayItem, id: string | null) => {
    if (!id) return "";
    const x = item.column_values.find((v) => v.id === id);
    return (String(x?.text || "").trim() || String(x?.display_value || "").trim());
  };
  const byIdSmartText = (item: MondayItem, id: string | null) => {
    if (!id) return "";
    const x = item.column_values.find((v) => v.id === id);
    return smartTextFromMondayColumnValue(x?.text, x?.display_value, x?.value);
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
  // Business Group (mirrored from Contacts board) is the authoritative source for "Business Function" in the UI.
  const bizGroupCandidates = pickColumnIds(columns, [(t) => t.includes("business group")]);
  const bizGroupPick = pickBestColumnIdByFillRate(items, bizGroupCandidates, (it, id) => byIdSmartText(it, id));
  const bizGroupColAuto = bizGroupPick.best || pickColumnId(columns, [(t) => t.includes("business group")]);
  const bizGroupColPinned = String(opts?.business_group_col_id || "").trim() || null;
  const bizGroupCol = bizGroupColPinned || bizGroupColAuto;

  // Business Function is often a mirrored / formula / connect-backed column; pick by fill-rate across likely candidates.
  const functionCandidates = pickColumnIds(columns, [
    (t) => t.includes("business function"),
    (t) => t === "function",
    (t) => t.includes("function"),
    (t) => t.includes("business") && t.includes("role"),
  ]);
  const functionPick = pickBestColumnIdByFillRate(items, functionCandidates, (it, id) => byIdSmartText(it, id));
  const functionCol = functionPick.best || pickColumnId(columns, [(t) => t.includes("business function"), (t) => t === "function", (t) => t.includes("function")]);
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
  const relPredicate = (c: MondayColumn) => {
    const type = norm(c.type);
    if (!(type.includes("relation") || type.includes("connect"))) return false;
    if (!accountsBoardId) return false;
    const st = parseJsonSafe(c.settings_str || null);
    const target = String(Math.trunc(accountsBoardId));
    if (st && typeof st === "object") {
      const boardIds = st.boardIds || st.board_ids || st.connectedBoardIds || st.connected_board_ids || st.board_ids_array;
      if (Array.isArray(boardIds) && boardIds.map((x: any) => String(x)).includes(target)) return true;
      const boardId = st.boardId || st.board_id || st.connectedBoardId || st.connected_board_id;
      if (boardId != null && String(boardId) === target) return true;
      const boards = st.boards || st.linkedBoards;
      if (Array.isArray(boards) && boards.some((b: any) => String(b?.id || b?.boardId || b?.board_id || "") === target)) return true;
    }
    // Title-based fallback: many orgs name it "Accounts".
    if (norm(c.title).includes("account")) return true;
    return false;
  };
  const accountsRelationColFromSettings = (accountsBoardId ? findConnectColumnToBoard(columns, accountsBoardId) : null);
  const relFillPick = pickBestRelationColumnByFill(items, columns, relPredicate, 200);
  const accountsRelationColAuto = relFillPick.best || accountsRelationColFromSettings;
  const accountsRelationColId = accountsRelationColPinned || relationColFromMirror || accountsRelationColAuto;
  const accountsRelationColMeta = accountsRelationColId ? {
    id: accountsRelationColId,
    title: colById[accountsRelationColId]?.title || null,
    type: colById[accountsRelationColId]?.type || null,
  } : { id: null, title: null, type: null };

  let accountsIndustryColId: string | null = accountsIndustryColPinned;
  const accountIndustryById: Record<string, string> = {};
  const accountNameById: Record<string, string> = {};
  let accountsJoinEnabled = false;
  let accountsJoinStats = {
    account_ids_found: 0,
    account_items_fetched: 0,
    account_industry_mapped: 0,
    deals_with_account_link: 0,
    deals_with_joined_industry: 0,
    relation_nonempty_value_sample: 0,
    relation_value_examples: [] as string[],
    relation_nonempty_text_sample: 0,
    relation_text_examples: [] as string[],
    relation_candidate_counts: {} as Record<string, number>,
    deals_with_joined_industry_by_name: 0,
    account_name_matched: 0,
  };

  // Some Monday API responses omit certain column values when requesting many columns at once.
  // If we're attempting an Accounts join, fetch the relation column by itself and use that value for linking.
  let relationValueByDealId: Record<string, { text: string; display_value: string; value: string | null }> | null = null;
  if (opts?.monday_token && accountsRelationColId) {
    try {
      // Only refetch if we detect the relation `value` is mostly empty in the initial payload.
      const sample = items.slice(0, 220);
      const nonEmpty = sample.filter((it) => {
        const cv = (it.column_values || []).find((v) => v.id === accountsRelationColId);
        return relationValueNonEmpty(cv?.value);
      }).length;
      const shouldRefetch = sample.length ? ((nonEmpty / sample.length) < 0.25) : true;
      if (shouldRefetch) {
        const dealIds = items.map((x) => String(x.id)).filter((x) => /^\d+$/.test(x));
        const relOnly = await fetchItemsByIds(opts.monday_token, dealIds, [accountsRelationColId]);
        relationValueByDealId = {};
        for (const it of relOnly) {
          const cv = (it.column_values || []).find((v) => v.id === accountsRelationColId);
          relationValueByDealId[String(it.id)] = {
            text: String(cv?.text || ""),
            display_value: String((cv as any)?.display_value || ""),
            value: cv?.value || null,
          };
        }
      }
    } catch (_) {
      relationValueByDealId = null;
    }
  }

  // Business Group is mirrored from Contacts board. Join Deals -> Contacts -> Business Group for reliability.
  const contactsBoardId = (opts?.contacts_board_id && Number.isFinite(Number(opts.contacts_board_id))) ? Number(opts.contacts_board_id) : null;
  const contactsBusinessGroupColPinned = String(opts?.contacts_business_group_col_id || "").trim() || null;
  const contactsRelationColPinned = String(opts?.contacts_relation_col_id || "").trim() || null;
  const bizGroupMirrorSettings = bizGroupCol ? parseJsonSafe(colById[bizGroupCol]?.settings_str || null) : null;
  const contactsRelationColFromMirror: string | null =
    (bizGroupMirrorSettings && (bizGroupMirrorSettings.relation_column_id || bizGroupMirrorSettings.relationColumnId || bizGroupMirrorSettings.board_relation_column_id || bizGroupMirrorSettings.boardRelationColumnId)) ? String(
      bizGroupMirrorSettings.relation_column_id || bizGroupMirrorSettings.relationColumnId || bizGroupMirrorSettings.board_relation_column_id || bizGroupMirrorSettings.boardRelationColumnId,
    ) : null;

  const contactsRelPredicate = (c: MondayColumn) => {
    const type = norm(c.type);
    if (!(type.includes("relation") || type.includes("connect"))) return false;
    if (!contactsBoardId) return false;
    const st = parseJsonSafe(c.settings_str || null);
    const target = String(Math.trunc(contactsBoardId));
    if (st && typeof st === "object") {
      const boardIds = st.boardIds || st.board_ids || st.connectedBoardIds || st.connected_board_ids || st.board_ids_array;
      if (Array.isArray(boardIds) && boardIds.map((x: any) => String(x)).includes(target)) return true;
      const boardId = st.boardId || st.board_id || st.connectedBoardId || st.connected_board_id;
      if (boardId != null && String(boardId) === target) return true;
      const boards = st.boards || st.linkedBoards;
      if (Array.isArray(boards) && boards.some((b: any) => String(b?.id || b?.boardId || b?.board_id || "") === target)) return true;
    }
    // Title-based fallback.
    if (norm(c.title).includes("contact")) return true;
    return false;
  };
  const contactsRelationColFromSettings = (contactsBoardId ? findConnectColumnToBoard(columns, contactsBoardId) : null);
  const contactsRelFillPick = pickBestRelationColumnByFill(items, columns, contactsRelPredicate, 200);
  const contactsRelationColAuto = contactsRelFillPick.best || contactsRelationColFromSettings;
  const contactsRelationColId = contactsRelationColPinned || contactsRelationColFromMirror || contactsRelationColAuto;

  let contactsBusinessGroupColId: string | null = contactsBusinessGroupColPinned;
  const contactBizGroupById: Record<string, string> = {};
  let contactsJoinEnabled = false;
  let contactsRelationValueByDealId: Record<string, { text: string; display_value: string; value: string | null }> | null = null;

  if (opts?.monday_token && contactsRelationColId) {
    try {
      const sample = items.slice(0, 220);
      const nonEmpty = sample.filter((it) => {
        const cv = (it.column_values || []).find((v) => v.id === contactsRelationColId);
        return relationValueNonEmpty(cv?.value);
      }).length;
      const shouldRefetch = sample.length ? ((nonEmpty / sample.length) < 0.25) : true;
      if (shouldRefetch) {
        const dealIds = items.map((x) => String(x.id)).filter((x) => /^\d+$/.test(x));
        const relOnly = await fetchItemsByIds(opts.monday_token, dealIds, [contactsRelationColId]);
        contactsRelationValueByDealId = {};
        for (const it of relOnly) {
          const cv = (it.column_values || []).find((v) => v.id === contactsRelationColId);
          contactsRelationValueByDealId[String(it.id)] = {
            text: String(cv?.text || ""),
            display_value: String((cv as any)?.display_value || ""),
            value: cv?.value || null,
          };
        }
      }
    } catch (_) {
      contactsRelationValueByDealId = null;
    }
  }

  if (contactsBoardId && contactsRelationColId && opts?.monday_token) {
    contactsJoinEnabled = true;
    const contactIds: string[] = [];
    for (const it of items) {
      const fallback = contactsRelationValueByDealId ? contactsRelationValueByDealId[String(it.id)] : null;
      const cv = fallback
        ? ({ id: contactsRelationColId, text: fallback.text, display_value: fallback.display_value, value: fallback.value } as any)
        : it.column_values.find((v) => v.id === contactsRelationColId);
      const linked = extractLinkedItemIdsFromConnectValue(cv?.value || null);
      for (const id of linked) if (!contactIds.includes(id)) contactIds.push(id);
      if (contactIds.length > 8000) break;
    }

    if (!contactsBusinessGroupColId) {
      const meta = await fetchBoardColumns(opts.monday_token, contactsBoardId);
      const candidates = meta.columns.filter((c) => norm(c.title).includes("business group")).map((c) => c.id);
      if (candidates.length) {
        // Pick by fill-rate using only referenced contact IDs (avoid scanning full Contacts board).
        const sampleIds = contactIds.slice(0, 80);
        if (sampleIds.length) {
          const sampleItems = await fetchItemsByIds(opts.monday_token, sampleIds, candidates);
          const counts: Record<string, number> = {};
          for (const id of candidates) counts[id] = 0;
          for (const it of sampleItems) {
            for (const id of candidates) {
              const cv = (it.column_values || []).find((v) => v.id === id);
              const v = smartTextFromMondayColumnValue(cv?.text, (cv as any)?.display_value, cv?.value);
              if (String(v || "").trim()) counts[id] += 1;
            }
          }
          let best: string | null = null;
          let bestC = -1;
          for (const id of candidates) {
            const c = counts[id] || 0;
            if (c > bestC) { bestC = c; best = id; }
          }
          contactsBusinessGroupColId = best || candidates[0] || null;
        } else {
          contactsBusinessGroupColId = candidates[0] || null;
        }
      }
    }

    if (contactIds.length && contactsBusinessGroupColId) {
      const contactItems = await fetchItemsByIds(opts.monday_token, contactIds, [contactsBusinessGroupColId]);
      for (const ci of contactItems) {
        const cv = (ci.column_values || []).find((v) => v.id === contactsBusinessGroupColId);
        const val = smartTextFromMondayColumnValue(cv?.text, (cv as any)?.display_value, cv?.value);
        if (val) contactBizGroupById[String(ci.id)] = val;
      }
    }
  }

  // Same idea for Business Function: if the chosen column appears mostly blank, fetch it alone to recover display_value.
  let functionValueByDealId: Record<string, { text: string; display_value: string; value: string | null }> | null = null;
  if (opts?.monday_token && functionCol) {
    try {
      const sample = items.slice(0, 220);
      const filled = sample.filter((it) => {
        const cv = (it.column_values || []).find((v) => v.id === functionCol);
        const v = smartTextFromMondayColumnValue(cv?.text, (cv as any)?.display_value, cv?.value);
        return !!String(v || "").trim();
      }).length;
      // If fewer than 25% of sampled rows have a function value, attempt a single-column refetch.
      if (sample.length && (filled / sample.length) < 0.25) {
        const dealIds = items.map((x) => String(x.id)).filter((x) => /^\d+$/.test(x));
        const fnOnly = await fetchItemsByIds(opts.monday_token, dealIds, [functionCol]);
        functionValueByDealId = {};
        for (const it of fnOnly) {
          const cv = (it.column_values || []).find((v) => v.id === functionCol);
          functionValueByDealId[String(it.id)] = {
            text: String(cv?.text || ""),
            display_value: String((cv as any)?.display_value || ""),
            value: cv?.value || null,
          };
        }
      }
    } catch (_) {
      functionValueByDealId = null;
    }
  }

  if (accountsBoardId && accountsRelationColId && opts?.monday_token) {
    accountsJoinEnabled = true;
    accountsJoinStats.relation_candidate_counts = relFillPick.counts || {};
    // Collect linked account item ids from deals items.
    const accountIds: string[] = [];
    for (const it of items) {
      const fallback = relationValueByDealId ? relationValueByDealId[String(it.id)] : null;
      const cv = fallback
        ? ({ id: accountsRelationColId, text: fallback.text, display_value: fallback.display_value, value: fallback.value } as any)
        : it.column_values.find((v) => v.id === accountsRelationColId);
      const rawVal = String(cv?.value || "").trim();
      if (relationValueNonEmpty(rawVal)) {
        accountsJoinStats.relation_nonempty_value_sample += 1;
        if (accountsJoinStats.relation_value_examples.length < 3) {
          accountsJoinStats.relation_value_examples.push(rawVal.length > 500 ? `${rawVal.slice(0, 497)}...` : rawVal);
        }
      }
      const rawText = (String(cv?.text || "").trim() || String((cv as any)?.display_value || "").trim());
      if (rawText) {
        accountsJoinStats.relation_nonempty_text_sample += 1;
        if (accountsJoinStats.relation_text_examples.length < 3) {
          accountsJoinStats.relation_text_examples.push(rawText.length > 200 ? `${rawText.slice(0, 197)}...` : rawText);
        }
      }
      const linked = extractLinkedItemIdsFromConnectValue(cv?.value || null);
      for (const id of linked) if (!accountIds.includes(id)) accountIds.push(id);
      if (accountIds.length > 5000) break;
    }
    accountsJoinStats.account_ids_found = accountIds.length;
    // If account industry column isn't pinned, infer from Accounts board columns.
    if (!accountsIndustryColId) {
      const accMeta = await fetchBoardColumns(opts.monday_token, accountsBoardId);
      const candidates = accMeta.columns.filter((c) => norm(c.title).includes("industry")).map((c) => c.id);
      if (candidates.length) {
        // Pick by fill-rate using only referenced account IDs (avoid scanning full Accounts board).
        const sampleIds = accountIds.slice(0, 80);
        if (sampleIds.length) {
          const sampleItems = await fetchItemsByIds(opts.monday_token, sampleIds, candidates);
          const counts: Record<string, number> = {};
          for (const id of candidates) counts[id] = 0;
          for (const it of sampleItems) {
            for (const id of candidates) {
              const cv = (it.column_values || []).find((v) => v.id === id);
              const v = smartTextFromMondayColumnValue(cv?.text, (cv as any)?.display_value, cv?.value);
              if (String(v || "").trim()) counts[id] += 1;
            }
          }
          let best: string | null = null;
          let bestC = -1;
          for (const id of candidates) {
            const c = counts[id] || 0;
            if (c > bestC) { bestC = c; best = id; }
          }
          accountsIndustryColId = best || candidates[0] || null;
        } else {
          accountsIndustryColId = candidates[0] || null;
        }
      }
    }

    if (accountIds.length && accountsIndustryColId) {
      // If account industry column isn't pinned, infer from Accounts board columns.
      // Fetch account items by ids with only the industry column.
      const accountItems = await fetchItemsByIds(opts.monday_token, accountIds, [accountsIndustryColId]);
      accountsJoinStats.account_items_fetched = accountItems.length;
      for (const ai of accountItems) {
        if (ai?.id && ai?.name) accountNameById[String(ai.id)] = String(ai.name);
        const cv = (ai.column_values || []).find((v) => v.id === accountsIndustryColId);
        const val = smartTextFromMondayColumnValue(cv?.text, (cv as any)?.display_value, cv?.value);
        if (val) accountIndustryById[String(ai.id)] = val;
      }
      accountsJoinStats.account_industry_mapped = Object.keys(accountIndustryById).length;
    }

    // Fallback: if relation column doesn't provide linked ids, but does provide linked item *names* in text,
    // join by Accounts item name -> industry.
    if (!accountIds.length && accountsIndustryColId && accountsJoinStats.relation_nonempty_text_sample > 0) {
      const accItemsAll = await fetchBoardItems(opts.monday_token, accountsBoardId, [accountsIndustryColId]);
      const nameToIndustry: Record<string, string> = {};
      const nameToId: Record<string, string> = {};
      for (const ai of accItemsAll) {
        const nm = norm(ai.name || "");
        if (!nm) continue;
        nameToId[nm] = String(ai.id || "");
        const cv = (ai.column_values || []).find((v) => v.id === accountsIndustryColId);
        const val = smartTextFromMondayColumnValue(cv?.text, (cv as any)?.display_value, cv?.value);
        if (val) nameToIndustry[nm] = val;
      }
      // Store in the same map but keyed by name marker.
      (accountIndustryById as any).__nameToIndustry = nameToIndustry;
      (accountNameById as any).__nameToId = nameToId;
      accountsJoinStats.account_name_matched = Object.keys(nameToIndustry).length;
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
    const stageNormRaw = norm(stage);
    const outcome = normalizeOutcomeStage(stageNormRaw);
    const stageNorm = outcome || stageNormRaw;
    const introDate = parseDate(introDateRaw);
    const startDate = parseDate(startDateRaw);
    const startDateIso = startDate ? startDate.toISOString().slice(0, 10) : null;
    if (durationMonths != null) durationDetectedCount += 1;
    const month = introDate ? monthLabel(introDate) : null;
    const stageLabel = outcome === "won"
      ? "7. Win"
      : outcome === "lost"
        ? "8. Loss"
        : (FUNNEL_STAGE_MAP[stageNorm] || stage);
    let dealSize = parseAmount(byId(item, adjContractNumCol));
    if (dealSize == null) dealSize = parseAmount(byId(item, adjContractCol));
    if (dealSize == null) dealSize = parseAmount(byId(item, tcvCol));
    let industryRawText = byIdSmartText(item, industryCol);
    if (accountsJoinEnabled && accountsRelationColId) {
      const fallback = relationValueByDealId ? relationValueByDealId[String(item.id)] : null;
      const cv = fallback
        ? ({ id: accountsRelationColId, text: fallback.text, display_value: fallback.display_value, value: fallback.value } as any)
        : item.column_values.find((v) => v.id === accountsRelationColId);
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
      const cvText = (cv && (String((cv as any).text || "").trim() || String((cv as any).display_value || "").trim())) || "";
      if ((!industryRawText || !industryRawText.trim()) && cv && cvText) {
        const nameToIndustry = (accountIndustryById as any).__nameToIndustry || null;
        if (nameToIndustry) {
          const parts = String(cvText || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const nm of parts) {
            const v = nameToIndustry[norm(nm)] || "";
            if (v && v.trim()) {
              industryRawText = v;
              accountsJoinStats.deals_with_joined_industry_by_name += 1;
              break;
            }
          }
        }
      }
    }
    const industry = primaryToken(industryRawText);
    let logoRawText = byIdSmartText(item, logoCol);
    // Prefer account/company name from the Deals->Accounts relation column (usually what you want as "Logo").
    if (accountsRelationColId) {
      const fallback = relationValueByDealId ? relationValueByDealId[String(item.id)] : null;
      const cv = fallback
        ? ({ id: accountsRelationColId, text: fallback.text, display_value: fallback.display_value, value: fallback.value } as any)
        : item.column_values.find((v) => v.id === accountsRelationColId);
      const cvText = (cv && (String((cv as any).text || "").trim() || String((cv as any).display_value || "").trim())) || "";
      if (cvText) logoRawText = cvText;

      // If we also have a join-built name map, prefer the canonical Accounts item name.
      if (accountsJoinEnabled && cv) {
        const linked = extractLinkedItemIdsFromConnectValue(cv?.value || null);
        for (const aid of linked) {
          const nm = accountNameById[String(aid)] || "";
          if (nm && nm.trim()) { logoRawText = nm; break; }
        }
      }
    }
    const logo = primaryToken(logoRawText);
    // Prefer Contacts join-derived Business Group when available.
    let bizFnRaw = "";
    if (contactsJoinEnabled && contactsRelationColId) {
      const fallback = contactsRelationValueByDealId ? contactsRelationValueByDealId[String(item.id)] : null;
      const cv = fallback
        ? ({ id: contactsRelationColId, text: fallback.text, display_value: fallback.display_value, value: fallback.value } as any)
        : item.column_values.find((v) => v.id === contactsRelationColId);
      const linked = extractLinkedItemIdsFromConnectValue(cv?.value || null);
      for (const cid of linked) {
        const v = contactBizGroupById[String(cid)] || "";
        if (v && v.trim()) { bizFnRaw = v; break; }
      }
    }
    if (!bizFnRaw || !String(bizFnRaw).trim()) bizFnRaw = byIdSmartText(item, bizGroupCol) || "";
    if (!bizFnRaw || !String(bizFnRaw).trim()) bizFnRaw = byIdSmartText(item, functionCol) || "";
    if ((!bizFnRaw || !String(bizFnRaw).trim()) && functionValueByDealId && functionCol) {
      const fallback = functionValueByDealId[String(item.id)];
      if (fallback) bizFnRaw = smartTextFromMondayColumnValue(fallback.text, fallback.display_value, fallback.value);
    }
    const bizFn = primaryToken(bizFnRaw);
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
        accounts_relation_col: accountsRelationColMeta,
        accounts_industry_col_id: accountsIndustryColId,
        industry_col_type: industryColType || null,
        relation_col_from_mirror: relationColFromMirror,
        relation_col_auto: accountsRelationColAuto,
        relation_col_from_settings: accountsRelationColFromSettings,
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
    const versionName = String(body?.version_name || "").trim() || null;
    if (!username || !password) return j({ error: "username and password are required." }, 400);
    if (!boardId) return j({ error: "board_id (or board URL) is required." }, 400);

    const supabase = createClient(supabaseUrl, serviceRole);
    const login = await supabase.rpc("get_dashboard_state", { p_username: username, p_password: password });
    if (login.error) return j({ error: login.error.message }, 401);
    const st = Array.isArray(login.data) ? login.data[0] : login.data;
    if (!st || st.role !== "admin") return j({ error: "Admin access required." }, 403);

    const meta = await fetchBoardColumns(mondayToken, boardId);
    const pinnedIndustryCol = (st.settings && (st.settings as any).monday_industry_col_id) ? String((st.settings as any).monday_industry_col_id) : null;
    const accountsBoardId = (st.settings && (st.settings as any).monday_accounts_board_id) ? Number((st.settings as any).monday_accounts_board_id) : 6218900019;
    const accountsIndustryColId = (st.settings && (st.settings as any).monday_accounts_industry_col_id) ? String((st.settings as any).monday_accounts_industry_col_id) : null;
    const accountsRelationColId = (st.settings && (st.settings as any).monday_deals_accounts_relation_col_id) ? String((st.settings as any).monday_deals_accounts_relation_col_id) : null;
    const pinnedBusinessGroupCol = (st.settings && (st.settings as any).monday_business_group_col_id) ? String((st.settings as any).monday_business_group_col_id) : null;
    const contactsBoardId = (st.settings && (st.settings as any).monday_contacts_board_id) ? Number((st.settings as any).monday_contacts_board_id) : 6218900012;
    const contactsBusinessGroupColId = (st.settings && (st.settings as any).monday_contacts_business_group_col_id) ? String((st.settings as any).monday_contacts_business_group_col_id) : null;
    const contactsRelationColId = (st.settings && (st.settings as any).monday_deals_contacts_relation_col_id) ? String((st.settings as any).monday_deals_contacts_relation_col_id) : null;

    // Determine which columns we need so relation columns include `value` reliably.
    const columns = meta.columns || [];
    const neededCandidates = new Set<string>();
    const addIf = (id: string | null) => { if (id) neededCandidates.add(id); };
    const pick = (fns: any[]) => pickColumnId(columns, fns);
    const pickMany = (fns: any[]) => pickColumnIds(columns, fns);
    const introDateCol = pick([(t: string) => t.includes("intro") && t.includes("date"), (t: string) => t.includes("scheduled intro")]);
    const startDateCol = pick([(t: string) => t === "start date", (t: string) => t.includes("start date"), (t: string) => t.includes("deal start")]);
    const durationCol = pick([(t: string) => t === "duration", (t: string) => t.includes("duration")]);
    const stageCol = pick([(t: string) => t.includes("deal stage"), (t: string) => t === "stage"]);
    const ownerCol = pick([(t: string) => t.includes("deal owner"), (t: string) => t.includes("owner")]);
    const nextStepCol = pick([(t: string) => t.includes("next step")]);
    const industryCol = pinnedIndustryCol || pick([(t: string) => t.includes("industry")]);
    const businessGroupCol = pinnedBusinessGroupCol || pick([(t: string) => t.includes("business group")]);
    const logoCol = pick([(t: string) => t.includes("logo"), (t: string) => t.includes("account") || t.includes("company")]);
    const functionCol = pick([(t: string) => t.includes("business function"), (t: string) => t === "function", (t: string) => t.includes("function")]);
    const sourceLeadCol = pick([(t: string) => t.includes("source of lead"), (t: string) => t === "source", (t: string) => t.includes("lead source")]);
    const revenueSourceCol = pick([(t: string) => t.includes("revenue source mapping"), (t: string) => t.includes("revenue source")]);
    const adjContractNumCol = pick([(t: string) => t.includes("adjusted") && t.includes("contract") && (t.includes("num") || t.includes("number"))]);
    const adjContractCol = pick([(t: string) => t.includes("adjusted") && t.includes("contract")]);
    const tcvCol = pick([(t: string) => t.includes("tcv"), (t: string) => t.includes("contract value")]);
    const durationCandidateCols = new Set<string>([
      ...(durationCol ? [durationCol] : []),
      ...pickMany([(t: string) => t.includes("duration"), (t: string) => t.includes("engagement") && t.includes("month"), (t: string) => t.includes("term") && t.includes("month"), (t: string) => t === "months"]),
    ]);
    addIf(introDateCol); addIf(startDateCol); addIf(stageCol); addIf(ownerCol); addIf(nextStepCol);
    addIf(industryCol); addIf(businessGroupCol); addIf(logoCol); addIf(functionCol); addIf(sourceLeadCol); addIf(revenueSourceCol);
    addIf(adjContractNumCol); addIf(adjContractCol); addIf(tcvCol);
    for (const id of durationCandidateCols) addIf(id);
    if (accountsRelationColId) addIf(accountsRelationColId);
    if (contactsRelationColId) addIf(contactsRelationColId);
    // Also include all relation/connect columns so we can auto-pick the right one by fill-rate.
    for (const c of columns) {
      const t = norm(c.type || '');
      if (t.includes('relation') || t.includes('connect')) neededCandidates.add(c.id);
    }

    const items = await fetchBoardItems(mondayToken, boardId, Array.from(neededCandidates));

    const dataset = await buildDataset(items, columns, boardId, meta.boardName, {
      industry_col_id: pinnedIndustryCol,
      accounts_board_id: accountsBoardId,
      accounts_industry_col_id: accountsIndustryColId,
      accounts_relation_col_id: accountsRelationColId,
      business_group_col_id: pinnedBusinessGroupCol,
      contacts_board_id: contactsBoardId,
      contacts_business_group_col_id: contactsBusinessGroupColId,
      contacts_relation_col_id: contactsRelationColId,
      monday_token: mondayToken,
    });
    const datasetHash = await sha256Hex(JSON.stringify(dataset));
    const settings = {
      ...(st.settings || {}),
      monday_board_id: String(boardId),
      monday_board_url: `https://themathcocrmtrial.monday.com/boards/${boardId}`,
      monday_last_sync_at: new Date().toISOString(),
      monday_last_sync_by: username,
      monday_last_sync_rows: items.length,
      monday_board_name: meta.boardName,
    };

    const prevVersion = await supabase
      .from("dashboard_versions")
      .select("id, dataset")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prevVersion.error) return j({ error: prevVersion.error.message }, 500);
    const prevDataset = prevVersion.data && typeof prevVersion.data.dataset === "object" ? (prevVersion.data.dataset as Record<string, any>) : null;
    const qa = runDataQualityChecks(dataset as Record<string, any>, prevDataset);
    settings.monday_last_qa_status = qa.status;
    settings.monday_last_qa_score = qa.score;
    settings.monday_last_qa_run_at = new Date().toISOString();

    const inserted = await supabase.from("dashboard_versions").insert({
      created_by: username,
      source: "monday_sync",
      board_id: String(boardId),
      board_name: meta.boardName,
      dataset,
      likelihood: st.likelihood || {},
      dataset_hash: datasetHash,
      item_count: Number(items.length || 0),
      notes: versionName,
      qa_status: qa.status,
      qa_score: qa.score,
      qa_summary: qa.summary,
      qa_report: qa.report,
      qa_run_at: new Date().toISOString(),
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
      board_name: meta.boardName,
      item_count: items.length,
      qa_status: qa.status,
      qa_score: qa.score,
      qa_summary: qa.summary,
      version_id: versionId,
      state: out,
    });
  } catch (e) {
    return j({ error: (e as Error).message || "Unexpected error" }, 500);
  }
});
