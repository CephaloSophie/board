import { useMutation, useQuery } from '@tanstack/react-query';
import { api, del, get, patch, post } from './client';
import { useInvalidateProject } from './invalidate';
import type { ClosePreview, SprintLeftovers, SprintRow } from '../types';

export interface SprintInput {
  label?: string;
  key?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
  linkedVersion?: string;
  order?: number;
}

export interface CloseSprintInput {
  carryOver: { mode: 'sprint' | 'backlog' | 'newSprint'; targetKey?: string; newSprint?: SprintInput };
  keep: string[];
  startTarget: boolean;
  createRetro: boolean;
}

export function useSprints(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['sprints', projectKey],
    queryFn: () => get<{ sprints: SprintRow[]; currentSprint: string | null }>(`/projects/${projectKey}/sprints`),
    enabled: !!projectKey,
  });
}

export function useClosePreview(projectKey: string, sprintKey: string | null) {
  return useQuery({
    queryKey: ['sprints', projectKey, 'close-preview', sprintKey],
    queryFn: () => get<ClosePreview>(`/projects/${projectKey}/sprints/${encodeURIComponent(sprintKey!)}/close-preview`),
    enabled: !!sprintKey,
    staleTime: 0,
  });
}

// Work left by a sprint: still in it (not done) and carried over at its closure.
export function useSprintLeftovers(projectKey: string | undefined, sprintKey: string | null | undefined) {
  return useQuery({
    queryKey: ['sprints', projectKey, 'leftovers', sprintKey],
    queryFn: () => get<SprintLeftovers>(`/projects/${projectKey}/sprints/${encodeURIComponent(sprintKey!)}/leftovers`),
    enabled: !!projectKey && !!sprintKey,
  });
}

export function useSprintMutations(projectKey: string) {
  const invalidate = useInvalidateProject(projectKey);
  const base = `/projects/${projectKey}/sprints`;
  const k = (key: string) => `${base}/${encodeURIComponent(key)}`;
  const opts = { onSuccess: invalidate };
  return {
    create: useMutation({ mutationFn: (data: SprintInput) => post<{ sprint: SprintRow }>(base, data), ...opts }),
    update: useMutation({
      mutationFn: ({ key, data }: { key: string; data: SprintInput }) => patch<{ sprint: SprintRow }>(k(key), data),
      ...opts,
    }),
    transition: useMutation({
      mutationFn: ({ key, action }: { key: string; action: 'ready' | 'draft' | 'reopen' }) =>
        post<{ sprint: SprintRow }>(`${k(key)}/${action}`),
      ...opts,
    }),
    start: useMutation({
      mutationFn: ({ key, data }: { key: string; data: { startDate?: string; endDate?: string; goal?: string } }) =>
        post<{ sprint: SprintRow }>(`${k(key)}/start`, data),
      ...opts,
    }),
    close: useMutation({
      mutationFn: ({ key, data }: { key: string; data: CloseSprintInput }) =>
        post<{ sprint: SprintRow; carriedOver: number; retroEventId: string | null }>(`${k(key)}/close`, data),
      ...opts,
    }),
    remove: useMutation({ mutationFn: (key: string) => del<{ ok: true }>(k(key)), ...opts }),
    setCurrent: useMutation({
      mutationFn: (key: string | null) => api<{ currentSprint: string | null }>(`${base}/current`, { method: 'PUT', body: JSON.stringify({ key }) }),
      ...opts,
    }),
  };
}
