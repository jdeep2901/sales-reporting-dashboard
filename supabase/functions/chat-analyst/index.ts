import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function j(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function norm(s: unknown): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveSeller(question: string, sellers: string[]): string {
  const q = norm(question);
  if (q.includes("overall") || q.includes("all sellers") || q.includes("all team")) return "All (unique deals)";
  for (const s of sellers) {
    if (s === "All (unique deals)") continue;
    const low = s.toLowerCase();
    if (q.includes(low)) return s;
    const first = low.split(" ")[0];
    if (first && q.includes(first)) return s;
  }
  return "All (unique deals)";
}

function resolveStage(question: string): string | null {
  const q = norm(question);
  if (q.includes("intro")) return "1. Intro";
  if (q.includes("qualification")) return "2. Qualification";
  if (q.includes("capab")) return "3. Capability";
  if (q.includes("problem scoping") || q.includes("scoping")) return "4. Problem Scoping";
  if (q.includes("contract")) return "5. Contracting";
  if (q.includes("proposal")) return "6. Commercial Proposal";
  if (q.includes("win")) return "7. Win";
  if (q.includes("loss") || q.includes("lost")) return "8. Loss";
  if (q.includes("no show") || q.includes("reschedule")) return "10. No Show/ Reschedule";
  return null;
}

function resolveMonth(question: string): string | null {
  const m = String(question || "").match(/\b(20\d{2})[-\/](0[1-9]|1[0-2])\b/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function groupedDetails(rawDetails: Record<string, Record<string, string[]>>): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [rawStage, monthMap] of Object.entries(rawDetails || {})) {
    const stage = String(rawStage || "");
    out[stage] ||= {};
    for (const [m, deals] of Object.entries(monthMap || {})) {
      out[stage][m] = Array.isArray(deals) ? deals : [];
    }
  }
  return out;
}

function groupedTable(rawTable: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [rawStage, monthMap] of Object.entries(rawTable || {})) {
    const stage = String(rawStage || "");
    out[stage] ||= {};
    for (const [m, v] of Object.entries(monthMap || {})) {
      out[stage][m] = Number(v || 0);
    }
  }
  return out;
}

function collectDeals(dataset: any, seller: string, stage: string, month: string | null) {
  const details = groupedDetails((dataset?.details || {})[seller] || {});
  const stageMap = details[stage] || {};
  const out: Array<{ deal: string; stage: string; month: string }> = [];
  if (month) {
    (stageMap[month] || []).forEach((d) => out.push({ deal: d, stage, month }));
  } else {
    Object.entries(stageMap).forEach(([m, deals]) => {
      (deals || []).forEach((d) => out.push({ deal: d, stage, month: m }));
    });
  }
  out.sort((a, b) => a.deal.localeCompare(b.deal) || a.month.localeCompare(b.month));
  return out;
}

function buildContext(dataset: any, question: string) {
  const sellers: string[] = Array.isArray(dataset?.sellers) ? dataset.sellers : [];
  const seller = resolveSeller(question, sellers);
  const stage = resolveStage(question);
  const month = resolveMonth(question);
  const tables = groupedTable((dataset?.tables || {})[seller] || {});
  const score = (((dataset?.scorecard || {}).sellers || {})[seller]) || {};
  const introSeries = ((((dataset?.intro_trend || {}).series || {})[seller === "All (unique deals)" ? "Overall (unique)" : seller]) || {});
  const winLoss = seller === "All (unique deals)"
    ? ((dataset?.win_loss_sources || {}).overall_unique || {})
    : (((dataset?.win_loss_sources || {}).sellers || {})[seller] || {});
  const stageCount = stage
    ? (month
      ? Number((tables[stage] || {})[month] || 0)
      : Object.values(tables[stage] || {}).reduce((a, b) => a + Number(b || 0), 0))
    : null;
  const deals = stage ? collectDeals(dataset, seller, stage, month).slice(0, 40) : [];
  const introVals = Object.values(introSeries).map((x) => Number(x || 0));
  const introTotal = introVals.reduce((a, b) => a + b, 0);
  const introAvg = introVals.length ? (introTotal / introVals.length) : 0;
  const topWinLoss = Array.isArray(winLoss?.rows) ? winLoss.rows.slice(0, 8) : [];
  const stuck = (((score?.kpi_details || {}).stuck_proxy_2_6) || []).slice(0, 20);
  return {
    seller,
    stage,
    month,
    stage_count: stageCount,
    sample_deals: deals,
    funnel_snapshot: {
      stage_1_2_count: Number(score?.stage_1_2_count || 0),
      stage_3_4_count: Number(score?.stage_3_4_count || 0),
      stage_5_6_count: Number(score?.stage_5_6_count || 0),
      stage_7_8_count: Number(score?.stage_7_8_count || 0),
      stage_1_6_count: Number(score?.stage_1_6_count || 0),
    },
    stuck_count: Number(score?.stuck_proxy_2_6 || 0),
    stuck_sample: stuck,
    intro_trend_summary: {
      buckets: introVals.length,
      total: introTotal,
      average: Number(introAvg.toFixed(2)),
      peak: introVals.length ? Math.max(...introVals) : 0,
    },
    win_loss_summary: {
      won_total: Number(winLoss?.won_total || 0),
      lost_total: Number(winLoss?.lost_total || 0),
      overall_win_rate: Number(winLoss?.overall_win_rate || 0),
      top_rows: topWinLoss,
    },
    available_months: (dataset?.months || []).slice(0, 80),
    note: "Numbers are based on current filtered dataset window already synced from Monday.",
  };
}

async function askOpenAI(apiKey: string, model: string, question: string, context: unknown): Promise<string> {
  const system = "You are a sales analytics assistant. Answer only from the provided context JSON. If data is missing, say so clearly. Use short, decision-oriented bullets.";
  const user = `Question:\n${question}\n\nContext JSON:\n${JSON.stringify(context)}`;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
      ],
      temperature: 0.2,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`OpenAI error: ${JSON.stringify(body)}`);
  }
  const direct = body?.output_text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const out = Array.isArray(body?.output) ? body.output : [];
  for (const item of out) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      const t = c?.text;
      if (typeof t === "string" && t.trim()) return t.trim();
    }
  }
  return "I could not generate an answer from the current context.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
    if (!supabaseUrl || !serviceRole) return j({ error: "Missing Supabase environment." }, 500);
    if (!openAiKey) return j({ error: "Missing OPENAI_API_KEY secret for function." }, 500);

    const body = await req.json();
    const username = norm(body?.username);
    const password = String(body?.password || "");
    const question = String(body?.question || "").trim();
    if (!username || !password) return j({ error: "username and password are required." }, 400);
    if (!question) return j({ error: "question is required." }, 400);

    const supabase = createClient(supabaseUrl, serviceRole);
    const login = await supabase.rpc("get_dashboard_state", { p_username: username, p_password: password });
    if (login.error) return j({ error: login.error.message }, 401);
    const st = Array.isArray(login.data) ? login.data[0] : login.data;
    const dataset = st?.dataset;
    if (!dataset || typeof dataset !== "object") {
      return j({ error: "No synced dataset found yet. Run Monday refresh first." }, 400);
    }

    const context = buildContext(dataset, question);
    const answer = await askOpenAI(openAiKey, model, question, context);
    return j({ ok: true, model, answer, context });
  } catch (e) {
    return j({ error: (e as Error).message || "Unexpected error" }, 500);
  }
});
