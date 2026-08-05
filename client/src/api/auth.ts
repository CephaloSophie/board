import { post, get } from './client';
import type { PublicUser } from '../types';

export function login(username: string, password: string) {
  return post<{ token: string; user: PublicUser }>('/auth/login', { username, password });
}

export function fetchMe() {
  return get<{ user: PublicUser }>('/auth/me');
}
