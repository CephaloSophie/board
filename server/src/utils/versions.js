// Semantic-ish version comparison ("10.2.0" < "10.10.0"); non-numeric parts
// sort first, ties fall back to string order.
function compareVersions(a, b) {
  const parts = (v) =>
    String(v)
      .replace(/^v/i, '')
      .split(/[.\-]/)
      .map((p) => (Number.isFinite(+p) ? +p : -1));
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return String(a).localeCompare(String(b));
}

module.exports = { compareVersions };
