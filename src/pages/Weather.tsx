import { useEffect, useState } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import './Dashboard.css';
import './Weather.css';

// ── Données de /api/weather/details ──────────────────────────────────────────

interface Gear { hat: boolean; gloves: boolean; scarf: boolean; hood: boolean; umbrella: boolean; boots: boolean; sunglasses: boolean }
interface Outfit {
    day: 'today' | 'tomorrow';
    moment: 'out' | 'back';
    hour: number;
    past: boolean;
    ts: number;
    temp: number;
    feels: number;
    rainProb: number;
    gust: number;
    uv: number;
    coat: 'winter' | 'mid' | 'light' | 'rain' | 'none';
    layers: number;
    gear: Gear;
    items: string[];
    headline: string;
    tip: string | null;
}
interface Barometer {
    source: 'sensor' | 'forecast';
    sensorName: string | null;
    raw: number | null;
    value: number;
    refs: Record<'3' | '6' | '24', number | null>;
    delta3h: number;
    trend: { level: string; label: string };
    curve: { ts: number; value: number; kind: 'measured' | 'forecast' }[];
}
interface Storm {
    score: number;
    level: 'calm' | 'watch' | 'likely' | 'storm';
    label: string;
    window: { from: number; to: number } | null;
    maxGust: number;
    factors: { id: string; label: string; value: string; score: number; max: number }[];
    hours: { ts: number; bad: boolean; gust: number; rainProb: number }[];
}
interface Airing {
    verdict: 'yes' | 'short' | 'no';
    label: string;
    reason: string;
    rainSoon: number | null;
    indoor: { name: string; temp: number; humidity: number };
    outdoor: { temp: number; humidity: number };
    door: { name: string; open: boolean | null } | null;
}
interface WeatherDetails {
    updatedAt: number;
    current: { temp: number; feels: number; humidity: number; dewPoint: number; wind: number; gust: number; code: number; isDay: boolean };
    outings: number[];
    barometer: Barometer | null;
    storm: Storm | null;
    outfits: Outfit[];
    airing: Airing | null;
    sun: { sunrise: number; sunset: number; dayLengthMin: number; deltaMin: number | null } | null;
}

// ── Formats ──────────────────────────────────────────────────────────────────

const dec = (n: number | null | undefined, d = 1) => (n == null ? '–' : n.toFixed(d).replace('.', ','));
const hm = (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const hOnly = (ts: number) => `${new Date(ts).getHours()} h`;
const dayWord = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86_400_000);
    if (diff === 0) return 'Aujourd’hui';
    if (diff === 1) return 'Demain';
    const w = d.toLocaleDateString('fr-FR', { weekday: 'long' });
    return w.charAt(0).toUpperCase() + w.slice(1);
};
const windowText = (w: { from: number; to: number }) => `${dayWord(w.from)} ${hOnly(w.from)} – ${hOnly(w.to)}`;

// ── Silhouette habillée ──────────────────────────────────────────────────────

