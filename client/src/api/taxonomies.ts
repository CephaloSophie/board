import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from './client';
import type { TaxonomyItem, TaxonomyKind } from '../types';

export function useTaxonomies(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['taxonomies', projectKey],
    queryFn: () =>
      get<{ taxonomies: TaxonomyItem[] }>(`/projects/${projectKey}/taxonomies`).then((r) => r.taxonomies),
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

export function useDeleteTaxonomy(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/projects/${projectKey}/taxonomies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxonomies', projectKey] }),
  });
}
