'use client';
/**
 * Line chart of two series over time (received vs resolved), drawn in SVG.
 * - 2px lines, recessive hairline grid, one y-axis with clean integer ticks
 * - a crosshair snaps to the nearest column; the tooltip lists both series
 * - keyboard: focus the chart and use ← / → ; the table view shows every value
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import Icon from '@/components/Icon';
import { useI18n } from '@/i18n';
import { formatBucket } from '@/lib/client/format';

export interface TrendRow { bucket: string; [series: string]: number | string }
export interface TrendSeries { key: string; label: string; color: string }

const PLOT_HEIGHT = 220;
const MARGIN = { top: 14, right: 16, bottom: 30, left: 40 };

function niceStep(max: number): number {
  if (max <= 5) return 1;
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * power;
}

/** A smooth line through the points that never overshoots (monotone cubic), so a count never dips below 0. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return pts.length ? `M${pts[0]![0]},${pts[0]![1]}` : '';
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i]![0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i]![1]) / (dx[i] || 1));
  const tan = pts.map((_, i) => (i === 0 ? m[0]! : i === n - 1 ? m[n - 2]! : m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
    const a = tan[i]! / m[i]!, b = tan[i + 1]! / m[i]!, h = a * a + b * b;
    if (h > 9) { const s = 3 / Math.sqrt(h); tan[i] = s * a * m[i]!; tan[i + 1] = s * b * m[i]!; }
  }
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!, h = (x1 - x0) / 3;
    d += ` C${x0 + h},${y0 + tan[i]! * h} ${x1 - h},${y1 - tan[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

function useWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return undefined;
    const el = ref.current;
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export default function TrendChart({ rows, unit, series, title }: { rows: TrendRow[]; unit: 'day' | 'month'; series: TrendSeries[]; title: string }) {
  const { t, lang } = useI18n();
  const outerRef = useRef<HTMLDivElement>(null); // always mounted: measures the width
  const plotRef = useRef<HTMLDivElement>(null);
  const width = useWidth(outerRef);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const gid = `tc${tableId.replace(/[^a-zA-Z0-9_-]/g, '')}`; // safe inside url(#…)

  const height = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;
  const plotW = width - MARGIN.left - MARGIN.right;
  const n = rows.length;
  const value = (r: TrendRow, k: string): number => Number(r[k] ?? 0) || 0;
  const maxValue = Math.max(0, ...rows.flatMap((r) => series.map((s) => value(r, s.key))));
  const step = niceStep(maxValue);
  const yMax = Math.max(step, Math.ceil(maxValue / step) * step);
  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let v = 0; v <= yMax + 1e-9; v += step) list.push(v);
    return list;
  }, [yMax, step]);

  const x = (i: number): number => MARGIN.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number): number => MARGIN.top + PLOT_HEIGHT - (v / yMax) * PLOT_HEIGHT;

  const labelEvery = unit === 'month' ? (width < 520 ? 2 : 1) : n <= 7 ? 1 : width < 520 ? 7 : 5;
  const showLabel = (i: number): boolean => (n - 1 - i) % labelEvery === 0;

  function indexFromPointer(clientX: number): number {
    const rect = plotRef.current!.getBoundingClientRect();
    const px = clientX - rect.left - MARGIN.left;
    if (n <= 1) return 0;
    return Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1))));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!n) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActive((a) => (a === null ? n - 1 : Math.min(n - 1, a + 1)));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive((a) => (a === null ? n - 1 : Math.max(0, a - 1)));
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  }

  const activeRow = active !== null ? rows[active] ?? null : null;
  const tooltipLeft = active !== null ? Math.min(Math.max(x(active) + 12, 8), width - 190) : 0;
  const flip = active !== null && x(active) + 200 > width;

  return (
    <div className="trend-chart" ref={outerRef}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <div className="legend" style={{ margin: 0 }}>
          {series.map((s) => <span key={s.key}><i className="line-key" style={{ background: s.color }} />{s.label}</span>)}
        </div>
        <button type="button" className="btn btn-sm btn-ghost" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable(!showTable)}>
          <Icon name={showTable ? 'chart' : 'table'} size={16} />{showTable ? t('dashboard.showChart') : t('dashboard.showTable')}
        </button>
      </div>

      {!showTable && (
        <div
          ref={plotRef}
          className="trend-plot"
          role="img"
          aria-label={`${title}. ${t('dashboard.chartKeyboard')}`}
          tabIndex={0}
          onPointerMove={(e) => setActive(indexFromPointer(e.clientX))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => (a === null ? n - 1 : a))}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
          style={{ height }}
        >
          <svg width={width} height={height} aria-hidden="true">
            {ticks.map((v) => (
              <g key={v}>
                <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis-line' : 'grid-line'} />
                <text x={MARGIN.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="tick">{v}</text>
              </g>
            ))}
            {rows.map((r, i) => (showLabel(i) ? (
              <text key={r.bucket} x={x(i)} y={height - 8} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} className="tick">
                {formatBucket(r.bucket, unit, lang, { withWeekday: unit === 'day' && n <= 7 && width >= 520 })}
              </text>
            ) : null))}
            {active !== null && <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + PLOT_HEIGHT} className="crosshair" />}
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`${gid}-g${i}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={i === 0 ? 0.16 : 0.08} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {series.map((s, i) => {
              const line = smoothPath(rows.map((r, j) => [x(j), y(value(r, s.key))]));
              const base = MARGIN.top + PLOT_HEIGHT;
              return (
                <g key={s.key}>
                  {n > 1 && <path d={`${line} L${x(n - 1)},${base} L${x(0)},${base} Z`} fill={`url(#${gid}-g${i})`} stroke="none" />}
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}
            {active !== null && series.map((s) => (
              <circle key={s.key} cx={x(active)} cy={y(value(rows[active]!, s.key))} r={5} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </svg>
          {activeRow && (
            <div className="chart-tooltip" style={flip ? { right: width - x(active!) + 12, top: 8 } : { left: tooltipLeft, top: 8 }}>
              <div className="tt-title">{formatBucket(activeRow.bucket, unit, lang, { withWeekday: unit === 'day', withYear: true })}</div>
              {series.map((s) => (
                <div className="tt-row" key={s.key}>
                  <i className="line-key" style={{ background: s.color }} />
                  <strong>{value(activeRow, s.key)}</strong>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showTable && (
        <div className="table-wrap" id={tableId}>
          <table className="table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr><th scope="col">{unit === 'month' ? t('dashboard.month') : t('dashboard.day')}</th>{series.map((s) => <th scope="col" key={s.key} className="num">{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bucket}>
                  <th scope="row" style={{ fontWeight: 400 }}>{formatBucket(r.bucket, unit, lang, { withWeekday: unit === 'day', withYear: true })}</th>
                  {series.map((s) => <td key={s.key} className="num">{value(r, s.key)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
