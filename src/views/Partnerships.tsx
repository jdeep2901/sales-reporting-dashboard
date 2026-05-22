import { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore } from '@/lib/queries';
import { useSeller, SELLER_OPTIONS } from '@/lib/sellerContext';
import { useSessionState } from '@/lib/hooks';
import { ACTIVE_SELLERS, stageNumber } from '@/lib/vpCompute';
import { formatCurrency } from '@/lib/formatters';
import type { DealRow } from '@/lib/vpCompute';

// ─── stage helpers ────────────────────────────────────────────────────────────

const STAGE_NORM: Record<string, string> = {
  'Scheduled Intro calls': '1. Intro',
  Qualification: '2. Qualification',
  'Capabilities showcase': '3. Capability',
  'Problem Scoping': '4. Problem Scoping',
  Contracting: '5. Contracting',
  'Commercial Proposal': '6. Commercial Proposal',
  Won: '7. Win',
};

const STAGE_SHORT: Record<string, string> = {
  '1. Intro': 'Intro',
  '2. Qualification': 'Qual',
  '3. Capability': 'Capability',
  '4. Problem Scoping': 'Prob. scoping',
  '5. Contracting': 'Contracting',
  '6. Commercial Proposal': 'Comm. proposal',
  '7. Win': 'Won',
};

function normStage(raw: string | null | undefined): string {
  return STAGE_NORM[String(raw ?? '').trim()] ?? String(raw ?? '').trim();
}

function matchSeller(row: DealRow, seller: string): boolean {
  if (!seller || seller === 'Overall') return ACTIVE_SELLERS.some((s) => matchSeller(row, s));
  const label = seller.trim().toLowerCase();
  const matched: string[] = Array.isArray(row.matched_sellers) ? (row.matched_sellers as string[]) : [];
  if (matched.some((s) => String(s).trim().toLowerCase() === label)) return true;
  return String(row.owner ?? row.seller ?? '').toLowerCase().includes(label);
}

function dealKey(row: DealRow): string {
  return `${String(row.deal ?? row.account ?? '').trim().toLowerCase()}||${String(row.intro_date ?? '').trim()}`;
}

function resolveSize(row: DealRow): number {
  const n = Number(row.deal_size);
  return isFinite(n) && n > 0 ? n : 0;
}

// ─── tech stack ───────────────────────────────────────────────────────────────

const TECH_CANONICAL: [string, string][] = [
  ['snowflake', 'Snowflake'],
  ['databricks', 'Databricks'],
  ['amazon', 'AWS'],
  ['aws', 'AWS'],
  ['azure', 'Azure'],
  ['google', 'Google'],
  ['microsoft', 'Microsoft'],
];

const TECH_COLORS: Record<string, { bg: string; text: string }> = {
  Snowflake:   { bg: '#E0F2FE', text: '#0369A1' },
  Databricks:  { bg: '#FEF3C7', text: '#92400E' },
  AWS:         { bg: '#FFF7ED', text: '#C2410C' },
  Azure:       { bg: '#EDE9FE', text: '#5B21B6' },
  Google:      { bg: '#DCFCE7', text: '#166534' },
  Microsoft:   { bg: '#F1F5F9', text: '#475569' },
};

const ALL_TECHS = ['Snowflake', 'Databricks', 'AWS', 'Azure', 'Google'];

