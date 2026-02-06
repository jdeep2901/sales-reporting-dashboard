import json
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

XLSX_PATH = "/Users/jaideepallam/Downloads/Deals_1770357609.xlsx"
OUT_PATH = "/Users/jaideepallam/Documents/AI Projects/codex/crosstab_data.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NUM_PREFIX = re.compile(r"^\s*\d+\.\s*")
INTRO_DATE_CUTOFF = date(2024, 10, 1)
CUTOFF_MONTH_LABEL = INTRO_DATE_CUTOFF.strftime("%Y-%m")
MATTER_STAGES = {
    "scheduled intro calls",
    "qualification",
    "capabilities showcase",
    "problem scoping",
    "contracting",
    "commercial proposal",
}
FUNNEL_STAGE_MAP = {
    "scheduled intro calls": "1. Intro",
    "qualification": "2. Qualification",
    "capabilities showcase": "3. Capability",
    "problem scoping": "4. Problem Scoping",
    "contracting": "5. Contracting",
    "commercial proposal": "6. Commercial Proposal",
}
FUNNEL_STAGES = [
    "1. Intro",
    "2. Qualification",
    "3. Capability",
    "4. Problem Scoping",
    "5. Contracting",
    "6. Commercial Proposal",
]
SLA_DAYS = {
    "scheduled intro calls": 21,
    "qualification": 30,
    "capabilities showcase": 30,
    "problem scoping": 45,
    "contracting": 45,
    "commercial proposal": 45,
}

SELLERS = [
    ("somya", "Somya"),
    ("akshay iyer", "Akshay Iyer"),
    ("abhinav kishore", "Abhinav Kishore"),
    ("maruti peri", "Maruti Peri"),
    ("vitor quirino", "Vitor Quirino"),
]


