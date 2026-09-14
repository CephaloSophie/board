const crypto = require('crypto');

const stripAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizeName = (s) => stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
const slug = (s) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

// Key-order independent JSON (hashes of mapped values).
function stableStringify(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// Comparison-friendly text: markup, bullets and spacing removed (ADF vs wiki exports).
const normalizeText = (s) =>
  String(s || '')
    .replace(/^\s*(?:-|\d+\.)\s+/gm, '')
    .replace(/[*_`~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function importError(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

module.exports = { stripAccents, normalizeName, slug, sha1, stableStringify, normalizeText, importError };
