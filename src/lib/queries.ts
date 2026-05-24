import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc, supabase } from './supabase';

// Shared dashboard state (targets, likelihood flags, settings)
export function useSharedStore(username: string | null, password: string | null) {
  return useQuery({
    queryKey: ['sharedStore', username],
    queryFn: () =>
      rpc('get_dashboard_state', { p_username: username!, p_password: password! }),
    enabled: !!username && !!password,
    staleTime: 5 * 60 * 1000,
  });
}

// Snapshot version list (metadata only)
export function useVersions(username: string | null, password: string | null) {
  const shared = useSharedStore(username, password);
  return {
    versions: (shared.data as { versions?: unknown[] } | null)?.versions ?? [],
    isLoading: shared.isLoading,
  };
}

// Full dataset for a specific version — credentials required by the RPC signature
export function useVersionData(
  username: string | null,
  password: string | null,
  versionId: string | null,
) {
  return useQuery({
    queryKey: ['versionData', username, versionId],
    queryFn: () =>
      rpc('get_dashboard_version', {
        p_username: username!,
        p_password: password!,
        p_version_id: versionId!,
      }),
    enabled: !!username && !!password && !!versionId,
    staleTime: 10 * 60 * 1000,
  });
}

// Version-to-version comparison
export function useVersionCompare(
  username: string | null,
  password: string | null,
  leftId: string | null,
  rightId: string | null,
) {
  return useQuery({
    queryKey: ['versionCompare', username, leftId, rightId],
    queryFn: () =>
      rpc('get_dashboard_compare', {
        p_username: username!,
        p_password: password!,
        p_left_version_id: leftId!,
        p_right_version_id: rightId!,
      }),
    enabled: !!username && !!password && !!leftId && !!rightId,
    staleTime: 10 * 60 * 1000,
  });
}

// Data quality report for a version
export function useVersionQa(
  username: string | null,
  password: string | null,
  versionId: string | null,
) {
  return useQuery({
    queryKey: ['versionQa', username, versionId],
    queryFn: () =>
      rpc('get_dashboard_version_qa', {
        p_username: username!,
        p_password: password!,
        p_version_id: versionId!,
      }),
    enabled: !!username && !!password && !!versionId,
    staleTime: 5 * 60 * 1000,
  });
}

// Batch-load multiple version datasets. Returns a stable map versionId → dataset.
// Uses a single query with all IDs so the hook count stays fixed.
export function useBatchVersionData(
  username: string | null,
  password: string | null,
  versionIds: string[],
) {
  const unique = Array.from(new Set(versionIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ['batchVersionData', username, unique],
    queryFn: async () => {
      const entries = await Promise.all(
        unique.map((id) =>
          rpc<{ dataset?: Record<string, unknown> }>('get_dashboard_version', {
            p_username: username!,
            p_password: password!,
            p_version_id: id,
          })
            .then((row) => [id, row?.dataset ?? null] as [string, Record<string, unknown> | null])
            .catch(() => [id, null] as [string, null]),
        ),
      );
      return Object.fromEntries(entries) as Record<string, Record<string, unknown> | null>;
    },
    enabled: !!username && !!password && unique.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}

// Deal staleness from snapshot history (days since last stage change per deal)
export interface DealStaleness {
  item_id: string;
  days_stale: number;
  current_stage_num: number;
}

export function useDealStaleness() {
  return useQuery({
    queryKey: ['dealStaleness'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_deal_staleness');
      if (error) throw new Error(`get_deal_staleness failed: ${error.message}`);
      const rows = (data ?? []) as DealStaleness[];
      return new Map<string, DealStaleness>(rows.map((r) => [r.item_id, r]));
    },
    staleTime: 60 * 60 * 1000, // 1 hour — recomputed from full history, cache aggressively
  });
}

// ── Seller actions ────────────────────────────────────────────────────────────

export interface SellerAction {
  id: string;
  seller_name: string;
  deal_id: string | null;
  deal_name: string | null;
  text: string;
  due_date: string | null;
  status: 'open' | 'done' | 'carry';
  auto_verified: boolean;
  created_at: string;
  updated_at: string;
}

export function useSellerActions(sellerName: string | null) {
  return useQuery({
    queryKey: ['sellerActions', sellerName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seller_actions')
        .select('*')
        .eq('seller_name', sellerName!)
        .order('created_at', { ascending: false });
      if (error) throw new Error(`seller_actions fetch failed: ${error.message}`);
      return (data ?? []) as SellerAction[];
    },
    enabled: !!sellerName,
    staleTime: 60 * 1000,
  });
}

export function useAllSellerActions(sellerNames: string[]) {
  const sorted = [...sellerNames].sort();
  return useQuery({
    queryKey: ['allSellerActions', sorted],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seller_actions')
        .select('*')
        .in('seller_name', sorted);
      if (error) throw new Error(`seller_actions fetch failed: ${error.message}`);
      const rows = (data ?? []) as SellerAction[];
      const map = new Map<string, SellerAction[]>();
      for (const row of rows) {
        const list = map.get(row.seller_name) ?? [];
        list.push(row);
        map.set(row.seller_name, list);
      }
      return map;
    },
    enabled: sorted.length > 0,
    staleTime: 60 * 1000,
  });
}

export function useCreateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Omit<SellerAction, 'id' | 'created_at' | 'updated_at' | 'auto_verified'>) => {
      const { data, error } = await supabase.from('seller_actions').insert(payload).select().single();
      if (error) throw new Error(error.message);
      return data as SellerAction;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['sellerActions', row.seller_name] });
      qc.invalidateQueries({ queryKey: ['allSellerActions'] });
    },
  });
}

export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<SellerAction> & { id: string }) => {
      const { data, error } = await supabase
        .from('seller_actions')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as SellerAction;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['sellerActions', row.seller_name] });
      qc.invalidateQueries({ queryKey: ['allSellerActions'] });
    },
  });
}

export function useDeleteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, seller_name }: { id: string; seller_name: string }) => {
      const { error } = await supabase.from('seller_actions').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { id, seller_name };
    },
    onSuccess: ({ seller_name }) => {
      qc.invalidateQueries({ queryKey: ['sellerActions', seller_name] });
      qc.invalidateQueries({ queryKey: ['allSellerActions'] });
    },
  });
}

// Save shared state mutation
export function useSaveSharedStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => rpc('save_dashboard_state', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sharedStore'] });
    },
  });
}