def norm(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def clean_stage(text: str) -> str:
    return " ".join(NUM_PREFIX.sub("", (text or "").strip()).split())


def parse_date(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"-?\d+(\.\d+)?", raw):
        try:
            return (datetime(1899, 12, 30) + timedelta(days=float(raw))).date()
        except Exception:
            return None
    fmts = [
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%d-%b-%Y",
        "%d %b %Y",
        "%b %d %Y",
        "%B %d %Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
    ]
    for f in fmts:
        try:
            return datetime.strptime(raw, f).date()
        except Exception:
            pass
    return None


def make_table():
    return defaultdict(Counter)


def inc(table, stage, month):
    table[stage][month] += 1


def make_detail_table():
    return defaultdict(lambda: defaultdict(set))


def add_detail(table, stage, month, deal_name):
    table[stage][month].add(deal_name)


def make_carry_table():
    return defaultdict(Counter)


def primary_token(text: str, fallback: str = "(blank)") -> str:
    s = (text or "").strip()
    if not s:
        return fallback
    return s.split(",")[0].strip() or fallback


def init_industry_action():
    return {"total": 0, "industries": defaultdict(lambda: {"total": 0, "logos": Counter(), "functions": Counter()})}


def add_industry_action(bucket, industry, logo, business_function):
    bucket["total"] += 1
    block = bucket["industries"][industry]
    block["total"] += 1
    block["logos"][logo] += 1
    block["functions"][business_function] += 1


def init_winloss_bucket():
    return {"won_total": 0, "lost_total": 0, "combos": defaultdict(lambda: {"won": 0, "lost": 0})}


def add_winloss(bucket, industry, logo, business_function, outcome):
    key = (industry, logo, business_function)
    block = bucket["combos"][key]
    block[outcome] += 1
    if outcome == "won":
        bucket["won_total"] += 1
    else:
        bucket["lost_total"] += 1


def week_start(d):
    # Monday-based week start
    return d - timedelta(days=d.weekday())


def init_scorecard():
    return {
        "stage_counts": Counter(),
        "stage_1_2_count": 0,
        "stage_3_4_count": 0,
        "stage_1_6_count": 0,
        "stage_5_6_count": 0,
        "stage_7_8_count": 0,
        "missing_next_step_2_6": 0,
        "over_sla_2_6": 0,
        "stuck_proxy_2_6": 0,
        "stage_1_2_records": [],
        "stage_3_4_records": [],
        "stage_1_6_records": [],
        "stage_5_6_records": [],
        "stage_7_8_records": [],
        "missing_next_step_records": [],
        "over_sla_records": [],
        "stuck_records": [],
    }


def add_scorecard(
    bucket,
    deal_name,
    seller_label,
    stage_norm,
    stage_label,
    created_date,
    next_step_date,
    created_month,
):
    bucket["stage_counts"][stage_label] += 1
    age_days = (date.today() - created_date).days if created_date is not None else None
    base_record = {
        "deal": deal_name,
        "seller": seller_label,
        "stage": stage_label,
        "created_month": created_month,
        "age_days": age_days,
    }
    if stage_norm in {"scheduled intro calls", "qualification"}:
        bucket["stage_1_2_count"] += 1
        bucket["stage_1_2_records"].append(base_record)
    if stage_norm in {"capabilities showcase", "problem scoping"}:
        bucket["stage_3_4_count"] += 1
        bucket["stage_3_4_records"].append(base_record)
    if stage_norm in MATTER_STAGES:
        bucket["stage_1_6_count"] += 1
        bucket["stage_1_6_records"].append(base_record)
    if stage_norm in {"contracting", "commercial proposal"}:
        bucket["stage_5_6_count"] += 1
        bucket["stage_5_6_records"].append(base_record)
    if stage_norm in {"won", "lost"}:
        bucket["stage_7_8_count"] += 1
        bucket["stage_7_8_records"].append(base_record)

    if stage_norm in MATTER_STAGES and stage_norm != "scheduled intro calls":
        missing_next_step = next_step_date is None
        over_sla = False
        if age_days is not None:
            over_sla = age_days > SLA_DAYS.get(stage_norm, 9999)
        if missing_next_step:
            bucket["missing_next_step_2_6"] += 1
            bucket["missing_next_step_records"].append({**base_record, "reason": "no next step"})
        if over_sla:
            bucket["over_sla_2_6"] += 1
            bucket["over_sla_records"].append({**base_record, "reason": "over SLA"})
        if missing_next_step or over_sla:
            bucket["stuck_proxy_2_6"] += 1
            bucket["stuck_records"].append(
                {
                    **base_record,
                    "missing_next_step": missing_next_step,
                    "over_sla": over_sla,
                }
            )


with zipfile.ZipFile(XLSX_PATH) as z:
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{NS}si"):
            shared.append("".join((node.text or "") for node in si.iter(f"{NS}t")))

    ws = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    sd = ws.find(f"{NS}sheetData")

    def cval(c):
        t = c.attrib.get("t")
        v = c.find(f"{NS}v")
        is_node = c.find(f"{NS}is")
        if t == "s" and v is not None and v.text:
            i = int(v.text)
            return shared[i] if i < len(shared) else ""
        if t == "inlineStr" and is_node is not None:
            return "".join((n.text or "") for n in is_node.iter(f"{NS}t"))
        if v is not None and v.text:
            return v.text
        return ""

    all_unique = make_table()
    all_unique_details = make_detail_table()
    all_unique_carry = make_carry_table()
    per_seller = {label: make_table() for _, label in SELLERS}
    per_seller_details = {label: make_detail_table() for _, label in SELLERS}
    per_seller_carry = {label: make_carry_table() for _, label in SELLERS}
    per_seller_funnel = {label: Counter() for _, label in SELLERS}
    scorecard = {"All (unique deals)": init_scorecard(), **{label: init_scorecard() for _, label in SELLERS}}
    industry_action = {label: init_industry_action() for _, label in SELLERS}
    winloss_overall = init_winloss_bucket()
    winloss_per_seller = {label: init_winloss_bucket() for _, label in SELLERS}
    intro_trend_overall = Counter()
    intro_trend_per_seller = {label: Counter() for _, label in SELLERS}
    intro_detail_overall = defaultdict(set)
    intro_detail_per_seller = {label: defaultdict(set) for _, label in SELLERS}
    months = set()
    stage_totals_all_unique = Counter()

    for row in sd.findall(f"{NS}row"):
        if int(row.attrib.get("r", "0")) <= 2:
            continue

        owner = ""
        deal_name = ""
        stage_raw = ""
        next_step_raw = ""
        intro_date_raw = ""
        industry_raw = ""
        logo_raw = ""
        function_raw = ""

        for c in row.findall(f"{NS}c"):
            ref = c.attrib.get("r", "")
            col = "".join(ch for ch in ref if ch.isalpha())
            if col == "A":
                deal_name = cval(c).strip()
            elif col == "B":
                logo_raw = cval(c)
            elif col == "C":
                industry_raw = cval(c)
            elif col == "K":
                function_raw = cval(c)
            elif col == "L":
                owner = cval(c)
            elif col == "BF":
                stage_raw = cval(c)
            elif col == "AC":
                next_step_raw = cval(c)
            elif col == "AF":
                intro_date_raw = cval(c)

        stage = clean_stage(stage_raw)
        if not stage or norm(stage) == "deal stage":
            continue

        d = parse_date(intro_date_raw)
        stage_n = norm(stage)
        if d is None or d < INTRO_DATE_CUTOFF:
            continue
        is_carry_in = False
        month = d.strftime("%Y-%m")
        if not deal_name:
            deal_name = "(Unnamed deal)"
        stage_label = FUNNEL_STAGE_MAP.get(stage_n, stage)
        next_step = parse_date(next_step_raw)
        intro_date = d
        industry = primary_token(industry_raw)
        logo = primary_token(logo_raw)
        business_function = primary_token(function_raw)

        owner_n = norm(owner)
        matched_labels = [label for key, label in SELLERS if key in owner_n]
        if not matched_labels:
            continue

        if stage_n in {"won", "lost"}:
            add_winloss(winloss_overall, industry, logo, business_function, stage_n)
            for label in matched_labels:
                add_winloss(winloss_per_seller[label], industry, logo, business_function, stage_n)
        if intro_date is not None and stage_n != "no show/ reschedule":
            wk = week_start(intro_date).isoformat()
            intro_trend_overall[wk] += 1
            intro_detail_overall[wk].add((deal_name, stage, intro_date.isoformat(), "Overall (unique)"))
            for label in matched_labels:
                intro_trend_per_seller[label][wk] += 1
                intro_detail_per_seller[label][wk].add((deal_name, stage, intro_date.isoformat(), label))

        inc(all_unique, stage, month)
        add_detail(all_unique_details, stage, month, deal_name)
        if is_carry_in:
            inc(all_unique_carry, stage, month)
        stage_totals_all_unique[stage] += 1
        months.add(month)
        add_scorecard(
            scorecard["All (unique deals)"],
            deal_name,
            "All (unique deals)",
            stage_n,
            stage_label,
            d,
            next_step,
            month,
        )

        for label in matched_labels:
            inc(per_seller[label], stage, month)
            add_detail(per_seller_details[label], stage, month, deal_name)
            if is_carry_in:
                inc(per_seller_carry[label], stage, month)
            if stage_n in FUNNEL_STAGE_MAP:
                per_seller_funnel[label][FUNNEL_STAGE_MAP[stage_n]] += 1
            add_scorecard(scorecard[label], deal_name, label, stage_n, stage_label, d, next_step, month)
            if stage_n in MATTER_STAGES:
                add_industry_action(industry_action[label], industry, logo, business_function)

    ordered_months = sorted(m for m in months if m != "Unknown")
    if "Unknown" in months:
        ordered_months.append("Unknown")

    # stage order based on all_unique totals, then alpha
    stages = sorted(stage_totals_all_unique.keys(), key=lambda s: (-stage_totals_all_unique[s], s.lower()))

    data = {
        "sellers": ["All (unique deals)"] + [label for _, label in SELLERS],
        "months": ordered_months,
        "stages": stages,
        "tables": {
            "All (unique deals)": {s: dict(all_unique[s]) for s in stages},
            **{label: {s: dict(per_seller[label][s]) for s in stages} for _, label in SELLERS},
        },
        "details": {
            "All (unique deals)": {
                s: {m: sorted(all_unique_details[s][m]) for m in all_unique_details[s]} for s in stages
            },
            **{
                label: {
                    s: {m: sorted(per_seller_details[label][s][m]) for m in per_seller_details[label][s]}
                    for s in stages
                }
                for _, label in SELLERS
            },
        },
        "carry_in": {
            "All (unique deals)": {s: dict(all_unique_carry[s]) for s in stages},
            **{label: {s: dict(per_seller_carry[label][s]) for s in stages} for _, label in SELLERS},
        },
        "meta": {
            "intro_date_cutoff": str(INTRO_DATE_CUTOFF),
            "cutoff_month_bucket": CUTOFF_MONTH_LABEL,
            "date_basis": "Intro Meeting Date (AF)",
        },
    }

    funnel_metrics = {"stages": FUNNEL_STAGES, "sellers": {}}
    for _, label in SELLERS:
        counts = [int(per_seller_funnel[label].get(stage, 0)) for stage in FUNNEL_STAGES]
        reached = [sum(counts[i:]) for i in range(len(counts))]
        conv_to_next = []
        for i in range(len(FUNNEL_STAGES)):
            if i == len(FUNNEL_STAGES) - 1:
                conv_to_next.append(None)
                continue
            denom = reached[i]
            numer = reached[i + 1]
            conv_to_next.append((numer / denom) if denom > 0 else None)
        funnel_metrics["sellers"][label] = {
            "counts": counts,
            "reached": reached,
            "conversion_to_next": conv_to_next,
            "total_stage_1_6": int(sum(counts)),
        }
    data["funnel_metrics"] = funnel_metrics
    scorecard_out = {"as_of_date": str(date.today()), "sellers": {}}
    for label, payload in scorecard.items():
        s16 = payload["stage_1_6_count"]
        miss_pct = (payload["missing_next_step_2_6"] / s16) if s16 else 0
        sla_pct = (payload["over_sla_2_6"] / s16) if s16 else 0
        stuck_sorted = sorted(
            payload["stuck_records"],
            key=lambda r: (
                0 if (r.get("age_days") is None) else -r["age_days"],
                r["deal"].lower(),
            ),
        )
        scorecard_out["sellers"][label] = {
            "stage_1_2_count": payload["stage_1_2_count"],
            "stage_3_4_count": payload["stage_3_4_count"],
            "stage_1_6_count": s16,
            "stage_5_6_count": payload["stage_5_6_count"],
            "stage_7_8_count": payload["stage_7_8_count"],
            "missing_next_step_2_6": payload["missing_next_step_2_6"],
            "missing_next_step_pct_1_6": miss_pct,
            "over_sla_2_6": payload["over_sla_2_6"],
            "over_sla_pct_1_6": sla_pct,
            "stuck_proxy_2_6": payload["stuck_proxy_2_6"],
            "stuck_top10": stuck_sorted[:10],
            "kpi_details": {
                "stage_1_2": payload["stage_1_2_records"],
                "stage_3_4": payload["stage_3_4_records"],
                "stage_1_6": payload["stage_1_6_records"],
                "stage_5_6": payload["stage_5_6_records"],
                "stage_7_8": payload["stage_7_8_records"],
                "missing_next_step_2_6": payload["missing_next_step_records"],
                "over_sla_2_6": payload["over_sla_records"],
                "stuck_proxy_2_6": payload["stuck_records"],
            },
        }
    data["scorecard"] = scorecard_out
    industry_out = {"sellers": {}}
    for _, label in SELLERS:
        raw = industry_action[label]
        industries = []
        for ind, payload in raw["industries"].items():
            logos = dict(payload["logos"])
            functions = dict(payload["functions"])
            industries.append(
                {
                    "industry": ind,
                    "total": int(payload["total"]),
                    "logos": logos,
                    "functions": functions,
                }
            )
        industries.sort(key=lambda x: (-x["total"], x["industry"].lower()))
        industry_out["sellers"][label] = {
            "total": int(raw["total"]),
            "industries": industries,
        }
    data["industry_action"] = industry_out
    def finalize_winloss(bucket):
        rows = []
        for (industry, logo, function), counts in bucket["combos"].items():
            won = int(counts["won"])
            lost = int(counts["lost"])
            total = won + lost
            win_rate = (won / total) if total else 0
            loss_rate = (lost / total) if total else 0
            rows.append(
                {
                    "industry": industry,
                    "logo": logo,
                    "function": function,
                    "won": won,
                    "lost": lost,
                    "total": total,
                    "win_rate": win_rate,
                    "loss_rate": loss_rate,
                }
            )
        rows.sort(key=lambda r: (-r["total"], -r["lost"], r["industry"].lower(), r["logo"].lower(), r["function"].lower()))
        total_outcomes = bucket["won_total"] + bucket["lost_total"]
        return {
            "won_total": int(bucket["won_total"]),
            "lost_total": int(bucket["lost_total"]),
            "total": int(total_outcomes),
            "overall_win_rate": (bucket["won_total"] / total_outcomes) if total_outcomes else 0,
            "rows": rows,
        }

    data["win_loss_sources"] = {
        "overall_unique": finalize_winloss(winloss_overall),
        "sellers": {label: finalize_winloss(winloss_per_seller[label]) for _, label in SELLERS},
        "note": "Scope is limited to included deals after active filters. Overall is unique by deal row; seller views include deals owned by that seller.",
    }
    all_weeks = sorted(intro_trend_overall.keys())
    data["intro_trend"] = {
        "weeks": all_weeks,
        "series": {
            "Overall (unique)": {w: int(intro_trend_overall[w]) for w in all_weeks},
            **{
                label: {w: int(intro_trend_per_seller[label].get(w, 0)) for w in all_weeks}
                for _, label in SELLERS
            },
        },
        "details": {
            "Overall (unique)": {
                w: [
                    {"deal": d, "stage": s, "intro_date": dt, "seller": sel}
                    for d, s, dt, sel in sorted(intro_detail_overall[w], key=lambda x: (x[0].lower(), x[2]))
                ]
                for w in all_weeks
            },
            **{
                label: {
                    w: [
                        {"deal": d, "stage": s, "intro_date": dt, "seller": sel}
                        for d, s, dt, sel in sorted(intro_detail_per_seller[label][w], key=lambda x: (x[0].lower(), x[2]))
                    ]
                    for w in all_weeks
                }
                for _, label in SELLERS
            },
        },
        "note": "Weekly trend uses Intro Meeting Date (AF), excludes deals currently in No Show/ Reschedule.",
    }

with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print(f"Wrote {OUT_PATH}")
print(f"Sellers: {data['sellers']}")
print(f"Stages: {len(data['stages'])}, Months: {len(data['months'])}")
