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

// Full dataset for a specific version
export function useVersionData(versionId: string | null) {
  return useQuery({
    queryKey: ['versionData', versionId],
    queryFn: () => rpc('get_dashboard_version', { p_version_id: versionId! }),
    enabled: !!versionId,
    staleTime: 10 * 60 * 1000,
  });
}

// Version-to-version comparison
export function useVersionCompare(leftId: string | null, rightId: string | null) {
  return useQuery({
    queryKey: ['versionCompare', leftId, rightId],
    queryFn: () =>
      rpc('get_dashboard_compare', { p_left_id: leftId!, p_right_id: rightId! }),
    enabled: !!leftId && !!rightId,
    staleTime: 10 * 60 * 1000,
  });
}

// Data quality report for a version
export function useVersionQa(versionId: string | null) {
  return useQuery({
    queryKey: ['versionQa', versionId],
    queryFn: () => rpc('get_dashboard_version_qa', { p_version_id: versionId! }),
    enabled: !!versionId,
    staleTime: 5 * 60 * 1000,
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
