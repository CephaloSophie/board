import { useMutation, useQuery } from '@tanstack/react-query';
import { api, get, patch, post } from './client';
import { useInvalidateProject } from './invalidate';
import type { MemberRow, ProjectAccess, ProjectRole } from '../types';

type MembersResponse = { access: ProjectAccess; members: MemberRow[] };

export function useMembers(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['members', projectKey],
    queryFn: () => get<MembersResponse>(`/projects/${projectKey}/members`),
    enabled: !!projectKey,
  });
}

// Users that can be assigned work (viewers excluded).
export function useAssignableUsers(projectKey: string | undefined) {
  const q = useMembers(projectKey);
  return { ...q, data: q.data?.members.filter((m) => m.role !== 'viewer').map((m) => m.user) };
}

export function useMemberMutations(projectKey: string) {
  const invalidate = useInvalidateProject(projectKey);
  const base = `/projects/${projectKey}/members`;
  const opts = { onSuccess: invalidate };
  return {
    add: useMutation({
      mutationFn: (data: { userIds: string[]; role: ProjectRole }) => post<MembersResponse>(base, data),
      ...opts,
    }),
    setRole: useMutation({
      mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) => patch<MembersResponse>(`${base}/${userId}`, { role }),
      ...opts,
    }),
    remove: useMutation({
      mutationFn: ({ userId, unassignOpenTasks }: { userId: string; unassignOpenTasks: boolean }) =>
        api<MembersResponse & { unassigned: number }>(`${base}/${userId}${unassignOpenTasks ? '?unassignOpenTasks=1' : ''}`, {
          method: 'DELETE',
        }),
      ...opts,
    }),
  };
}