function Figure({ o }: { o: Outfit }) {
    const g = o.gear;
    const on = (b: boolean) => (b ? 1 : 0.1);
    const rain = o.coat === 'rain';
    const coatStroke = o.coat === 'none' ? 'var(--h-muted)' : rain ? 'var(--h-cool)' : 'var(--h-accent)';
    const coatFill = rain ? 'var(--h-cool-dim)' : o.coat === 'winter' ? '#2f3a1a' : o.coat === 'none' ? 'transparent' : '#232a17';
    return (
        <svg className="wx-figure" viewBox="0 0 260 340" role="img" aria-label={`Silhouette habillée : ${o.items.join(', ')}`}>
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="110" cy="62" r="24" stroke="var(--h-muted)" strokeWidth="3" />
                <path d="M92 210 L90 300 M128 210 L130 300" stroke="var(--h-muted)" strokeWidth="3" />
                <path d="M80 104 L60 188 M140 104 L160 188" stroke="var(--h-muted)" strokeWidth="3" />
                <path d="M82 100 Q110 90 138 100 L152 214 H68 Z" stroke={coatStroke} strokeWidth="3.5" fill={coatFill} />
                {o.coat !== 'none' && <path d="M110 98 V214" stroke={coatStroke} strokeWidth="2" />}
                <g opacity={on(g.hat)}>
                    <path d="M86 58 Q86 30 110 30 Q134 30 134 58 Z" stroke="var(--h-accent)" strokeWidth="3" fill="#2f3a1a" />
                    <path d="M84 58 H136" stroke="var(--h-accent)" strokeWidth="5" />
                    <circle cx="110" cy="25" r="6" fill="var(--h-accent)" />
                </g>
                <g opacity={on(g.hood)}>
                    <path d="M80 70 Q80 26 110 26 Q140 26 140 70 L136 96 M80 70 L84 96" stroke="var(--h-cool)" strokeWidth="3" />
                </g>
                <g opacity={on(g.sunglasses)}>
                    <path d="M94 60 H106 M114 60 H126 M106 60 H114" stroke="var(--h-light)" strokeWidth="5" />
                </g>
                <g opacity={on(g.scarf)}>
                    <path d="M88 94 Q110 108 132 94" stroke="var(--h-accent)" strokeWidth="7" />
                    <path d="M124 100 L130 132" stroke="var(--h-accent)" strokeWidth="6" />
                </g>
                <g opacity={on(g.gloves)}>
                    <circle cx="58" cy="194" r="8" fill="var(--h-accent)" />
                    <circle cx="162" cy="194" r="8" fill="var(--h-accent)" />
                </g>
                <g opacity={on(g.boots)}>
                    <path d="M80 286 H101 V318 H74 Q72 310 80 306 Z" stroke="var(--h-cool)" strokeWidth="3" fill="var(--h-cool-dim)" />
                    <path d="M119 286 H140 V306 Q148 310 146 318 H119 Z" stroke="var(--h-cool)" strokeWidth="3" fill="var(--h-cool-dim)" />
                </g>
                <g opacity={on(g.umbrella)}>
                    <path d="M168 128 Q210 74 252 128 Z" stroke="var(--h-cool)" strokeWidth="3" fill="var(--h-cool-dim)" />
                    <path d="M210 128 V196 Q210 206 200 204" stroke="var(--h-cool)" strokeWidth="3" />
                </g>
            </g>
        </svg>
    );
}

// ── Baromètre à deux aiguilles ───────────────────────────────────────────────