function parseTechStack(raw: string | null | undefined): string[] {
  if (!raw || raw === 'Not identified' || raw === 'No') return [];
  const parts = String(raw).split(/[,/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  parts.forEach((p) => {
    const entry = TECH_CANONICAL.find(([k]) => p.includes(k));
    if (entry && !seen.has(entry[1])) {
      seen.add(entry[1]);
      result.push(entry[1]);
    }
  });
  return result;
}

// ─── partner status ───────────────────────────────────────────────────────────

type PartnerStatus = 'involved' | 'influenced' | 'not_engaged' | 'unknown';

function getPartnerStatus(row: DealRow): PartnerStatus {
  const v = String(row.partner_source_type ?? '').trim().toLowerCase();
  if (v.includes('involved')) return 'involved';
  if (v.includes('influenced')) return 'influenced';
  if (v.includes('not engaged')) return 'not_engaged';
  return 'unknown';
}

const PARTNER_CONFIG: Record<PartnerStatus, { label: string; bg: string; text: string }> = {
  involved:    { label: 'Partner involved',   bg: 'var(--status-green-bg)',  text: 'var(--status-green-text)' },
  influenced:  { label: 'Partner influenced', bg: 'var(--status-amber-bg)',  text: 'var(--status-amber-text)' },
  not_engaged: { label: 'Not engaged',        bg: 'var(--bg-surface)',       text: 'var(--text-secondary)' },
  unknown:     { label: 'Not set',            bg: 'var(--status-red-bg)',    text: 'var(--status-red-text)' },
};

// ─── alliances intro ──────────────────────────────────────────────────────────

type AlliancesStatus = 'yes' | 'no' | 'unknown';

function getAlliancesStatus(row: DealRow): AlliancesStatus {
  const v = String(row.alliances_team_intro ?? '').trim().toLowerCase();
  if (v === 'yes') return 'yes';
  if (v === 'no') return 'no';
  return 'unknown';
}

// ─── partner AE ───────────────────────────────────────────────────────────────

type AEStatus = 'done' | 'shared' | 'not_started' | 'unknown';

function getAEStatus(row: DealRow): AEStatus {
  const v = String(row.partner_ae ?? '').trim().toLowerCase();
  if (v === 'done') return 'done';
  if (v.includes('shared') || v.includes('sellers')) return 'shared';
  if (v.includes('not started')) return 'not_started';
  return 'unknown';
}

// ─── notes (localStorage) ────────────────────────────────────────────────────

const NOTES_KEY = 'partnership_notes_v1';

function loadNotes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}'); }
  catch { return {}; }
}

function persistNote(itemId: string, text: string) {
  const notes = loadNotes();
  if (text.trim()) { notes[itemId] = text; } else { delete notes[itemId]; }
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function noteKey(row: DealRow): string {
  return String((row as Record<string, unknown>).item_id ?? dealKey(row));
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const n = stageNumber(stage) ?? 0;
  const isLate = n >= 5;
  const isMid = n >= 3;
  return (
    <span className="text-11 px-1.5 py-0.5 rounded"
      style={{
        background: isLate ? 'var(--status-green-bg)' : isMid ? '#EEF2FF' : 'var(--bg-surface)',
        color: isLate ? 'var(--status-green-text)' : isMid ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: 500,
      }}>
      {STAGE_SHORT[stage] ?? stage}
    </span>
  );
}

function TechChips({ stack, limit = 3 }: { stack: string[]; limit?: number }) {
  if (stack.length === 0) return <span className="text-11 text-text-tertiary">—</span>;
  const shown = stack.slice(0, limit);
  const extra = stack.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => {
        const c = TECH_COLORS[t] ?? { bg: 'var(--bg-surface)', text: 'var(--text-secondary)' };
        return (
          <span key={t} className="text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: c.bg, color: c.text }}>
            {t}
          </span>
        );
      })}
      {extra > 0 && <span className="text-11 text-text-tertiary">+{extra}</span>}
    </div>
  );
}

function PartnerPill({ status }: { status: PartnerStatus }) {
  const c = PARTNER_CONFIG[status];
  return <span className="text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: c.bg, color: c.text }}>{c.label}</span>;
}

function AlliancesBadge({ status }: { status: AlliancesStatus }) {
  if (status === 'yes') return <span className="text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--status-green-bg)', color: 'var(--status-green-text)' }}>Yes</span>;
  if (status === 'no')  return <span className="text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--status-amber-bg)', color: 'var(--status-amber-text)' }}>No</span>;
  return <span className="text-11 text-text-tertiary">—</span>;
}

function AEBadge({ status }: { status: AEStatus }) {
  if (status === 'done')        return <span className="text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--status-green-bg)', color: 'var(--status-green-text)' }}>Done</span>;
  if (status === 'shared')      return <span className="text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--status-amber-bg)', color: 'var(--status-amber-text)' }}>Shared</span>;
  if (status === 'not_started') return <span className="text-11 px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--status-red-bg)', color: 'var(--status-red-text)' }}>Not started</span>;
  return <span className="text-11 text-text-tertiary">—</span>;
}

// ─── main component ───────────────────────────────────────────────────────────

