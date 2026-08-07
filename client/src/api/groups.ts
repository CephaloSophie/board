import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from './client';
import type { UserGroup } from '../types';

export function useGroups(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['groups', projectKey],
    queryFn: () => get<{ groups: UserGroup[] }>(`/projects/${projectKey}/groups`).then((r) => r.groups),
    enabled: !!projectKey,
  });
}

export function useCreateGroup(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<UserGroup>) => post<{ group: UserGroup }>(`/projects/${projectKey}/groups`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', projectKey] }),
  });
}

export function useUpdateGroup(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<UserGroup> }) =>
      patch<{ group: UserGroup }>(`/projects/${projectKey}/groups/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', projectKey] }),
  });
}

export function useDeleteGroup(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/projects/${projectKey}/groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', projectKey] }),
  });
}
