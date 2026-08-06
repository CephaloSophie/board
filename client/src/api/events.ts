import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from './client';
import type { ProjectEvent } from '../types';

export function useEvents(projectKey: string | undefined, params?: { sprint?: string; type?: string }) {
  const qs = new URLSearchParams();
  if (params?.sprint) qs.set('sprint', params.sprint);
  if (params?.type) qs.set('type', params.type);
  const suffix = qs.toString() ? `?${qs}` : '';
  return useQuery({
    queryKey: ['events', projectKey, params],
    queryFn: () => get<{ events: ProjectEvent[] }>(`/projects/${projectKey}/events${suffix}`).then((r) => r.events),
    enabled: !!projectKey,
  });
}

export function useEvent(projectKey: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ['event', projectKey, id],
    queryFn: () => get<{ event: ProjectEvent }>(`/projects/${projectKey}/events/${id}`).then((r) => r.event),
    enabled: !!projectKey && !!id,
  });
}

export function useCreateEvent(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ProjectEvent>) => post<{ event: ProjectEvent }>(`/projects/${projectKey}/events`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', projectKey] }),
  });
}

export function useUpdateEvent(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProjectEvent> }) =>
      patch<{ event: ProjectEvent }>(`/projects/${projectKey}/events/${id}`, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['events', projectKey] });
      qc.invalidateQueries({ queryKey: ['event', projectKey, vars.id] });
    },
  });
}

export function useDeleteEvent(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/projects/${projectKey}/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', projectKey] }),
  });
}

export function useLinkTaskToEvent(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, taskId, note }: { eventId: string; taskId: string; note?: string }) =>
      post<{ event: ProjectEvent }>(`/projects/${projectKey}/events/${eventId}/tasks`, { taskId, note }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['events', projectKey] });
      qc.invalidateQueries({ queryKey: ['event', projectKey, vars.eventId] });
    },
  });
}

export function useUnlinkTaskFromEvent(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, linkId }: { eventId: string; linkId: string }) =>
      del<{ event: ProjectEvent }>(`/projects/${projectKey}/events/${eventId}/tasks/${linkId}`),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['events', projectKey] });
      qc.invalidateQueries({ queryKey: ['event', projectKey, vars.eventId] });
    },
  });
}
