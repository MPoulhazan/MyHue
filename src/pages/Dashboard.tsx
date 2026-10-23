import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform, animate } from 'framer-motion';
import { useHome, SWATCHES } from '../hooks/useHome';
import { useVoice } from '../hooks/useVoice';
import type { DashLight, LogEntry } from '../hooks/useHome';
import { themeColor, useTheme } from '../theme/useTheme';
import './Dashboard.css';

const ease = [0.2, 0.8, 0.2, 1] as const;

// ── Petits utilitaires ───────────────────────────────────────────────────────

function useClock() {
    const [d, setD] = useState(new Date());
    useEffect(() => {
        const t = setInterval(() => setD(new Date()), 1000);
        return () => clearInterval(t);
    }, []);
    return d;
}

/** Nombre qui « roule » jusqu'à sa valeur. */
function Num({ value, decimals = 0 }: { value: number | null | undefined; decimals?: number }) {
    const spring = useSpring(0, { stiffness: 80, damping: 18 });
    const text = useTransform(spring, (v) => v.toFixed(decimals).replace('.', ','));
    useEffect(() => {
        if (value != null) spring.set(value);
    }, [value, spring]);
    if (value == null) return <span>--</span>;
    return <motion.span>{text}</motion.span>;
}

/** Texte qui s'écrit caractère par caractère. */
function Typewriter({ text, speed = 18 }: { text: string; speed?: number }) {
    const [n, setN] = useState(0);
    useEffect(() => {
        setN(0);
        const t = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(t), v) : v + 1)), speed);
        return () => clearInterval(t);
    }, [text, speed]);
    return <>{text.slice(0, n)}</>;
}

/** Panneau avec séquence d'allumage : balayage + coins qui se tracent. */
function Panel({ children, className = '', delay = 0, style }: { children: ReactNode; className?: string; delay?: number; style?: CSSProperties }) {
    return (
        <motion.section
            className={`dash-panel ${className}`}
            style={style}
            initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
            animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
            transition={{ duration: 0.7, delay, ease }}
        >
            <span className="dash-corner tl" />
            <span className="dash-corner tr" />
            <span className="dash-corner bl" />
            <span className="dash-corner br" />
            {children}
        </motion.section>
    );
}

// ── Fond animé : grille de points + horizon qui défile, teinté par l'accent ──

function Backdrop({ accent }: { accent: string }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const accentRef = useRef(accent);
    const reduce = useReducedMotion();
    accentRef.current = accent;

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        let raf = 0;
        let w = 0, h = 0;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const resize = () => {
            w = canvas.clientWidth;
            h = canvas.clientHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);
        const draw = (t: number) => {
            ctx.clearRect(0, 0, w, h);
            const a = accentRef.current;
            const dotColor = themeColor('text-primary') || '#E6EAE3';
            const gap = 28;
            const ox = (t * 0.004) % gap;
            for (let x = -gap; x < w + gap; x += gap) {
                for (let y = 0; y < h; y += gap) {
                    const px = x + ox;
                    const wave = Math.sin(px * 0.012 + y * 0.018 + t * 0.0012);
                    ctx.globalAlpha = 0.05 + Math.max(0, wave) * 0.12;
                    ctx.fillStyle = wave > 0.85 ? a : dotColor;
                    ctx.fillRect(px, y, 1.4, 1.4);
                }
            }
            // ligne de balayage
            const sy = ((t * 0.05) % (h + 200)) - 100;
            const grad = ctx.createLinearGradient(0, sy - 80, 0, sy + 80);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(0.5, a);
            grad.addColorStop(1, 'transparent');
            ctx.globalAlpha = 0.05;
            ctx.fillStyle = grad;
            ctx.fillRect(0, sy - 80, w, 160);
            ctx.globalAlpha = 1;
            if (!reduce) raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, [reduce]);

    return (
        <div className="dash-backdrop" aria-hidden="true">
            <canvas ref={ref} />
            <div className="dash-ambient" />
        </div>
    );
}

// ── Thermostat (cadran) ──────────────────────────────────────────────────────

