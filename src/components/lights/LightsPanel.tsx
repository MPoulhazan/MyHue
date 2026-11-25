import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import { motion } from 'framer-motion';
import { SWATCHES } from '../../hooks/useHome';
import type { useHome, Ambiance, DashLight } from '../../hooks/useHome';
import { Icon } from '../Icon';
import { avgLevel, useLastLevel, useLevelGesture } from '../home/levels';
import { HueStatus, RoomCard } from '../home/cards';
import './LightsPanel.css';

// Écran Lumières : les pièces › une pièce › ses lampes (tablette et téléphone)

// Ambiances prêtes : blanc plus ou moins chaud (mireds) à une intensité donnée
const AMBIANCES: (Ambiance & { bg: string; fg: string })[] = [
    { label: 'Lecture', ct: 233, level: 100, bg: '#F7E7C4', fg: '#2A2418' },
    { label: 'Détente', ct: 400, level: 60, bg: '#FFB45C', fg: '#2A2418' },
    { label: 'Focus', ct: 200, level: 100, bg: '#DCE8FF', fg: '#10213D' },
    { label: 'Bougie', ct: 500, level: 25, bg: '#6E3B1E', fg: '#FFE2C4' },
    { label: 'Veilleuse', ct: 454, level: 5, bg: '#3A2A12', fg: '#F2D9A6' },
];

/** Curseur horizontal : glisser ou flèches du clavier, par pas de 5 %. */
function Slider({ value, label, onChange, className = '' }: { value: number; label: string; onChange: (v: number) => void; className?: string }) {
    const active = useRef(false);
    const valueAt = (e: RPointerEvent<HTMLDivElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 20) * 5;
    };
    return (
        <div className={`slider ${className}`} role="slider" tabIndex={0} aria-label={label}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
            onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                active.current = true;
                onChange(valueAt(e));
            }}
            onPointerMove={(e) => active.current && onChange(valueAt(e))}
            onPointerUp={() => (active.current = false)}
            onPointerCancel={() => (active.current = false)}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'ArrowRight') onChange(Math.min(100, value + 5));
                if (e.key === 'ArrowLeft') onChange(Math.max(0, value - 5));
            }}>
            <motion.span className="slider-fill" animate={{ width: `${value}%` }} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
        </div>
    );
}

/** Lampes groupées par pièce Hue, dans l'ordre des pièces. */
function useRoomLights(home: ReturnType<typeof useHome>) {
    return useMemo(() => {
        const map = new Map<string, DashLight[]>();
        for (const r of home.rooms) map.set(r, []);
        for (const l of home.lights) {
            if (!map.has(l.room)) map.set(l.room, []);
            map.get(l.room)!.push(l);
        }
        return [...map.entries()].filter(([, ls]) => ls.length);
    }, [home.rooms, home.lights]);
}

// ── Lampe de l'entrée : minuterie du détecteur, en anneau autour de l'ampoule ─

type EntranceTimer = { lightId: string; endsAt: number; total: number };

/** Interroge /api/entrance-light tant qu'une lampe de la pièce est allumée. */
function useEntranceTimer(active: boolean): EntranceTimer | null {
    const [timer, setTimer] = useState<EntranceTimer | null>(null);
    useEffect(() => {
        if (!active) return setTimer(null);
        let alive = true;
        const load = () => fetch('/api/entrance-light').then((r) => (r.ok ? r.json() : null)).then((d) => {
            if (!alive || !d) return;
            // compté sur l'horloge de la tablette à partir du temps restant vu par le Pi
            setTimer(d.offAt && d.lightId ? { lightId: String(d.lightId), endsAt: Date.now() + (d.offAt - d.now), total: d.offAfterSec * 1000 } : null);
        }).catch(() => {});
        load();
        const t = setInterval(load, 3000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [active]);
    return timer;
}

function useSecondTick(on: boolean) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!on) return;
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [on]);
    return now;
}

const mmss = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ── Lampe : toucher = marche/arrêt, glisser = intensité ─────────────────────

