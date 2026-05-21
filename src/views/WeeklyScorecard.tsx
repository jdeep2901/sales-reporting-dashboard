import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useAuth } from '@/lib/auth';
import { useSharedStore } from '@/lib/queries';
import { ACTIVE_SELLERS, stageNumber } from '@/lib/vpCompute';
import { buildQuarterLabels } from '@/lib/vpCompute';
import { formatCurrency } from '@/lib/formatters';
import type { DealRow } from '@/lib/vpCompute';

const STAGE_BUCKETS = [
  { key: 'stage_1_6', label: 'Stage 1–6 total' },
  { key: 'stage_1_2', label: 'Stage 1–2' },
  { key: 'stage_3_4', label: 'Stage 3–4' },
  { key: 'stage_5_6', label: 'Stage 5–6' },
  { key: 'stage_7_8', label: 'Won / Lost' },
] as const;

const FUNNEL_STAGES = [
  { label: '1. Intro', n: 1 },
  { label: '2. Qualification', n: 2 },
  { label: '3. Capability', n: 3 },
  { label: '4. Problem Scoping', n: 4 },
  { label: '6. Commercial Proposal', n: 5 },
  { label: '5. Contracting', n: 6 },
];

const STAGE_NORM_MAP: Record<string, string> = {
  'Scheduled Intro calls': '1. Intro',
  Qualification: '2. Qualification',
  'Capabilities showcase': '3. Capability',
  'Problem Scoping': '4. Problem Scoping',
  Contracting: '5. Contracting',
  'Commercial Proposal': '6. Commercial Proposal',
  Won: '7. Win',
  Lost: '8. Loss',
  Disqualified: '9. Disqualified',
  'No Show/ Reschedule': '10. No Show/ Reschedule',
};

function normStage(raw: string): string {
  return STAGE_NORM_MAP[raw] ?? raw;
}

function sellerMatches(row: DealRow, seller: string): boolean {
  if (!seller || seller === 'Overall') {
    return ACTIVE_SELLERS.some((s) => sellerMatches(row, s));
  }
  const label = seller.trim().toLowerCase();
  const matched: string[] = Array.isArray(row.matched_sellers) ? row.matched_sellers as string[] : [];
  if (matched.some((s) => String(s).trim().toLowerCase() === label)) return true;
  const raw = String(row.owner ?? row.seller ?? row.deal_owner ?? '').toLowerCase();
  return raw.includes(label);
}

function buildKpiBuckets(rows: DealRow[], seller: string) {
  const out: Record<string, DealRow[]> = { stage_1_6: [], stage_1_2: [], stage_3_4: [], stage_5_6: [], stage_7_8: [] };
  const seen = new Set<string>();
  rows.forEach((r) => {
    if (!sellerMatches(r, seller)) return;
    const stageNorm = normStage(String(r.stage ?? r.deal_stage ?? '').trim());
    if (String(stageNorm).toLowerCase().includes('latent pool')) return;
    const n = stageNumber(stageNorm);
    if (n == null || n < 1 || n > 8) return;
    const dealKey = `${r.deal}|${r.intro_date}|${stageNorm}`;
    if (n >= 1 && n <= 6) { if (!seen.has('16' + dealKey)) { seen.add('16' + dealKey); out.stage_1_6.push(r); } }
    if (n === 1 || n === 2) { if (!seen.has('12' + dealKey)) { seen.add('12' + dealKey); out.stage_1_2.push(r); } }
    if (n === 3 || n === 4) { if (!seen.has('34' + dealKey)) { seen.add('34' + dealKey); out.stage_3_4.push(r); } }
    if (n === 5 || n === 6) { if (!seen.has('56' + dealKey)) { seen.add('56' + dealKey); out.stage_5_6.push(r); } }
    if (n === 7 || n === 8) { if (!seen.has('78' + dealKey)) { seen.add('78' + dealKey); out.stage_7_8.push(r); } }
  });
  return out;
}

