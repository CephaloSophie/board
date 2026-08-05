import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from './client';
import type { Task, TaskFilters } from '../types';

function buildQuery(filters: Partial<TaskFilters>): string {
  const params = new URLSearchParams();
  (Object.keys(filters) as (keyof TaskFilters)[]).forEach((key) => {
    const value = filters[key];
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, v));
    } else if (value) {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useTasks(projectKey: string | undefined, filters: Partial<TaskFilters>) {
  return useQuery({
    queryKey: ['tasks', projectKey, filters],
    queryFn: () =>
      get<{ tasks: Task[] }>(`/projects/${projectKey}/tasks${buildQuery(filters)}`).then((r) => r.tasks),
    enabled: !!projectKey,
  });
}

export function useTask(projectKey: string | undefined, taskId: string | undefined) {
  return useQuery({
    queryKey: ['task', projectKey, taskId],
    queryFn: () => get<{ task: Task }>(`/projects/${projectKey}/tasks/${taskId}`).then((r) => r.task),
    enabled: !!projectKey && !!taskId,
  });
}

export function useCreateTask(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Task>) => post<{ task: Task }>(`/projects/${projectKey}/tasks`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', projectKey] }),
  });
}

export function useUpdateTask(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: Partial<Task> & { note?: string } }) =>
      patch<{ task: Task }>(`/projects/${projectKey}/tasks/${taskId}`, data),
    onMutate: async ({ taskId, data }) => {
      await qc.cancelQueries({ queryKey: ['tasks', projectKey] });
      const previous = qc.getQueriesData<Task[]>({ queryKey: ['tasks', projectKey] });
      previous.forEach(([key, tasks]) => {
        if (!tasks) return;
        qc.setQueryData(
          key,
          tasks.map((t) => (t.taskId === taskId ? { ...t, ...data } : t))
        );
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, tasks]) => qc.setQueryData(key, tasks));
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks', projectKey] });
      qc.invalidateQueries({ queryKey: ['task', projectKey, vars.taskId] });
      qc.invalidateQueries({ queryKey: ['project-stats', projectKey] });
    },
  });
}

export function useDeleteTask(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => del<{ ok: true }>(`/projects/${projectKey}/tasks/${taskId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', projectKey] }),
  });
}

export function useAddComment(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, text }: { taskId: string; text: string }) =>
      post<{ comments: Task['comments'] }>(`/projects/${projectKey}/tasks/${taskId}/comments`, { text }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['task', projectKey, vars.taskId] }),
  });
}

export function useDeleteComment(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, commentId }: { taskId: string; commentId: string }) =>
      del<{ ok: true }>(`/projects/${projectKey}/tasks/${taskId}/comments/${commentId}`),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['task', projectKey, vars.taskId] }),
  });
}
