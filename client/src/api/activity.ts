import { useInfiniteQuery } from '@tanstack/react-query';
import { get } from './client';
import type { ActivityEntry } from '../types';

export interface ActivityQuery {
  user?: string[];
  scope?: string[];
  field?: string[];
  action?: string[];
  sprint?: string[];
  version?: string[];
  taskId?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
}

function toParams(query: ActivityQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params;
}

// Project audit log, newest first, paginated with an opaque cursor.
export function useActivity(projectKey: string | undefined, query: ActivityQuery, opts: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ['activity', projectKey, query],
    queryFn: ({ pageParam }) => {
      const params = toParams(query);
      if (pageParam) params.set('cursor', pageParam);
      return get<{ entries: ActivityEntry[]; nextCursor: string | null }>(`/projects/${projectKey}/activity?${params}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled: !!projectKey && opts.enabled !== false,
  });
}
