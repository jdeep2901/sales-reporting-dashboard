import { useState, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useBatchVersionData, useSaveSharedStore } from '@/lib/queries';
import { ACTIVE_SELLERS, stageNumber, empiricalEv } from '@/lib/vpCompute';
import { useSeller, SELLER_OPTIONS } from '@/lib/sellerContext';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import type { DealRow } from '@/lib/vpCompute';

const OPERATING_START = '2026-01-01';
const MANUAL_NS = '__operating_manual_metrics';

const MANUAL_METRICS = [
  { id: 8, key: 'cofo_intros', label: '# of Co-Fo intros', category: 'Key levers' },
  { id: 9, key: 'in_person_connects_workshops', label: '# of in-person connects / workshops', category: 'Key levers' },
  { id: 10, key: 'leads_mapped_to_alliances', label: '# of leads mapped to alliances', category: 'Key levers' },
] as const;

interface VersionMeta {
  id: string;
  created_at: string;
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseIsoDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

function weekKey(weekStart: Date): string {
  return [
    weekStart.getFullYear(),
    String(weekStart.getMonth() + 1).padStart(2, '0'),
    String(weekStart.getDate()).padStart(2, '0'),
  ].join('-');
}

function weekLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function weekEnd(weekStart: Date): Date {
  const d = new Date(weekStart.getTime());
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function buildWeekStarts(startIso: string, endDateLike: string): Date[] {
  const start = parseIsoDate(startIso);
  const end = parseDate(endDateLike) ?? new Date();
  if (!start || !end) return [];
  const out: Date[] = [];
  const d = new Date(start.getTime());
  while (d.getTime() <= end.getTime()) {
    out.push(new Date(d.getTime()));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

function closestVersionForWeekEnd(we: Date, versionsMeta: VersionMeta[]): VersionMeta | null {
  let best: { meta: VersionMeta; ca: Date } | null = null;
  versionsMeta.forEach((v) => {
    const ca = parseDate(v.created_at);
    if (!ca || ca.getTime() > we.getTime()) return;
    if (!best || ca.getTime() > best.ca.getTime()) best = { meta: v, ca };
  });
  return (best as { meta: VersionMeta; ca: Date } | null)?.meta ?? null;
}

function fiscalQLabel(d: Date): string {
  const m = d.getMonth() + 1;
  const fiscalMonth = ((m - 4 + 12) % 12) + 1;
  const quarter = Math.floor((fiscalMonth - 1) / 3) + 1;
  const fy = m >= 4 ? d.getFullYear() + 1 : d.getFullYear();
  return `Q${quarter}'${String(fy).slice(-2)}`;
}

function isWon(stage: string | undefined | null): boolean {
  return String(stage ?? '').toLowerCase().match(/7\. win|^won$|^win$/) != null;
}

function isLost(stage: string | undefined | null): boolean {
  return String(stage ?? '').toLowerCase().match(/8\. loss|^lost$|^loss$/) != null;
}

function isActive(stage: string | undefined | null): boolean {
  const s = String(stage ?? '').toLowerCase();
  if (!s || s.includes('latent') || s.includes('disqualified') || s.includes('no show')) return false;
  const n = stageNumber(stage);
  return n != null && n >= 1 && n <= 6;
}

function rowMatchesSeller(row: DealRow, seller: string): boolean {
  const label = seller.trim().toLowerCase();
  const matched: string[] = Array.isArray(row.matched_sellers) ? row.matched_sellers as string[] : [];
  if (matched.some((s) => String(s).trim().toLowerCase() === label)) return true;
  return String(row.owner ?? row.seller ?? row.deal_owner ?? '').toLowerCase().includes(label);
}

function getRows(dataset: Record<string, unknown> | null): DealRow[] {
  return Array.isArray(dataset?.all_deals_rows) ? dataset!.all_deals_rows as DealRow[] : [];
}

function scopedRows(dataset: Record<string, unknown> | null, seller: string): DealRow[] {
  const rows = getRows(dataset);
  if (!seller || seller === 'Overall') {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (!ACTIVE_SELLERS.some((s) => rowMatchesSeller(r, s))) return false;
      const key = `${r.deal}||${r.intro_date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return rows.filter((r) => rowMatchesSeller(r, seller));
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

// ─── computed metric functions ────────────────────────────────────────────────

function metric_newLogos(dataset: Record<string, unknown> | null, seller: string, we: Date): number {
  const qLabel = fiscalQLabel(we);
  return scopedRows(dataset, seller).filter((r) => isWon(r.stage ?? r.deal_stage) && quarterPaced(r, qLabel) > 0).length;
}

function metric_lateStage(dataset: Record<string, unknown> | null, seller: string): number {
  return scopedRows(dataset, seller).filter((r) => {
    const n = stageNumber(r.stage ?? r.deal_stage);
    return n != null && n >= 5 && n <= 6;
  }).length;
}

function metric_introToQual(dataset: Record<string, unknown> | null, seller: string): number | null {
  const rows = scopedRows(dataset, seller);
  const intros = rows.filter((r) => {
    const n = stageNumber(r.stage ?? r.deal_stage);
    return n != null && n >= 1;
  }).length;
  if (intros === 0) return null;
  const qualified = rows.filter((r) => {
    const n = stageNumber(r.stage ?? r.deal_stage);
    return n != null && n >= 2 && !isWon(r.stage) && !isLost(r.stage);
  }).length;
  return qualified / intros;
}

function metric_daysSinceLastWin(dataset: Record<string, unknown> | null, seller: string): number | null {
  const wonDates = scopedRows(dataset, seller)
    .filter((r) => isWon(r.stage ?? r.deal_stage))
    .map((r) => parseIsoDate(r.start_date as string | null))
    .filter(Boolean) as Date[];
  if (!wonDates.length) return null;
  const latest = wonDates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  const today = new Date();
  return Math.round((today.getTime() - latest.getTime()) / 86_400_000);
}

function metric_pipelineEv4Q(dataset: Record<string, unknown> | null, seller: string, we: Date): number {
  const rows = scopedRows(dataset, seller).filter((r) => isActive(r.stage ?? r.deal_stage));
  const quarters = [0, 1, 2, 3].map((offset) => {
    const d = new Date(we);
    d.setMonth(d.getMonth() + offset * 3);
    return fiscalQLabel(d);
  });
  const seen = new Set(quarters);
  const uniqueQ = Array.from(seen);
  return rows.reduce((acc, r) => acc + uniqueQ.reduce((qacc, q) => qacc + empiricalEv(r, q), 0), 0);
}

// ─── manual metric store helpers ─────────────────────────────────────────────

type LikelihoodState = Record<string, unknown>;

function getManualValue(
  likelihood: LikelihoodState,
  seller: string,
  weekStart: Date,
  metricKey: string,
): number | null {
  const ns = likelihood[MANUAL_NS] as Record<string, unknown> | undefined;
  if (!ns) return null;
  const sellerBucket = ns[seller] as Record<string, unknown> | undefined;
  const weekBucket = sellerBucket?.[weekKey(weekStart)] as Record<string, unknown> | undefined;
  const v = Number(weekBucket?.[metricKey]);
  return isFinite(v) && v >= 0 ? v : null;
}

function setManualValue(
  likelihood: LikelihoodState,
  seller: string,
  weekStart: Date,
  metricKey: string,
  rawValue: string,
): LikelihoodState {
  const next = JSON.parse(JSON.stringify(likelihood)) as LikelihoodState;
  if (!next[MANUAL_NS] || typeof next[MANUAL_NS] !== 'object') next[MANUAL_NS] = {};
  const ns = next[MANUAL_NS] as Record<string, Record<string, Record<string, unknown>>>;
  if (!ns[seller]) ns[seller] = {};
  const wk = weekKey(weekStart);
  if (!ns[seller][wk]) ns[seller][wk] = {};
  const n = Number(rawValue);
  if (rawValue.trim() === '' || !isFinite(n) || n < 0) {
    delete ns[seller][wk][metricKey];
  } else {
    ns[seller][wk][metricKey] = Math.round(n);
  }
  return next;
}

// ─── component ───────────────────────────────────────────────────────────────

export function OperatingMetrics() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};
  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;
  const saveStore = useSaveSharedStore();

  const dataset = (storeData?.dataset as Record<string, unknown> | null) ?? null;
  const versionsMeta: VersionMeta[] = useMemo(() => {
    const v = storeData?.versions_meta ?? storeData?.versions;
    return Array.isArray(v) ? v as VersionMeta[] : [];
  }, [storeData]);

  const { seller, setSeller } = useSeller();
  const [localLikelihood, setLocalLikelihood] = useState<LikelihoodState | null>(null);
  const [saveStatus, setSaveStatus] = useState('');

  const likelihood = useMemo((): LikelihoodState => {
    if (localLikelihood != null) return localLikelihood;
    return (storeData?.likelihood as LikelihoodState | null) ?? {};
  }, [storeData, localLikelihood]);

  const asOfDate = useMemo(() => {
    const sc = dataset?.scorecard_summary as Record<string, unknown> | null;
    const sc2 = dataset?.scorecard as Record<string, unknown> | null;
    return String(sc?.as_of_date ?? sc2?.as_of_date ?? new Date().toISOString().slice(0, 10));
  }, [dataset]);

  const weekStarts = useMemo(() => buildWeekStarts(OPERATING_START, asOfDate), [asOfDate]);

  // Only fetch snapshots for older versions (not latest)
  const latestId = String(storeData?.latest_version_id ?? storeData?.active_version_id ?? '');
  const weekVersionIds = useMemo(() => {
    const ids = weekStarts.map((ws) => {
      const we = weekEnd(ws);
      const meta = closestVersionForWeekEnd(we, versionsMeta);
      return meta?.id ?? null;
    });
    return Array.from(new Set(ids.filter((id): id is string => !!id && id !== latestId)));
  }, [weekStarts, versionsMeta, latestId]);

  const batchQuery = useBatchVersionData(username ?? null, password ?? null, weekVersionIds);
  const batchMap = (batchQuery.data as Record<string, Record<string, unknown> | null> | null) ?? {};

  const getDatasetForWeek = useCallback((ws: Date): Record<string, unknown> | null => {
    const we = weekEnd(ws);
    const meta = closestVersionForWeekEnd(we, versionsMeta);
    if (!meta) return dataset;
    if (meta.id === latestId) return dataset;
    return batchMap[meta.id] ?? dataset;
  }, [versionsMeta, dataset, batchMap, latestId]);

  const handleManualChange = (weekStart: Date, metricKey: string, rawValue: string) => {
    if (!seller || seller === 'Overall') return;
    setLocalLikelihood((prev) => setManualValue(prev ?? likelihood, seller, weekStart, metricKey, rawValue));
    setSaveStatus('Unsaved');
  };

  const handleSave = async () => {
    if (!localLikelihood) return;
    setSaveStatus('Saving...');
    try {
      await saveStore.mutateAsync({
        p_username: username!,
        p_password: password!,
        p_likelihood: localLikelihood,
      });
      setSaveStatus('Saved.');
      setLocalLikelihood(null);
    } catch (e) {
      setSaveStatus((e as Error).message ?? 'Save failed.');
    }
  };

  if (storeQuery.isLoading) return <div className="p-6 text-13 text-text-secondary">Loading operating metrics...</div>;
  if (storeQuery.isError) return <div className="p-6 text-13 text-status-red">Failed to load data.</div>;

  const visibleWeeks = weekStarts.slice(-20); // show last 20 weeks by default

  const computedMetrics = [
    {
      id: 1,
      label: 'Weighted pipeline (next 4 quarters)',
      category: 'Revenue',
      fmt: 'money' as const,
      getValue: (ws: Date, ds: Record<string, unknown> | null) => metric_pipelineEv4Q(ds, seller, ws),
      tone: (v: number) => v > 500_000 ? 'green' : v > 200_000 ? 'amber' : 'red',
    },
    {
      id: 2,
      label: 'New logos closed (quarter)',
      category: 'Revenue',
      fmt: 'count' as const,
      getValue: (ws: Date, ds: Record<string, unknown> | null) => metric_newLogos(ds, seller, ws),
      tone: (v: number) => v >= 2 ? 'green' : v === 1 ? 'amber' : 'red',
    },
    {
      id: 3,
      label: 'Late stage deals (5–6)',
      category: 'Pipeline',
      fmt: 'count' as const,
      getValue: (_: Date, ds: Record<string, unknown> | null) => metric_lateStage(ds, seller),
      tone: (v: number) => v >= 3 ? 'green' : v >= 1 ? 'amber' : 'red',
    },
    {
      id: 4,
      label: 'Intro → qualification conversion',
      category: 'Pipeline',
      fmt: 'percent' as const,
      getValue: (_: Date, ds: Record<string, unknown> | null) => metric_introToQual(ds, seller),
      tone: (v: number) => v >= 0.5 ? 'green' : v >= 0.4 ? 'amber' : 'red',
    },
    {
      id: 5,
      label: 'Days since last win',
      category: 'Pipeline',
      fmt: 'days' as const,
      getValue: (_: Date, ds: Record<string, unknown> | null) => metric_daysSinceLastWin(ds, seller),
      tone: (v: number) => v <= 30 ? 'green' : v <= 60 ? 'amber' : 'red',
    },
  ];

  const formatValue = (v: number | null, fmt: string) => {
    if (v == null) return '—';
    if (fmt === 'money') return formatCurrency(v);
    if (fmt === 'percent') return formatPercent(v, 0);
    if (fmt === 'days') return `${v}d`;
    return String(Math.round(v));
  };

  const toneStyle = (tone: string) => {
    if (tone === 'green') return { color: 'var(--status-green)' };
    if (tone === 'amber') return { color: 'var(--status-amber)' };
    return { color: 'var(--status-red)' };
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-18 font-medium text-text-primary">What are our operating trends?</h2>
          <p className="text-12 text-text-tertiary mt-0.5">
            {visibleWeeks.length} weeks shown{batchQuery.isLoading && <span className="text-status-amber"> — loading snapshots...</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus && <span className="text-12 text-text-secondary">{saveStatus}</span>}
          {localLikelihood && (
            <button onClick={handleSave} className="px-3 py-1.5 text-12 rounded-md font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
              Save manual inputs
            </button>
          )}
          <select
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            className="text-13 px-3 py-1.5 rounded-md bg-bg-surface text-text-primary"
            style={{ border: '0.5px solid var(--border-emphasis)' }}
          >
            {SELLER_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Computed metrics table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
        <div className="px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border-hairline)' }}>
          <span className="text-13 font-medium text-text-primary">Computed metrics</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-12">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                <th className="text-left py-2 px-3 text-text-secondary font-medium bg-bg-card" style={{ minWidth: 220 }}>Metric</th>
                {visibleWeeks.map((ws) => (
                  <th key={weekKey(ws)} className="text-right py-2 px-2 text-text-secondary font-medium whitespace-nowrap">
                    {weekLabel(ws)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {computedMetrics.map((m) => (
                <tr key={m.id} style={{ borderBottom: '0.5px solid var(--border-hairline)' }} className="hover:bg-bg-hover">
                  <td className="py-2 px-3 text-text-primary bg-bg-card">
                    <div>{m.label}</div>
                    <div className="text-11 text-text-tertiary">{m.category}</div>
                  </td>
                  {visibleWeeks.map((ws) => {
                    const ds = getDatasetForWeek(ws);
                    const val = m.getValue(ws, ds);
                    const tone = val != null ? m.tone(val) : 'neutral';
                    return (
                      <td key={weekKey(ws)} className="py-2 px-2 text-right tabular-nums font-medium"
                        style={tone !== 'neutral' ? toneStyle(tone) : { color: 'var(--text-tertiary)' }}>
                        {formatValue(val, m.fmt)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual metrics table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
        <div className="px-4 py-2.5 flex items-center gap-3" style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border-hairline)' }}>
          <span className="text-13 font-medium text-text-primary">Manual inputs — key levers</span>
          {seller === 'Overall' && (
            <span className="text-11 text-text-tertiary">Select a seller to enter values</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-12">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                <th className="text-left py-2 px-3 text-text-secondary font-medium bg-bg-card" style={{ minWidth: 220 }}>Metric</th>
                {visibleWeeks.map((ws) => (
                  <th key={weekKey(ws)} className="text-right py-2 px-2 text-text-secondary font-medium whitespace-nowrap">
                    {weekLabel(ws)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MANUAL_METRICS.map((m) => (
                <tr key={m.id} style={{ borderBottom: '0.5px solid var(--border-hairline)' }} className="hover:bg-bg-hover">
                  <td className="py-2 px-3 text-text-primary bg-bg-card">
                    <div>{m.label}</div>
                    <div className="text-11 text-text-tertiary">{m.category}</div>
                  </td>
                  {visibleWeeks.map((ws) => {
                    if (seller === 'Overall') {
                      const total = ACTIVE_SELLERS.reduce((acc, s) => {
                        return acc + (getManualValue(likelihood, s, ws, m.key) ?? 0);
                      }, 0);
                      return (
                        <td key={weekKey(ws)} className="py-2 px-2 text-right tabular-nums text-text-secondary">
                          {total > 0 ? total : '—'}
                        </td>
                      );
                    }
                    const val = getManualValue(likelihood, seller, ws, m.key);
                    return (
                      <td key={weekKey(ws)} className="py-1 px-1 text-right">
                        <input
                          type="number"
                          min="0"
                          value={val ?? ''}
                          placeholder="—"
                          onChange={(e) => handleManualChange(ws, m.key, e.target.value)}
                          className="w-16 text-right text-12 tabular-nums px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)', color: 'var(--text-primary)' }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