const ang = (p: number) => -135 + (Math.max(960, Math.min(1060, p)) - 960) * 2.7;
const pt = (a: number, r: number) => {
    const t = (a * Math.PI) / 180;
    return [160 + r * Math.sin(t), 160 - r * Math.cos(t)];
};
const arc = (p0: number, p1: number, r: number) => {
    const [x0, y0] = pt(ang(p0), r);
    const [x1, y1] = pt(ang(p1), r);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${ang(p1) - ang(p0) > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};
const TICKS = (() => {
    let minor = '';
    let major = '';
    for (let p = 960; p <= 1060; p += 5) {
        const isMajor = p % 10 === 0;
        const [x0, y0] = pt(ang(p), 118);
        const [x1, y1] = pt(ang(p), isMajor ? 104 : 110);
        const seg = `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} `;
        if (isMajor) major += seg;
        else minor += seg;
    }
    return { minor, major };
})();
const DIAL_LABELS: [number, string, string][] = [
    [970, 'TEMPÊTE', 'var(--h-light-text)'],
    [990, 'PLUIE', 'var(--h-cool-text)'],
    [1010, 'VARIABLE', 'var(--h-muted)'],
    [1030, 'BEAU', 'var(--h-accent)'],
    [1050, 'SEC', 'var(--h-accent)'],
];

function Gauge({ value, reference, label }: { value: number; reference: number | null; label: string }) {
    return (
        <svg className="wx-gauge" viewBox="0 0 320 270" role="img" aria-label={`Pression ${dec(value)} hectopascals, ${label}`}>
            <path d={arc(960, 985, 132)} stroke="var(--h-light)" strokeWidth="10" fill="none" />
            <path d={arc(985, 1005, 132)} stroke="var(--h-cool)" strokeWidth="10" fill="none" />
            <path d={arc(1005, 1020, 132)} stroke="var(--h-line-2)" strokeWidth="10" fill="none" />
            <path d={arc(1020, 1060, 132)} stroke="var(--h-accent)" strokeWidth="10" fill="none" />
            <path d={TICKS.minor} stroke="var(--h-muted)" strokeWidth="1.5" />
            <path d={TICKS.major} stroke="var(--h-text)" strokeWidth="2.5" />
            {DIAL_LABELS.map(([p, text, color]) => {
                const [x, y] = pt(ang(p), 92);
                return <text key={text} x={x} y={y + 4} fill={color} fontSize="12" fontWeight="700" textAnchor="middle">{text}</text>;
            })}
            {reference != null && (
                <g className="wx-needle" style={{ transform: `rotate(${ang(reference)}deg)` }}>
                    <path d="M160 160 L160 42" stroke="var(--h-light)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 5" />
                    <path d="M153 50 L160 34 L167 50 Z" fill="var(--h-light)" />
                </g>
            )}
            <g className="wx-needle" style={{ transform: `rotate(${ang(value)}deg)` }}>
                <path d="M160 176 L160 40" stroke="var(--h-text)" strokeWidth="5" strokeLinecap="round" />
            </g>
            <circle cx="160" cy="160" r="12" fill="var(--h-text)" />
            <circle cx="160" cy="160" r="5" fill="var(--h-surface)" />
            <text x="160" y="226" fill="var(--h-text)" fontSize="40" fontWeight="500" textAnchor="middle" className="mono">{dec(value)}</text>
            <text x="160" y="248" fill="var(--h-muted)" fontSize="13" textAnchor="middle">hPa</text>
        </svg>
    );
}

/** Pression d'hier à demain, avec la fenêtre de tempête en ambre. */
function PressureChart({ b, storm, updatedAt }: { b: Barometer; storm: Storm | null; updatedAt: number }) {
    if (b.curve.length < 2) return null;
    const W = 700;
    const H = 200;
    const t0 = b.curve[0].ts;
    const t1 = b.curve[b.curve.length - 1].ts;
    const vals = b.curve.map((p) => p.value);
    const min = Math.floor(Math.min(...vals) - 2);
    const max = Math.ceil(Math.max(...vals) + 2);
    const X = (ts: number) => 44 + ((ts - t0) / Math.max(t1 - t0, 1)) * (W - 54);
    const Y = (v: number) => 14 + ((max - v) / Math.max(max - min, 1)) * (H - 40);
    const measured = b.curve.filter((p) => p.kind === 'measured');
    // La prévision part du dernier point mesuré pour que les deux traits se touchent
    const forecast = [...measured.slice(-1), ...b.curve.filter((p) => p.kind === 'forecast')];
    const line = (pts: Barometer['curve']) => pts.map((p) => `${X(p.ts).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
    const now = updatedAt;
    const mid = Math.round((min + max) / 2);
    const w = storm?.window;
    return (
        <svg className="wx-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
            aria-label={`Pression d’hier à demain, entre ${min} et ${max} hectopascals`}>
            {w && w.from < t1 && (
                <rect x={X(Math.max(w.from, t0))} y="8" width={Math.max(4, X(Math.min(w.to, t1)) - X(Math.max(w.from, t0)))} height={H - 34}
                    fill="var(--h-light)" opacity="0.14" />
            )}
            {[max - 2, mid, min + 2].map((v) => (
                <g key={v}>
                    <path d={`M44 ${Y(v)} H${W - 10}`} stroke="var(--h-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <text x="38" y={Y(v) + 4} fill="var(--h-muted)" fontSize="11" textAnchor="end" className="mono">{v}</text>
                </g>
            ))}
            <path d={`M${X(now)} 8 V${H - 26}`} stroke="var(--h-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <text x={X(now)} y={H - 8} fill="var(--h-accent)" fontSize="12" fontWeight="700" textAnchor="middle">maintenant</text>
            <polyline points={line(measured)} fill="none" stroke="var(--h-text)" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <polyline points={line(forecast)} fill="none" stroke="var(--h-cool)" strokeWidth="3" strokeDasharray="7 6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

const REFS: { id: '3' | '6' | '24'; label: string }[] = [
    { id: '3', label: '3 h' },
    { id: '6', label: '6 h' },
    { id: '24', label: '24 h' },
];

function BarometerSheet({ b, storm, updatedAt, onClose }: { b: Barometer; storm: Storm | null; updatedAt: number; onClose: () => void }) {
    const [ref, setRef] = useState<'3' | '6' | '24'>('3');
    const refValue = b.refs[ref];
    const delta = refValue != null ? b.value - refValue : null;
    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <motion.div className="sheet wx-sheet" role="dialog" aria-modal="true" aria-label="Baromètre"
                initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                transition={{ duration: 0.2 }} onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <div className="sheet-title">
                        <h2>Baromètre</h2>
                        <span className="muted">
                            {b.source === 'sensor' ? `capteur ${b.sensorName} · ramené au niveau de la mer (brut ${dec(b.raw)})` : 'prévision Open-Meteo'}
                        </span>
                    </div>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>

                <div className="wx-sheet-grid">
                    <div className="wx-dial">
                        <Gauge value={b.value} reference={refValue} label={b.trend.label} />
                        <div className="wx-refs" role="group" aria-label="Aiguille témoin">
                            <span className="muted">Aiguille témoin</span>
                            {REFS.map((r) => (
                                <button key={r.id} type="button" className={ref === r.id ? 'active' : ''} aria-pressed={ref === r.id} onClick={() => setRef(r.id)}>
                                    {r.label}
                                </button>
                            ))}
                        </div>
                        <div className={`wx-trend lvl-${b.trend.level}`}>
                            <strong>{b.trend.label}</strong>
                            {delta != null && <span className="mono">{delta >= 0 ? '+' : '−'}{dec(Math.abs(delta))} hPa en {ref} h</span>}
                        </div>
                    </div>

                    <div className="wx-sheet-side">
                        {storm && (
                            <section className="wx-panel" aria-label="Risque de tempête">
                                <div className="wx-storm-head">
                                    <div>
                                        <span className="muted">Risque de tempête · 48 h</span>
                                        <strong className={`wx-score lvl-${storm.level}`}>{storm.score}</strong>
                                        <span className="wx-storm-label">{storm.label}{storm.window ? ` · ${windowText(storm.window)}` : ''}</span>
                                    </div>
                                </div>
                                <ul className="wx-factors">
                                    {storm.factors.map((f) => (
                                        <li key={f.id}>
                                            <span>{f.label}</span>
                                            <span className="wx-bar"><i style={{ width: `${(f.score / f.max) * 100}%` }} className={f.score / f.max > 0.5 ? 'hot' : ''} /></span>
                                            <span className="mono muted">{f.value}</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        <section className="wx-panel" aria-label="Pression d’hier à demain">
                            <div className="wx-chart-head">
                                <strong>Pression · hier → demain</strong>
                                <span className="muted"><i className="wx-key solid" />mesurée <i className="wx-key dashed" />prévue</span>
                            </div>
                            <PressureChart b={b} storm={storm} updatedAt={updatedAt} />
                        </section>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** Écran Météo (sous Climat) : la tenue d'abord, puis tempête, baromètre, aération, soleil. */
export function Weather() {
    const [data, setData] = useState<WeatherDetails | null>(null);
    const [error, setError] = useState(false);
    const [day, setDay] = useState<'today' | 'tomorrow' | null>(null);
    const [moment, setMoment] = useState<'out' | 'back' | null>(null);
    const [sheet, setSheet] = useState(false);

    useEffect(() => {
        const load = () => axios.get('/api/weather/details')
            .then(({ data }) => { setData(data); setError(false); })
            .catch(() => setError(true));
        load();
        const t = setInterval(load, 10 * 60_000);
        return () => clearInterval(t);
    }, []);

    // Par défaut : la prochaine sortie qui n'est pas passée
    const next = data?.outfits.find((o) => !o.past) ?? data?.outfits[0];
    const d = day ?? next?.day ?? 'today';
    const m = moment ?? next?.moment ?? 'out';
    const o = data?.outfits.find((x) => x.day === d && x.moment === m) ?? null;
    const [outH, backH] = data?.outings ?? [8, 17];
    const b = data?.barometer ?? null;
    const storm = data?.storm ?? null;

    return (
        <div className="home">
            <header className="home-top">
                <div className="home-hello">
                    <Link to="/climate" className="round-btn" aria-label="Retour à Climat"><Icon name="back" size={22} strokeWidth={2} /></Link>
                    <h1>Météo</h1>
                    {data && <span className="muted">Dehors <strong className="mono">{dec(data.current.temp, 0)}°</strong> · ressenti <span className="mono">{dec(data.current.feels, 0)}°</span></span>}
                </div>
                {storm && storm.level !== 'calm' && (
                    <span className="wx-alert"><Icon name="alert" size={18} strokeWidth={2} />{storm.window ? `${storm.label} · ${windowText(storm.window)}` : `Tempête : ${storm.label.toLowerCase()}`}</span>
                )}
            </header>

            {!data && <p className="muted">{error ? 'Météo indisponible pour l’instant.' : 'Chargement de la météo…'}</p>}

            {data && (
                <div className="wx-layout">
                    <section className="card wx-main" aria-label="Comment m’habiller">
                        <div className="wx-toggles">
                            <div className="wx-seg" role="group" aria-label="Jour">
                                {(['today', 'tomorrow'] as const).map((k) => (
                                    <button key={k} type="button" className={d === k ? 'active' : ''} aria-pressed={d === k} onClick={() => setDay(k)}>
                                        {k === 'today' ? 'Aujourd’hui' : 'Demain'}
                                    </button>
                                ))}
                            </div>
                            <div className="wx-seg" role="group" aria-label="Sortie">
                                {(['out', 'back'] as const).map((k) => (
                                    <button key={k} type="button" className={m === k ? 'active' : ''} aria-pressed={m === k} onClick={() => setMoment(k)}>
                                        {k === 'out' ? `Aller · ${outH} h` : `Retour · ${backH} h`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {o ? (
                            <>
                                <h2 className={`wx-headline ${o.gust >= 60 ? 'stormy' : ''}`} aria-live="polite">
                                    {o.past && <span className="muted">C’était : </span>}{o.headline}
                                </h2>
                                <div className="wx-outfit">
                                    <Figure o={o} />
                                    <div className="wx-outfit-info">
                                        <div className="wx-feels">
                                            <div>
                                                <span className="muted">Ressenti à {o.hour} h</span>
                                                <strong className="mono">{o.feels}°</strong>
                                            </div>
                                            <dl>
                                                <div><dt>Réel</dt><dd className="mono">{o.temp}°</dd></div>
                                                <div><dt>Pluie</dt><dd className="mono">{o.rainProb} %</dd></div>
                                                <div><dt>Rafales</dt><dd className="mono">{o.gust} km/h</dd></div>
                                            </dl>
                                        </div>
                                        <div className="wx-layers" aria-label={`${o.layers} couche${o.layers > 1 ? 's' : ''}`}>
                                            <span className="muted">Couches</span>
                                            {[1, 2, 3, 4].map((n) => <i key={n} className={n <= o.layers ? 'on' : ''} />)}
                                        </div>
                                        <ul className="wx-items">{o.items.map((it) => <li key={it}>{it}</li>)}</ul>
                                        {o.tip && <p className="warn-line">{o.tip}</p>}
                                    </div>
                                </div>
                            </>
                        ) : <p className="muted">Pas de prévision pour cette sortie.</p>}
                    </section>

                    <aside className="wx-side">
                        {storm && (
                            <button type="button" className={`wx-tile wx-storm lvl-${storm.level}`} onClick={() => setSheet(true)}>
                                <span className="wx-tile-head">
                                    <strong>{storm.level === 'calm' ? 'Pas de tempête en vue' : 'Tempête en approche'}</strong>
                                    <span className="mono">{storm.score} / 100</span>
                                </span>
                                <span>{storm.window ? `${windowText(storm.window)} · rafales jusqu’à ${storm.maxGust} km/h` : `Rafales max ${storm.maxGust} km/h sur 48 h`}</span>
                                <span className="wx-strip" aria-hidden="true">
                                    {storm.hours.filter((_, i) => i % 4 === 0).map((h, i) => {
                                        const block = storm.hours.slice(i * 4, i * 4 + 4);
                                        const bad = block.some((x) => x.bad);
                                        const windy = block.some((x) => x.gust >= 45);
                                        return <i key={h.ts} className={bad ? 'bad' : windy ? 'windy' : ''} />;
                                    })}
                                </span>
                                <span className="wx-strip-scale muted"><span>maintenant</span><span>+48 h</span></span>
                            </button>
                        )}

                        {b && (
                            <button type="button" className="wx-tile wx-baro" onClick={() => setSheet(true)} aria-label={`Baromètre ${dec(b.value)} hectopascals, ${b.trend.label}. Ouvrir le détail`}>
                                <span className="wx-baro-val">
                                    <span className="muted">Baromètre</span>
                                    <strong className="mono">{dec(b.value)}</strong>
                                    <span className={`wx-baro-trend lvl-${b.trend.level}`}>{b.delta3h >= 0 ? '+' : '−'}{dec(Math.abs(b.delta3h))} hPa en 3 h</span>
                                </span>
                                <Spark curve={b.curve.filter((p) => p.kind === 'measured')} />
                                <Icon name="chevron" size={20} strokeWidth={2.2} />
                            </button>
                        )}

                        {data.airing && (
                            <section className="wx-tile" aria-label="Aérer">
                                <span className="wx-tile-head">
                                    <strong>Ouvrir {data.airing.door ? `la ${data.airing.door.name.toLowerCase()}` : 'les fenêtres'} ?</strong>
                                    <span className={`wx-verdict v-${data.airing.verdict}`}>{data.airing.label}</span>
                                </span>
                                <span className="wx-two muted">
                                    <span>{data.airing.indoor.name} <b className="mono">{dec(data.airing.indoor.temp)}° · {data.airing.indoor.humidity} %</b></span>
                                    <span>Dehors <b className="mono">{dec(data.airing.outdoor.temp)}° · {data.airing.outdoor.humidity} %</b></span>
                                </span>
                                <span className="muted">
                                    {data.airing.reason}
                                    {data.airing.rainSoon && data.airing.verdict !== 'no' ? ` Ferme avant ${hm(data.airing.rainSoon)}, la pluie arrive.` : ''}
                                    {data.airing.door?.open ? ' (elle est ouverte en ce moment)' : ''}
                                </span>
                            </section>
                        )}

                        {data.sun && <SunTile sun={data.sun} updatedAt={data.updatedAt} />}
                    </aside>
                </div>
            )}

            <AnimatePresence>
                {sheet && b && <BarometerSheet key="baro" b={b} storm={storm} updatedAt={data?.updatedAt ?? 0} onClose={() => setSheet(false)} />}
            </AnimatePresence>
        </div>
    );
}

function Spark({ curve }: { curve: { ts: number; value: number }[] }) {
    if (curve.length < 2) return <span />;
    const vals = curve.map((p) => p.value);
    const min = Math.min(...vals);
    const span = Math.max(Math.max(...vals) - min, 1);
    const pts = curve.map((p, i) => `${((i / (curve.length - 1)) * 200).toFixed(1)},${(56 - ((p.value - min) / span) * 48).toFixed(1)}`).join(' ');
    const last = pts.split(' ').pop()!.split(',');
    return (
        <svg className="wx-spark" viewBox="0 0 200 64" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={pts} fill="none" stroke="var(--h-text)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <circle cx={last[0]} cy={last[1]} r="4" fill="var(--h-light)" />
        </svg>
    );
}

function SunTile({ sun, updatedAt }: { sun: NonNullable<WeatherDetails['sun']>; updatedAt: number }) {
    const now = updatedAt;
    const f = Math.max(0, Math.min(1, (now - sun.sunrise) / (sun.sunset - sun.sunrise)));
    const up = now > sun.sunrise && now < sun.sunset;
    // Point sur la courbe de Bézier quadratique (20,64) (190,-40) (360,64)
    const x = (1 - f) ** 2 * 20 + 2 * (1 - f) * f * 190 + f ** 2 * 360;
    const y = (1 - f) ** 2 * 64 + 2 * (1 - f) * f * -40 + f ** 2 * 64;
    return (
        <section className="wx-tile" aria-label={`Soleil : lever ${hm(sun.sunrise)}, coucher ${hm(sun.sunset)}`}>
            <svg className="wx-sun" viewBox="0 0 380 72" aria-hidden="true">
                <path d="M20 64 Q190 -40 360 64" fill="none" stroke="var(--h-line)" strokeWidth="3" strokeDasharray="4 6" />
                <path d="M10 64 H370" stroke="var(--h-line)" strokeWidth="1.5" />
                {up && <circle cx={x} cy={y} r="9" fill="var(--h-light)" />}
            </svg>
            <span className="wx-sun-row muted">
                <span>Lever <b className="mono">{hm(sun.sunrise)}</b></span>
                {sun.deltaMin != null && <span>{sun.deltaMin > 0 ? '+' : '−'}{Math.abs(sun.deltaMin)} min / jour</span>}
                <span>Coucher <b className="mono">{hm(sun.sunset)}</b></span>
            </span>
        </section>
    );
}
