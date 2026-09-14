import { useEffect, useRef, useState } from 'react';

// Dependency-free SVG/HTML charts sized to their container (ResizeObserver).

export interface Datum {
  key: string;
  label: string;
  color?: string;
  value: number;
  split?: Datum[];
}

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
const M = { l: 34, r: 10, t: 10, b: 28 };

function YGrid({ max, width, height }: { max: number; width: number; height: number }) {
  return (
    <>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = M.t + (height - M.t - M.b) * (1 - f);
        return (
          <g key={f}>
            <line x1={M.l} x2={width - M.r} y1={y} y2={y} className="chart-grid" />
            <text x={M.l - 5} y={y + 3} textAnchor="end" className="chart-axis">
              {fmtNum(Math.round(max * f * 10) / 10)}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function VerticalBars({ data }: { data: Datum[] }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const W = Math.max(size.width, 120);
  const H = Math.max(size.height, 90);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotH = H - M.t - M.b;
  const slot = (W - M.l - M.r) / Math.max(data.length, 1);
  return (
    <div ref={ref} className="chart">
      <svg width={W} height={H} role="img">
        <YGrid max={max} width={W} height={H} />
        {data.map((d, i) => {
          const x = M.l + i * slot + slot * 0.18;
          const bw = slot * 0.64;
          let acc = 0;
          const segments = d.split?.length ? d.split : [d];
          return (
            <g key={d.key}>
              {segments.map((s) => {
                const h = (plotH * s.value) / max;
                const y = M.t + plotH - (plotH * acc) / max - h;
                acc += s.value;
                return (
                  <rect key={s.key} x={x} y={y} width={bw} height={Math.max(h, 0)} rx={3} fill={s.color || 'var(--accent)'}>
                    <title>{`${d.label}${d.split?.length ? ` · ${s.label}` : ''} : ${fmtNum(s.value)}`}</title>
                  </rect>
                );
              })}
              <text x={x + bw / 2} y={H - M.b + 15} textAnchor="middle" className="chart-axis">
                {truncate(d.label, Math.max(3, Math.floor(slot / 6.5)))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function HorizontalBars({ data, format = fmtNum }: { data: Datum[]; format?: (n: number) => string }) {
  const max = Math.max(0, ...data.map((d) => d.value)) || 1;
  return (
    <div className="hbars">
      {data.map((d) => (
        <div className="hbar" key={d.key}>
          <div className="hbar__label" title={d.label}>
            {d.label}
          </div>
          <div className="hbar__track">
            {(d.split?.length ? d.split : [d]).map((s) => (
              <span key={s.key} style={{ width: `${(s.value / max) * 100}%`, background: s.color || 'var(--accent)' }} title={`${s.label} : ${format(s.value)}`} />
            ))}
          </div>
          <div className="hbar__value">{format(d.value)}</div>
        </div>
      ))}
    </div>
  );
}

function ringPath(a0: number, a1: number, R: number, r: number) {
  const p = (a: number, rad: number) => [50 + rad * Math.cos(a), 50 + rad * Math.sin(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(a0, R);
  const [x1, y1] = p(a1, R);
  const [x2, y2] = p(a1, r);
  const [x3, y3] = p(a0, r);
  return `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
}

export function Donut({ data, centerLabel = 'total' }: { data: Datum[]; centerLabel?: string }) {
  const sum = data.reduce((a, d) => a + d.value, 0);
  let angle = -Math.PI / 2;
  return (
    <div className="donut">
      <svg viewBox="0 0 100 100" role="img">
        {sum === 0 && <circle cx={50} cy={50} r={33} className="donut-empty" />}
        {data.map((d) => {
          const span = sum ? (d.value / sum) * Math.PI * 2 : 0;
          if (!span) return null;
          const a0 = angle;
          angle += span;
          const full = span >= Math.PI * 2 - 1e-6;
          return (
            <g key={d.key}>
              {full ? (
                <>
                  <path d={ringPath(a0, a0 + Math.PI, 42, 26)} fill={d.color} />
                  <path d={ringPath(a0 + Math.PI, a0 + Math.PI * 2 - 1e-4, 42, 26)} fill={d.color} />
                </>
              ) : (
                <path d={ringPath(a0, a0 + span - 0.01, 42, 26)} fill={d.color}>
                  <title>{`${d.label} : ${fmtNum(d.value)}`}</title>
                </path>
              )}
            </g>
          );
        })}
        <text x={50} y={50} textAnchor="middle" className="donut-total">
          {fmtNum(Math.round(sum * 10) / 10)}
        </text>
        <text x={50} y={61} textAnchor="middle" className="donut-sub">
          {centerLabel}
        </text>
      </svg>
      <ul className="legend">
        {data.map((d) => (
          <li key={d.key}>
            <span className="dot" style={{ background: d.color }} />
            <span className="legend__label">{d.label}</span>
            <b>{fmtNum(d.value)}</b>
            <span className="text-muted">{sum ? Math.round((d.value / sum) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Series {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

export function LineChart({ labels, series }: { labels: string[]; series: Series[] }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const W = Math.max(size.width, 160);
  const H = Math.max(size.height, 100);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'))));
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const x = (i: number) => M.l + (labels.length <= 1 ? plotW / 2 : (i * plotW) / (labels.length - 1));
  const y = (v: number) => M.t + plotH * (1 - v / max);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 60))));
  return (
    <div className="chart-with-legend">
      <div ref={ref} className="chart">
        <svg width={W} height={H} role="img">
          <YGrid max={max} width={W} height={H} />
          {labels.map((l, i) =>
            i % every === 0 || i === labels.length - 1 ? (
              <text key={`${l}-${i}`} x={x(i)} y={H - M.b + 15} textAnchor="middle" className="chart-axis">
                {l}
              </text>
            ) : null
          )}
          {series.map((s) => {
            let d = '';
            s.values.forEach((v, i) => {
              if (typeof v !== 'number') return;
              d += `${d ? 'L' : 'M'}${x(i)} ${y(v)} `;
            });
            return (
              <g key={s.key}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} />
                {!s.dashed &&
                  s.values.map((v, i) =>
                    typeof v === 'number' ? (
                      <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={s.color}>
                        <title>{`${labels[i]} · ${s.label} : ${fmtNum(v)}`}</title>
                      </circle>
                    ) : null
                  )}
              </g>
            );
          })}
        </svg>
      </div>
      <Legend items={series.map((s) => ({ key: s.key, label: s.label, color: s.color, dashed: s.dashed }))} />
    </div>
  );
}

export function GroupedBars({
  labels,
  series,
  average,
}: {
  labels: string[];
  series: { key: string; label: string; color: string; values: (number | null)[] }[];
  average?: number | null;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const W = Math.max(size.width, 160);
  const H = Math.max(size.height, 100);
  const max = niceMax(Math.max(0, average || 0, ...series.flatMap((s) => s.values.map((v) => v || 0))));
  const plotH = H - M.t - M.b;
  const slot = (W - M.l - M.r) / Math.max(labels.length, 1);
  const bw = (slot * 0.7) / Math.max(series.length, 1);
  return (
    <div className="chart-with-legend">
      <div ref={ref} className="chart">
        <svg width={W} height={H} role="img">
          <YGrid max={max} width={W} height={H} />
          {labels.map((label, i) => (
            <g key={`${label}-${i}`}>
              {series.map((s, k) => {
                const v = s.values[i] || 0;
                const h = (plotH * v) / max;
                return (
                  <rect key={s.key} x={M.l + i * slot + slot * 0.15 + k * bw} y={M.t + plotH - h} width={bw - 2} height={h} rx={2} fill={s.color}>
                    <title>{`${label} · ${s.label} : ${fmtNum(s.values[i])}`}</title>
                  </rect>
                );
              })}
              <text x={M.l + i * slot + slot / 2} y={H - M.b + 15} textAnchor="middle" className="chart-axis">
                {truncate(label, Math.max(4, Math.floor(slot / 6.5)))}
              </text>
            </g>
          ))}
          {typeof average === 'number' && (
            <line x1={M.l} x2={W - M.r} y1={M.t + plotH * (1 - average / max)} y2={M.t + plotH * (1 - average / max)} stroke="var(--gold)" strokeDasharray="5 4" strokeWidth={1.5}>
              <title>{`Moyenne : ${fmtNum(average)}`}</title>
            </line>
          )}
        </svg>
      </div>
      <Legend
        items={[
          ...series.map((s) => ({ key: s.key, label: s.label, color: s.color })),
          ...(typeof average === 'number' ? [{ key: 'avg', label: `Moyenne ${fmtNum(average)}`, color: 'var(--gold)', dashed: true }] : []),
        ]}
      />
    </div>
  );
}

function Legend({ items }: { items: { key: string; label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.key}>
          <span className={`legend-swatch${it.dashed ? ' dashed' : ''}`} style={{ background: it.dashed ? 'transparent' : it.color, borderColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
