import type { MergeRequestProvider, MergeRequestState } from '../types';

// Client mirror of server/src/utils/mergeRequests.js (display + early validation only).

export const MR_STATE_META: Record<MergeRequestState, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: 'var(--mute)' },
  open: { label: 'Ouverte', color: 'var(--info)' },
  merged: { label: 'Fusionnée', color: 'var(--violet)' },
  closed: { label: 'Fermée', color: 'var(--danger)' },
};

export const MR_STATES = Object.keys(MR_STATE_META) as MergeRequestState[];

export const MR_PROVIDER_LABELS: Record<MergeRequestProvider, string> = {
  gitlab: 'GitLab',
  github: 'GitHub',
  bitbucket: 'Bitbucket',
  azure: 'Azure DevOps',
  gitea: 'Gitea / Forgejo',
  other: 'Lien',
};

const PATTERNS: { provider: MergeRequestProvider; re: RegExp; ref: (n: string) => string; repo?: (m: RegExpExecArray) => string; num?: (m: RegExpExecArray) => string }[] = [
  { provider: 'gitlab', re: /^\/(.+?)\/-\/merge_requests\/(\d+)/, ref: (n) => `!${n}` },
  { provider: 'azure', re: /^\/(.+?)\/_git\/([^/]+)\/pullrequest\/(\d+)/i, ref: (n) => `!${n}`, repo: (m) => `${m[1]}/${m[2]}`, num: (m) => m[3] },
  { provider: 'bitbucket', re: /^\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i, ref: (n) => `#${n}`, repo: (m) => `${m[1]}/${m[2]}`, num: (m) => m[3] },
  { provider: 'bitbucket', re: /^\/([^/]+\/[^/]+)\/pull-requests\/(\d+)/, ref: (n) => `#${n}` },
  { provider: 'github', re: /^\/([^/]+\/[^/]+)\/pull\/(\d+)/, ref: (n) => `#${n}` },
  { provider: 'gitea', re: /^\/([^/]+\/[^/]+)\/pulls\/(\d+)/, ref: (n) => `#${n}` },
];

export interface ParsedMergeRequest {
  url: string;
  provider: MergeRequestProvider;
  repo: string;
  ref: string;
}

/** null when the text is not an absolute http(s) URL. */
export function parseMergeRequestUrl(raw: string): ParsedMergeRequest | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  for (const p of PATTERNS) {
    const m = p.re.exec(path);
    if (!m) continue;
    let provider = p.provider;
    if (provider === 'github' && !host.includes('github')) provider = 'other';
    if (provider === 'bitbucket' && host.includes('github')) provider = 'other';
    return { url: url.toString(), provider, repo: p.repo ? p.repo(m) : m[1], ref: p.ref(p.num ? p.num(m) : m[2]) };
  }
  return { url: url.toString(), provider: 'other', repo: '', ref: '' };
}

export function mergeRequestLabel(mr: { repo?: string; ref?: string; title?: string; url: string }): string {
  const head = [mr.repo, mr.ref].filter(Boolean).join(' ');
  if (mr.title) return head ? `${head} · ${mr.title}` : mr.title;
  return head || mr.url.replace(/^https?:\/\//, '');
}
