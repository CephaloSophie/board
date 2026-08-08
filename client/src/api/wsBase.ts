// Base origin for WebSocket connections (Planning Poker + Retrospective).
//
// By default we use the page's own origin — which is correct when the app is
// served by the API server itself (single origin), the recommended production
// setup. When the client is served from a *separate* origin (e.g. the Vite
// server on :7001 proxying to the API on :7002), Vite's WebSocket proxy is
// unreliable and Chrome reports "Invalid frame header". In that case set
// VITE_WS_BASE to the API's ws(s):// origin so the browser connects to it
// directly and bypasses the proxy, e.g. VITE_WS_BASE=ws://217.160.186.250:7002
export function wsBase(): string {
  const configured = import.meta.env.VITE_WS_BASE as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}
