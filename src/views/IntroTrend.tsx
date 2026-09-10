import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';
import { useAuth } from '@/lib/auth';
import { useSharedStore } from '@/lib/queries';
import { useIndustry, INDUSTRY_OPTIONS } from '@/lib/industryContext';
import { industryOf, isExcludedFromNewSales, rowMatchesIndustry, type DealRow } from '@/lib/vpCompute';

type Granularity = 'week' | 'month';

interface IntroRecord {
  deal: string;
  intro_date: string;
  stage: string;
  industry: string;
}

// Monday-start week key — matches the week axis the sync function writes to intro_trend.
function weekKeyOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Recomputed from deal rows (not the backend's per-seller series) so it can be cut by
// industry and includes every current seller. Same rule as the sync function: intro
// meeting date, excluding deals currently in No Show / Reschedule.
function buildIntroRecords(rows: DealRow[], industry: string): IntroRecord[] {
  const seen = new Set<string>();
  const out: IntroRecord[] = [];
  for (const r of rows) {
    const intro = String(r.intro_date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(intro)) continue;
    const stage = String(r.stage ?? r.deal_stage ?? '');
    if (/no show|reschedule/i.test(stage)) continue;
    if (isExcludedFromNewSales(r) || !rowMatchesIndustry(r, industry)) continue;
    const key = `${r.deal}|${intro}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ deal: String(r.deal ?? r.account ?? '—'), intro_date: intro, stage, industry: industryOf(r) });
  }
  return out;
}

function weekAxis(backendWeeks: unknown, records: IntroRecord[]): string[] {
  if (Array.isArray(backendWeeks) && backendWeeks.length) return (backendWeeks as string[]).slice().sort();
  const keys = Array.from(new Set(records.map((r) => weekKeyOf(r.intro_date)))).sort();
  return keys;
}

function buildSeries(
  records: IntroRecord[],
  weeks: string[],
  granularity: Granularity,
): { labels: string[]; points: number[]; target: number; targetLabel: string } {
  const byWeek: Record<string, number> = {};
  records.forEach((r) => { const w = weekKeyOf(r.intro_date); byWeek[w] = (byWeek[w] ?? 0) + 1; });

  if (granularity === 'month') {
    const agg: Record<string, number> = {};
    weeks.forEach((w) => {
      const m = w.slice(0, 7);
      agg[m] = (agg[m] ?? 0) + (byWeek[w] ?? 0);
    });
    const labels = Object.keys(agg).sort();
    return { labels, points: labels.map((m) => agg[m] ?? 0), target: 16, targetLabel: 'Target 16 / month' };
  }
  return { labels: weeks, points: weeks.map((w) => byWeek[w] ?? 0), target: 4, targetLabel: 'Target 4 / week' };
}

function buildDetailSeries(
  records: IntroRecord[],
  weeks: string[],
  granularity: Granularity,
): Record<string, IntroRecord[]> {
  const byWeek: Record<string, IntroRecord[]> = {};
  records.forEach((r) => { const w = weekKeyOf(r.intro_date); (byWeek[w] ??= []).push(r); });
  if (granularity === 'month') {
    const agg: Record<string, IntroRecord[]> = {};
    weeks.forEach((w) => { (agg[w.slice(0, 7)] ??= []).push(...(byWeek[w] ?? [])); });
    return agg;
  }
  const out: Record<string, IntroRecord[]> = {};
  weeks.forEach((w) => { out[w] = byWeek[w] ?? []; });
  return out;
}

function formatWeekLabel(label: string, granularity: Granularity): string {
  if (granularity === 'month') {
    const [y, m] = label.split('-');
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  const d = new Date(label + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function IntroTrend() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};
  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;
  const dataset = (storeData?.dataset as Record<string, unknown> | null) ?? null;
  const introTrend = (dataset?.intro_trend as Record<string, unknown> | null) ?? {};

  const { industry: scope, setIndustry: setScope } = useIndustry();
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  const scopeOptions = INDUSTRY_OPTIONS;

  const allRows = useMemo(
    () => (Array.isArray(dataset?.all_deals_rows) ? (dataset!.all_deals_rows as DealRow[]) : []),
    [dataset],
  );
  const records = useMemo(() => buildIntroRecords(allRows, scope), [allRows, scope]);
  const weeks = useMemo(() => weekAxis(introTrend.weeks, records), [introTrend, records]);

  const { labels, points, target, targetLabel } = useMemo(
    () => buildSeries(records, weeks, granularity),
    [records, weeks, granularity],
  );

  const detailSeries = useMemo(
    () => buildDetailSeries(records, weeks, granularity),
    [records, weeks, granularity],
  );

  const chartData = useMemo(
    () => labels.map((l, i) => ({ label: formatWeekLabel(l, granularity), rawLabel: l, count: points[i] ?? 0 })),
    [labels, points, granularity],
  );

  const total = points.reduce((a, b) => a + b, 0);
  const peak = points.length ? Math.max(...points) : 0;
  const peakIdx = points.indexOf(peak);
  const peakLabel = peakIdx >= 0 ? labels[peakIdx] : '—';
  const avg = points.length ? total / points.length : 0;

  const detailRecords = selectedLabel ? (detailSeries[selectedLabel] ?? []) : [];

  if (storeQuery.isLoading) return <div className="p-6 text-13 text-text-secondary">Loading call trends...</div>;
  if (storeQuery.isError) return <div className="p-6 text-13 text-status-red">Failed to load data.</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-18 font-medium text-text-primary">Are we building enough top-of-funnel activity?</h2>
        <div className="flex items-center gap-3">
          <select
            value={scope}
            onChange={(e) => { setScope(e.target.value); setSelectedLabel(null); }}
            className="text-13 px-3 py-1.5 rounded-md bg-bg-surface text-text-primary"
            style={{ border: '0.5px solid var(--border-emphasis)' }}
          >
            {scopeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex rounded-md overflow-hidden" style={{ border: '0.5px solid var(--border-emphasis)' }}>
            {(['week', 'month'] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => { setGranularity(g); setSelectedLabel(null); }}
                className="px-3 py-1.5 text-12 capitalize"
                style={{
                  background: granularity === g ? 'var(--accent)' : 'var(--bg-surface)',
                  color: granularity === g ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats chips */}
      <div className="flex gap-2 flex-wrap">
        {[
          `${granularity === 'month' ? 'Months' : 'Weeks'}: ${labels.length}`,
          `Intro calls: ${total}`,
          `${granularity === 'month' ? 'Monthly' : 'Weekly'} avg: ${avg.toFixed(1)}`,
          `Peak: ${peak} (${peakLabel ? formatWeekLabel(peakLabel, granularity) : '—'})`,
          targetLabel,
        ].map((chip) => (
          <span key={chip} className="text-12 px-2.5 py-1 rounded-full tabular-nums"
            style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)', color: 'var(--text-secondary)' }}>
            {chip}
          </span>
        ))}
      </div>

      {/* Bar chart */}
      <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)' }}>
        <p className="text-11 text-text-tertiary mb-3">Click a bar to see deal details</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            onClick={(e) => {
              if (e?.activePayload?.[0]) {
                const raw = (e.activePayload[0].payload as { rawLabel: string }).rawLabel;
                setSelectedLabel(raw === selectedLabel ? null : raw);
              }
            }}
          >
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false}
              interval={granularity === 'week' ? Math.max(0, Math.floor(chartData.length / 20)) : 0} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={24} />
            <Tooltip
              contentStyle={{ fontSize: 12, border: '0.5px solid var(--border-hairline)', borderRadius: 8 }}
              formatter={(v: unknown) => [String(v), 'Intro calls']}
            />
            <ReferenceLine y={target} stroke="var(--status-amber)" strokeDasharray="4 2" strokeWidth={1.5}
              label={{ value: `Target ${target}`, position: 'right', fontSize: 10, fill: 'var(--status-amber)' }} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} cursor="pointer">
              {chartData.map((d, i) => (
                <Cell key={i}
                  fill={d.rawLabel === selectedLabel ? 'var(--accent)' : (d.count >= target ? 'var(--status-green)' : 'var(--status-amber)')}
                  opacity={d.rawLabel === selectedLabel ? 1 : 0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detail table */}
      {selectedLabel && (
        <div className="rounded-lg p-4" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-13 font-medium text-text-primary">
              {formatWeekLabel(selectedLabel, granularity)} — {detailRecords.length} deal(s)
            </span>
            <button onClick={() => setSelectedLabel(null)} className="text-11 text-text-tertiary hover:text-text-primary">Clear</button>
          </div>
          {detailRecords.length === 0 ? (
            <p className="text-12 text-text-tertiary">No records.</p>
          ) : (
            <table className="w-full text-12">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                  <th className="text-left py-1.5 text-text-secondary font-medium">Deal</th>
                  <th className="text-left py-1.5 text-text-secondary font-medium">Stage</th>
                  <th className="text-left py-1.5 text-text-secondary font-medium">Industry</th>
                  <th className="text-right py-1.5 text-text-secondary font-medium">Intro date</th>
                </tr>
              </thead>
              <tbody>
                {[...detailRecords].sort((a, b) => String(a.deal ?? '').localeCompare(String(b.deal ?? ''))).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border-hairline)' }} className="hover:bg-bg-hover">
                    <td className="py-1.5 pr-3 text-text-primary">{String(r.deal ?? '—')}</td>
                    <td className="py-1.5 pr-3 text-text-secondary">{String(r.stage ?? '—')}</td>
                    <td className="py-1.5 pr-3 text-text-secondary">{r.industry}</td>
                    <td className="py-1.5 text-right text-text-secondary">{String(r.intro_date ?? '—').slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