function LampTile({ light, onLevel, timer }: { light: DashLight; onLevel: (v: number) => void; timer?: EntranceTimer | null }) {
    const lastLevel = useLastLevel(light.level);
    const on = light.reachable && light.level > 0;
    const now = useSecondTick(Boolean(on && timer));
    const left = on && timer ? Math.max(0, timer.endsAt - now) : 0;
    const showTimer = left > 0;
    const { dragging, handlers } = useLevelGesture(light.level, (v) => light.dimmable && onLevel(v), () => onLevel(on ? 0 : lastLevel.current));

    if (!light.reachable) {
        return (
            <div className="lamp-tile offline">
                <span className="lamp-bulb"><Icon name="lights" size={20} strokeWidth={2} /></span>
                <span className="lamp-label">
                    <span className="lamp-tile-name">{light.name}</span>
                    <span className="warn">Injoignable</span>
                </span>
            </div>
        );
    }

    return (
        <div className={`lamp-tile ${on ? 'on' : ''} ${dragging ? 'dragging' : ''} ${showTimer && left <= 15_000 ? 'ending' : ''}`}
            role="slider" tabIndex={0} aria-label={light.name}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={light.level} aria-valuetext={on ? `${light.level} %` : 'éteinte'}
            {...handlers}>
            {light.dimmable && (
                <motion.span className="lamp-tile-fill" aria-hidden="true"
                    animate={{ width: `${on ? light.level : 0}%` }} transition={{ type: 'spring', stiffness: dragging ? 700 : 200, damping: 34 }} />
            )}
            <span className="lamp-tile-top">
                <span className="lamp-bulb" style={on ? { background: light.color, boxShadow: `0 0 24px ${light.color}66` } : undefined}>
                    {showTimer && timer && (
                        <span className="lamp-timer-ring" aria-hidden="true"
                            style={{ '--p': Math.min(1, left / timer.total), '--ring': light.color } as CSSProperties} />
                    )}
                    <Icon name="lights" size={20} strokeWidth={2} />
                </span>
                {on && light.dimmable && <span className="room-pct">{light.level} %</span>}
            </span>
            <span className="lamp-label">
                <span className="lamp-tile-name">{light.name}</span>
                <span className="muted">
                    {!light.dimmable ? 'Prise' : on ? 'Allumée' : 'Éteinte'}
                    {showTimer && <> · <span className="lamp-timer-left" title="S'éteint toute seule (détecteur)">{mmss(left)}</span></>}
                </span>
            </span>
        </div>
    );
}

// ── Panneau complet : les pièces › la pièce choisie et ses lampes ────────────

export function LightsPanel({ home, room, onRoom }: {
    home: ReturnType<typeof useHome>;
    room: string | null;
    onRoom: (room: string) => void;
}) {
    const roomLights = useRoomLights(home);
    const [colors, setColors] = useState(false);

    const current = roomLights.find(([r]) => r === room) ?? roomLights[0];
    const [roomName, lights] = current ?? ['', []];
    const entranceTimer = useEntranceTimer(lights.some((l) => l.reachable && l.level > 0));
    const roomIds = lights.filter((l) => l.reachable).map((l) => l.id);
    const roomLevel = avgLevel(lights);
    const scenes = home.roomScenes[roomName] ?? [];

    return (
        <div className="lights-layout">
            <section className="lights-rooms" aria-label="Pièces">
                <div className="lights-room-list">
                    {roomLights.map(([r, ls]) => (
                        <RoomCard key={r} name={r} lights={ls} selected={r === roomName}
                            onOpen={() => onRoom(r)}
                            onLevel={(v) => home.setLevel(ls.map((l) => l.id), v)} />
                    ))}
                    <HueStatus />
                </div>
            </section>

            {current && (
                <section className="card lights-lamps" aria-label={`Lampes de ${roomName}`}>
                    <div className="lights-lamps-head">
                        <h2>{roomName}</h2>
                        <span className="light-text mono">{roomLevel ? `${roomLevel} %` : 'éteinte'}</span>
                    </div>
                    <Slider value={roomLevel} label={`Intensité ${roomName}`} onChange={(v) => home.setLevel(roomIds, v)} className="big" />
                    <div className="lights-ambiances">
                        {AMBIANCES.map((a) => (
                            <button key={a.label} type="button" style={{ background: a.bg, color: a.fg }}
                                onClick={() => home.applyAmbiance(roomIds, a)}>{a.label}</button>
                        ))}
                        <button type="button" className={`ambiance-color ${colors ? 'open' : ''}`} aria-expanded={colors}
                            onClick={() => setColors((c) => !c)}>
                            <span className="dots" aria-hidden="true"><i style={{ background: '#FF7A59' }} /><i style={{ background: '#A26BFF' }} /><i style={{ background: '#4F7DFF' }} /></span>
                            Couleur
                        </button>
                    </div>
                    {colors && (
                        <div className="swatches">
                            {SWATCHES.filter((s) => !s.ct).map((s) => (
                                <button key={s.label} type="button" aria-label={s.label} style={{ background: s.hex }}
                                    onClick={() => home.setColor(roomIds, s)} />
                            ))}
                        </div>
                    )}
                    {scenes.length > 0 && (
                        <div className="lights-scenes" role="group" aria-label={`Scènes Hue de ${roomName}`}>
                            {scenes.map((s) => (
                                <button key={s.id} type="button" onClick={() => home.activateScene(roomName, s)}>{s.name}</button>
                            ))}
                        </div>
                    )}
                    <div className="lamp-grid">
                        {lights.map((l) => (
                            <LampTile key={l.id} light={l} onLevel={(v) => home.setLevel([l.id], v)}
                                timer={entranceTimer?.lightId === l.id ? entranceTimer : null} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
