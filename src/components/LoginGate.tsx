import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { rpc } from '@/lib/supabase';

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { credentials, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (credentials) return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      await rpc('get_dashboard_state', {
        p_username: username.trim().toLowerCase(),
        p_password: password,
      });
      login(username.trim().toLowerCase(), password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('invalid') || msg.includes('auth') ? 'Invalid username or password.' : `Login failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-page flex items-center justify-center">
      <div
        className="bg-bg-card w-full max-w-sm p-8"
        style={{ border: '0.5px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}
      >
        <p className="text-13 font-medium text-text-primary mb-6">Sign in to MathCo sales reporting</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-11 text-text-secondary" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="text-13 text-text-primary bg-bg-surface px-3 py-2 outline-none"
              style={{
                border: '0.5px solid var(--border-emphasis)',
                borderRadius: 'var(--radius-sm)',
              }}
              disabled={loading}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-11 text-text-secondary" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="text-13 text-text-primary bg-bg-surface px-3 py-2 outline-none"
              style={{
                border: '0.5px solid var(--border-emphasis)',
                borderRadius: 'var(--radius-sm)',
              }}
              disabled={loading}
            />
          </div>
          {error && <p className="text-11 text-status-red">{error}</p>}
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="mt-1 text-13 font-medium text-white bg-accent px-4 py-2 disabled:opacity-40"
            style={{ borderRadius: 'var(--radius-sm)' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
