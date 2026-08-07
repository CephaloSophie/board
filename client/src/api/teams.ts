import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from './client';
import type { Team } from '../types';

export function useTeams(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['teams', projectKey],
    queryFn: () => get<{ teams: Team[] }>(`/projects/${projectKey}/teams`).then((r) => r.teams),
    enabled: !!projectKey,
  });
}

export function useCreateTeam(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Team>) => post<{ team: Team }>(`/projects/${projectKey}/teams`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams', projectKey] }),
  });
}

export function useUpdateTeam(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Team> }) =>
      patch<{ team: Team }>(`/projects/${projectKey}/teams/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams', projectKey] }),
  });
}

export function useDeleteTeam(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/projects/${projectKey}/teams/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams', projectKey] }),
  });
}
