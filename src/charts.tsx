// Hand-built SVG charts (no chart library): small, fast, and fully themeable through CSS variables.
// Encoding rules used everywhere:
//   ACTUAL = solid ink line / filled marks    PLANNED = indigo, outlined    PROJECTED = dashed sky line + hatched fill
import { useEffect, useMemo, useRef, useState } from 'react';
import { compact, fmtDate, money, monthLabel } from './lib';
import type { FPoint, Forecast } from './data';

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    setW(Math.round(ref.current.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceStep = (range: number, n: number) => {
  const raw = range / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};
function ticks(min: number, max: number, n = 4) {
  const step = niceStep(max - min || 1, n);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v));
  return out;
}
const linePath = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

// ─────────────────────────────────────────────────────────────
// Cash-flow forecast
// ─────────────────────────────────────────────────────────────
export type Scenario = 'both' | 'conservative' | 'optimistic';
export function ForecastChart({ f, horizon, scenario = 'both', height = 260, today }: { f: Forecast; horizon: number; scenario?: Scenario; height?: number; today: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const showActual = true;
  const histDays = horizon <= 30 ? 14 : 30;
  const actual = f.actual.slice(-histDays - 1);
  const cons = f.conservative.slice(0, horizon + 1);
  const opt = f.optimistic.slice(0, horizon + 1);

  const m = { l: 46, r: 12, t: 14, b: 26 };
  const W = Math.max(w, 280), H = height;
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const nPast = actual.length - 1;
  const total = nPast + horizon; // x index: 0..total, today at nPast
  const x = (i: number) => m.l + (i / total) * iw;

  const vals = [
    ...actual.map((p) => p.balance),
    ...(scenario !== 'optimistic' ? cons.map((p) => p.balance) : []),
    ...(scenario !== 'conservative' ? opt.map((p) => p.balance) : []),
    0,
  ];
  const tk = ticks(Math.min(...vals) / 100, Math.max(...vals) / 100, 4).map((t) => t * 100);
  const yMin = tk[0], yMax = tk[tk.length - 1];
  const y = (v: number) => m.t + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;

  const aPts: [number, number][] = actual.map((p, i) => [x(i), y(p.balance)]);
  const cPts: [number, number][] = cons.map((p, i) => [x(nPast + i), y(p.balance)]);
  const oPts: [number, number][] = opt.map((p, i) => [x(nPast + i), y(p.balance)]);

  // shortfall area: where the conservative line is below zero
  const y0 = y(0);
  const negPath = useMemo(() => {
    if (scenario === 'optimistic') return '';
    let d = '';
    let open = false;
    cons.forEach((p, i) => {
      const px = x(nPast + i);
      if (p.balance < 0) {
        if (!open) { d += `M${px.toFixed(1)},${y0.toFixed(1)}`; open = true; }
        d += `L${px.toFixed(1)},${y(p.balance).toFixed(1)}`;
      } else if (open) { d += `L${px.toFixed(1)},${y0.toFixed(1)}Z`; open = false; }
    });
    if (open) d += `L${x(nPast + cons.length - 1).toFixed(1)},${y0.toFixed(1)}Z`;
    return d;
  }, [cons, scenario, w, height, horizon]); // eslint-disable-line react-hooks/exhaustive-deps

  const low = scenario === 'optimistic' ? null : cons.reduce((mn, p) => (p.balance < mn.balance ? p : mn), cons[0]);
  const lowIdx = low ? cons.indexOf(low) : 0;

  const xTicks = useMemo(() => {
    const narrow = W < 480;
    const step = horizon <= 30 ? (narrow ? 14 : 7) : horizon <= 90 ? (narrow ? 30 : 14) : (narrow ? 120 : 60);
    const out: { i: number; label: string }[] = [];
    for (let k = 0; k <= horizon; k += step) {
      const pt = cons[k]; if (!pt) continue;
      out.push({ i: nPast + k, label: k === 0 ? 'Today' : horizon > 120 ? monthLabel(pt.date.slice(0, 7)) : fmtDate(pt.date) });
    }
    return out;
  }, [horizon, W, nPast, cons]);

  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round((px / r.width) * total);
    setHover(Math.max(0, Math.min(total, i)));
  };
  const hi = hover;
  const hPoint = hi == null ? null : hi <= nPast ? { kind: 'actual' as const, p: actual[hi] } : { kind: 'proj' as const, c: cons[hi - nPast], o: opt[hi - nPast] };
  const tipX = hi == null ? 0 : Math.min(Math.max(x(hi), 90), W - 90);

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {w > 0 && (
        <>
          <svg width={W} height={H} role="img" aria-label="Cash-flow forecast: recorded balance to today, then projected balances for the conservative and optimistic income scenarios">
            <defs>
              <pattern id="hatch-neg" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--neg-soft)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--neg)" strokeWidth="1.4" opacity="0.55" />
              </pattern>
              <linearGradient id="a-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--actual)" stopOpacity="0.14" /><stop offset="1" stopColor="var(--actual)" stopOpacity="0" /></linearGradient>
            </defs>
            {/* projected zone */}
            <rect x={x(nPast)} y={m.t} width={x(total) - x(nPast)} height={ih} fill="var(--proj-soft)" opacity="0.55" rx="6" />
            {tk.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--ink-3)' : 'var(--grid)'} strokeWidth={t === 0 ? 1.2 : 1} strokeDasharray={t === 0 ? '0' : '0'} />
                <text x={m.l - 8} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
              </g>
            ))}
            {xTicks.map((t) => (<text key={t.i} x={x(t.i)} y={H - 6} textAnchor={t.i === nPast ? 'middle' : 'middle'}>{t.label}</text>))}
            {negPath && <path d={negPath} fill="url(#hatch-neg)" />}
            {/* actual */}
            {showActual && <>
              <path d={`${linePath(aPts)}L${x(nPast)},${y(yMin)}L${x(0)},${y(yMin)}Z`} fill="url(#a-fill)" />
              <path d={linePath(aPts)} fill="none" stroke="var(--actual)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            </>}
            {/* projected */}
            {scenario !== 'conservative' && <path d={linePath(oPts)} fill="none" stroke="var(--proj-2)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />}
            {scenario !== 'optimistic' && <path d={linePath(cPts)} fill="none" stroke="var(--proj)" strokeWidth="2.25" strokeDasharray="7 5" strokeLinecap="round" />}
            {/* today marker */}
            <line x1={x(nPast)} x2={x(nPast)} y1={m.t} y2={H - m.b} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(nPast)} cy={y(actual[nPast].balance)} r="5" fill="var(--surface)" stroke="var(--actual)" strokeWidth="2.5" />
            {/* lowest point */}
            {low && low.balance < 0 && (
              <g>
                <circle cx={x(nPast + lowIdx)} cy={y(low.balance)} r="4.5" fill="var(--surface)" stroke="var(--neg)" strokeWidth="2.25" />
              </g>
            )}
            {hi != null && <line x1={x(hi)} x2={x(hi)} y1={m.t} y2={H - m.b} stroke="var(--ink)" strokeOpacity="0.35" />}
            {hi != null && hPoint?.kind === 'actual' && <circle cx={x(hi)} cy={y(hPoint.p.balance)} r="4" fill="var(--actual)" stroke="var(--surface)" strokeWidth="2" />}
            {hi != null && hPoint?.kind === 'proj' && <>
              {scenario !== 'conservative' && <circle cx={x(hi)} cy={y(hPoint.o.balance)} r="4" fill="var(--proj-2)" stroke="var(--surface)" strokeWidth="2" />}
              {scenario !== 'optimistic' && <circle cx={x(hi)} cy={y(hPoint.c.balance)} r="4" fill="var(--proj)" stroke="var(--surface)" strokeWidth="2" />}
            </>}
            <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(null); }} style={{ cursor: 'crosshair' }} />
          </svg>
          {hPoint && hi != null && (
            <div className="tip" style={{ left: tipX, top: 6 }}>
              <div className="t-date">{hPoint.kind === 'actual' ? fmtDate(hPoint.p.date, 'long') : fmtDate(hPoint.c.date, 'long')}</div>
              {hPoint.kind === 'actual' ? (
                <div className="t-row"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><i className="dot actual" />Recorded balance</span><b className="num">{money(hPoint.p.balance)}</b></div>
              ) : (
                <>
                  {scenario !== 'optimistic' && <div className="t-row"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><i className="dot proj" />Conservative</span><b className="num" style={{ color: hPoint.c.balance < 0 ? 'var(--neg)' : undefined }}>{money(hPoint.c.balance)}</b></div>}
                  {scenario !== 'conservative' && <div className="t-row"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><i className="dot proj" style={{ borderStyle: 'dotted' }} />Optimistic</span><b className="num">{money(hPoint.o.balance)}</b></div>}
                  <div className="xs muted" style={{ marginTop: 4 }}>Projected — not in your accounts</div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ForecastLegend({ scenario }: { scenario: Scenario }) {
  return (
    <div className="legend">
      <span><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" stroke="var(--actual)" strokeWidth="2.5" strokeLinecap="round" /></svg>Recorded (actual)</span>
      {scenario !== 'optimistic' && <span><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" stroke="var(--proj)" strokeWidth="2.5" strokeDasharray="6 4" strokeLinecap="round" /></svg>Conservative · guaranteed income only</span>}
      {scenario !== 'conservative' && <span><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" stroke="var(--proj-2)" strokeWidth="2.5" strokeDasharray="2 4" strokeLinecap="round" /></svg>Optimistic · plus anticipated</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sparkline
// ─────────────────────────────────────────────────────────────
export function Spark({ values, width = 96, height = 32, color = 'var(--actual)', area = true }: { values: number[]; width?: number; height?: number; color?: string; area?: boolean }) {
  const mn = Math.min(...values), mx = Math.max(...values);
  const pts: [number, number][] = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - mn) / (mx - mn || 1)) * (height - 6)]);
  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      {area && <path d={`${linePath(pts)}L${width - 2},${height}L2,${height}Z`} fill={color} opacity="0.1" />}
      <path d={linePath(pts)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.5" fill={color} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Area line (net worth)
// ─────────────────────────────────────────────────────────────
export function AreaLine({ series, height = 200, label }: { series: { key: string; value: number }[]; height?: number; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const W = Math.max(w, 280), m = { l: 50, r: 10, t: 12, b: 24 };
  const iw = W - m.l - m.r, ih = height - m.t - m.b;
  const vals = series.map((s) => s.value);
  const tk = ticks(Math.min(...vals) / 100, Math.max(...vals) / 100, 3);
  const lo = tk[0] * 100, hiV = tk[tk.length - 1] * 100;
  const x = (i: number) => m.l + (i / (series.length - 1)) * iw;
  const y = (v: number) => m.t + (1 - (v - lo) / (hiV - lo || 1)) * ih;
  const pts: [number, number][] = series.map((s, i) => [x(i), y(s.value)]);
  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    setHi(Math.max(0, Math.min(series.length - 1, Math.round(((e.clientX - r.left) / r.width) * (series.length - 1)))));
  };
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {w > 0 && <>
        <svg width={W} height={height} role="img" aria-label={label}>
          <defs><linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--actual)" stopOpacity="0.16" /><stop offset="1" stopColor="var(--actual)" stopOpacity="0" /></linearGradient></defs>
          {tk.map((t) => (<g key={t}><line x1={m.l} x2={W - m.r} y1={y(t * 100)} y2={y(t * 100)} stroke="var(--grid)" /><text x={m.l - 8} y={y(t * 100) + 4} textAnchor="end">{compact(t * 100)}</text></g>))}
          {series.map((s, i) => (i % 2 === 0 || series.length < 8) && <text key={s.key} x={x(i)} y={height - 6} textAnchor="middle">{monthLabel(s.key)}</text>)}
          <path d={`${linePath(pts)}L${x(series.length - 1)},${m.t + ih}L${x(0)},${m.t + ih}Z`} fill="url(#nw-fill)" />
          <path d={linePath(pts)} fill="none" stroke="var(--actual)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4.5" fill="var(--surface)" stroke="var(--actual)" strokeWidth="2.5" />
          {hi != null && <><line x1={x(hi)} x2={x(hi)} y1={m.t} y2={m.t + ih} stroke="var(--ink)" strokeOpacity="0.3" /><circle cx={x(hi)} cy={y(series[hi].value)} r="4" fill="var(--actual)" stroke="var(--surface)" strokeWidth="2" /></>}
          <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHi(null); }} />
        </svg>
        {hi != null && <div className="tip" style={{ left: Math.min(Math.max(x(hi), 80), W - 80), top: 0 }}><div className="t-date">{monthLabel(series[hi].key, true)}</div><div className="t-row"><span>Net worth</span><b className="num">{money(series[hi].value)}</b></div></div>}
      </>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Income vs expenses (grouped bars)
// ─────────────────────────────────────────────────────────────
export function FlowBars({ months, height = 220 }: { months: { key: string; income: number; expense: number; imported?: boolean; partial?: boolean }[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const W = Math.max(w, 280), m = { l: 44, r: 6, t: 12, b: 26 };
  const iw = W - m.l - m.r, ih = height - m.t - m.b;
  const mx = Math.max(...months.flatMap((x) => [x.income, x.expense]));
  const tk = ticks(0, mx / 100, 4);
  const top = tk[tk.length - 1] * 100;
  const y = (v: number) => m.t + (1 - v / top) * ih;
  const band = iw / months.length;
  const bw = Math.min(22, band * 0.28);
  const r = 4;
  const bar = (cx: number, v: number, fill: string, hatch: boolean) => {
    if (v <= 0) return null;
    const h = y(0) - y(v);
    const rr = Math.min(r, h / 2);
    const d = `M${cx - bw / 2},${y(0)}V${y(v) + rr}Q${cx - bw / 2},${y(v)} ${cx - bw / 2 + rr},${y(v)}H${cx + bw / 2 - rr}Q${cx + bw / 2},${y(v)} ${cx + bw / 2},${y(v) + rr}V${y(0)}Z`;
    return <path d={d} fill={hatch ? 'none' : fill} stroke={hatch ? fill : 'none'} strokeWidth={hatch ? 1.6 : 0} strokeDasharray={hatch ? '4 3' : undefined} opacity={hatch ? 1 : 1} />;
  };
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {w > 0 && <>
        <svg width={W} height={height} role="img" aria-label="Income versus expenses by month">
          {tk.map((t) => (<g key={t}><line x1={m.l} x2={W - m.r} y1={y(t * 100)} y2={y(t * 100)} stroke="var(--grid)" /><text x={m.l - 8} y={y(t * 100) + 4} textAnchor="end">{compact(t * 100)}</text></g>))}
          {months.map((mo, i) => {
            const cx = m.l + band * (i + 0.5);
            return (
              <g key={mo.key} opacity={hi != null && hi !== i ? 0.45 : 1}>
                {bar(cx - bw / 2 - 1.5, mo.income, 'var(--pos)', !!mo.partial)}
                {bar(cx + bw / 2 + 1.5, mo.expense, 'var(--ink-3)', !!mo.partial)}
                <text x={cx} y={height - 6} textAnchor="middle">{monthLabel(mo.key)}{mo.partial ? '*' : ''}</text>
                <rect x={cx - band / 2} y={m.t} width={band} height={ih + 14} fill="transparent" onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHi(null); }} />
              </g>
            );
          })}
        </svg>
        {hi != null && (() => {
          const mo = months[hi]; const cx = m.l + band * (hi + 0.5);
          return (
            <div className="tip" style={{ left: Math.min(Math.max(cx, 90), W - 90), top: 0 }}>
              <div className="t-date">{monthLabel(mo.key, true)}{mo.partial ? ' · so far' : ''}{mo.imported ? ' · imported summary' : ''}</div>
              <div className="t-row"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><i className="sw" style={{ background: 'var(--pos)' }} />Income</span><b className="num">{money(mo.income, { cents: false })}</b></div>
              <div className="t-row"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><i className="sw" style={{ background: 'var(--ink-3)' }} />Spending</span><b className="num">{money(mo.expense, { cents: false })}</b></div>
              <div className="t-row"><span>Net</span><b className="num" style={{ color: mo.income - mo.expense < 0 ? 'var(--neg)' : 'var(--pos)' }}>{money(mo.income - mo.expense, { sign: true, cents: false })}</b></div>
            </div>
          );
        })()}
      </>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ring (budget health)
// ─────────────────────────────────────────────────────────────
export function Ring({ pct, size = 84, stroke = 9, color = 'var(--planned)', children }: { pct: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${circ * Math.min(1, pct)} ${circ}`} style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="c">{children}</div>
    </div>
  );
}

// Re-exported type helper for callers
export type { FPoint };

// ─────────────────────────────────────────────────────────────
// Credit score history: one line per bureau + scoring model, on a real date axis.
// Identity is never colour alone: a legend names every line, line ends are labelled, and a second/third model of the same bureau
// uses a dashed/dotted stroke with a different marker. Lines are never joined across bureaus or models.
// ─────────────────────────────────────────────────────────────
import type { Series, CreditScore } from './credit';
import { BUREAUS } from './credit';
import { diffDays, parse } from './lib';

export const BUREAU_COLOR: Record<string, string> = { Experian: 'var(--c-exp)', Equifax: 'var(--c-eq)', TransUnion: 'var(--c-tu)' };
const DASH = [undefined, '7 4', '2 4', '10 3 2 3'];
const dashFor = (all: Series[], s: Series) => DASH[Math.min(all.filter((x) => x.bureau === s.bureau).findIndex((x) => x.key === s.key), DASH.length - 1)];
export function SeriesSwatch({ s, all }: { s: Series; all: Series[] }) {
  return <svg width="22" height="10" aria-hidden="true"><line x1="1" x2="21" y1="5" y2="5" stroke={BUREAU_COLOR[s.bureau]} strokeWidth="2.4" strokeDasharray={dashFor(all, s)} strokeLinecap="round" /></svg>;
}
export function ScoreChart({ series, height = 260 }: { series: Series[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<{ s: Series; i: number } | null>(null);
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return null;
  const dates = pts.map((p) => p.observedOn).sort();
  const d0 = dates[0], d1 = dates[dates.length - 1];
  const span = Math.max(1, diffDays(d1, d0));
  const W = Math.max(w, 280), m = { l: 38, r: 16, t: 14, b: 26 };
  const iw = W - m.l - m.r, ih = height - m.t - m.b;
  const lo0 = Math.min(...pts.map((p) => p.score)), hi0 = Math.max(...pts.map((p) => p.score));
  const pad = Math.max(10, Math.round((hi0 - lo0) * 0.2));
  const tk = ticks(Math.max(250, lo0 - pad), Math.min(900, hi0 + pad), 4);
  const yMin = tk[0], yMax = tk[tk.length - 1];
  const x = (d: string) => (span === 1 && d0 === d1 ? m.l + iw / 2 : m.l + (diffDays(d, d0) / span) * iw);
  const y = (v: number) => m.t + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;
  const xticks = (() => {
    if (d0 === d1) return [d0];
    const n = Math.min(5, Math.max(2, Math.floor(iw / 90)));
    return Array.from({ length: n }, (_, k) => { const d = new Date(parse(d0).getTime() + (k / (n - 1)) * (parse(d1).getTime() - parse(d0).getTime())); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  })();
  const nearest = (cx: number, cy: number) => {
    let best: { s: Series; i: number } | null = null, bd = 1e9;
    for (const s of series) s.points.forEach((p, i) => { const dd = Math.hypot(x(p.observedOn) - cx, (y(p.score) - cy) * 0.6); if (dd < bd) { bd = dd; best = { s, i }; } });
    return bd < 60 ? best : null;
  };
  const onMove = (e: React.PointerEvent) => { const r = (e.currentTarget as SVGRectElement).getBoundingClientRect(); setHi(nearest(e.clientX - r.left + m.l, e.clientY - r.top + m.t)); };
  const label = `Credit score history: ${series.map((s) => `${s.bureau} ${s.model}, latest ${s.points[s.points.length - 1].score}`).join('; ')}`;
  const tip = hi && hi.s.points[hi.i];
  const tipPrev = hi && hi.i > 0 ? hi.s.points[hi.i - 1] : null;
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {w > 0 && <>
        <svg width={W} height={height} role="img" aria-label={label}>
          {tk.map((t) => (<g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={m.l - 8} y={y(t) + 4} textAnchor="end">{t}</text></g>))}
          {xticks.map((d, k) => <text key={d} x={x(d)} y={height - 6} textAnchor={xticks.length === 1 ? 'middle' : k === 0 ? 'start' : k === xticks.length - 1 ? 'end' : 'middle'}>{fmtDate(d)}{d.slice(0, 4) !== (new Date().getFullYear() + '') ? ` ’${d.slice(2, 4)}` : ''}</text>)}
          {series.map((s) => {
            const path = linePath(s.points.map((p) => [x(p.observedOn), y(p.score)] as [number, number]));
            return <g key={s.key}>
              {s.points.length > 1 && <path d={path} fill="none" stroke={BUREAU_COLOR[s.bureau]} strokeWidth="2" strokeDasharray={dashFor(series, s)} strokeLinejoin="round" strokeLinecap="round" />}
              {s.points.map((p, i) => <circle key={p.id} cx={x(p.observedOn)} cy={y(p.score)} r={hi && hi.s.key === s.key && hi.i === i ? 5.5 : 4} fill={BUREAU_COLOR[s.bureau]} stroke="var(--surface)" strokeWidth="2" />)}
            </g>;
          })}
          <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHi(null); }} />
        </svg>
        {hi && tip && <div className="tip" style={{ left: Math.min(Math.max(x(tip.observedOn), 90), W - 90), top: 0 }}>
          <div className="t-date">{fmtDate(tip.observedOn, 'long')}</div>
          <div className="t-row"><span>{hi.s.bureau} · {hi.s.model}</span><b className="num">{tip.score}</b></div>
          <div className="t-row"><span>Change</span><b className="num">{tipPrev ? `${tip.score - tipPrev.score > 0 ? '+' : tip.score - tipPrev.score < 0 ? '−' : ''}${Math.abs(tip.score - tipPrev.score)}` : 'First entry'}</b></div>
        </div>}
      </>}
    </div>
  );
}
export type { CreditScore };
void BUREAUS;
