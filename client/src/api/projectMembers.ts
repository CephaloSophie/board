import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, del, api } from './client';
import type { Role, UserRef } from '../types';

export interface ProjectMember {
  _id: string;
  user: UserRef & { role?: Role };
  role: Role;
}

export function useProjectMembers(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['project-members', projectKey],
    queryFn: () =>
      get<{ members: ProjectMember[]; myRole: Role | null }>(`/projects/${projectKey}/members`),
    enabled: !!projectKey,
  });
}

export function useSetProjectRole(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api<{ member: ProjectMember }>(`/projects/${projectKey}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', projectKey] }),
  });
}

export function useClearProjectRole(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => del<{ ok: true }>(`/projects/${projectKey}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', projectKey] }),
  });
}
