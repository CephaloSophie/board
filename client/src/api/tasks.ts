import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, put, del } from './client';
import { useInvalidateProject } from './invalidate';
import type { Comment, CriteriaProgress, Criterion, MergeRequest, MergeRequestState, SubtaskStats, SubtaskTree, Task, TaskFilters } from '../types';

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
      return get<{ tasks: Task[]; subtaskStats?: Record<string, SubtaskStats> }>(`/projects/${projectKey}/tasks${suffix}`).then((r) =>
        r.subtaskStats ? r.tasks.map((t) => (r.subtaskStats![t.taskId] ? { ...t, subtaskStats: r.subtaskStats![t.taskId] } : t)) : r.tasks
      );
    },
    enabled: !!projectKey,
  });
}

// Lightweight search used by task pickers (parent, sub-task attachment).
export function useTaskSearch(projectKey: string | undefined, search: string, enabled = true) {
  return useQuery({
    queryKey: ['task-search', projectKey, search],
    queryFn: () => {
      const params = new URLSearchParams({ fields: 'summary', limit: '20', sort: 'updatedAt:desc' });
      if (search.trim()) params.set('search', search.trim());
      return get<{ tasks: Task[] }>(`/projects/${projectKey}/tasks?${params}`).then((r) => r.tasks);
    },
    enabled: !!projectKey && enabled,
    staleTime: 15_000,
  });
}

export function useSubtasks(projectKey: string | undefined, taskId: string | undefined) {
  return useQuery({
    queryKey: ['subtasks', projectKey, taskId],
    queryFn: () => get<SubtaskTree>(`/projects/${projectKey}/tasks/${taskId}/subtasks`),
    enabled: !!projectKey && !!taskId,
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
    mutationFn: (data: TaskCreate) => post<{ task: Task }>(`/projects/${projectKey}/tasks`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', projectKey] });
      qc.invalidateQueries({ queryKey: ['subtasks', projectKey] });
      qc.invalidateQueries({ queryKey: ['task', projectKey] });
      qc.invalidateQueries({ queryKey: ['activity', projectKey] });
      qc.invalidateQueries({ queryKey: ['project-stats', projectKey] });
    },
  });
}

export type TaskCreate = Omit<Partial<Task>, 'assignee' | 'criteria' | 'mergeRequests'> & {
  assignee?: string | null;
  criteria?: { text: string; done?: boolean }[];
  mergeRequests?: { url: string; title?: string; state?: MergeRequestState }[];
};

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
      qc.invalidateQueries({ queryKey: ['subtasks', projectKey] });
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
      qc.invalidateQueries({ queryKey: ['subtasks', projectKey] });
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

export type CommentPatch = { text?: string; pinned?: boolean; resolved?: boolean };

export function useEditComment(projectKey: string) {
  return useCommentMutation(projectKey, ({ taskId, commentId, ...data }: { taskId: string; commentId: string } & CommentPatch) =>
    patch<{ comments: Comment[] }>(`/projects/${projectKey}/tasks/${taskId}/comments/${commentId}`, data)
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

// ---------- Acceptance criteria ----------
// Every criteria mutation answers with the whole populated list: write it into the task cache.

type CriteriaResponse = { criteria: Criterion[]; progress: CriteriaProgress; createdIds?: string[]; commentId?: string };

function useCriteriaMutation<V extends { taskId: string }>(projectKey: string, fn: (v: V) => Promise<CriteriaResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      qc.setQueryData<Task>(['task', projectKey, vars.taskId], (task) => (task ? { ...task, criteria: data.criteria, acceptance: data.criteria.map((c) => c.text) } : task));
      qc.setQueriesData<Task[]>({ queryKey: ['tasks', projectKey] }, (rows) =>
        rows?.map((t) => (t.taskId === vars.taskId ? { ...t, criteria: data.criteria.map((c) => ({ ...c, comments: [] })) } : t))
      );
      qc.invalidateQueries({ queryKey: ['task', projectKey, vars.taskId] });
      qc.invalidateQueries({ queryKey: ['activity', projectKey] });
    },
  });
}

const criteriaPath = (projectKey: string, taskId: string) => `/projects/${projectKey}/tasks/${taskId}/criteria`;