const TICKS = 48;
function Thermostat({ temp, humidity, pressure, setpoint, power, onChange, onToggle, compact }: {
    temp: number | null; humidity: number | null; pressure: number | null;
    setpoint: number; power: boolean; compact?: boolean;
    onChange: (v: number) => void; onToggle: () => void;
}) {
    const frac = (setpoint - 16) / 15;
    const lit = Math.round(frac * TICKS);
    const R = 116, C = 2 * Math.PI * R, ARC = C * 0.75;
    return (
        <div className={`thermo ${compact ? 'compact' : ''} ${power ? 'on' : ''}`}>
            <div className="thermo-dial">
                <svg viewBox="0 0 300 300" aria-hidden="true">
                    <g className="spin"><circle cx="150" cy="150" r="144" className="ring-a" /></g>
                    <g className="spin-rev"><circle cx="150" cy="150" r="133" className="ring-b" /></g>
                    {Array.from({ length: TICKS }, (_, i) => {
                        const ang = (135 + (i / (TICKS - 1)) * 270) * (Math.PI / 180);
                        const x1 = 150 + Math.cos(ang) * 98, y1 = 150 + Math.sin(ang) * 98;
                        const x2 = 150 + Math.cos(ang) * 104, y2 = 150 + Math.sin(ang) * 104;
                        return <motion.line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="tick"
                            animate={{ opacity: i < lit ? 1 : 0.18 }} transition={{ delay: i * 0.008 }} />;
                    })}
                    <circle cx="150" cy="150" r={R} className="arc-bg" strokeDasharray={`${ARC} ${C}`} transform="rotate(135 150 150)" />
                    <motion.circle cx="150" cy="150" r={R} className="arc" transform="rotate(135 150 150)"
                        initial={{ strokeDasharray: `0 ${C}` }}
                        animate={{ strokeDasharray: `${ARC * frac} ${C}` }}
                        transition={{ type: 'spring', stiffness: 70, damping: 16 }} />
                </svg>
                <div className="thermo-center">
                    <div className="thermo-temp"><Num value={temp} decimals={1} /><small>°</small></div>
                    {!compact && <div className="muted">{humidity != null ? `${Math.round(humidity)} %` : '--'} · {pressure != null ? `${Math.round(pressure)} hPa` : '--'}</div>}
                    <div className="thermo-set">→ {setpoint.toString().replace('.', ',')}°</div>
                    {power && <div className="heat-waves"><span /><span /><span /></div>}
                </div>
            </div>
            <div className="thermo-actions">
                <button className="btn" aria-label="Baisser la consigne" onClick={() => onChange(Math.max(16, setpoint - 0.5))}>−</button>
                <button className={`btn heat ${power ? 'active' : ''}`} onClick={onToggle}>{power ? 'ARRÊTER' : 'CHAUFFER'}</button>
                <button className="btn" aria-label="Monter la consigne" onClick={() => onChange(Math.min(31, setpoint + 0.5))}>+</button>
            </div>
        </div>
    );
}

// ── Colonne de lumière (curseur vertical) ────────────────────────────────────

function useDrag(onValue: (v: number) => void, onEnd: () => void, axis: 'x' | 'y') {
    const active = useRef(false);
    const valueFrom = (e: RPointerEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = axis === 'x' ? (e.clientX - r.left) / r.width : (r.bottom - e.clientY) / r.height;
        return Math.round(Math.max(0, Math.min(1, f)) * 20) * 5;
    };
    return {
        onPointerDown: (e: RPointerEvent<HTMLElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            active.current = true;
            onValue(valueFrom(e));
        },
        onPointerMove: (e: RPointerEvent<HTMLElement>) => active.current && onValue(valueFrom(e)),
        onPointerUp: () => {
            if (active.current) onEnd();
            active.current = false;
        },
        onPointerCancel: () => (active.current = false),
    };
}

