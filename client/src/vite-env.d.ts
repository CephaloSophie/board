/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_BASE?: string;
  readonly VITE_PORT?: string;
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
