import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get, post, patch } from './client';
import { useInvalidateProject } from './invalidate';
import type { Project, ProjectOverview, ProjectStats } from '../types';

export function useProjects(opts: { archived?: boolean } = {}) {
  return useQuery({
    queryKey: ['projects', opts.archived ? 'archived' : 'active'],
    queryFn: () => get<{ projects: Project[] }>(`/projects${opts.archived ? '?archived=1' : ''}`).then((r) => r.projects),
  });
}

export function useProject(key: string | undefined) {
  return useQuery({
    queryKey: ['project', key],
    queryFn: () => get<{ project: Project }>(`/projects/${key}`).then((r) => r.project),
    enabled: !!key,
  });
}

export function useProjectStats(key: string | undefined) {
  return useQuery({
    queryKey: ['project-stats', key],
    queryFn: () => get<ProjectStats>(`/projects/${key}/stats`),
    enabled: !!key,
  });
}

export function useProjectOverview(key: string | undefined) {
  return useQuery({
    queryKey: ['project-overview', key],
    queryFn: () => get<ProjectOverview>(`/projects/${key}/overview`),
    enabled: !!key,
  });
}

export function useProjectLabels(key: string | undefined) {
  return useQuery({
    queryKey: ['labels', key],
    queryFn: () => get<{ labels: { value: string; count: number }[] }>(`/projects/${key}/labels`).then((r) => r.labels),
    enabled: !!key,
    staleTime: 60_000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { key: string; name: string; vendor?: string; description?: string; currentVersion?: string }) =>
      post<{ project: Project }>('/projects', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export type ProjectSettingsInput = Partial<
  Pick<
    Project,
    | 'name'
    | 'vendor'
    | 'description'
    | 'currentVersion'
    | 'sprintDurationValue'
    | 'sprintDurationUnit'
    | 'timezone'
    | 'workingDays'
    | 'estimation'
    | 'defaults'
    | 'access'
  >
>;

export function useUpdateProject(key: string) {
  const invalidate = useInvalidateProject(key);
  return useMutation({
    mutationFn: (data: ProjectSettingsInput) => patch<{ project: Project }>(`/projects/${key}`, data),
    onSuccess: invalidate,
  });
}

export function useProjectAction(key: string) {
  const invalidate = useInvalidateProject(key);
  return useMutation({
    mutationFn: ({ action, data }: { action: 'archive' | 'unarchive' | 'transfer'; data?: unknown }) =>
      post<{ project: Project }>(`/projects/${key}/${action}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteProject(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmKey: string) =>
      api<{ deleted: Record<string, number> }>(`/projects/${key}`, { method: 'DELETE', body: JSON.stringify({ confirmKey }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}
