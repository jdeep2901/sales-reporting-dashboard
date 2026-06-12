import { useDealEngagement, type DealEngagement } from '@/lib/queries';
import { formatCurrency } from '@/lib/formatters';

const STATE: Record<
  DealEngagement['state'],
  { label: string; border: string; bg: string; text: string }
> = {
  two_way_active: { label: 'Two-way active', border: 'var(--status-green)', bg: 'var(--status-green-bg)', text: 'var(--status-green-text)' },
  chasing:        { label: 'Chasing',        border: 'var(--status-amber)', bg: 'var(--status-amber-bg)', text: 'var(--status-amber-text)' },
  gone_quiet:     { label: 'Gone quiet',      border: 'var(--status-red)',   bg: 'var(--status-red-bg)',   text: 'var(--status-red-text)' },
  won_execution:  { label: 'Won — executing', border: 'var(--accent)',       bg: '#ede9fe',                text: '#5b21b6' },
  no_signal:      { label: 'No signal',       border: 'var(--text-tertiary)',bg: 'var(--bg-surface)',      text: 'var(--text-secondary)' },
};

// Order: risk first (what needs attention), healthy next, won/no-signal last.
const STATE_ORDER: DealEngagement['state'][] = ['gone_quiet', 'chasing', 'no_signal', 'two_way_active', 'won_execution'];

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysAgo(d: string | null): string {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return '';
  const n = Math.round((Date.now() - dt.getTime()) / 86400000);
  return n <= 0 ? 'today' : `${n}d ago`;
}

function StatePill({ state }: { state: DealEngagement['state'] }) {
  const s = STATE[state];
  return (
    <span
      className="text-11 font-medium"
      style={{ background: s.bg, color: s.text, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}
    >
      {s.label}
    </span>
  );
}

function Row({ d }: { d: DealEngagement }) {
  const s = STATE[d.state];
  const [account, ...rest] = d.monday_deal.split(' / ');
  const dealName = rest.join(' / ') || account;
  return (
    <tr
      className="hover:bg-bg-hover"
      style={{ borderBottom: '0.5px solid var(--border-hairline)', borderLeft: `2px solid ${s.border}` }}
    >
      <td className="py-2.5 px-3" style={{ minWidth: 220 }}>
        <div className="text-13 text-text-primary font-medium">{account}</div>
        <div className="text-11 text-text-tertiary">{dealName} · {d.seller}</div>
      </td>
      <td className="py-2.5 px-3"><StatePill state={d.state} /></td>
      <td className="py-2.5 px-3 text-right tabular-nums text-13 text-text-secondary whitespace-nowrap">
        {d.deal_size ? formatCurrency(d.deal_size) : '—'}
      </td>
      <td className="py-2.5 px-3 text-13 whitespace-nowrap">
        <span className="text-text-primary">{fmtDate(d.last_inbound)}</span>
        {d.last_inbound && <span className="text-11 text-text-tertiary"> · {daysAgo(d.last_inbound)}</span>}
        {d.prospect_contact && <div className="text-11 text-text-tertiary">{d.prospect_contact}</div>}
      </td>
      <td className="py-2.5 px-3 text-13 text-text-secondary whitespace-nowrap">{fmtDate(d.last_outbound)}</td>
      <td className="py-2.5 px-3 text-right tabular-nums text-13 text-text-secondary">{d.followups_30d || '—'}</td>
      <td className="py-2.5 px-3 text-12 text-text-secondary" style={{ minWidth: 240, lineHeight: 1.5 }}>
        {d.reconciliation}
        {!d.confirmed && (
          <span className="text-11" style={{ color: 'var(--status-amber-text)' }}> · needs confirmation</span>
        )}
      </td>
    </tr>
  );
}

export function Engagement() {
  const { data, isLoading, isError, refetch } = useDealEngagement();

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-8 w-72 rounded" style={{ background: 'var(--bg-surface)' }} />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-12 rounded" style={{ background: 'var(--bg-surface)' }} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 text-13 text-status-red rounded-lg" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
        Failed to load engagement signals — <button className="underline" onClick={() => refetch()}>retry</button>
      </div>
    );
  }

  const rows = data ?? [];
  if (!rows.length) {
    return (
      <div className="p-4 text-13 text-text-secondary rounded-lg" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
        No engagement signals yet. The next inbox scan will populate Q2 closure deals here.
      </div>
    );
  }

  const sorted = [...rows].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || (b.deal_size ?? 0) - (a.deal_size ?? 0),
  );
  const counts = STATE_ORDER.map((st) => ({ st, n: rows.filter((r) => r.state === st).length })).filter((c) => c.n > 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-18 font-medium text-text-primary">Are deals actually moving?</h2>
        <p className="text-12 text-text-tertiary mt-0.5">
          Email engagement on Q2 closure deals, from JD's inbox · prospect-response signal, not follow-up volume
        </p>
      </div>

      {/* Summary strip */}
      <div className="flex flex-wrap gap-2">
        {counts.map(({ st, n }) => (
          <div
            key={st}
            className="flex items-center gap-1.5 text-12"
            style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)', borderRadius: 8, padding: '6px 10px' }}
          >
            <span className="tabular-nums font-medium text-text-primary">{n}</span>
            <StatePill state={st} />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-hairline)' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 920 }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border-hairline)' }}>
                <th className="text-left py-2 px-3 text-11 font-medium text-text-secondary">Deal</th>
                <th className="text-left py-2 px-3 text-11 font-medium text-text-secondary">Engagement</th>
                <th className="text-right py-2 px-3 text-11 font-medium text-text-secondary">Size</th>
                <th className="text-left py-2 px-3 text-11 font-medium text-text-secondary">Last prospect reply</th>
                <th className="text-left py-2 px-3 text-11 font-medium text-text-secondary">Last seller send</th>
                <th className="text-right py-2 px-3 text-11 font-medium text-text-secondary">Follow-ups 30d</th>
                <th className="text-left py-2 px-3 text-11 font-medium text-text-secondary">Read vs Monday</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => <Row key={d.id} d={d} />)}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-11 text-text-tertiary">
        v0 seed · {rows.length} Q2 closure deals scanned over the last month. Prospect replies are the unfakeable signal —
        "gone quiet" means a previously responsive prospect went silent. Mapping confirmed via the morning brief.
      </p>
    </div>
  );
}
