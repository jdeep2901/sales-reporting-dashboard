import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useBatchVersionData } from '@/lib/queries';
import {
  ACTIVE_SELLERS, buildRows, type QuarterTargets,
} from '@/lib/vpCompute';
import { KpiCard } from '@/components/KpiCard';
import { formatCurrency } from '@/lib/formatters';

// ── constants ─────────────────────────────────────────────────────────────────

const FY27_Q = { current: "Q1'27", next: "Q2'27" };

const SELLER_VERTICAL: Record<string, string> = {
  'Akshay Iyer': 'Pharma',
  'Somya':       'CPG',
  'Suvom Mitro': 'Retail',
  'Vitor Quirino': 'EU',
  'Maruti Peri': 'Engineering',
  'Sahana':      'RoW',
};
const FY_START = new Date(2026, 3, 1, 0, 0, 0); // Apr 1 2026

// Recharts stroke colors — must be hardcoded here (not in CSS vars)
const COLOR_EV        = '#635BFF'; // --accent
const COLOR_BOOKED    = '#16A34A'; // --status-green
const COLOR_COMMITTED = '#D97706'; // --status-amber
const COLOR_TARGET    = '#9CA3AF'; // --text-tertiary
const COLOR_FORECAST  = '#0EA5E9'; // sky-500

// ── types ─────────────────────────────────────────────────────────────────────

interface VersionMeta { id: string; created_at: string }

interface TeamMetrics {
  ev: number; booked: number; committed: number;
  target: number; forecast: number;
  sellers: { seller: string; ev: number; booked: number; committed: number; target: number }[];
}

interface WeekPoint {
  label: string;
  versionId: string;
  dataset: Record<string, unknown> | null;
  metrics: TeamMetrics | null;
}

type MetricKey = 'ev' | 'booked' | 'committed' | 'forecast';
type QuarterScope = 'current' | 'both';

// ── helpers ───────────────────────────────────────────────────────────────────

function isoWeekKey(d: Date): string {
  const dt = new Date(d.getTime());
  dt.setHours(12, 0, 0, 0);
  dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7));
  const ys = new Date(dt.getFullYear(), 0, 1);
  const w = Math.ceil(((dt.getTime() - ys.getTime()) / 86400000 + 1) / 7);
  return `${dt.getFullYear()}-W${String(w).padStart(2, '0')}`;
}

function weekLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Returns the latest-per-ISO-week snapshots since FY start, sorted ascending
function buildWeeklyAnchors(metas: VersionMeta[]): { label: string; meta: VersionMeta }[] {
  const weekMap = new Map<string, { date: Date; meta: VersionMeta }>();
  for (const v of metas) {
    const d = new Date(v.created_at);
    if (isNaN(d.getTime()) || d < FY_START) continue;
    const wk = isoWeekKey(d);
    const ex = weekMap.get(wk);
    if (!ex || d > ex.date) weekMap.set(wk, { date: d, meta: v });
  }
  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { date, meta }]) => ({ label: weekLabel(date), meta }));
}

function computeMetrics(
  dataset: Record<string, unknown> | null,
  targets: QuarterTargets,
  scope: QuarterScope,
): TeamMetrics {
  const empty = { ev: 0, booked: 0, committed: 0, target: 0, forecast: 0, sellers: [] };
  if (!dataset) return empty;
  const { summary } = buildRows(dataset, targets, FY27_Q);
  const rows = scope === 'both' ? summary : summary.filter((s) => s.quarter.key === 'current');
  const team = rows.reduce(
    (acc, s) => ({
      ev: acc.ev + s.ev,
      booked: acc.booked + s.booked,
      committed: acc.committed + s.committed,
      target: acc.target + s.target,
    }),
    { ev: 0, booked: 0, committed: 0, target: 0 },
  );
  const sellers = [...ACTIVE_SELLERS].map((seller) => {
    const sellerRows = rows.filter((s) => s.seller === seller);
    return {
      seller,
      ev: sellerRows.reduce((a, s) => a + s.ev, 0),
      booked: sellerRows.reduce((a, s) => a + s.booked, 0),
      committed: sellerRows.reduce((a, s) => a + s.committed, 0),
      target: sellerRows.reduce((a, s) => a + s.target, 0),
    };
  });
  return { ...team, forecast: team.booked + team.committed, sellers };
}

// ── chart tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md text-12 shadow-sm px-3 py-2"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-emphasis)' }}>
      <div className="text-text-secondary mb-1.5 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 tabular-nums">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-text-secondary capitalize">{p.name}</span>
          <span className="ml-auto pl-4 text-text-primary font-medium">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── per-seller table ──────────────────────────────────────────────────────────

