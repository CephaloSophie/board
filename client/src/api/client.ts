const TOKEN_KEY = 'board.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(body?.error || `Erreur HTTP ${res.status}`, res.status);
  }
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined });
export const patch = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