export function Partnerships() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};
  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;
  const dataset = (storeData?.dataset as Record<string, unknown> | null) ?? null;
  const allRows: DealRow[] = Array.isArray(dataset?.all_deals_rows) ? (dataset!.all_deals_rows as DealRow[]) : [];

  const { seller, setSeller } = useSeller();

  // ── filters ──
  const [stageGroup, setStageGroup]     = useSessionState<'all' | 'early' | 'mid' | 'late'>('pship_stage_group', 'all');
  const [partnerFilter, setPartnerFilter] = useSessionState<'all' | PartnerStatus>('pship_partner_filter', 'all');
  const [alliancesFilter, setAlliancesFilter] = useSessionState<'all' | 'yes' | 'no'>('pship_alliances_filter', 'all');
  const [techFilter, setTechFilter]     = useSessionState<string[]>('pship_tech_filter', []);
  const [search, setSearch]             = useState(''); // search intentionally not persisted
  const [includeWon, setIncludeWon]     = useState(false);

  // ── notes ──
  const [notes, setNotes]         = useState<Record<string, string>>(loadNotes);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [draft, setDraft]         = useState('');

  const openNotes = (key: string) => {
    if (expandedKey === key) { setExpandedKey(null); return; }
    setExpandedKey(key);
    setDraft(notes[key] ?? '');
  };

  const commitNote = (key: string) => {
    const trimmed = draft.trim();
    persistNote(key, trimmed);
    setNotes((prev) => {
      const next = { ...prev };
      if (trimmed) next[key] = trimmed; else delete next[key];
      return next;
    });
  };

  const toggleTech = (t: string) =>
    setTechFilter(techFilter.includes(t) ? techFilter.filter((x) => x !== t) : [...techFilter, t]);

  // ── deduped active deals ──
  const deals = useMemo(() => {
    const seen = new Set<string>();
    const result: DealRow[] = [];
    allRows.forEach((r) => {
      if (!matchSeller(r, seller)) return;
      const stageNorm = normStage(r.stage ?? r.deal_stage);
      const n = stageNumber(stageNorm);
      if (n == null) return;
      if (!includeWon && n === 7) return;
      if (n < 1 || n > 7) return;
      const k = dealKey(r);
      if (seen.has(k)) return;
      seen.add(k);
      result.push(r);
    });
    return result;
  }, [allRows, seller, includeWon]);

  // ── filtered + sorted ──
  const filtered = useMemo(() => {
    return deals.filter((r) => {
      const stageNorm = normStage(r.stage ?? r.deal_stage);
      const n = stageNumber(stageNorm) ?? 0;
      if (stageGroup === 'early' && (n < 1 || n > 2)) return false;
      if (stageGroup === 'mid'   && (n < 3 || n > 4)) return false;
      if (stageGroup === 'late'  && (n < 5 || n > 6)) return false;

      if (partnerFilter !== 'all' && getPartnerStatus(r) !== partnerFilter) return false;
      if (alliancesFilter !== 'all' && getAlliancesStatus(r) !== alliancesFilter) return false;

      if (techFilter.length > 0) {
        const stack = parseTechStack(r.tech_stack);
        if (!techFilter.some((t) => stack.includes(t))) return false;
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!String(r.deal ?? r.account ?? '').toLowerCase().includes(q)) return false;
      }

      return true;
    }).sort((a, b) => resolveSize(b) - resolveSize(a));
  }, [deals, stageGroup, partnerFilter, alliancesFilter, techFilter, search]);

  // ── KPIs (always over active 1-6) ──
  const kpis = useMemo(() => {
    const active = deals.filter((r) => {
      const n = stageNumber(normStage(r.stage ?? r.deal_stage)) ?? 0;
      return n >= 1 && n <= 6;
    });
    return {
      total: active.length,
      noAction: active.filter((r) => ['unknown', 'not_engaged'].includes(getPartnerStatus(r))).length,
      involvedPipeline: active.filter((r) => getPartnerStatus(r) === 'involved').reduce((a, r) => a + resolveSize(r), 0),
      lateNoIntro: active.filter((r) => {
        const n = stageNumber(normStage(r.stage ?? r.deal_stage)) ?? 0;
        return n >= 5 && getAlliancesStatus(r) !== 'yes';
      }).length,
      noStack: active.filter((r) => parseTechStack(r.tech_stack).length === 0).length,
    };
  }, [deals]);

  const showSeller = seller === 'Overall';
  const cols = showSeller
    ? '1fr 90px 130px 80px 1fr 160px 70px 90px 80px 60px'
    : '1fr 130px 80px 1fr 160px 70px 90px 80px 60px';

  const headers = [
    { label: 'Deal' },
    ...(showSeller ? [{ label: 'Seller' }] : []),
    { label: 'Stage' },
    { label: 'Size', right: true },
    { label: 'Tech stack' },
    { label: 'Partner status' },
    { label: 'Alliances intro', right: true },
    { label: 'Partner AE', right: true },
    { label: 'Portal', right: true },
    { label: 'Notes', right: true },
  ];

  if (storeQuery.isLoading) return <div className="p-6 text-13 text-text-secondary">Loading partnerships data…</div>;
  if (storeQuery.isError)   return <div className="p-6 text-13 text-status-red">Failed to load data.</div>;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-18 font-medium text-text-primary">Partnerships review</h2>
          <p className="text-12 text-text-tertiary mt-0.5">Alliance prioritization and partner action tracking across active pipeline</p>
        </div>
        <select
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
          className="text-13 px-3 py-1.5 rounded-md bg-bg-surface text-text-primary"
          style={{ border: '0.5px solid var(--border-emphasis)' }}
        >
          {SELLER_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: kpis.noAction > 0 ? '2px solid var(--status-amber)' : undefined }}>
          <div className="text-11 text-text-secondary mb-1">No partner action</div>
          <div className="text-22 font-medium tabular-nums" style={{ color: kpis.noAction > 0 ? 'var(--status-amber)' : 'var(--text-primary)' }}>{kpis.noAction}</div>
          <div className="text-11 text-text-tertiary mt-1">of {kpis.total} active deals</div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: '2px solid var(--status-green)' }}>
          <div className="text-11 text-text-secondary mb-1">Partner-involved pipeline</div>
          <div className="text-22 font-medium tabular-nums text-text-primary">{kpis.involvedPipeline > 0 ? formatCurrency(kpis.involvedPipeline) : '—'}</div>
          <div className="text-11 text-text-tertiary mt-1">total deal size</div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)', borderLeft: kpis.lateNoIntro > 0 ? '2px solid var(--status-red)' : undefined }}>
          <div className="text-11 text-text-secondary mb-1">Late stage, no alliances intro</div>
          <div className="text-22 font-medium tabular-nums" style={{ color: kpis.lateNoIntro > 0 ? 'var(--status-red)' : 'var(--text-primary)' }}>{kpis.lateNoIntro}</div>
          <div className="text-11 text-text-tertiary mt-1">deals in stages 5–6</div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)' }}>
          <div className="text-11 text-text-secondary mb-1">Tech stack unknown</div>
          <div className="text-22 font-medium tabular-nums text-text-primary">{kpis.noStack}</div>
          <div className="text-11 text-text-tertiary mt-1">no stack identified yet</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)' }}>
        <div className="flex flex-wrap items-center gap-3">

          {/* Search */}
          <input
            type="text"
            placeholder="Search deals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-12 px-2.5 py-1.5 rounded-md bg-bg-surface text-text-primary placeholder:text-text-tertiary"
            style={{ border: '0.5px solid var(--border-emphasis)', minWidth: 200 }}
          />

          {/* Stage group */}
          <div className="flex items-center gap-1">
            <span className="text-11 text-text-tertiary mr-1">Stage</span>
            {(['all', 'early', 'mid', 'late'] as const).map((g) => (
              <button key={g} onClick={() => setStageGroup(g)}
                className="text-11 px-2 py-0.5 rounded capitalize"
                style={{
                  background: stageGroup === g ? 'var(--text-primary)' : 'var(--bg-surface)',
                  color: stageGroup === g ? '#fff' : 'var(--text-secondary)',
                  border: '0.5px solid var(--border-hairline)',
                }}>
                {g === 'early' ? 'Early (1–2)' : g === 'mid' ? 'Mid (3–4)' : g === 'late' ? 'Late (5–6)' : 'All'}
              </button>
            ))}
          </div>

          {/* Partner status */}
          <div className="flex items-center gap-1">
            <span className="text-11 text-text-tertiary mr-1">Partner</span>
            {(['all', 'involved', 'influenced', 'not_engaged', 'unknown'] as const).map((p) => {
              const label = p === 'all' ? 'All' : p === 'not_engaged' ? 'Not engaged' : p === 'unknown' ? 'Not set' : p.charAt(0).toUpperCase() + p.slice(1);
              return (
                <button key={p} onClick={() => setPartnerFilter(p)}
                  className="text-11 px-2 py-0.5 rounded"
                  style={{
                    background: partnerFilter === p ? 'var(--text-primary)' : 'var(--bg-surface)',
                    color: partnerFilter === p ? '#fff' : 'var(--text-secondary)',
                    border: '0.5px solid var(--border-hairline)',
                  }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Alliances intro */}
          <div className="flex items-center gap-1">
            <span className="text-11 text-text-tertiary mr-1">Alliances intro</span>
            {(['all', 'yes', 'no'] as const).map((a) => (
              <button key={a} onClick={() => setAlliancesFilter(a)}
                className="text-11 px-2 py-0.5 rounded capitalize"
                style={{
                  background: alliancesFilter === a ? 'var(--text-primary)' : 'var(--bg-surface)',
                  color: alliancesFilter === a ? '#fff' : 'var(--text-secondary)',
                  border: '0.5px solid var(--border-hairline)',
                }}>
                {a === 'all' ? 'All' : a}
              </button>
            ))}
          </div>
        </div>

        {/* Tech stack chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-11 text-text-tertiary">Tech stack</span>
          {ALL_TECHS.map((t) => {
            const active = techFilter.includes(t);
            const c = TECH_COLORS[t];
            return (
              <button key={t} onClick={() => toggleTech(t)}
                className="text-11 px-2 py-0.5 rounded font-medium"
                style={{
                  background: active ? c.bg : 'var(--bg-surface)',
                  color: active ? c.text : 'var(--text-secondary)',
                  border: `0.5px solid ${active ? c.text : 'var(--border-hairline)'}`,
                  opacity: active ? 1 : 0.7,
                }}>
                {t}
              </button>
            );
          })}
          {techFilter.length > 0 && (
            <button onClick={() => setTechFilter([])} className="text-11 text-text-tertiary hover:text-text-primary">
              Clear ×
            </button>
          )}

          {/* Won toggle */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setIncludeWon((v) => !v)}
              className="text-11 px-2 py-0.5 rounded"
              style={{
                background: includeWon ? 'var(--status-green-bg)' : 'var(--bg-surface)',
                color: includeWon ? 'var(--status-green-text)' : 'var(--text-secondary)',
                border: '0.5px solid var(--border-hairline)',
              }}>
              {includeWon ? '✓ Including won' : 'Include won'}
            </button>
            <span className="text-11 text-text-tertiary">{filtered.length} deal{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
        {/* Column headers */}
        <div className="grid px-4 py-2 text-11 text-text-tertiary font-medium bg-bg-surface"
          style={{ gridTemplateColumns: cols, borderBottom: '0.5px solid var(--border-hairline)' }}>
          {headers.map((h, i) => (
            <span key={i} className={h.right ? 'text-right' : ''}>{h.label}</span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-12 text-text-tertiary">No deals match the current filters.</div>
        ) : (
          filtered.map((r) => {
            const stageNorm  = normStage(r.stage ?? r.deal_stage);
            const dealLabel  = String(r.deal ?? r.account ?? '—');
            const size       = resolveSize(r);
            const stack      = parseTechStack(r.tech_stack);
            const ps         = getPartnerStatus(r);
            const as_        = getAlliancesStatus(r);
            const ae         = getAEStatus(r);
            const portal     = String(r.partner_registered_on_portal ?? '').trim();
            const startDate  = r.start_date ? String(r.start_date).slice(0, 10) : null;
            const sellerLabel = Array.isArray(r.matched_sellers) && r.matched_sellers.length > 0
              ? String(r.matched_sellers[0]) : String(r.owner ?? '—');
            const nk         = noteKey(r);
            const hasNote    = Boolean(notes[nk]);
            const isExpanded = expandedKey === nk;

            return (
              <div key={nk} style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                {/* Main row */}
                <div
                  onClick={() => openNotes(nk)}
                  className="grid px-4 py-2.5 items-center hover:bg-bg-hover cursor-pointer"
                  style={{
                    gridTemplateColumns: cols,
                    borderLeft: ps === 'involved' ? '2px solid var(--status-green)' : ps === 'influenced' ? '2px solid var(--status-amber)' : ps === 'unknown' ? '2px solid var(--status-red)' : '2px solid transparent',
                    background: isExpanded ? 'rgba(99,91,255,0.03)' : undefined,
                  }}
                >
                  {/* Deal */}
                  <div>
                    <div className="text-12 font-medium text-text-primary truncate">{dealLabel}</div>
                    {stageNorm === '7. Win' && (
                      <div className="text-11 text-text-tertiary">{startDate ?? ''}</div>
                    )}
                  </div>

                  {/* Seller (Overall only) */}
                  {showSeller && <div className="text-12 text-text-secondary truncate">{sellerLabel}</div>}

                  {/* Stage */}
                  <div><StageBadge stage={stageNorm} /></div>

                  {/* Size */}
                  <div className="text-12 tabular-nums text-right font-medium text-text-primary">
                    {size > 0 ? formatCurrency(size) : '—'}
                  </div>

                  {/* Tech stack */}
                  <TechChips stack={stack} />

                  {/* Partner status */}
                  <div><PartnerPill status={ps} /></div>

                  {/* Alliances intro */}
                  <div className="text-right"><AlliancesBadge status={as_} /></div>

                  {/* Partner AE */}
                  <div className="text-right"><AEBadge status={ae} /></div>

                  {/* Portal */}
                  <div className="text-right">
                    {portal === 'Yes'
                      ? <span className="text-11 font-medium" style={{ color: 'var(--status-green)' }}>Yes</span>
                      : portal === 'No'
                      ? <span className="text-11 text-text-tertiary">No</span>
                      : <span className="text-11 text-text-tertiary">—</span>}
                  </div>

                  {/* Notes icon */}
                  <div className="text-right">
                    <span className="text-11" style={{ color: hasNote ? 'var(--accent)' : 'var(--text-tertiary)' }}
                      title={hasNote ? notes[nk] : 'Add note'}>
                      {hasNote ? '✎ Note' : '+ Note'}
                    </span>
                  </div>
                </div>

                {/* Expanded notes panel */}
                {isExpanded && (
                  <div className="px-4 py-3" style={{ background: 'var(--bg-surface)', borderTop: '0.5px solid var(--border-hairline)' }}>
                    <div className="flex items-start gap-4">
                      {/* Deal context */}
                      <div className="space-y-1 min-w-[260px]">
                        <div className="text-11 font-medium text-text-secondary mb-1.5">Deal context</div>
                        <div className="text-11 text-text-secondary"><span className="text-text-tertiary">Stage:</span> {STAGE_SHORT[stageNorm] ?? stageNorm}</div>
                        <div className="text-11 text-text-secondary"><span className="text-text-tertiary">Size:</span> {size > 0 ? formatCurrency(size) : '—'}</div>
                        <div className="text-11 text-text-secondary"><span className="text-text-tertiary">Tech stack:</span> {parseTechStack(r.tech_stack).join(', ') || '—'}</div>
                        <div className="text-11 text-text-secondary"><span className="text-text-tertiary">Partner status:</span> {PARTNER_CONFIG[ps].label}</div>
                        <div className="text-11 text-text-secondary"><span className="text-text-tertiary">Alliances intro:</span> {r.alliances_team_intro || '—'}</div>
                        <div className="text-11 text-text-secondary"><span className="text-text-tertiary">Partner AE:</span> {r.partner_ae || '—'}</div>
                        <div className="text-11 text-text-secondary"><span className="text-text-tertiary">Portal:</span> {portal || '—'}</div>
                        {r.next_meeting_date && (
                          <div className="text-11 text-text-secondary"><span className="text-text-tertiary">Next meeting:</span> {String(r.next_meeting_date).slice(0, 10)}</div>
                        )}
                      </div>

                      {/* Notes editor */}
                      <div className="flex-1">
                        <div className="text-11 font-medium text-text-secondary mb-1.5">Review notes</div>
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitNote(nk)}
                          placeholder="Capture partner conversation context, next steps, blockers, or action items from this review…"
                          className="w-full text-12 text-text-primary placeholder:text-text-tertiary resize-none rounded-md p-2.5"
                          style={{
                            background: 'var(--bg-card)',
                            border: '0.5px solid var(--border-emphasis)',
                            minHeight: 100,
                            outline: 'none',
                          }}
                          rows={4}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-11 text-text-tertiary">Auto-saved locally on this device</span>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); setDraft(''); commitNote(nk); }}
                              className="text-11 text-text-tertiary hover:text-text-primary">
                              Clear
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); commitNote(nk); setExpandedKey(null); }}
                              className="text-11 px-2.5 py-1 rounded font-medium"
                              style={{ background: 'var(--accent)', color: '#fff' }}>
                              Done
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