function LightColumn({ light, index, onLevel, onEnd }: { light: DashLight; index: number; onLevel: (v: number) => void; onEnd: () => void }) {
    const [dragging, setDragging] = useState(false);
    const drag = useDrag(onLevel, () => { setDragging(false); onEnd(); }, 'y');
    const v = light.reachable ? light.level : 0;
    const style = { '--c': light.color } as CSSProperties;
    return (
        <motion.div className={`lcol ${v ? 'on' : ''} ${light.reachable ? '' : 'offline'}`} style={style}
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + index * 0.05, duration: 0.6, ease }}>
            <div className="lcol-pct">{light.reachable ? (v ? `${v}%` : 'OFF') : 'HS'}</div>
            <div className="lcol-track" role="slider" tabIndex={0} aria-label={light.name}
                aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}
                {...(light.reachable ? drag : {})}
                onPointerDownCapture={() => light.reachable && setDragging(true)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') onLevel(Math.min(100, v + 10));
                    if (e.key === 'ArrowDown') onLevel(Math.max(0, v - 10));
                }}>
                <motion.span className="lcol-fill"
                    animate={{ height: `${v}%`, backgroundColor: light.color }}
                    transition={{ height: { type: 'spring', stiffness: dragging ? 600 : 160, damping: dragging ? 40 : 20 }, backgroundColor: { duration: 0.6, delay: index * 0.04 } }}>
                    <span className="lcol-shine" />
                </motion.span>
                <AnimatePresence>
                    {dragging && (
                        <motion.span className="lcol-bubble" style={{ bottom: `${v}%` }}
                            initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
                            {v}
                        </motion.span>
                    )}
                </AnimatePresence>
            </div>
            <div className="lcol-name">{light.name}</div>
        </motion.div>
    );
}

// ── Journal ──────────────────────────────────────────────────────────────────

function Journal({ log }: { log: LogEntry[] }) {
    return (
        <ul className="journal">
            <AnimatePresence initial={false}>
                {log.map((e, i) => (
                    <motion.li key={e.id} layout initial={{ opacity: 0, x: -12, height: 0 }} animate={{ opacity: 1, x: 0, height: 'auto' }}
                        exit={{ opacity: 0 }} transition={{ duration: 0.35, ease }}>
                        <span className="muted">{e.t}</span>
                        <span style={{ color: e.color }}>{i === 0 ? <Typewriter text={e.msg} /> : e.msg}</span>
                        {e.href && <a className="ask-claude-btn" href={e.href} target="_blank" rel="noreferrer">Demander à Claude ↗</a>}
                    </motion.li>
                ))}
            </AnimatePresence>
        </ul>
    );
}

// ── Barre agent (texte + voix) ───────────────────────────────────────────────

const VOICE_PLACEHOLDER = {
    listening: 'J’écoute…',
    thinking: 'Je réfléchis…',
    speaking: 'Je réponds…',
} as const;

const WAKE_TITLE = {
    off: 'Activer « Hey Jarvis » sur cet appareil',
    loading: 'Chargement du modèle…',
    on: '« Hey Jarvis » actif — toucher pour couper',
    'needs-tap': 'Touche l’écran pour réveiller le micro',
    error: 'Mot d’activation indisponible',
} as const;

// ?voicedebug dans l'URL : état du micro, du mot d'activation et de la reconnaissance
const VOICE_DEBUG = new URLSearchParams(window.location.search).has('voicedebug');

function VoiceDebug({ voice }: { voice: ReturnType<typeof useVoice> }) {
    const [, tick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 250);
        return () => clearInterval(t);
    }, []);
    const s = voice.listenerRef.current?.stats;
    return (
        <pre style={{ width: '100%', margin: 0, fontSize: 12, opacity: 0.8 }}>
            {`jarvis=${voice.wakeStatus}${voice.wakeError ? ` (${voice.wakeError})` : ''} blocs=${s?.chunks ?? '-'} niveau=${s ? s.level.toFixed(3) : '-'} score=${s ? s.score.toFixed(2) : '-'} perdus=${s?.dropped ?? '-'} micro=${s?.mic || '-'}
`}
            {`reco=${voice.supported ? 'ok' : 'indispo'} état=${voice.state} étapes: ${voice.trace.join(' → ') || '-'}`}
        </pre>
    );
}

