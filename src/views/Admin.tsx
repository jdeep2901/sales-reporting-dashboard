import { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useSharedStore, useSaveSharedStore } from '@/lib/queries';
import { rpc, SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';
import { ACTIVE_SELLERS } from '@/lib/vpCompute';
import { buildQuarterLabels } from '@/lib/vpCompute';
import { formatCurrency } from '@/lib/formatters';

interface QuarterTarget {
  seller: string;
  quarter: string;
  revenue: number;
}

type QuarterTargets = Record<string, QuarterTarget>;

interface UserRecord {
  username: string;
  role: string;
  created_at?: string;
  last_login_at?: string;
}

function normalizeQuarterKey(seller: string, quarter: string): string {
  return `${seller.trim().toLowerCase()}||${quarter.trim().toUpperCase()}`;
}

function fmtTs(ts: string | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function TargetsSection({ targets, quarters, onSave }: {
  targets: QuarterTargets;
  quarters: string[];
  onSave: (updated: QuarterTargets) => Promise<void>;
}) {
  const [localTargets, setLocalTargets] = useState<QuarterTargets>({ ...targets });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const sellers = [...ACTIVE_SELLERS];

  const getValue = (seller: string, quarter: string) => {
    const key = normalizeQuarterKey(seller, quarter);
    return localTargets[key]?.revenue ?? 0;
  };

  const setValue = (seller: string, quarter: string, raw: string) => {
    const key = normalizeQuarterKey(seller, quarter);
    const n = Number(raw);
    setLocalTargets((prev) => ({
      ...prev,
      [key]: { seller, quarter, revenue: isFinite(n) ? n : 0 },
    }));
    setDirty(true);
    setMsg('');
  };

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      await onSave(localTargets);
      setDirty(false);
      setMsg('Saved.');
    } catch (e) {
      setMsg((e as Error).message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg p-4" style={{ border: '0.5px solid var(--border-hairline)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-14 font-medium text-text-primary">Quarter targets</h3>
        <div className="flex items-center gap-3">
          {msg && <span className="text-12 text-text-secondary">{msg}</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="px-3 py-1.5 text-12 rounded-md font-medium"
            style={{
              background: dirty ? 'var(--accent)' : 'var(--bg-surface)',
              color: dirty ? '#fff' : 'var(--text-tertiary)',
              border: '0.5px solid var(--border-hairline)',
            }}
          >
            {saving ? 'Saving...' : 'Save targets'}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-12">
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
              <th className="text-left py-2 text-text-secondary font-medium pr-4">Seller</th>
              {quarters.map((q) => (
                <th key={q} className="text-right py-2 text-text-secondary font-medium px-2">{q}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sellers.map((seller) => (
              <tr key={seller} style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
                <td className="py-2 pr-4 text-text-primary">{seller}</td>
                {quarters.map((q) => (
                  <td key={q} className="py-2 px-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={getValue(seller, q)}
                      onChange={(e) => setValue(seller, q, e.target.value)}
                      className="w-28 text-right text-12 tabular-nums px-2 py-1 rounded"
                      style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-emphasis)', color: 'var(--text-primary)' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '0.5px solid var(--border-emphasis)' }}>
              <td className="py-2 pr-4 text-text-secondary font-medium">Overall</td>
              {quarters.map((q) => {
                const total = sellers.reduce((acc, s) => acc + getValue(s, q), 0);
                return (
                  <td key={q} className="py-2 px-2 text-right tabular-nums text-text-primary font-medium">
                    {formatCurrency(total)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function UsersSection({ users, currentUsername, onRefresh }: {
  users: UserRecord[];
  currentUsername: string;
  onRefresh: () => void;
}) {
  const { credentials } = useAuth();
  const [addUser, setAddUser] = useState('');
  const [addPass, setAddPass] = useState('');
  const [addRole, setAddRole] = useState<'viewer' | 'admin'>('viewer');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const upsert = async () => {
    if (!addUser.trim() || !addPass.trim()) { setMsg('Username and password required.'); return; }
    setSaving(true);
    setMsg('');
    try {
      await rpc('upsert_dashboard_user', {
        p_username: credentials!.username,
        p_password: credentials!.password,
        p_target_username: addUser.trim().toLowerCase(),
        p_target_password: addPass,
        p_target_role: addRole,
      });
      setAddUser(''); setAddPass('');
      setMsg('Saved.');
      onRefresh();
    } catch (e) {
      setMsg((e as Error).message ?? 'Failed.');
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (username: string) => {
    if (!confirm(`Delete "${username}" permanently?`)) return;
    try {
      await rpc('delete_dashboard_user', {
        p_username: credentials!.username,
        p_password: credentials!.password,
        p_target_username: username,
      });
      setMsg(`Deleted "${username}".`);
      onRefresh();
    } catch (e) {
      setMsg((e as Error).message ?? 'Failed to delete.');
    }
  };

  const admins = users.filter((u) => u.role === 'admin');

  return (
    <div className="rounded-lg p-4" style={{ border: '0.5px solid var(--border-hairline)', background: 'var(--bg-card)' }}>
      <h3 className="text-14 font-medium text-text-primary mb-4">Users</h3>

      {msg && <p className="text-12 text-text-secondary mb-3">{msg}</p>}

      <table className="w-full text-12 mb-5">
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
            {['Username', 'Role', 'Created', 'Last login', 'Actions'].map((h) => (
              <th key={h} className="text-left py-2 text-text-secondary font-medium pr-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr><td colSpan={5} className="py-3 text-text-tertiary">No users found.</td></tr>
          )}
          {users.map((u) => {
            const isSelf = u.username === currentUsername;
            const isLastAdmin = u.role === 'admin' && admins.length <= 1;
            const canDelete = !isSelf && !isLastAdmin;
            return (
              <tr key={u.username} style={{ borderBottom: '0.5px solid var(--border-hairline)' }} className="hover:bg-bg-hover">
                <td className="py-2 pr-4 text-text-primary">{u.username}</td>
                <td className="py-2 pr-4">
                  <span className="text-11 px-1.5 py-0.5 rounded"
                    style={{ background: u.role === 'admin' ? 'var(--status-amber-bg)' : 'var(--bg-surface)', color: u.role === 'admin' ? 'var(--status-amber-text)' : 'var(--text-secondary)' }}>
                    {u.role}
                  </span>
                </td>
                <td className="py-2 pr-4 text-text-secondary">{fmtTs(u.created_at)}</td>
                <td className="py-2 pr-4 text-text-secondary">{fmtTs(u.last_login_at)}</td>
                <td className="py-2 pr-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setAddUser(u.username); setAddRole(u.role === 'admin' ? 'admin' : 'viewer'); }}
                      className="text-11 px-2 py-0.5 rounded"
                      style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)', color: 'var(--text-secondary)' }}
                    >Reset password</button>
                    <button
                      onClick={() => canDelete && deleteUser(u.username)}
                      disabled={!canDelete}
                      title={isSelf ? 'Cannot delete your own account' : isLastAdmin ? 'Cannot delete last admin' : ''}
                      className="text-11 px-2 py-0.5 rounded"
                      style={{
                        background: canDelete ? 'var(--status-red-bg)' : 'var(--bg-surface)',
                        border: '0.5px solid var(--border-hairline)',
                        color: canDelete ? 'var(--status-red-text)' : 'var(--text-tertiary)',
                        opacity: canDelete ? 1 : 0.5,
                      }}
                    >Delete</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Add / update user form */}
      <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
        <h4 className="text-12 font-medium text-text-secondary mb-3">Add or update user</h4>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Username"
            value={addUser}
            onChange={(e) => setAddUser(e.target.value)}
            className="text-12 px-2.5 py-1.5 rounded"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-emphasis)', color: 'var(--text-primary)', width: 160 }}
          />
          <input
            type="password"
            placeholder="Password"
            value={addPass}
            onChange={(e) => setAddPass(e.target.value)}
            className="text-12 px-2.5 py-1.5 rounded"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-emphasis)', color: 'var(--text-primary)', width: 160 }}
          />
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as 'viewer' | 'admin')}
            className="text-12 px-2.5 py-1.5 rounded"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-emphasis)', color: 'var(--text-primary)' }}
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={upsert}
            disabled={saving}
            className="text-12 px-3 py-1.5 rounded font-medium"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {saving ? 'Saving...' : 'Save user'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SyncSection({ settings }: { settings: Record<string, unknown> | null }) {
  const { credentials } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const lastSync = settings?.last_sync_at ? fmtTs(String(settings.last_sync_at)) : '—';
  const boardUrl = String(settings?.monday_board_url ?? settings?.monday_board_id ?? 'https://themathcocrmtrial.monday.com/boards/6218900009');

  const triggerSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const url = `${SUPABASE_FUNCTIONS_URL}/functions/v1/sync-monday-board`;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
          'x-username': credentials!.username,
          'x-password': credentials!.password,
        },
        body: JSON.stringify({ board_url: boardUrl }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSyncMsg(`Sync triggered. ${json?.message ?? ''}`);
    } catch (e) {
      setSyncMsg((e as Error).message ?? 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-lg p-4" style={{ border: '0.5px solid var(--border-hairline)', background: 'var(--bg-card)' }}>
      <h3 className="text-14 font-medium text-text-primary mb-3">Monday.com sync</h3>
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <span className="text-12 text-text-tertiary">Last sync: </span>
          <span className="text-12 text-text-primary tabular-nums">{lastSync}</span>
        </div>
        <div>
          <span className="text-12 text-text-tertiary">Board: </span>
          <span className="text-12 text-text-secondary">{boardUrl.split('/').pop() ?? boardUrl}</span>
        </div>
        <button
          onClick={triggerSync}
          disabled={syncing}
          className="px-3 py-1.5 text-12 rounded-md font-medium"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {syncing ? 'Syncing...' : 'Trigger sync'}
        </button>
        {syncMsg && <span className="text-12 text-text-secondary">{syncMsg}</span>}
      </div>
    </div>
  );
}

export function Admin() {
  const { credentials } = useAuth();
  const { username, password } = credentials ?? {};
  const storeQuery = useSharedStore(username ?? null, password ?? null);
  const storeData = (storeQuery.data as Record<string, unknown> | null) ?? null;
  const saveStore = useSaveSharedStore();

  const targets: QuarterTargets = useMemo(
    () => ((storeData?.quarter_targets ?? {}) as QuarterTargets),
    [storeData],
  );

  const users: UserRecord[] = useMemo(() => {
    const u = storeData?.users;
    if (!u || typeof u !== 'object') return [];
    return Object.values(u as Record<string, UserRecord>).sort((a, b) => a.username.localeCompare(b.username));
  }, [storeData]);

  const settings = (storeData?.settings as Record<string, unknown> | null) ?? null;

  const quarters = useMemo(() => {
    const dataset = storeData?.dataset as Record<string, unknown> | null;
    const asOfDate = (dataset?.scorecard as Record<string, unknown> | null)?.as_of_date as string | null ?? null;
    const { current, next } = buildQuarterLabels(asOfDate);
    const existingQs = Array.from(new Set(
      Object.values(targets).map((t) => t.quarter?.trim().toUpperCase()).filter(Boolean)
    )).sort();
    const all = Array.from(new Set([...existingQs, current, next])).sort();
    return all.length ? all : [current, next];
  }, [targets, storeData]);

  const handleSaveTargets = async (updated: QuarterTargets) => {
    await saveStore.mutateAsync({
      p_username: username!,
      p_password: password!,
      p_quarter_targets: updated,
    });
  };

  const handleRefreshUsers = () => {
    storeQuery.refetch();
  };

  if (storeQuery.isLoading) return <div className="p-6 text-13 text-text-secondary">Loading admin panel...</div>;
  if (storeQuery.isError) return <div className="p-6 text-13 text-status-red">Failed to load data.</div>;

  const currentUserData = users.find((u) => u.username === username);
  const isAdmin = currentUserData?.role === 'admin';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-18 font-medium text-text-primary">Admin</h2>
        <div className="flex items-center gap-2">
          <span className="text-12 text-text-tertiary">Signed in as</span>
          <span className="text-12 font-medium text-text-primary">{username}</span>
          <span className="text-11 px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)', color: 'var(--text-secondary)' }}>
            {currentUserData?.role ?? '—'}
          </span>
        </div>
      </div>

      {!isAdmin && (
        <div className="rounded-lg p-4 text-13 text-text-secondary"
          style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-hairline)' }}>
          Admin-only actions are hidden. Sign in as an admin user to manage users and sync settings.
        </div>
      )}

      {/* Targets grid — visible to all */}
      <TargetsSection targets={targets} quarters={quarters} onSave={handleSaveTargets} />

      {/* Admin-only sections */}
      {isAdmin && (
        <>
          <SyncSection settings={settings} />
          <UsersSection users={users} currentUsername={username ?? ''} onRefresh={handleRefreshUsers} />
        </>
      )}
    </div>
  );
}
