import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Typed RPC wrapper — mirrors existing backend RPC names exactly.
// Add overloads here as views are migrated.
export async function rpc<T = unknown>(
  fn:
    | 'get_dashboard_state'
    | 'save_dashboard_state'
    | 'get_dashboard_version'
    | 'get_dashboard_version_qa'
    | 'get_dashboard_compare'
    | 'rename_dashboard_version'
    | 'upsert_dashboard_user'
    | 'delete_dashboard_user'
    | 'get_deal_staleness',
  payload?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, payload ?? {});
  if (error) throw new Error(`RPC ${fn} failed: ${error.message}`);
  return (Array.isArray(data) ? data[0] ?? null : data) as T;
}

export const SUPABASE_FUNCTIONS_URL = `${supabaseUrl}/functions/v1`;
