import { useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useBatchVersionData } from '@/lib/queries';
import { ACTIVE_SELLERS, empiricalEv, stageNumber } from '@/lib/vpCompute';
import { formatCurrency } from '@/lib/formatters';
import type { DealRow } from '@/lib/vpCompute';

interface VersionMeta {
  id: string;
  created_at: string;
}

interface AnchorPoint {
  date: Date;
  label: string;
  versionId: string | null;
  dataset: Record<string, unknown> | null;
}

function parseDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

function ltDateLabel(d: Date, override?: string): string {
  if (override) return override;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function fiscalQLabel(d: Date): string {
  const m = d.getMonth() + 1;
  const fiscalMonth = ((m - 4 + 12) % 12) + 1;
  const quarter = Math.floor((fiscalMonth - 1) / 3) + 1;
  const fiscalYear = m >= 4 ? d.getFullYear() + 1 : d.getFullYear();
  return `Q${quarter}'${String(fiscalYear).slice(-2)}`;
}

function buildAnchors(versionsMeta: VersionMeta[]): { date: Date; label: string }[] {
  const versions = versionsMeta
    .map((v) => ({ meta: v, createdAt: parseDate(v.created_at) }))
    .filter((v) => v.createdAt != null)
    .sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
  if (!versions.length) return [];
  const first = dateOnly(versions[0].createdAt!);
  const latest = dateOnly(versions[versions.length - 1].createdAt!);
  const anchors: { date: Date; label: string }[] = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate() <= 15 ? 1 : 15, 12);
  if (first.getDate() > 15) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() <= latest.getTime()) {
    anchors.push({ date: new Date(cursor), label: ltDateLabel(cursor) });
    if (cursor.getDate() === 1) cursor.setDate(15);
    else { cursor.setMonth(cursor.getMonth() + 1); cursor.setDate(1); }
  }
  const last = anchors[anchors.length - 1];
  if (!last || latest.getTime() > last.date.getTime()) {
    anchors.push({ date: latest, label: ltDateLabel(latest, 'Latest') });
  }
  return anchors;
}

function versionForAnchor(anchorDate: Date, versionsMeta: VersionMeta[]): VersionMeta | null {
  const anchorEnd = new Date(anchorDate.getTime());
  anchorEnd.setHours(23, 59, 59, 999);
  let best: { meta: VersionMeta; createdAt: Date } | null = null;
  versionsMeta.forEach((v) => {
    const ca = parseDate(v.created_at);
    if (!ca || ca.getTime() > anchorEnd.getTime()) return;
    if (!best || ca.getTime() > best.createdAt.getTime()) best = { meta: v, createdAt: ca };
  });
  return (best as { meta: VersionMeta; createdAt: Date } | null)?.meta ?? null;
}

function isWon(stage: string | undefined | null): boolean {
  const s = String(stage ?? '').toLowerCase();
  return s.includes('7. win') || s === 'won' || s === 'win';
}

function isClosureActive(stage: string | undefined | null): boolean {
  const s = String(stage ?? '').toLowerCase();
  if (!s) return false;
  if (s.includes('won') || s.includes('win') || s.includes('loss') || s.includes('lost')) return false;
  if (s.includes('disqualified') || s.includes('no show') || s.includes('reschedule') || s.includes('latent')) return false;
  const n = stageNumber(stage);
  return n != null && n >= 1 && n <= 6;
}

function quarterPaced(row: DealRow, qLabel: string): number {
  const start = row.start_date ? new Date(row.start_date + 'T00:00:00') : null;
  const total = Number(row.deal_size ?? 0);
  if (!start || !isFinite(total) || total <= 0) return 0;
  const dur = Math.round(Number(row.duration_months ?? 1)) || 1;
  let out = 0;
  for (let i = 0; i < dur; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    if (fiscalQLabel(d) === qLabel) out += total / dur;
  }
  return out;
}

function getRows(dataset: Record<string, unknown> | null): DealRow[] {
  return Array.isArray(dataset?.all_deals_rows) ? dataset!.all_deals_rows as DealRow[] : [];
}

function rowMatchesSeller(row: DealRow, seller: string): boolean {
  const label = seller.trim().toLowerCase();
  const matched: string[] = Array.isArray(row.matched_sellers) ? row.matched_sellers as string[] : [];
  if (matched.some((s) => String(s).trim().toLowerCase() === label)) return true;
  const raw = String(row.owner ?? row.seller ?? row.deal_owner ?? '').toLowerCase();
  return raw.includes(label);
}

