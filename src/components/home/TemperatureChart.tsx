import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import axios from 'axios';
import { fmt } from './cards';

/** GET /api/climate/chart/:did */
interface ChartData {
    from: number;
    to: number;
    points: { ts: number; temperature: number; humidity: number | null }[];
    outdoor: { ts: number; temperature: number }[];
    setpoint: { from: number; to: number; target: number }[] | null;
    nights: { from: number; to: number }[];
}

type XY = [number, number];

const HOUR = 3600_000;
const PAD = { left: 34, right: 14, top: 14 };
const OUT_H = 46; // bande « dehors »
const OUT_GAP = 16;
const AXIS_H = 20;

/** Courbe lissée qui ne dépasse jamais les mesures (cubique monotone, Fritsch–Carlson). */
function smoothPath(pts: XY[]): string {
    const n = pts.length;
    if (n < 2) return '';
    const dx: number[] = [];
    const m: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        dx.push(pts[i + 1][0] - pts[i][0] || 1e-6);
        m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
    }
    const t: number[] = [m[0]];
    for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
    t.push(m[n - 2]);
    for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) {
            t[i] = 0;
            t[i + 1] = 0;
            continue;
        }
        const a = t[i] / m[i];
        const b = t[i + 1] / m[i];
        const s = a * a + b * b;
        if (s > 9) {
            const k = 3 / Math.sqrt(s);
            t[i] = k * a * m[i];
            t[i + 1] = k * b * m[i];
        }
    }
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i] / 3;
        d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
}

/** Valeur interpolée à l'instant ts (null hors des mesures). */
function valueAt(series: { ts: number; temperature: number }[], ts: number): number | null {
    if (!series.length || ts < series[0].ts || ts > series[series.length - 1].ts) return null;
    const i = series.findIndex((p) => p.ts >= ts);
    if (i <= 0) return series[0].temperature;
    const a = series[i - 1];
    const b = series[i];
    return a.temperature + ((b.temperature - a.temperature) * (ts - a.ts)) / Math.max(b.ts - a.ts, 1);
}

const hourLabel = (ts: number) => `${new Date(ts).getHours()} h`;
const timeLabel = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};
const signed = (x: number) => (x > 0.05 ? '+' : x < -0.05 ? '−' : '') + fmt(Math.abs(x));

