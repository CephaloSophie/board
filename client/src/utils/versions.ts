// "10.2.0" < "10.10.0" (mirrors server utils/versions.js).
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    String(v)
      .replace(/^v/i, '')
      .split(/[.-]/)
      .map((p) => (Number.isFinite(+p) ? +p : -1));
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return String(a).localeCompare(String(b));
}

export function slugKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
