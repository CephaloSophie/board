import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, del } from './client';

export interface RetroSummary {
  _id: string;
  sprint: string;
  team?: { _id: string; name: string; color?: string } | null;
  title?: string;
  facilitator?: { _id: string; displayName: string; color?: string };
  phase: string;
  status: 'draft' | 'running' | 'done';
  invited: { _id: string; displayName: string; color?: string; role?: string }[];
  createdAt: string;
}

export function useRetros(projectKey: string | undefined, params?: { sprint?: string; team?: string }) {
  const qs = new URLSearchParams();
  if (params?.sprint) qs.set('sprint', params.sprint);
  if (params?.team) qs.set('team', params.team);
  const suffix = qs.toString() ? `?${qs}` : '';
  return useQuery({
    queryKey: ['retros', projectKey, params],
    queryFn: () => get<{ retros: RetroSummary[] }>(`/projects/${projectKey}/retros${suffix}`).then((r) => r.retros),
    enabled: !!projectKey,
  });
}

export function useCreateRetro(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { sprint: string; team?: string | null; title?: string; facilitator?: string }) =>
      post<{ retro: RetroSummary }>(`/projects/${projectKey}/retros`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['retros', projectKey] }),
  });
}

export function useDeleteRetro(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/projects/${projectKey}/retros/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['retros', projectKey] }),
  });
}