function rowsForSeller(rows: DealRow[], seller: string): DealRow[] {
  if (!seller || seller === 'Overall') {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (!ACTIVE_SELLERS.some((s) => rowMatchesSeller(r, s))) return false;
      const key = `${r.deal}||${r.intro_date}||${r.stage}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return rows.filter((r) => rowMatchesSeller(r, seller));
}

function computeActuals(dataset: Record<string, unknown> | null, seller: string, date: Date): number {
  const qLabel = fiscalQLabel(date);
  return rowsForSeller(getRows(dataset), seller)
    .filter((r) => isWon(r.stage ?? r.deal_stage))
    .reduce((acc, r) => acc + quarterPaced(r, qLabel), 0);
}

function computePipelineEv(dataset: Record<string, unknown> | null, seller: string, date: Date): number {
  const qLabel = fiscalQLabel(date);
  return rowsForSeller(getRows(dataset), seller)
    .filter((r) => isClosureActive(r.stage ?? r.deal_stage))
    .reduce((acc, r) => acc + empiricalEv(r, qLabel), 0);
}

function computeNewDeals(
  dataset: Record<string, unknown> | null,
  seller: string,
  prevDataset: Record<string, unknown> | null,
): number | null {
  if (!prevDataset) return null;
  const activeKey = (r: DealRow) => `${r.deal}||${r.intro_date}`;
  const currKeys = new Set(rowsForSeller(getRows(dataset), seller).filter((r) => isClosureActive(r.stage ?? r.deal_stage)).map(activeKey));
  const prevKeys = new Set(rowsForSeller(getRows(prevDataset), seller).filter((r) => isClosureActive(r.stage ?? r.deal_stage)).map(activeKey));
  let count = 0;
  currKeys.forEach((k) => { if (!prevKeys.has(k)) count++; });
  return count;
}

type MetricFn = (p: AnchorPoint, seller: string, prev: AnchorPoint | null) => number | null;

function MetricTable({ title, points, getValue, format }: {
  title: string;
  points: AnchorPoint[];
  getValue: MetricFn;
  format: 'money' | 'count';
}) {
  const sellers = ['Overall', ...ACTIVE_SELLERS];
  const fmt = (v: number | null) => {
    if (v == null || v === 0) return '—';
    return format === 'money' ? formatCurrency(v) : String(v);
  };

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
      <div className="px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border-hairline)' }}>
        <span className="text-13 font-medium text-text-primary">{title}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-12">
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
              <th className="text-left py-2 px-3 text-text-secondary font-medium bg-bg-card" style={{ minWidth: 120 }}>Seller</th>
              {points.map((p) => (
                <th key={p.label} className="text-right py-2 px-3 text-text-secondary font-medium whitespace-nowrap">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => {
              const isOverall = s === 'Overall';
              return (
                <tr key={s} style={{ borderBottom: '0.5px solid var(--border-hairline)' }} className="hover:bg-bg-hover">
                  <td className="py-2 px-3 font-medium bg-bg-card"
                    style={{ color: isOverall ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {s}
                  </td>
                  {points.map((p, i) => {
                    const prev = i > 0 ? points[i - 1] : null;
                    const val = isOverall
                      ? ACTIVE_SELLERS.reduce((acc, sel) => acc + (getValue(p, sel, prev) ?? 0), 0)
                      : getValue(p, s, prev);
                    return (
                      <td key={p.label} className="py-2 px-3 text-right tabular-nums text-text-secondary">
                        {fmt(val)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LtTrends() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};
  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;

  const versionsMeta: VersionMeta[] = useMemo(() => {
    const v = storeData?.versions_meta ?? storeData?.versions;
    return Array.isArray(v) ? v as VersionMeta[] : [];
  }, [storeData]);

  const currentDataset = (storeData?.dataset as Record<string, unknown> | null) ?? null;
  const latestVersionId = String(storeData?.latest_version_id ?? storeData?.active_version_id ?? '');

  const anchors = useMemo(() => buildAnchors(versionsMeta), [versionsMeta]);

  const anchorVersionIds = useMemo(() => {
    return anchors
      .map((a) => versionForAnchor(a.date, versionsMeta)?.id)
      .filter((id): id is string => !!id && id !== latestVersionId);
  }, [anchors, versionsMeta, latestVersionId]);

  const batchQuery = useBatchVersionData(username ?? null, password ?? null, anchorVersionIds);
  const batchMap = (batchQuery.data as Record<string, Record<string, unknown> | null> | null) ?? {};

  const points = useMemo((): AnchorPoint[] => {
    return anchors.map((a) => {
      const meta = versionForAnchor(a.date, versionsMeta);
      const id = meta?.id ?? null;
      const dataset = !id ? currentDataset : (id === latestVersionId ? currentDataset : (batchMap[id] ?? null));
      return { ...a, versionId: id, dataset };
    }).filter((p) => p.dataset != null);
  }, [anchors, versionsMeta, batchMap, currentDataset, latestVersionId]);

  if (storeQuery.isLoading) return <div className="p-6 text-13 text-text-secondary">Loading LT trends...</div>;
  if (storeQuery.isError) return <div className="p-6 text-13 text-status-red">Failed to load data.</div>;

  if (!anchors.length) {
    return (
      <div className="p-6 text-13 text-text-secondary">
        No historical snapshots available yet. Data will appear after multiple Monday syncs have been captured.
      </div>
    );
  }

  const shownPoints = points.slice(-16);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-18 font-medium text-text-primary">LT biweekly trends</h2>
        <p className="text-12 text-text-tertiary mt-0.5">
          {points.length} semi-monthly snapshot(s) from {points[0]?.label} to {points[points.length - 1]?.label}
          {batchQuery.isLoading && <span className="text-status-amber"> — loading historical snapshots...</span>}
        </p>
      </div>

      {points.length === 0 ? (
        <div className="p-4 rounded-lg text-13 text-text-secondary" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
          {batchQuery.isLoading ? 'Loading historical snapshots...' : 'No snapshot data could be loaded.'}
        </div>
      ) : (
        <div className="space-y-4">
          <MetricTable
            title="Booked — won revenue (quarter-paced)"
            points={shownPoints}
            getValue={(p, s) => computeActuals(p.dataset, s, p.date)}
            format="money"
          />
          <MetricTable
            title="Weighted pipeline (empirical stage probability)"
            points={shownPoints}
            getValue={(p, s) => computePipelineEv(p.dataset, s, p.date)}
            format="money"
          />
          <MetricTable
            title="Projected outcome (booked + weighted pipeline)"
            points={shownPoints}
            getValue={(p, s) => computeActuals(p.dataset, s, p.date) + computePipelineEv(p.dataset, s, p.date)}
            format="money"
          />
          <MetricTable
            title="New active deals since previous snapshot"
            points={shownPoints}
            getValue={(p, s, prev) => computeNewDeals(p.dataset, s, prev?.dataset ?? null)}
            format="count"
          />
        </div>
      )}
    </div>
  );
}