function buildFunnelData(rows: DealRow[], seller: string) {
  const counts: Record<number, number> = {};
  rows.forEach((r) => {
    if (!sellerMatches(r, seller)) return;
    const stageNorm = normStage(String(r.stage ?? r.deal_stage ?? '').trim());
    if (String(stageNorm).toLowerCase().includes('latent pool')) return;
    const n = stageNumber(stageNorm);
    if (n == null || n < 1 || n > 6) return;
    counts[n] = (counts[n] ?? 0) + 1;
  });
  return FUNNEL_STAGES.map((s) => ({ label: s.label.split('. ')[1] ?? s.label, count: counts[s.n] ?? 0 }));
}

function QuarterDealTable({ rows, qLabel, seller }: { rows: DealRow[]; qLabel: string; seller: string }) {
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (!sellerMatches(r, seller)) return false;
      const stageNorm = normStage(String(r.stage ?? r.deal_stage ?? '').trim());
      const n = stageNumber(stageNorm);
      return n != null && n >= 1 && n <= 6;
    }).slice(0, 20);
  }, [rows, seller]);

  if (!filtered.length) return <p className="text-11 text-text-tertiary py-2">No active deals in {qLabel}.</p>;

  return (
    <table className="w-full text-12">
      <thead>
        <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
          <th className="text-left py-1.5 text-text-secondary font-medium">Deal</th>
          <th className="text-left py-1.5 text-text-secondary font-medium">Stage</th>
          <th className="text-right py-1.5 text-text-secondary font-medium tabular-nums">Size</th>
          <th className="text-right py-1.5 text-text-secondary font-medium">Next meeting</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((r, i) => {
          const stageNorm = normStage(String(r.stage ?? r.deal_stage ?? '').trim());
          const n = stageNumber(stageNorm) ?? 0;
          const isLate = n >= 5;
          return (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border-hairline)' }}
              className="hover:bg-bg-hover">
              <td className="py-1.5 pr-3">
                <span className="text-text-primary">{String(r.deal ?? r.account ?? r.logo ?? '—')}</span>
              </td>
              <td className="py-1.5 pr-3">
                <span className={`text-11 px-1.5 py-0.5 rounded`}
                  style={{
                    background: isLate ? 'var(--status-green-bg)' : 'var(--bg-surface)',
                    color: isLate ? 'var(--status-green-text)' : 'var(--text-secondary)',
                  }}>
                  {stageNorm.split('. ')[1] ?? stageNorm}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums text-text-secondary">
                {r.deal_size ? formatCurrency(Number(r.deal_size)) : '—'}
              </td>
              <td className="py-1.5 text-right text-text-secondary">
                {r.next_meeting_date ? String(r.next_meeting_date).slice(0, 10) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function WeeklyScorecard() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};
  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;

  const dataset = (storeData?.dataset as Record<string, unknown> | null) ?? null;
  const scorecard = (dataset?.scorecard as Record<string, unknown> | null) ?? {};
  const allRows: DealRow[] = Array.isArray(dataset?.all_deals_rows) ? dataset!.all_deals_rows as DealRow[] : [];
  const asOfDate = String(scorecard?.as_of_date ?? '');

  const [seller, setSeller] = useState('Overall');
  const [activeKpi, setActiveKpi] = useState<string | null>(null);

  const quarterLabels = useMemo(() => buildQuarterLabels(asOfDate || null), [asOfDate]);

  const buckets = useMemo(() => buildKpiBuckets(allRows, seller), [allRows, seller]);
  const funnelData = useMemo(() => buildFunnelData(allRows, seller), [allRows, seller]);

  const sellerOptions = ['Overall', ...ACTIVE_SELLERS];

  if (storeQuery.isLoading) {
    return <div className="p-6 text-13 text-text-secondary">Loading scorecard...</div>;
  }
  if (storeQuery.isError) {
    return <div className="p-6 text-13 text-status-red">Failed to load data.</div>;
  }

  const activePopup = activeKpi ? (buckets[activeKpi as keyof typeof buckets] ?? []) : [];
  const activePopupLabel = STAGE_BUCKETS.find((b) => b.key === activeKpi)?.label ?? '';

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-18 font-medium text-text-primary">Weekly scorecard</h2>
          {asOfDate && <p className="text-12 text-text-tertiary mt-0.5">As of {asOfDate}</p>}
        </div>
        <select
          value={seller}
          onChange={(e) => { setSeller(e.target.value); setActiveKpi(null); }}
          className="text-13 px-3 py-1.5 rounded-md bg-bg-surface text-text-primary"
          style={{ border: '0.5px solid var(--border-emphasis)' }}
        >
          {sellerOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* KPI boxes */}
      <div className="grid grid-cols-5 gap-3">
        {STAGE_BUCKETS.map(({ key, label }) => {
          const count = buckets[key as keyof typeof buckets]?.length ?? 0;
          const isActive = activeKpi === key;
          return (
            <button
              key={key}
              onClick={() => setActiveKpi(isActive ? null : key)}
              className="text-left p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                background: isActive ? 'var(--bg-surface)' : 'var(--bg-card)',
                border: isActive ? '1.5px solid var(--accent)' : '0.5px solid var(--border-hairline)',
              }}
            >
              <div className="text-11 text-text-secondary mb-1.5">{label}</div>
              <div className="text-22 font-medium text-text-primary tabular-nums">{count}</div>
              <div className="text-11 text-text-tertiary mt-1">deals</div>
            </button>
          );
        })}
      </div>

      {/* KPI detail popup */}
      {activeKpi && (
        <div className="rounded-lg p-4" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-13 font-medium text-text-primary">{activePopupLabel} — {activePopup.length} deals</span>
            <button onClick={() => setActiveKpi(null)} className="text-11 text-text-tertiary hover:text-text-primary">Close</button>
          </div>
          <table className="w-full text-12">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                <th className="text-left py-1.5 text-text-secondary font-medium">Deal</th>
                <th className="text-left py-1.5 text-text-secondary font-medium">Stage</th>
                <th className="text-left py-1.5 text-text-secondary font-medium">Seller</th>
                <th className="text-right py-1.5 text-text-secondary font-medium tabular-nums">Size</th>
                <th className="text-right py-1.5 text-text-secondary font-medium">Intro date</th>
              </tr>
            </thead>
            <tbody>
              {activePopup.slice(0, 50).map((r, i) => {
                const stageNorm = normStage(String(r.stage ?? r.deal_stage ?? '').trim());
                return (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border-hairline)' }} className="hover:bg-bg-hover">
                    <td className="py-1.5 pr-3 text-text-primary">{String(r.deal ?? r.account ?? r.logo ?? '—')}</td>
                    <td className="py-1.5 pr-3 text-text-secondary">{stageNorm.split('. ')[1] ?? stageNorm}</td>
                    <td className="py-1.5 pr-3 text-text-secondary">{String(r.owner ?? r.seller ?? '—')}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-secondary">{r.deal_size ? formatCurrency(Number(r.deal_size)) : '—'}</td>
                    <td className="py-1.5 text-right text-text-secondary">{r.intro_date ? String(r.intro_date).slice(0, 10) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Funnel chart */}
      <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)' }}>
        <h3 className="text-14 font-medium text-text-primary mb-4">Pipeline funnel — active deals</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={funnelData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ fontSize: 12, border: '0.5px solid var(--border-hairline)', borderRadius: 8 }}
              formatter={(v: unknown) => [String(v), 'Deals']}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {funnelData.map((_, i) => (
                <Cell key={i} fill={i >= 4 ? 'var(--status-green)' : 'var(--accent)'} opacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Closure likelihood tables */}
      <div className="grid grid-cols-2 gap-4">
        {[{ label: `Current quarter (${quarterLabels.current})`, qLabel: quarterLabels.current },
          { label: `Next quarter (${quarterLabels.next})`, qLabel: quarterLabels.next }].map(({ label, qLabel }) => (
          <div key={qLabel} className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)' }}>
            <h3 className="text-13 font-medium text-text-primary mb-3">{label}</h3>
            <QuarterDealTable rows={allRows} qLabel={qLabel} seller={seller} />
          </div>
        ))}
      </div>
    </div>
  );
}
