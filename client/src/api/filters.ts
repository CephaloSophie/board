import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get, post, patch, del } from './client';
import type { SavedFilter } from '../types';

export type SavedFilterInput = Partial<
  Pick<SavedFilter, 'name' | 'description' | 'filters' | 'view' | 'groupBy' | 'sort' | 'visibility'>
> & { isDefault?: boolean; isStarred?: boolean };

const put = <T,>(path: string, data: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(data) });

export function useSavedFilters(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['filters', projectKey],
    queryFn: () => get<{ filters: SavedFilter[] }>(`/projects/${projectKey}/filters`).then((r) => r.filters),
    enabled: !!projectKey,
  });
}

function useFilterMutation<V, R>(projectKey: string, fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filters', projectKey] }),
  });
}

export function useCreateSavedFilter(projectKey: string) {
  return useFilterMutation(projectKey, (data: SavedFilterInput) =>
    post<{ filter: SavedFilter }>(`/projects/${projectKey}/filters`, data)
  );
}

export function useUpdateSavedFilter(projectKey: string) {
  return useFilterMutation(projectKey, ({ id, data }: { id: string; data: SavedFilterInput }) =>
    patch<{ filter: SavedFilter }>(`/projects/${projectKey}/filters/${id}`, data)
  );
}

export function useDeleteSavedFilter(projectKey: string) {
  return useFilterMutation(projectKey, (id: string) => del<{ ok: true }>(`/projects/${projectKey}/filters/${id}`));
}

export function useStarSavedFilter(projectKey: string) {
  return useFilterMutation(projectKey, ({ id, starred }: { id: string; starred: boolean }) =>
    put<{ filter: SavedFilter }>(`/projects/${projectKey}/filters/${id}/star`, { starred })
  );
}

export function useDefaultSavedFilter(projectKey: string) {
  return useFilterMutation(projectKey, ({ id, isDefault }: { id: string; isDefault: boolean }) =>
    put<{ filter: SavedFilter }>(`/projects/${projectKey}/filters/${id}/default`, { isDefault })
  );
}