/** Les dernières 24 h d'un thermomètre : la pièce, la consigne, le dehors et les nuits. */
export function TemperatureChart({ did, name }: { did: string; name: string }) {
    const [data, setData] = useState<ChartData | null>(null);
    const [failed, setFailed] = useState(false);
    const [hover, setHover] = useState<number | null>(null); // instant pointé
    const boxRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 360, h: 220 });

    useEffect(() => {
        const load = () => axios.get<ChartData>(`/api/climate/chart/${encodeURIComponent(did)}`)
            .then(({ data }) => { setData(data); setFailed(false); })
            .catch(() => setFailed(true));
        load();
        const id = setInterval(load, 5 * 60_000);
        return () => clearInterval(id);
    }, [did]);

    useLayoutEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0) setSize({ w: Math.round(width), h: Math.round(height) || 220 });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [data]);

    const chart = useMemo(() => {
        if (!data || data.points.length < 2) return null;
        const { w, h } = size;
        const { from, to, points, outdoor, setpoint } = data;
        const hasOut = outdoor.length >= 2;
        const mainBottom = h - AXIS_H - (hasOut ? OUT_H + OUT_GAP : 0);
        const x = (ts: number) => PAD.left + ((ts - from) / Math.max(to - from, 1)) * (w - PAD.left - PAD.right);

        // Axe des degrés : pièce et consigne, au moins 2° d'amplitude, graduations rondes
        const vals = [...points.map((p) => p.temperature), ...(setpoint || []).map((s) => s.target)];
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        if (hi - lo < 2) {
            const mid = (hi + lo) / 2;
            lo = mid - 1;
            hi = mid + 1;
        }
        const step = hi - lo > 6 ? 2 : hi - lo > 3 ? 1 : 0.5;
        lo = Math.floor((lo - 0.2) / step) * step;
        hi = Math.ceil((hi + 0.2) / step) * step;
        const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (mainBottom - PAD.top);
        const yTicks: number[] = [];
        for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push(Math.round(v * 10) / 10);
        // Pas plus de 4 graduations
        const every = Math.ceil(yTicks.length / 4);
        const shownTicks = yTicks.filter((_, i) => i % every === 0);

        // Heures rondes toutes les 6 h
        const xTicks: number[] = [];
        const first = new Date(from);
        first.setMinutes(0, 0, 0);
        for (let ts = first.getTime() + HOUR; ts < to - HOUR; ts += HOUR) {
            // Pas collée à « maint. » (téléphone)
            if (new Date(ts).getHours() % 6 === 0 && x(ts) < w - PAD.right - 52) xTicks.push(ts);
        }

        const inPts: XY[] = points.map((p) => [x(p.ts), y(p.temperature)]);
        const line = smoothPath(inPts);
        const area = `${line}L${inPts[inPts.length - 1][0].toFixed(1)},${mainBottom}L${inPts[0][0].toFixed(1)},${mainBottom}Z`;

        let minP = points[0];
        let maxP = points[0];
        for (const p of points) {
            if (p.temperature < minP.temperature) minP = p;
            if (p.temperature > maxP.temperature) maxP = p;
        }

        const setPath = (setpoint || [])
            .map((s) => `M${x(s.from).toFixed(1)},${y(s.target).toFixed(1)}H${x(s.to).toFixed(1)}`)
            .join('');
        // Marches verticales entre deux consignes qui se touchent
        const setRisers = (setpoint || []).slice(1)
            .filter((s, i) => setpoint![i].to === s.from)
            .map((s, i) => `M${x(s.from).toFixed(1)},${y(setpoint![i].target).toFixed(1)}V${y(s.target).toFixed(1)}`)
            .join('');

        // Bande « dehors » : sa propre échelle, sous le graphique
        let out = null;
        if (hasOut) {
            const top = mainBottom + OUT_GAP;
            const ovals = outdoor.map((p) => p.temperature);
            const olo = Math.min(...ovals);
            const ohi = Math.max(...ovals, olo + 1);
            const oy = (v: number) => top + 6 + (1 - (v - olo) / (ohi - olo)) * (OUT_H - 12);
            const clipped = outdoor.map((p) => ({ ...p, ts: Math.min(Math.max(p.ts, from), to) }));
            const opts: XY[] = clipped.map((p) => [x(p.ts), oy(p.temperature)]);
            out = { top, oy, line: smoothPath(opts), lo: olo, hi: ohi };
        }

        return { w, h, x, y, mainBottom, yTicks: shownTicks, xTicks, line, area, minP, maxP, setPath: setPath + setRisers, out, lo, hi };
    }, [data, size]);

    if (failed && !data) return <p className="muted">Courbe indisponible pour le moment.</p>;
    if (!data) return <div className="temp-chart-skeleton" aria-hidden="true" />;
    if (!chart) return <p className="muted">Pas encore assez de mesures sur 24 h.</p>;

    const { points, outdoor, setpoint, nights } = data;
    const last = points[points.length - 1];
    const threeH = valueAt(points, last.ts - 3 * HOUR);
    const trend = threeH != null ? last.temperature - threeH : null;
    const outNow = outdoor.length ? valueAt(outdoor, data.to) ?? outdoor[outdoor.length - 1].temperature : null;
    const setNow = setpoint?.length && setpoint[setpoint.length - 1].to >= data.to - 60_000 ? setpoint[setpoint.length - 1].target : null;

    const onPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * chart.w;
        const frac = (px - PAD.left) / (chart.w - PAD.left - PAD.right);
        if (frac < -0.02 || frac > 1.02) return setHover(null);
        setHover(data.from + Math.min(Math.max(frac, 0), 1) * (data.to - data.from));
    };
    const hv = hover != null ? {
        ts: hover,
        room: valueAt(points, hover),
        out: valueAt(outdoor, hover),
        set: setpoint?.find((s) => s.from <= hover && s.to >= hover)?.target ?? null,
    } : null;
    const lastX = chart.x(last.ts);
    const lastY = chart.y(last.temperature);
    // Infobulle à côté du curseur, du côté où il reste de la place
    const tipRight = hv ? chart.x(hv.ts) < chart.w / 2 : true;
    const tipStyle = hv ? (tipRight ? { left: chart.x(hv.ts) + 12 } : { right: chart.w - chart.x(hv.ts) + 12 }) : {};

    return (
        <figure className="temp-chart">
            <div className="temp-chart-summary">
                <span className="tc-now mono">{fmt(last.temperature)}°</span>
                {trend != null && (
                    <span className={`tc-pill ${trend > 0.15 ? 'up' : trend < -0.15 ? 'down' : ''}`}>
                        {Math.abs(trend) < 0.15 ? 'Stable en 3 h' : `${signed(trend)}° en 3 h`}
                    </span>
                )}
                {setNow != null && <span className="tc-pill set">Consigne {fmt(setNow)}°</span>}
                {outNow != null && <span className="tc-pill out">Dehors {fmt(outNow)}°</span>}
            </div>

            <div className="temp-chart-box" ref={boxRef}>
                <svg width={chart.w} height={chart.h} viewBox={`0 0 ${chart.w} ${chart.h}`} role="img"
                    aria-label={`Température de ${name} sur 24 heures, entre ${fmt(chart.minP.temperature)} et ${fmt(chart.maxP.temperature)} degrés${outNow != null ? `, ${fmt(outNow)} degrés dehors` : ''}`}
                    onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setHover(null)}>
                    <defs>
                        <linearGradient id={`tc-fill-${did}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--h-light)" stopOpacity="0.28" />
                            <stop offset="55%" stopColor="var(--h-cool)" stopOpacity="0.14" />
                            <stop offset="100%" stopColor="var(--h-cool)" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id={`tc-line-${did}`} gradientUnits="userSpaceOnUse" x1="0" y1={chart.y(chart.hi)} x2="0" y2={chart.y(chart.lo)}>
                            <stop offset="0%" stopColor="var(--h-light)" />
                            <stop offset="100%" stopColor="var(--h-cool)" />
                        </linearGradient>
                    </defs>

                    {/* Nuits */}
                    {nights.map((n) => (
                        <rect key={n.from} className="tc-night" x={chart.x(n.from)} y={0}
                            width={Math.max(chart.x(n.to) - chart.x(n.from), 0)} height={chart.h - AXIS_H} rx={6} />
                    ))}

                    {/* Graduations */}
                    {chart.yTicks.map((v) => (
                        <g key={v}>
                            <line className="tc-grid" x1={PAD.left} x2={chart.w - PAD.right} y1={chart.y(v)} y2={chart.y(v)} />
                            <text className="tc-axis" x={PAD.left - 6} y={chart.y(v) + 4} textAnchor="end">{fmt(v, Number.isInteger(v) ? 0 : 1)}°</text>
                        </g>
                    ))}
                    {chart.xTicks.map((ts) => (
                        <text key={ts} className="tc-axis" x={chart.x(ts)} y={chart.h - 5} textAnchor="middle">{hourLabel(ts)}</text>
                    ))}
                    <text className="tc-axis" x={chart.w - PAD.right} y={chart.h - 5} textAnchor="end">maint.</text>

                    {/* Consigne */}
                    {chart.setPath && <path className="tc-set" d={chart.setPath} />}

                    {/* Pièce */}
                    <path d={chart.area} fill={`url(#tc-fill-${did})`} />
                    <path d={chart.line} fill="none" stroke={`url(#tc-line-${did})`} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />

                    {/* Min et max */}
                    {[{ p: chart.maxP, k: 'max', dy: -9 }, { p: chart.minP, k: 'min', dy: 17 }].map(({ p, k, dy }) => {
                        const px = chart.x(p.ts);
                        // Pas d'étiquette collée au point « maintenant »
                        if (Math.abs(px - lastX) < 50) return null;
                        return (
                            <g key={k}>
                                <circle cx={px} cy={chart.y(p.temperature)} r={3.5} className={`tc-dot ${k}`} />
                                <text className="tc-mark" x={Math.min(Math.max(px, PAD.left + 30), chart.w - PAD.right - 30)}
                                    y={chart.y(p.temperature) + dy} textAnchor="middle">
                                    {fmt(p.temperature)}° · {hourLabel(p.ts)}
                                </text>
                            </g>
                        );
                    })}

                    {/* Maintenant */}
                    <circle cx={lastX} cy={lastY} r={9} className="tc-pulse" />
                    <circle cx={lastX} cy={lastY} r={4.5} className="tc-now-dot" />

                    {/* Dehors */}
                    {chart.out && (
                        <g>
                            <line className="tc-grid" x1={PAD.left} x2={chart.w - PAD.right} y1={chart.out.top} y2={chart.out.top} />
                            <path className="tc-out" d={chart.out.line} />
                            <text className="tc-axis" x={PAD.left - 6} y={chart.out.top + 14} textAnchor="end">{fmt(chart.out.hi, 0)}°</text>
                            <text className="tc-axis" x={PAD.left - 6} y={chart.out.top + OUT_H - 2} textAnchor="end">{fmt(chart.out.lo, 0)}°</text>
                            <text className="tc-axis tc-out-label" x={PAD.left + 6} y={chart.out.top + 14}>Dehors</text>
                        </g>
                    )}

                    {/* Curseur */}
                    {hv && (
                        <g pointerEvents="none">
                            <line className="tc-cursor" x1={chart.x(hv.ts)} x2={chart.x(hv.ts)} y1={PAD.top - 6} y2={chart.h - AXIS_H} />
                            {hv.room != null && <circle cx={chart.x(hv.ts)} cy={chart.y(hv.room)} r={5} className="tc-now-dot" />}
                            {hv.out != null && chart.out && <circle cx={chart.x(hv.ts)} cy={chart.out.oy(hv.out)} r={3.5} className="tc-dot out" />}
                        </g>
                    )}
                </svg>

                {hv && (
                    <div className="tc-tip" style={tipStyle}>
                        <strong className="mono">{timeLabel(hv.ts)}</strong>
                        {hv.room != null && <span>{name} <b className="mono">{fmt(hv.room)}°</b></span>}
                        {hv.set != null && <span>Consigne <b className="mono">{fmt(hv.set)}°</b></span>}
                        {hv.out != null && <span>Dehors <b className="mono">{fmt(hv.out)}°</b></span>}
                    </div>
                )}
            </div>

            <figcaption className="temp-chart-legend muted">
                <span><i className="lg-room" />Pièce</span>
                {setpoint && setpoint.length > 0 && <span><i className="lg-set" />Consigne</span>}
                {outdoor.length >= 2 && <span><i className="lg-out" />Dehors</span>}
                {nights.length > 0 && <span><i className="lg-night" />Nuit</span>}
            </figcaption>
        </figure>
    );
}