function AgentBar({ onAsk, chips }: { onAsk: (m: string) => Promise<string | undefined>; chips: string[] }) {
    const [text, setText] = useState('');
    const voice = useVoice(onAsk);
    const listening = voice.state === 'listening';
    const noMic = !voice.secure
        ? 'Micro bloqué : la page doit être en HTTPS (ou origine autorisée dans Chrome)'
        : 'Reconnaissance vocale non disponible dans ce navigateur';
    const wakeFailed = voice.wakeStatus === 'error' ? `Jarvis indisponible : ${voice.wakeError}` : null;
    const placeholder =
        voice.state === 'idle'
            ? voice.voiceError || wakeFailed
                || (voice.wakeStatus === 'on' ? 'Dis « Hey Jarvis » ou écris ici' : 'Dis-moi ce que tu veux')
            : VOICE_PLACEHOLDER[voice.state];

    return (
        <div className="agentbar">
            <form className={`agent-input ${listening ? 'listening' : ''}`} onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onAsk(text.trim());
                setText('');
            }}>
                <span className="accent">&gt;</span>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Commande pour l'agent" />
                {listening && <span className="wave" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}</span>}
                <button type="button" className="mic" aria-label="Parler à l'agent" onClick={voice.converse}
                    disabled={!voice.supported || voice.state !== 'idle'} title={voice.supported ? undefined : noMic}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </button>
            </form>
            <button type="button" className={`chip wake ${voice.wakeEnabled ? 'on' : ''} ${voice.wakeStatus}`}
                onClick={() => voice.setWakeEnabled(!voice.wakeEnabled)} disabled={!voice.supported} aria-pressed={voice.wakeEnabled}
                title={voice.supported ? (voice.wakeError ? `${WAKE_TITLE.error} : ${voice.wakeError}` : WAKE_TITLE[voice.wakeStatus]) : noMic}>
                Jarvis
            </button>
            {chips.map((c) => <button key={c} className="chip" onClick={() => onAsk(c)}>{c}</button>)}
            {VOICE_DEBUG && <VoiceDebug voice={voice} />}
        </div>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function Dashboard() {
    const home = useHome();
    const clock = useClock();
    const [target, setTarget] = useState('Maison');

    const visible = useMemo(
        () => home.lights.filter((l) => target === 'Maison' || l.room === target),
        [home.lights, target],
    );
    const live = visible.filter((l) => l.reachable);
    const lit = live.filter((l) => l.level > 0);
    // Sans lumière colorée allumée, l'accent suit le thème (lime en sombre, olive en clair)
    const { darkness } = useTheme();
    const accent = useMemo(() => {
        const top = home.lights.filter((l) => l.reachable && l.level > 0 && l.colorable).sort((a, b) => b.level - a.level)[0];
        return top?.color || themeColor('accent') || '#C8F560';
        // eslint-disable-next-line react-hooks/exhaustive-deps -- darkness relit le token --accent
    }, [home.lights, darkness]);
    const master = live.length ? Math.round(live.reduce((a, l) => a + l.level, 0) / live.length) : 0;
    const ids = live.map((l) => l.id);
    const masterDrag = useDrag((v) => home.setLevel(ids, v), () => home.push(`${target} · intensité ${master} %`, accent), 'x');
    const many = visible.length > 6;
    const activeSwatch = SWATCHES.find((s) => lit.length && lit.every((l) => l.color === s.hex));

    // Accent animé en douceur (CSS var interpolée)
    const rootRef = useRef<HTMLDivElement>(null);
    const prevAccent = useRef(accent);
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const ctl = animate(prevAccent.current, accent, {
            duration: 0.8,
            onUpdate: (c) => el.style.setProperty('--accent', c),
        });
        prevAccent.current = accent;
        return () => ctl.stop();
    }, [accent]);

    const h = home.heating;
    const offline = home.lights.filter((l) => !l.reachable).length;

    return (
        <div className="dash" ref={rootRef} style={{ '--accent': accent } as CSSProperties}>
            <Backdrop accent={accent} />

            <motion.header className="dash-top" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                <span className="logo">MYHUE<span className="accent">//</span>HOME</span>
                <span className="status">
                    <span className={`dot ${home.online.zigbee ? 'ok' : ''}`} /><span className="st">ZIGBEE</span>
                    <span className={`dot ${home.online.hue ? 'ok' : ''}`} /><span className="st">HUE {home.lights.length - offline}/{home.lights.length}</span>
                    <span className={`dot ${h?.connected ? 'ok' : ''}`} /><span className="st">CLIM</span>
                    <span className="clock">{clock.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }).toUpperCase()} · {clock.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <Link to="/apps" className="apps-link" aria-label="Toutes les apps">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></svg>
                    </Link>
                </span>
            </motion.header>

            <div className="dash-ticker">
                <AnimatePresence mode="wait">
                    {home.log[0] && (
                        <motion.div key={home.log[0].id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                            <span className="muted">{home.log[0].t}</span> <span style={{ color: home.log[0].color }}>{home.log[0].msg}</span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="dash-left">
                <Panel delay={0.1} className="thermo-panel">
                    <div className="panel-head"><span>{(home.climate as any).name?.toUpperCase() || 'SALON'}</span><span className={h?.power ? 'heat-on' : ''}>{h?.power ? '● CHAUD' : '○ ARRÊT'}</span></div>
                    <Thermostat
                        temp={home.climate.temperature} humidity={home.climate.humidity} pressure={home.climate.pressure}
                        setpoint={h?.temperature ?? 22} power={!!h?.power}
                        onChange={(t) => { home.controlHeating({ temperature: t }); }}
                        onToggle={() => { home.controlHeating({ power: !h?.power }); home.push(h?.power ? 'Clim · arrêt' : `Clim · chaud ${h?.temperature ?? 22}°`, themeColor('warn')); }}
                    />
                </Panel>
                {home.door && (
                    <Panel delay={0.18} className={`door-panel ${home.door.open ? 'open' : ''}`}>
                        <div>
                            <div className="panel-head"><span>{home.door.name.toUpperCase()}</span></div>
                            <motion.div key={String(home.door.open)} className="door-state" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
                                {home.door.open ? 'OUVERTE' : 'FERMÉE'}
                            </motion.div>
                            <div className="muted small">depuis {home.door.since}</div>
                        </div>
                        <svg className="door-icon" width="44" height="60" viewBox="0 0 44 60" aria-hidden="true">
                            <rect x="4" y="2" width="36" height="56" rx="2" className="frame" />
                            <motion.g style={{ originX: '8px' }} animate={{ skewY: home.door.open ? -12 : 0, scaleX: home.door.open ? 0.55 : 1 }} transition={{ type: 'spring', stiffness: 120, damping: 14 }}>
                                <rect x="8" y="6" width="28" height="48" className="leaf" />
                                <circle cx="30" cy="31" r="2" className="knob" />
                            </motion.g>
                        </svg>
                    </Panel>
                )}
            </div>

            <Panel delay={0.14} className="lights-panel">
                <div className="lights-head">
                    <span className="label">LUMIÈRES</span>
                    <div className="targets">
                        {['Maison', ...home.rooms].map((r) => (
                            <button key={r} className={`tgt ${target === r ? 'active' : ''}`} onClick={() => setTarget(r)}>
                                {target === r && <motion.span layoutId="tgt-bg" className="tgt-bg" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                                <span className="tgt-label">{r}</span>
                            </button>
                        ))}
                    </div>
                    <span className="count"><b><Num value={lit.length} /></b> / {visible.length} ON</span>
                </div>

                <div className="master-row">
                    <button className="btn icon" aria-label="Tout éteindre" onClick={() => { home.setLevel(ids, 0); home.push(`${target} · tout éteint`); }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0" /></svg>
                    </button>
                    <div className="master" role="slider" tabIndex={0} aria-label={`Intensité ${target}`} aria-valuenow={master} aria-valuemin={0} aria-valuemax={100} {...masterDrag}>
                        <motion.div className="master-fill" animate={{ width: `${master}%` }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} />
                        <div className="master-label"><span>INTENSITÉ · {target.toUpperCase()}</span><span>{master} %</span></div>
                    </div>
                </div>

                <div className="swatches">
                    <span className="label">COULEUR</span>
                    <div className="swatch-list">
                        {SWATCHES.map((s) => (
                            <button key={s.label} className="swatch" aria-label={s.label} style={{ background: s.hex }}
                                onClick={() => { home.setColor(ids, s); home.push(`${target} · ${s.label}`, s.hex); }}>
                                {activeSwatch?.label === s.label && <motion.span layoutId="swatch-ring" className="swatch-ring" />}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={`columns ${many ? 'many' : ''}`}>
                    {visible.map((l, i) => (
                        <LightColumn key={l.id} light={l} index={i}
                            onLevel={(v) => home.setLevel([l.id], v)}
                            onEnd={() => home.push(`${l.name} → ${l.level ? l.level + ' %' : 'OFF'}`, l.color)} />
                    ))}
                    {!visible.length && <div className="muted">Pont Hue injoignable…</div>}
                </div>
            </Panel>

            <Panel delay={0.2} className="journal-panel">
                <div className="panel-head"><span>JOURNAL</span><span className="live"><span className="dot ok" />LIVE</span></div>
                <Journal log={home.log} />
            </Panel>

            <motion.div className="dash-bottom" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }}>
                <AgentBar onAsk={home.askAgent} chips={['Mode cinéma', 'Éteins tout', 'Chauffe à 21°']} />
            </motion.div>
        </div>
    );
}
