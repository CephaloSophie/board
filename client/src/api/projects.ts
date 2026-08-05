import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch } from './client';
import type { Project } from '../types';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => get<{ projects: Project[] }>('/projects').then((r) => r.projects),
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
    queryFn: () => get<{ total: number; done: number; bugs: number; totalPoints: number }>(
      `/projects/${key}/stats`
    ),
    enabled: !!key,
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

export function useUpdateProject(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Project>) => patch<{ project: Project }>(`/projects/${key}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', key] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
