'use client';

/**
 * Dependency-free chart primitives (SVG/HTML) following the data-viz spec:
 * thin marks (2px lines, bars <= 24px with a 4px rounded data end), hairline recessive grid, one axis per
 * chart, a legend whenever there are 2+ series, a hover/keyboard tooltip on every chart, and a table view
 * twin so no value is reachable only through colour or a tooltip. Series colours are the fixed
 * `--series-N` tokens in globals.css; text always wears text tokens, never the series colour.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';

// ------------------------------------------------------------------ formatting
const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');

/** Axis-tick style compact numbers in Indian units: 45K, 1.2L, 3Cr. */
export function compact(n: number, money = false): string {
  const a = Math.abs(n);
  const p = money ? '₹' : '';
  const s = n < 0 ? '-' : '';
  if (a >= 1e7) return `${s}${p}${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${s}${p}${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${s}${p}${trim(a / 1e3)}K`;
  return `${s}${p}${trim(a)}`;
}

/** Round the top of an axis to a clean number and return 0..top ticks (about four intervals). */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 0.5, 1] };
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { top, ticks };
}

/** Indices to label on an evenly spaced axis: measured in pixels so labels never touch, on phones or desktops. */
export function pickLabels(n: number, widthPx: number, minGapPx: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const perDay = widthPx / (n - 1);
  const step = Math.max(1, Math.ceil(minGapPx / perDay));
  const idx: number[] = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) {
    // the last date always shows; drop the previous label if it would crowd it
    if ((n - 1 - idx[idx.length - 1]) * perDay < minGapPx && idx.length > 1) idx.pop();
    idx.push(n - 1);
  }
  return idx;
}

export const seriesColor = (i: number) => `var(--series-${(i % 6) + 1})`;
const SURFACE = 'rgb(var(--surface))';
const GRID = 'rgb(var(--slate-200))';
const AXIS = 'rgb(var(--slate-300))';
const MUTED = 'rgb(var(--slate-500))';

// ------------------------------------------------------------------ hooks
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(240, el.clientWidth));
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** One floating tooltip per chart. Content is React nodes built from text - never innerHTML. */
function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; node: ReactNode } | null>(null);
  const show = useCallback((clientX: number, clientY: number, node: ReactNode) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setTip({ x: clientX - r.left, y: clientY - r.top, node });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const width = ref.current?.clientWidth ?? 0;
  const view = tip && (
    <div
      role="status"
      className="pointer-events-none absolute z-20 min-w-[140px] max-w-[260px] rounded-card border border-slate-200 bg-surface px-3 py-2 text-sm shadow-lg"
      style={{ left: tip.x, top: Math.max(tip.y - 12, 0), transform: `translate(${tip.x > width * 0.6 ? 'calc(-100% - 12px)' : '12px'}, -100%)` }}
    >
      {tip.node}
    </div>
  );
  return { ref, show, hide, view };
}