export function useCriteriaActions(projectKey: string) {
  const qc = useQueryClient();
  const add = useCriteriaMutation(projectKey, ({ taskId, items, position }: { taskId: string; items: { text: string; done?: boolean }[]; position?: 'start' | 'end' }) =>
    post<CriteriaResponse>(criteriaPath(projectKey, taskId), { items, position })
  );
  const update = useCriteriaMutation(projectKey, ({ taskId, criterionId, ...data }: { taskId: string; criterionId: string; text?: string; done?: boolean }) =>
    patch<CriteriaResponse>(`${criteriaPath(projectKey, taskId)}/${criterionId}`, data)
  );
  const remove = useCriteriaMutation(projectKey, ({ taskId, criterionId }: { taskId: string; criterionId: string }) =>
    del<CriteriaResponse>(`${criteriaPath(projectKey, taskId)}/${criterionId}`)
  );
  const reorder = useMutation({
    mutationFn: ({ taskId, ids }: { taskId: string; ids: string[] }) => put<CriteriaResponse>(`${criteriaPath(projectKey, taskId)}/order`, { ids }),
    // Optimistic: the dropped order shows at once, the server answer confirms it.
    onMutate: async ({ taskId, ids }) => {
      await qc.cancelQueries({ queryKey: ['task', projectKey, taskId] });
      const previous = qc.getQueryData<Task>(['task', projectKey, taskId]);
      if (previous?.criteria) {
        const byId = new Map(previous.criteria.map((c) => [c._id, c]));
        const ordered = ids.map((id) => byId.get(id)).filter((c): c is Criterion => !!c);
        qc.setQueryData<Task>(['task', projectKey, taskId], { ...previous, criteria: [...ordered, ...previous.criteria.filter((c) => !ids.includes(c._id))] });
      }
      return { previous };
    },
    onError: (_e, vars, ctx) => ctx?.previous && qc.setQueryData(['task', projectKey, vars.taskId], ctx.previous),
    onSuccess: (data, vars) => {
      qc.setQueryData<Task>(['task', projectKey, vars.taskId], (task) => (task ? { ...task, criteria: data.criteria } : task));
      qc.invalidateQueries({ queryKey: ['activity', projectKey] });
    },
  });
  const addComment = useCriteriaMutation(projectKey, ({ taskId, criterionId, text }: { taskId: string; criterionId: string; text: string }) =>
    post<CriteriaResponse>(`${criteriaPath(projectKey, taskId)}/${criterionId}/comments`, { text })
  );
  const editComment = useCriteriaMutation(projectKey, ({ taskId, criterionId, commentId, text }: { taskId: string; criterionId: string; commentId: string; text: string }) =>
    patch<CriteriaResponse>(`${criteriaPath(projectKey, taskId)}/${criterionId}/comments/${commentId}`, { text })
  );
  const removeComment = useCriteriaMutation(projectKey, ({ taskId, criterionId, commentId }: { taskId: string; criterionId: string; commentId: string }) =>
    del<CriteriaResponse>(`${criteriaPath(projectKey, taskId)}/${criterionId}/comments/${commentId}`)
  );
  return { add, update, remove, reorder, addComment, editComment, removeComment };
}

// ---------- Merge requests ----------

type MergeRequestsResponse = { mergeRequests: MergeRequest[]; mergeRequestId?: string };

export function useMergeRequestActions(projectKey: string) {
  const qc = useQueryClient();
  const path = (taskId: string) => `/projects/${projectKey}/tasks/${taskId}/merge-requests`;
  const onSuccess = (data: MergeRequestsResponse, vars: { taskId: string }) => {
    qc.setQueryData<Task>(['task', projectKey, vars.taskId], (task) => (task ? { ...task, mergeRequests: data.mergeRequests } : task));
    qc.setQueriesData<Task[]>({ queryKey: ['tasks', projectKey] }, (rows) =>
      rows?.map((t) => (t.taskId === vars.taskId ? { ...t, mergeRequests: data.mergeRequests } : t))
    );
    qc.invalidateQueries({ queryKey: ['task', projectKey, vars.taskId] });
    qc.invalidateQueries({ queryKey: ['activity', projectKey] });
  };
  const add = useMutation({
    mutationFn: ({ taskId, ...data }: { taskId: string; url: string; title?: string; state?: MergeRequestState }) => post<MergeRequestsResponse>(path(taskId), data),
    onSuccess,
  });
  const update = useMutation({
    mutationFn: ({ taskId, mrId, ...data }: { taskId: string; mrId: string; url?: string; title?: string; state?: MergeRequestState }) =>
      patch<MergeRequestsResponse>(`${path(taskId)}/${mrId}`, data),
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: ({ taskId, mrId }: { taskId: string; mrId: string }) => del<MergeRequestsResponse>(`${path(taskId)}/${mrId}`),
    onSuccess,
  });
  return { add, update, remove };
}
