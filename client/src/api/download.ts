import { ApiError, getToken } from './client';

// Authenticated downloads: the JWT lives in an Authorization header, so a plain
// link cannot be used — fetch the file, then hand the browser a blob URL.
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error || `Erreur HTTP ${res.status}`, res.status, body || undefined);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = decodeURIComponent(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