// ------------------------------------------------------------------ card, legend, table view
export function ChartCard({
  title, subtitle, legend, table, children, loading, empty, emptyText, actions, className = '',
}: {
  title: string; subtitle?: string;
  legend?: Array<{ name: string; color: string; kind?: 'line' | 'box' }>;
  table?: { head: string[]; rows: Array<Array<string | number>> };
  children: ReactNode; loading?: boolean; empty?: boolean; emptyText?: string; actions?: ReactNode; className?: string;
}) {
  const { t } = useT();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`card flex flex-col gap-3 ${className}`} aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {table && !empty && (
            <button className="min-h-[32px] rounded-card border border-slate-300 px-2 text-xs font-medium text-slate-600 hover:bg-slate-100" aria-pressed={view === 'table'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
              {view === 'chart' ? t('tableView') : t('chartView')}
            </button>
          )}
        </div>
      </header>

      {/* a legend whenever there are 2+ series; a single series is named by the title */}
      {legend && legend.length > 1 && view === 'chart' && !empty && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.name} className="flex items-center gap-1.5">
              <span aria-hidden style={{ background: l.color }} className={l.kind === 'box' ? 'h-2.5 w-2.5 rounded-sm' : 'h-[2px] w-4 rounded'} />
              {l.name}
            </li>
          ))}
        </ul>
      )}

      {/* refetch keeps the frame: the previous render stays, dimmed */}
      <div className={`transition-opacity ${loading ? 'opacity-50' : ''}`} aria-busy={loading}>
        {empty ? (
          <p className="flex min-h-[120px] items-center justify-center rounded-card bg-slate-50 px-4 text-center text-sm text-slate-500">{emptyText ?? t('noData')}</p>
        ) : view === 'table' && table ? (
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-slate-600">
                <tr>{table.head.map((h, i) => <th key={h + i} scope="col" className={`px-2 py-1 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {table.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => (ci === 0
                    ? <th key={ci} scope="row" className="px-2 py-1 text-left font-normal">{c}</th>
                    : <td key={ci} className="px-2 py-1 text-right tabular-nums">{c}</td>))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : children}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ line chart
export interface LineSeries { key: string; name: string; color: string; values: Array<number | null> }

function segments(values: Array<number | null>): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (v === null) { if (cur.length) out.push(cur); cur = []; } else cur.push([i, v]);
  });
  if (cur.length) out.push(cur);
  return out;
}

/** Multi-series line chart on ONE axis, gaps where there is no data, crosshair + tooltip listing every series. */
export function LineChart({
  labels, series, fmt, axisFmt, xText, tipTitle, height = 220, ariaLabel,
}: {
  labels: string[]; series: LineSeries[]; fmt: (n: number) => string; axisFmt: (n: number) => string;
  xText: (label: string) => string; tipTitle: (label: string) => string; height?: number; ariaLabel: string;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const { ref: tipRef, show, hide, view } = useTip();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const m = { l: 48, r: 16, t: 12, b: 24 };
  const iw = Math.max(10, width - m.l - m.r);
  const ih = height - m.t - m.b;
  const n = labels.length;
  const nums = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const { top, ticks } = niceScale(Math.max(0, ...nums));
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / top) * ih;

  // x labels: as many as fit with >= 72px between neighbours, always ending on the last date
  const xIdx = pickLabels(n, iw, 72);

  const tipFor = useCallback((i: number): ReactNode => (
    <div>
      <div className="mb-1 text-xs text-slate-500">{tipTitle(labels[i])}</div>
      {series.map((s) => s.values[i] !== null && (
        <div key={s.key} className="flex items-center gap-2">
          <span aria-hidden className="h-[2px] w-3 shrink-0 rounded" style={{ background: s.color }} />
          <b className="tabular-nums">{fmt(s.values[i] as number)}</b>
          <span className="truncate text-slate-500">{s.name}</span>
        </div>
      ))}
      {series.every((s) => s.values[i] === null) && <div className="text-slate-500">—</div>}
    </div>
  ), [labels, series, fmt, tipTitle]);

  const at = (i: number, clientX: number, clientY: number) => { setHover(i); show(clientX, clientY, tipFor(i)); };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - r.left - m.l;
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px / iw) * (n - 1))));
    at(i, r.left + x(i), e.clientY);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = Math.max(0, Math.min(n - 1, (hover ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1)));
    const r = svgRef.current!.getBoundingClientRect();
    at(i, r.left + x(i), r.top + m.t + 24);
  };

  const single = series.length === 1;
  return (
    <div ref={(el) => { (wrap as React.MutableRefObject<HTMLDivElement | null>).current = el; (tipRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }} className="relative w-full">
      <svg
        ref={svgRef} width={width} height={height} role="img" aria-label={ariaLabel} tabIndex={0}
        className="block max-w-full outline-none focus-visible:ring-2 focus-visible:ring-brand/40" onKeyDown={onKey}
        onFocus={() => { const i = n - 1; const r = svgRef.current!.getBoundingClientRect(); at(i, r.left + x(i), r.top + m.t + 24); }}
        onBlur={() => { setHover(null); hide(); }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">{axisFmt(t)}</text>
          </g>
        ))}
        {xIdx.map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} fontSize={11} fill={MUTED}>{xText(labels[i])}</text>
        ))}

        {series.map((s) => {
          const segs = segments(s.values);
          return (
            <g key={s.key}>
              {single && segs.map((sg, k) => sg.length > 1 && (
                <path key={`a${k}`} d={`M${x(sg[0][0])},${y(0)} ${sg.map(([i, v]) => `L${x(i)},${y(v)}`).join(' ')} L${x(sg[sg.length - 1][0])},${y(0)} Z`} fill={s.color} opacity={0.1} />
              ))}
              {segs.map((sg, k) => sg.length > 1
                ? <path key={k} d={sg.map(([i, v], j) => `${j ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                : <circle key={k} cx={x(sg[0][0])} cy={y(sg[0][1])} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />)}
            </g>
          );
        })}

        {/* end markers (r 4 + 2px surface ring); a single series also gets its latest value labelled */}
        {series.map((s) => {
          const last = [...s.values.keys()].reverse().find((i) => s.values[i] !== null);
          if (last === undefined) return null;
          const v = s.values[last] as number;
          return (
            <g key={`e${s.key}`}>
              <circle cx={x(last)} cy={y(v)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
              {single && (() => {
                // sit above the marker unless the line arrives from above (then below); a surface halo keeps it legible over any line
                const prev = [...s.values.keys()].slice(0, last).reverse().find((i) => s.values[i] !== null);
                const descending = prev !== undefined && (s.values[prev] as number) > v;
                return (
                  <text
                    x={x(last) - 8} y={descending ? y(v) + 18 : y(v) - 10} textAnchor="end" fontSize={12} fontWeight={600}
                    fill="currentColor" className="text-slate-800" stroke={SURFACE} strokeWidth={4} strokeLinejoin="round" paintOrder="stroke"
                  >
                    {fmt(v)}
                  </text>
                );
              })()}
            </g>
          );
        })}

        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke={AXIS} strokeWidth={1} />
            {series.map((s) => s.values[hover] !== null && <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />)}
          </g>
        )}
        {/* a wide, invisible pointer layer: readers aim at a date, not at a 2px line */}
        <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => { setHover(null); hide(); }} />
      </svg>
      {view}
    </div>
  );
}