function SellerTable({ points, metric, scope }: { points: WeekPoint[]; metric: MetricKey; scope: QuarterScope }) {
  const visible = points.slice(-8);
  const q = scope === 'both' ? 'Q1+Q2' : 'Q1';
  const metricLabel: Record<MetricKey, string> = {
    ev: `Expected value (${q})`, booked: `Booked (${q})`,
    committed: `Committed S5/S6 (${q})`, forecast: `Forecast (${q})`,
  };
  const teamTotals = visible.map((p) => {
    const m = p.metrics;
    if (!m) return null;
    return metric === 'forecast' ? m.booked + m.committed : m[metric];
  });

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
      <div className="px-4 py-2.5 flex items-center justify-between"
        style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border-hairline)' }}>
        <span className="text-13 font-medium text-text-primary">{metricLabel[metric]}</span>
        <span className="text-11 text-text-tertiary">weekly snapshots since Apr 1</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-12">
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
              <th className="text-left py-2 px-3 text-text-secondary font-medium"
                style={{ minWidth: 130, background: 'var(--bg-card)' }}>Seller</th>
              {visible.map((p) => (
                <th key={p.versionId} className="text-right py-2 px-3 text-text-secondary font-medium whitespace-nowrap">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Team row */}
            <tr style={{ borderBottom: '0.5px solid var(--border-hairline)', background: 'var(--bg-surface)' }}>
              <td className="py-2 px-3 font-medium text-text-primary">Team</td>
              {teamTotals.map((val, i) => (
                <td key={i} className="py-2 px-3 text-right tabular-nums font-medium text-text-primary">
                  {val != null && val > 0 ? formatCurrency(val) : '—'}
                </td>
              ))}
            </tr>
            {[...ACTIVE_SELLERS].map((seller) => (
              <tr key={seller} style={{ borderBottom: '0.5px solid var(--border-hairline)' }}
                className="hover:bg-bg-hover">
                <td className="py-2 px-3 text-text-secondary" style={{ background: 'var(--bg-card)' }}>
                  {SELLER_VERTICAL[seller] ?? seller}
                </td>
                {visible.map((p) => {
                  const row = p.metrics?.sellers.find((s) => s.seller === seller);
                  const val = row ? (metric === 'forecast' ? row.booked + row.committed : row[metric]) : null;
                  return (
                    <td key={p.versionId} className="py-2 px-3 text-right tabular-nums text-text-secondary">
                      {val != null && val > 0 ? formatCurrency(val) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── main view ─────────────────────────────────────────────────────────────────

export function LtTrends() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};

  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;

  const targets = useMemo(
    () => ((storeData?.quarter_targets ?? {}) as QuarterTargets),
    [storeData],
  );

  const versionsMeta: VersionMeta[] = useMemo(() => {
    const v = storeData?.versions_meta ?? storeData?.versions;
    return Array.isArray(v) ? (v as VersionMeta[]) : [];
  }, [storeData]);

  const currentDataset = (storeData?.dataset as Record<string, unknown> | null) ?? null;
  const latestVersionId = String(storeData?.latest_version_id ?? storeData?.active_version_id ?? '');

  const [tableMetric, setTableMetric] = useState<MetricKey>('ev');
  const [scope, setScope] = useState<QuarterScope>('current');

  // Weekly anchors (one per ISO week since Apr 1, latest snapshot wins)
  const anchors = useMemo(() => buildWeeklyAnchors(versionsMeta), [versionsMeta]);

  // Batch-load all historical snapshots (excluding the latest, which we already have)
  const historicalIds = useMemo(
    () => anchors.map((a) => a.meta.id).filter((id) => id !== latestVersionId),
    [anchors, latestVersionId],
  );
  const batchQuery = useBatchVersionData(username ?? null, password ?? null, historicalIds);
  const batchMap = (batchQuery.data as Record<string, Record<string, unknown> | null> | null) ?? {};

  // Assemble final week points with computed metrics
  const points = useMemo((): WeekPoint[] => {
    return anchors.map((a) => {
      const id = a.meta.id;
      const dataset = id === latestVersionId ? currentDataset : (batchMap[id] ?? null);
      const metrics = dataset ? computeMetrics(dataset, targets, scope) : null;
      return { label: a.label, versionId: id, dataset, metrics };
    }).filter((p) => p.metrics != null);
  }, [anchors, batchMap, currentDataset, latestVersionId, targets, scope]);

  // Current (latest) metrics
  const current = points[points.length - 1]?.metrics;

  // Chart data
  const chartData = useMemo(() => points.map((p) => ({
    name: p.label,
    EV: Math.round(p.metrics?.ev ?? 0),
    Booked: Math.round(p.metrics?.booked ?? 0),
    Committed: Math.round(p.metrics?.committed ?? 0),
    Forecast: Math.round((p.metrics?.booked ?? 0) + (p.metrics?.committed ?? 0)),
  })), [points]);

  const teamTarget = current?.target ?? 0;

  const metricTabs: { key: MetricKey; label: string }[] = [
    { key: 'ev', label: 'EV' },
    { key: 'booked', label: 'Booked' },
    { key: 'committed', label: 'Committed' },
    { key: 'forecast', label: 'Forecast' },
  ];

  // ── loading / error states ────────────────────────────────────────────────

  if (storeQuery.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-md" style={{ background: 'var(--bg-surface)' }} />
          ))}
        </div>
        <div className="h-64 rounded-lg" style={{ background: 'var(--bg-surface)' }} />
      </div>
    );
  }

  if (storeQuery.isError) {
    return (
      <div className="p-4 text-13 text-status-red rounded-lg"
        style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
        Failed to load — <button className="underline" onClick={() => storeQuery.refetch()}>retry</button>
      </div>
    );
  }

  if (!points.length && !batchQuery.isLoading) {
    return (
      <div className="p-4 text-13 text-text-secondary rounded-lg"
        style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
        No snapshots found since Apr 1. Data will appear after the next Monday sync.
      </div>
    );
  }

  const evRatio = teamTarget > 0 && current ? current.ev / teamTarget : null;
  const evRatioColor = evRatio == null ? 'muted' : evRatio >= 1.5 ? 'green' : evRatio >= 1.0 ? 'amber' : 'red';
  const forecastRatio = teamTarget > 0 && current ? (current.booked + current.committed) / teamTarget : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-18 font-medium text-text-primary">
            LT pipeline trends — {scope === 'both' ? "FY27 Q1 + Q2" : "FY27 Q1"}
          </h2>
          <p className="text-12 text-text-tertiary mt-0.5">
            {points.length} weekly snapshot{points.length !== 1 ? 's' : ''} &middot; Apr 1 to {points[points.length - 1]?.label}
            {batchQuery.isLoading && (
              <span className="text-status-amber"> &middot; loading history...</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(['current', 'both'] as QuarterScope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className="px-3 py-1 text-12 rounded-md transition-colors"
              style={{
                background: scope === s ? 'var(--bg-surface)' : 'transparent',
                border: '0.5px solid ' + (scope === s ? 'var(--border-emphasis)' : 'var(--border-hairline)'),
                color: scope === s ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: scope === s ? 500 : 400,
              }}
            >
              {s === 'current' ? 'Q1 only' : 'Q1 + Q2'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      {current && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label={`Expected value (${scope === 'both' ? 'Q1+Q2' : 'Q1'})`}
            value={formatCurrency(current.ev)}
            sub={evRatio != null ? `${(evRatio * 100).toFixed(0)}% of target` : undefined}
            subColor={evRatioColor}
          />
          <KpiCard
            label={`Booked (${scope === 'both' ? 'Q1+Q2' : 'Q1'})`}
            value={formatCurrency(current.booked)}
            sub={teamTarget > 0 ? `${((current.booked / teamTarget) * 100).toFixed(0)}% of target` : undefined}
            subColor={current.booked / teamTarget >= 0.5 ? 'green' : current.booked / teamTarget >= 0.3 ? 'amber' : 'muted'}
          />
          <KpiCard
            label={`Committed S5/S6 (${scope === 'both' ? 'Q1+Q2' : 'Q1'})`}
            value={formatCurrency(current.committed)}
            sub={`${formatCurrency(current.booked + current.committed)} forecast`}
            subColor="muted"
          />
          <KpiCard
            label="Forecast vs target"
            value={forecastRatio != null ? `${(forecastRatio * 100).toFixed(0)}%` : '—'}
            sub={forecastRatio != null ? (forecastRatio >= 1 ? 'on track' : `${formatCurrency(teamTarget - current.booked - current.committed)} gap`) : undefined}
            subColor={forecastRatio != null ? (forecastRatio >= 1 ? 'green' : forecastRatio >= 0.7 ? 'amber' : 'red') : 'muted'}
          />
        </div>
      )}

      {/* Trend chart */}
      <div className="rounded-lg px-4 pt-4 pb-2"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-hairline)' }}>
        <div className="text-13 font-medium text-text-primary mb-4">Team pipeline — week over week</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v) => formatCurrency(v)}
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              width={64}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              iconType="plainline"
              iconSize={16}
              wrapperStyle={{ fontSize: 11, paddingTop: 8, color: 'var(--text-secondary)' }}
            />
            {teamTarget > 0 && (
              <ReferenceLine
                y={teamTarget}
                stroke={COLOR_TARGET}
                strokeDasharray="4 3"
                label={{ value: 'Target', position: 'insideTopRight', fontSize: 10, fill: COLOR_TARGET }}
              />
            )}
            <Line type="monotone" dataKey="EV" stroke={COLOR_EV} strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: COLOR_EV }} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="Booked" stroke={COLOR_BOOKED} strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: COLOR_BOOKED }} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="Committed" stroke={COLOR_COMMITTED} strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: COLOR_COMMITTED }} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="Forecast" stroke={COLOR_FORECAST} strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={{ r: 3, strokeWidth: 0, fill: COLOR_FORECAST }} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per-seller breakdown */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          {metricTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTableMetric(t.key)}
              className="px-3 py-1 text-12 rounded-md transition-colors"
              style={{
                background: tableMetric === t.key ? 'var(--bg-surface)' : 'transparent',
                border: '0.5px solid ' + (tableMetric === t.key ? 'var(--border-emphasis)' : 'transparent'),
                color: tableMetric === t.key ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: tableMetric === t.key ? 500 : 400,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {points.length > 0 && <SellerTable points={points} metric={tableMetric} scope={scope} />}
      </div>
    </div>
  );
}
