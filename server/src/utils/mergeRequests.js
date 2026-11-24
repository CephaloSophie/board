const { httpError } = require('./httpError');

// Merge / pull requests linked to a task (pasted by the developer).
const MR_STATES = ['draft', 'open', 'merged', 'closed'];
const MR_PROVIDERS = ['gitlab', 'github', 'bitbucket', 'azure', 'gitea', 'other'];
const MAX_MERGE_REQUESTS = 30;
const MAX_URL_LENGTH = 2000;

// Ordered: the first pattern matching the URL path wins.
const PATTERNS = [
  { provider: 'gitlab', re: /^\/(.+?)\/-\/merge_requests\/(\d+)/, ref: (n) => `!${n}` },
  { provider: 'azure', re: /^\/(.+?)\/_git\/([^/]+)\/pullrequest\/(\d+)/i, ref: (n) => `!${n}`, repo: (m) => `${m[1]}/${m[2]}`, num: (m) => m[3] },
  { provider: 'bitbucket', re: /^\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i, ref: (n) => `#${n}`, repo: (m) => `${m[1]}/${m[2]}`, num: (m) => m[3] },
  { provider: 'bitbucket', re: /^\/([^/]+\/[^/]+)\/pull-requests\/(\d+)/, ref: (n) => `#${n}` },
  { provider: 'github', re: /^\/([^/]+\/[^/]+)\/pull\/(\d+)/, ref: (n) => `#${n}` },
  { provider: 'gitea', re: /^\/([^/]+\/[^/]+)\/pulls\/(\d+)/, ref: (n) => `#${n}` },
];

/**
 * Validates a merge request URL (http/https only) and extracts what can be
 * shown without calling the forge: provider, repository path and number.
 *   https://gitlab.example.com/team/app/-/merge_requests/42 → gitlab, team/app, !42
 *   https://github.com/acme/api/pull/7                      → github, acme/api, #7
 */
function parseMergeRequestUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw httpError(400, 'MR_URL_REQUIRED', 'Le lien de la merge request est requis.');
  if (value.length > MAX_URL_LENGTH) throw httpError(400, 'MR_URL_INVALID', 'Lien trop long.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw httpError(400, 'MR_URL_INVALID', 'Lien invalide : collez l’adresse complète (https://…).');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw httpError(400, 'MR_URL_INVALID', 'Seuls les liens http(s) sont acceptés.');
  }
  const host = url.hostname.toLowerCase();
  const path = decodeURIComponent(url.pathname);
  for (const p of PATTERNS) {
    const m = p.re.exec(path);
    if (!m) continue;
    const number = p.num ? p.num(m) : m[2];
    let provider = p.provider;
    // Self-hosted forges keep their own host name: only trust the path shape,
    // except for the ambiguous "/owner/repo/pull/N" shape outside github hosts.
    if (provider === 'github' && !host.includes('github')) provider = 'other';
    if (provider === 'bitbucket' && host.includes('github')) provider = 'other';
    return { url: url.toString(), provider, repo: p.repo ? p.repo(m) : m[1], ref: p.ref(number), host };
  }
  return { url: url.toString(), provider: 'other', repo: '', ref: '', host };
}

function cleanState(state, fallback = 'open') {
  if (state === undefined || state === null || state === '') return fallback;
  if (!MR_STATES.includes(state)) {
    throw httpError(400, 'MR_STATE_INVALID', 'Statut de merge request inconnu.', { allowed: MR_STATES });
  }
  return state;
}

function cleanTitle(title) {
  return String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Builds a sub-document payload; `input` is a URL string or `{ url, title?, state? }`. */
function mergeRequestFromInput(input, user) {
  const item = input && typeof input === 'object' ? input : { url: input };
  const parsed = parseMergeRequestUrl(item.url);
  return {
    url: parsed.url,
    provider: parsed.provider,
    repo: parsed.repo || undefined,
    ref: parsed.ref || undefined,
    title: cleanTitle(item.title) || undefined,
    state: cleanState(item.state),
    addedBy: user?._id || null,
  };
}

/** Short human label used in history, activity and notifications ("team/app !42"). */
function mergeRequestLabel(mr) {
  const head = [mr.repo, mr.ref].filter(Boolean).join(' ');
  const label = mr.title ? `${head ? `${head} · ` : ''}${mr.title}` : head || mr.url;
  return label.length > 160 ? `${label.slice(0, 159)}…` : label;
}

function findMergeRequest(task, id) {
  const mr = task.mergeRequests.id(id);
  if (!mr) throw httpError(404, 'MR_NOT_FOUND', 'Merge request introuvable.');
  return mr;
}

module.exports = {
  MR_STATES,
  MR_PROVIDERS,
  MAX_MERGE_REQUESTS,
  parseMergeRequestUrl,
  mergeRequestFromInput,
  mergeRequestLabel,
  cleanState,
  cleanTitle,
  findMergeRequest,
};
