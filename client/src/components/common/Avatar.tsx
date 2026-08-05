function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export default function Avatar({
  name,
  color,
  size = 'md',
}: {
  name: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = size === 'sm' ? 'avatar sm' : size === 'lg' ? 'avatar lg' : 'avatar';
  return (
    <span className={cls} style={{ background: color || '#6b78ea' }} title={name}>
      {initials(name || '?')}
    </span>
  );
}
