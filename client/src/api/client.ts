const TOKEN_KEY = 'board.token';
export const AUTH_EXPIRED_EVENT = 'board:auth-expired';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = typeof body?.code === 'string' ? body.code : undefined;
    this.body = body;
  }
}

export function errorMessage(e: unknown, fallback = 'Une erreur est survenue.'): string {
  return e instanceof Error ? e.message : fallback;
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
    if (res.status === 401 && token) {
      setToken(null);
      // Lets AuthContext drop the user and route back to the login screen.
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(body?.error || `Erreur HTTP ${res.status}`, res.status, body || undefined);
  }
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined });
export const patch = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