// ------------------------------------------------------------------ horizontal bars (magnitude, or diverging around zero)
export interface BarRow { key: string; label: string; value: number | null; text?: string; detail?: string }

/**
 * Horizontal bars, <= 24px thick, rounded 4px at the data end and square at the baseline. The value sits at
 * the bar tip. `diverging` draws from a zero line: series-1 blue above zero, red below.
 */
export function BarList({ rows, fmt, diverging = false, color = 'var(--series-1)', ariaLabel, nullText }: {
  rows: BarRow[]; fmt: (n: number) => string; diverging?: boolean; color?: string; ariaLabel: string; nullText?: string;
}) {
  const { ref, show, hide, view } = useTip();
  const vals = rows.map((r) => r.value).filter((v): v is number => v !== null);
  const min = diverging ? Math.min(0, ...vals) : 0;
  const max = diverging ? Math.max(0, ...vals) : Math.max(0, ...vals);
  const span = max - min || 1;
  // 56px of room at each end so tip labels never clip
  const pos = (v: number) => `calc(56px + (100% - 112px) * ${(v - min) / span})`;
  const zero = pos(0);

  const tipFor = (r: BarRow): ReactNode => (
    <div>
      <div className="mb-0.5 text-xs text-slate-500">{r.label}</div>
      <b className="tabular-nums">{r.value === null ? nullText ?? '—' : fmt(r.value)}</b>
      {r.detail && <div className="text-xs text-slate-500">{r.detail}</div>}
    </div>
  );

  return (
    <div ref={ref} className="relative" role="list" aria-label={ariaLabel}>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const v = r.value;
          const neg = v !== null && v < 0;
          return (
            <li
              key={r.key} role="listitem" tabIndex={0}
              className="group grid grid-cols-[minmax(72px,30%)_1fr] items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              onPointerMove={(e) => show(e.clientX, e.clientY, tipFor(r))}
              onPointerLeave={hide}
              onFocus={(e) => { const b = e.currentTarget.getBoundingClientRect(); show(b.left + b.width / 2, b.top, tipFor(r)); }}
              onBlur={hide}
            >
              <span className="truncate text-sm text-slate-700" title={r.label}>{r.label}</span>
              <div className="relative h-6">
                {diverging && <span aria-hidden className="absolute inset-y-0 w-px" style={{ left: zero, background: AXIS }} />}
                {v !== null && (
                  <>
                    <span
                      className="absolute top-[2px] h-5 transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                      style={{
                        background: neg ? 'var(--diverge-neg)' : color,
                        left: neg ? pos(v) : diverging ? zero : pos(0),
                        width: `calc(${Math.abs(v) / span} * (100% - 112px))`,
                        borderRadius: neg ? '4px 0 0 4px' : '0 4px 4px 0',
                      }}
                    />
                    <span
                      className="absolute top-0 flex h-6 items-center whitespace-nowrap text-xs font-medium tabular-nums text-slate-800"
                      style={neg ? { right: `calc(100% - ${pos(v)} + 6px)` } : { left: `calc(${pos(v)} + 6px)` }}
                    >
                      {r.text ?? fmt(v)}
                    </span>
                  </>
                )}
                {v === null && <span className="absolute left-0 top-0 flex h-6 items-center text-xs text-slate-500">{nullText ?? '—'}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {view}
    </div>
  );
}

