import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from './client';
import { useInvalidateProject } from './invalidate';
import type { Comment, Task, TaskFilters } from '../types';

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

// `summary` skips history/comments/instructions (board and list views only
// need card fields; the detail view loads the full task on its own).
export function useTasks(projectKey: string | undefined, filters: Partial<TaskFilters>, opts: { summary?: boolean } = {}) {
  return useQuery({
    queryKey: ['tasks', projectKey, filters, opts.summary ? 'summary' : 'full'],
    queryFn: () => {
      const qs = buildQuery(filters);
      const suffix = opts.summary ? `${qs ? `${qs}&` : '?'}fields=summary` : qs;
      return get<{ tasks: Task[] }>(`/projects/${projectKey}/tasks${suffix}`).then((r) => r.tasks);
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', projectKey] });
      qc.invalidateQueries({ queryKey: ['activity', projectKey] });
    },
  });
}

export type TaskPatch = Omit<Partial<Task>, 'assignee'> & { assignee?: string | null; note?: string };

// `optimistic` is merged into cached board rows immediately (e.g. the populated
// assignee object) while `data` is what the API receives.
export function useUpdateTask(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: TaskPatch; optimistic?: Partial<Task> }) =>
      patch<{ task: Task }>(`/projects/${projectKey}/tasks/${taskId}`, data),
    onMutate: async ({ taskId, data, optimistic }) => {
      await qc.cancelQueries({ queryKey: ['tasks', projectKey] });
      const previous = qc.getQueriesData<Task[]>({ queryKey: ['tasks', projectKey] });
      const { assignee, note, ...rest } = data;
      void note;
      const merged: Partial<Task> = { ...rest, ...(assignee === null ? { assignee: null } : {}), ...optimistic };
      previous.forEach(([key, tasks]) => {
        if (!tasks) return;
        qc.setQueryData(
          key,
          tasks.map((t) => (t.taskId === taskId ? { ...t, ...merged } : t))
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
      qc.invalidateQueries({ queryKey: ['analytics', projectKey] });
      qc.invalidateQueries({ queryKey: ['activity', projectKey] });
      qc.invalidateQueries({ queryKey: ['sprints', projectKey] });
      qc.invalidateQueries({ queryKey: ['versions', projectKey] });
    },
  });
}

export type BulkPatch = Partial<Record<'sprint' | 'version' | 'assignee' | 'status' | 'priority' | 'type' | 'category' | 'techno' | 'area' | 'parent', string | null>>;

export function useBulkUpdateTasks(projectKey: string) {
  const invalidate = useInvalidateProject(projectKey);
  return useMutation({
    mutationFn: (body: { taskIds: string[]; patch: BulkPatch; note?: string }) =>
      post<{ updated: number; unchanged: number; notFound: string[] }>(`/projects/${projectKey}/tasks/bulk`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteTask(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => del<{ ok: true }>(`/projects/${projectKey}/tasks/${taskId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', projectKey] });
      qc.invalidateQueries({ queryKey: ['activity', projectKey] });
    },
  });
}

// Comment mutations answer with the full, populated comment list: write it into the task cache.
function useCommentMutation<V extends { taskId: string }, R extends object>(projectKey: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      const comments = 'comments' in data ? (data.comments as Comment[]) : null;
      if (comments) {
        qc.setQueryData<Task>(['task', projectKey, vars.taskId], (task) => (task ? { ...task, comments } : task));
      }
      qc.invalidateQueries({ queryKey: ['task', projectKey, vars.taskId] });
      qc.invalidateQueries({ queryKey: ['activity', projectKey] });
    },
  });
}

export function useAddComment(projectKey: string) {
  return useCommentMutation(projectKey, ({ taskId, text, parent }: { taskId: string; text: string; parent?: string }) =>
    post<{ comments: Comment[]; commentId: string }>(`/projects/${projectKey}/tasks/${taskId}/comments`, { text, parent })
  );
}

export function useEditComment(projectKey: string) {
  return useCommentMutation(projectKey, ({ taskId, commentId, text }: { taskId: string; commentId: string; text: string }) =>
    patch<{ comments: Comment[] }>(`/projects/${projectKey}/tasks/${taskId}/comments/${commentId}`, { text })
  );
}

export function useReactToComment(projectKey: string) {
  return useCommentMutation(projectKey, ({ taskId, commentId, emoji }: { taskId: string; commentId: string; emoji: string }) =>
    post<{ comments: Comment[]; added: boolean }>(`/projects/${projectKey}/tasks/${taskId}/comments/${commentId}/reactions`, { emoji })
  );
}

export function useDeleteComment(projectKey: string) {
  return useCommentMutation(projectKey, ({ taskId, commentId }: { taskId: string; commentId: string }) =>
    del<{ ok: true; removed: number }>(`/projects/${projectKey}/tasks/${taskId}/comments/${commentId}`)
  );
}

export const REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '😕', '🚀', '👀', '✅', '🔥'];
