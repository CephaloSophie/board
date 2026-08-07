// Tiny dependency-free inline-SVG charts, theme-aware via currentColor / vars.

export function BarChart({
  data,
  height = 180,
}: {
  data: { label: string; value: number; sub?: number; color?: string }[];
  height?: number;
}) {
  if (!data.length) return <div className="empty">Pas de données.</div>;
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.sub || 0)));
  const w = Math.max(data.length * 46, 200);
  const pad = 24;
  const chartH = height - pad;
  const bw = w / data.length;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${height}`} className="chart-svg" style={{ minWidth: w }}>
        {data.map((d, i) => {
          const h = (d.value / max) * chartH;
          const subH = d.sub ? (d.sub / max) * chartH : 0;
          const x = i * bw + bw * 0.2;
          const bar = bw * 0.6;
          return (
            <g key={i}>
              {d.sub != null && (
                <rect x={x} y={chartH - subH} width={bar} height={subH} rx={3} fill="var(--line-strong)" opacity={0.5} />
              )}
              <rect x={x} y={chartH - h} width={bar} height={h} rx={3} fill={d.color || 'var(--accent)'} />
              <text x={x + bar / 2} y={chartH - h - 4} textAnchor="middle" fontSize="9" fill="var(--soft)" fontFamily="var(--mono)">
                {d.value}
              </text>
              <text x={x + bar / 2} y={height - 6} textAnchor="middle" fontSize="8" fill="var(--mute)">
                {d.label.length > 8 ? d.label.slice(-6) : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Burndown({
  points,
  height = 200,
}: {
  points: { day: number; ideal: number; actual: number | null }[];
  height?: number;
}) {
  if (!points.length) return <div className="empty">Sprint sans dates — burndown indisponible.</div>;
  const w = 480;
  const pad = 28;
  const max = Math.max(1, ...points.map((p) => p.ideal));
  const days = points.length - 1;
  const x = (d: number) => pad + (d / days) * (w - pad * 2);
  const y = (v: number) => pad / 2 + (1 - v / max) * (height - pad);

  const idealPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day)},${y(p.ideal)}`).join(' ');
  const actualPts = points.filter((p) => p.actual !== null);
  const actualPath = actualPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day)},${y(p.actual as number)}`).join(' ');

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${height}`} className="chart-svg" style={{ minWidth: 360 }}>
        {/* axes */}
        <line x1={pad} y1={height - pad / 2} x2={w - pad} y2={height - pad / 2} stroke="var(--line)" />
        <line x1={pad} y1={pad / 2} x2={pad} y2={height - pad / 2} stroke="var(--line)" />
        {/* ideal (dashed) */}
        <path d={idealPath} fill="none" stroke="var(--mute)" strokeWidth={1.5} strokeDasharray="5 4" />
        {/* actual (solid, area) */}
        {actualPts.length > 0 && (
          <>
            <path d={actualPath} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
            {actualPts.map((p, i) => (
              <circle key={i} cx={x(p.day)} cy={y(p.actual as number)} r={2.5} fill="var(--accent)" />
            ))}
          </>
        )}
        <text x={pad} y={height - 4} fontSize="9" fill="var(--mute)">
          J0
        </text>
        <text x={w - pad} y={height - 4} textAnchor="end" fontSize="9" fill="var(--mute)">
          J{days}
        </text>
      </svg>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--accent)' }} /> Restant réel
        </span>
        <span>
          <i style={{ background: 'var(--mute)' }} /> Idéal
        </span>
      </div>
    </div>
  );
}