// ------------------------------------------------------------------ columns (12 months)
export interface Column { key: string; label: string; value: number; tipTitle: string }

export function Columns({ cols, fmt, axisFmt, color = 'var(--series-1)', height = 210, ariaLabel }: {
  cols: Column[]; fmt: (n: number) => string; axisFmt: (n: number) => string; color?: string; height?: number; ariaLabel: string;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const { ref: tipRef, show, hide, view } = useTip();
  const [active, setActive] = useState<string | null>(null);

  const m = { l: 48, r: 8, t: 20, b: 24 };
  const iw = Math.max(10, width - m.l - m.r);
  const ih = height - m.t - m.b;
  const band = iw / cols.length;
  const bw = Math.min(24, band * 0.6);
  // the axis label is a month name; the year is added on the first column and on every January
  const every = band < 34 ? 2 : 1;
  const { top, ticks } = niceScale(Math.max(0, ...cols.map((c) => c.value)));
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const peak = cols.reduce((p, c, i) => (c.value > cols[p].value ? i : p), 0);

  /** Rounded 4px at the data end (top), square at the baseline. */
  const bar = (cx: number, v: number) => {
    const h = ih - (y(v) - m.t);
    if (h <= 0) return '';
    const r = Math.min(4, h);
    const x0 = cx - bw / 2, x1 = cx + bw / 2, yt = y(v), yb = m.t + ih;
    return `M${x0},${yb} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x1 - r} Q${x1},${yt} ${x1},${yt + r} V${yb} Z`;
  };

  return (
    <div ref={(el) => { (wrap as React.MutableRefObject<HTMLDivElement | null>).current = el; (tipRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block max-w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">{axisFmt(t)}</text>
          </g>
        ))}
        {cols.map((c, i) => {
          const cx = m.l + band * i + band / 2;
          return (
            <g key={c.key}>
              <path d={bar(cx, c.value)} fill={color} opacity={active === c.key ? 0.8 : 1} />
              {i % every === 0 && <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill={MUTED}>{c.label}</text>}
              {/* one label only: the extreme */}
              {i === peak && c.value > 0 && <text x={cx} y={y(c.value) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor" className="text-slate-800">{axisFmt(c.value)}</text>}
              {/* the hit target is the whole month band, far bigger than the mark */}
              <rect
                x={m.l + band * i} y={m.t} width={band} height={ih + 4} fill="transparent" tabIndex={0}
                aria-label={`${c.tipTitle}: ${fmt(c.value)}`}
                className="outline-none focus-visible:stroke-[var(--series-1)]"
                onPointerMove={(e) => { setActive(c.key); show(e.clientX, e.clientY, <div><div className="mb-0.5 text-xs text-slate-500">{c.tipTitle}</div><b className="tabular-nums">{fmt(c.value)}</b></div>); }}
                onPointerLeave={() => { setActive(null); hide(); }}
                onFocus={(e) => { setActive(c.key); const b = e.currentTarget.getBoundingClientRect(); show(b.left + b.width / 2, b.top + 24, <div><div className="mb-0.5 text-xs text-slate-500">{c.tipTitle}</div><b className="tabular-nums">{fmt(c.value)}</b></div>); }}
                onBlur={() => { setActive(null); hide(); }}
              />
            </g>
          );
        })}
      </svg>
      {view}
    </div>
  );
}
