import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from './supabase';

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
