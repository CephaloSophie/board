import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, patch, post } from './client';
import type { TaskFilters, UserRef } from '../types';

export type WidgetType =
  | 'kpi'
  | 'breakdown'
  | 'matrix'
  | 'sprintBurndown'
  | 'velocity'
  | 'workload'
  | 'taskList'
  | 'recentActivity'
  | 'sprintSummary'
  | 'note';

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetSource {
  mode: 'global' | 'filter' | 'inline' | 'none';
  filterId: string | null;
  filters: Partial<TaskFilters>;
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  layout: WidgetLayout;
  source: WidgetSource;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
}

export interface Dashboard {
  _id: string;
  name: string;
  description: string;
  visibility: 'private' | 'shared';
  owner: UserRef;
  globalFilters: Partial<TaskFilters>;
  widgets: Widget[];
  widgetCount?: number;
  revision: number;
  isOwner: boolean;
  canEdit: boolean;
  isStarred: boolean;
  isDefault: boolean;
  updatedAt: string;
}

export type DashboardInput = Partial<Pick<Dashboard, 'name' | 'description' | 'visibility' | 'globalFilters' | 'widgets'>> & {
  template?: string;
  isDefault?: boolean;
  isStarred?: boolean;
};

export function useDashboards(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['dashboards', projectKey],
    queryFn: () => get<{ dashboards: Dashboard[]; templates: string[] }>(`/projects/${projectKey}/dashboards`),
    enabled: !!projectKey,
  });
}

export function useDashboard(projectKey: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', projectKey, id],
    queryFn: () => get<{ dashboard: Dashboard }>(`/projects/${projectKey}/dashboards/${id}`).then((r) => r.dashboard),
    enabled: !!projectKey && !!id,
    retry: false,
  });
}

export function useDashboardMutations(projectKey: string) {
  const qc = useQueryClient();
  const base = `/projects/${projectKey}/dashboards`;
  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: ['dashboards', projectKey] });
    qc.invalidateQueries({ queryKey: ['dashboard', projectKey] });
  };
  const put = <T,>(path: string, data: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(data) });
  return {
    create: useMutation({ mutationFn: (data: DashboardInput) => post<{ dashboard: Dashboard }>(base, data), onSuccess }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: DashboardInput & { revision: number } }) => patch<{ dashboard: Dashboard }>(`${base}/${id}`, data),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: string) => del<{ ok: true }>(`${base}/${id}`), onSuccess }),
    duplicate: useMutation({ mutationFn: ({ id, name }: { id: string; name?: string }) => post<{ dashboard: Dashboard }>(`${base}/${id}/duplicate`, { name }), onSuccess }),
    star: useMutation({ mutationFn: ({ id, starred }: { id: string; starred: boolean }) => put(`${base}/${id}/star`, { starred }), onSuccess }),
    setDefault: useMutation({ mutationFn: ({ id, isDefault }: { id: string; isDefault: boolean }) => put(`${base}/${id}/default`, { isDefault }), onSuccess }),
  };
}

// Widget data. Keys live under ['analytics', projectKey] so task mutations refresh them.
export function useAnalytics<T>(projectKey: string, endpoint: string, body: unknown, method: 'GET' | 'POST' = 'POST', enabled = true) {
  return useQuery({
    queryKey: ['analytics', projectKey, endpoint, body],
    queryFn: () =>
      method === 'GET' ? get<T>(`/projects/${projectKey}/analytics/${endpoint}`) : post<T>(`/projects/${projectKey}/analytics/${endpoint}`, body),
    staleTime: 30_000,
    retry: false,
    enabled,
  });
}
