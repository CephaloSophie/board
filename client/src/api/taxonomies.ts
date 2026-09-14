import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get, post, patch, del } from './client';
import { useInvalidateProject } from './invalidate';
import type { TaxonomyItem, TaxonomyKind } from '../types';

// Archived items are only fetched on request (admin screens); mutations
// invalidate the ['taxonomies', projectKey] prefix, refreshing both variants.
export function useTaxonomies(projectKey: string | undefined, opts: { includeArchived?: boolean } = {}) {
  const all = !!opts.includeArchived;
  return useQuery({
    queryKey: ['taxonomies', projectKey, all ? 'all' : 'active'],
    queryFn: () =>
      get<{ taxonomies: TaxonomyItem[] }>(
        `/projects/${projectKey}/taxonomies${all ? '?includeArchived=1' : ''}`
      ).then((r) => r.taxonomies),
    enabled: !!projectKey,
  });
}

export function taxonomiesByKind(items: TaxonomyItem[] | undefined, kind: TaxonomyKind) {
  return (items || []).filter((i) => i.kind === kind && !i.archived).sort((a, b) => a.order - b.order);
}

export function useCreateTaxonomy(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TaxonomyItem> & { kind: TaxonomyKind; key: string; label: string }) =>
      post<{ taxonomy: TaxonomyItem }>(`/projects/${projectKey}/taxonomies`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxonomies', projectKey] }),
  });
}

export function useUpdateTaxonomy(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<TaxonomyItem> }) =>
      patch<{ taxonomy: TaxonomyItem }>(`/projects/${projectKey}/taxonomies/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxonomies', projectKey] }),
  });
}

export function useReorderTaxonomies(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { kind: TaxonomyKind; keys: string[] }) =>
      api<{ taxonomies: TaxonomyItem[] }>(`/projects/${projectKey}/taxonomies/order`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxonomies', projectKey] }),
  });
}

// Delete a value and move every task / saved filter using it to `replacementKey`.
export function useReplaceTaxonomy(projectKey: string) {
  const invalidate = useInvalidateProject(projectKey);
  return useMutation({
    mutationFn: ({ id, replacementKey }: { id: string; replacementKey: string }) =>
      post<{ tasksUpdated: number; filtersUpdated: number }>(`/projects/${projectKey}/taxonomies/${id}/replace`, { replacementKey }),
    onSuccess: invalidate,
  });
}

export function useDeleteTaxonomy(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/projects/${projectKey}/taxonomies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxonomies', projectKey] }),
  });
}
