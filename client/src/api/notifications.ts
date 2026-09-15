import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get, post } from './client';
import type { AppNotification } from '../types';

type Inbox = { notifications: AppNotification[]; unread: number };
const KEY = ['notifications'];

// Loaded once when the application starts (no websocket, no polling, no refetch
// on focus). A page reload or the « Actualiser » button fetches them again.
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => get<Inbox>('/notifications?limit=60'),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
  });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const markLocal = (ids: string[] | 'all') =>
    qc.setQueryData<Inbox>(KEY, (inbox) => {
      if (!inbox) return inbox;
      const changed = inbox.notifications.filter((n) => !n.read && (ids === 'all' || ids.includes(n._id))).length;
      return {
        notifications: inbox.notifications.map((n) => (ids === 'all' || ids.includes(n._id) ? { ...n, read: true } : n)),
        unread: ids === 'all' ? 0 : Math.max(0, inbox.unread - changed),
      };
    });
  return {
    markRead: useMutation({
      mutationFn: (ids: string[] | 'all') => post<{ unread: number }>('/notifications/read', ids === 'all' ? { all: true } : { ids }),
      onMutate: markLocal,
    }),
    clearRead: useMutation({
      mutationFn: () => api<{ deleted: number }>('/notifications/read', { method: 'DELETE' }),
      onSuccess: () => qc.setQueryData<Inbox>(KEY, (inbox) => inbox && { ...inbox, notifications: inbox.notifications.filter((n) => !n.read) }),
    }),
  };
}
