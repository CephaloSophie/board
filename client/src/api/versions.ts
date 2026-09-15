import { useMutation, useQuery } from '@tanstack/react-query';
import { get, patch, post } from './client';
import { useInvalidateProject } from './invalidate';
import type { VersionRow } from '../types';

export interface VersionInput {
  key?: string;
  label?: string;
  startDate?: string;
  releaseDate?: string;
  description?: string;
  archived?: boolean;
}

export function useVersions(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['versions', projectKey],
    queryFn: () => get<{ versions: VersionRow[]; currentVersion: string }>(`/projects/${projectKey}/versions`),
    enabled: !!projectKey,
  });
}

export function useVersionMutations(projectKey: string) {
  const invalidate = useInvalidateProject(projectKey);
  const base = `/projects/${projectKey}/versions`;
  const k = (key: string) => `${base}/${encodeURIComponent(key)}`;
  const opts = { onSuccess: invalidate };
  return {
    create: useMutation({ mutationFn: (data: VersionInput) => post<{ version: VersionRow }>(base, data), ...opts }),
    update: useMutation({
      mutationFn: ({ key, data }: { key: string; data: VersionInput }) => patch<{ version: VersionRow }>(k(key), data),
      ...opts,
    }),
    release: useMutation({
      mutationFn: ({ key, data }: { key: string; data: { releasedAt?: string; moveOpenTo?: string; setCurrent?: string } }) =>
        post<{ version: VersionRow; moved: number }>(`${k(key)}/release`, data),
      ...opts,
    }),
    unrelease: useMutation({ mutationFn: (key: string) => post<{ version: VersionRow }>(`${k(key)}/unrelease`), ...opts }),
  };
}
