import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from './client';
import type { PublicUser } from '../types';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => get<{ users: PublicUser[] }>('/users').then((r) => r.users),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { username: string; displayName: string; password: string; role: string; email?: string; color?: string }) =>
      post<{ user: PublicUser }>('/users', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PublicUser> & { password?: string } }) =>
      patch<{ user: PublicUser }>(`/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
