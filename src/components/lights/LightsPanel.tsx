import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import { motion } from 'framer-motion';
import { SWATCHES } from '../../hooks/useHome';
import type { useHome, Ambiance, DashLight } from '../../hooks/useHome';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { avgLevel, useLastLevel, useLevelGesture } from '../home/levels';
import './LightsPanel.css';

// Écran Lumières : toute la maison › une pièce › ses lampes (tablette et onglet du téléphone)

// Ambiances prêtes : blanc plus ou moins chaud (mireds) à une intensité donnée
const AMBIANCES: (Ambiance & { bg: string; fg: string })[] = [
    { label: 'Lecture', ct: 233, level: 100, bg: '#F7E7C4', fg: '#2A2418' },
    { label: 'Détente', ct: 400, level: 60, bg: '#FFB45C', fg: '#2A2418' },
    { label: 'Focus', ct: 200, level: 100, bg: '#DCE8FF', fg: '#10213D' },
    { label: 'Bougie', ct: 500, level: 25, bg: '#6E3B1E', fg: '#FFE2C4' },
    { label: 'Veilleuse', ct: 454, level: 5, bg: '#3A2A12', fg: '#F2D9A6' },
];

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

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

// ── Pièce : toucher = la choisir, glisser = intensité, interrupteur = marche/arrêt

function RoomTile({ name, lights, selected, onSelect, onLevel }: {
    name: string;
    lights: DashLight[];
    selected: boolean;
    onSelect: () => void;
    onLevel: (v: number) => void;
}) {
    const on = lights.filter((l) => l.reachable && l.level > 0);
    const level = avgLevel(lights);
    const lastLevel = useLastLevel(level);
    const { dragging, handlers } = useLevelGesture(level, onLevel, onSelect);
    const toggle = () => onLevel(on.length ? 0 : lastLevel.current);

    return (
        <div className={`lights-room ${on.length ? 'on' : ''} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
            role="slider" tabIndex={0} aria-label={`${name}${selected ? ', affichée' : ''}`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} aria-valuetext={on.length ? `${level} %` : 'éteinte'}
            {...handlers}>
            <motion.span className="room-fill" aria-hidden="true"
                animate={{ width: `${level}%` }} transition={{ type: 'spring', stiffness: dragging ? 700 : 200, damping: 34 }} />
            <span className="lights-room-text">
                <span className="room-name">{name}</span>
                <span className="lights-room-sub">
                    <span className="room-sub">{on.length ? `${on.length} sur ${lights.length} allumée${on.length > 1 ? 's' : ''}` : `Éteinte · ${plural(lights.length, 'lampe')}`}</span>
                    {on.length > 0 && <span className="room-pct">{level} %</span>}
                </span>
            </span>
            <button type="button" className={`switch ${on.length ? 'on light' : ''}`} aria-pressed={on.length > 0}
                aria-label={`${on.length ? 'Éteindre' : 'Allumer'} ${name}`} onClick={toggle}>
                <span />
            </button>
        </div>
    );
}

// ── Lampe : toucher = marche/arrêt, glisser = intensité ─────────────────────

function LampTile({ light, onLevel }: { light: DashLight; onLevel: (v: number) => void }) {
    const lastLevel = useLastLevel(light.level);
    const on = light.reachable && light.level > 0;
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
        <div className={`lamp-tile ${on ? 'on' : ''} ${dragging ? 'dragging' : ''}`}
            role="slider" tabIndex={0} aria-label={light.name}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={light.level} aria-valuetext={on ? `${light.level} %` : 'éteinte'}
            {...handlers}>
            {light.dimmable && (
                <motion.span className="lamp-tile-fill" aria-hidden="true"
                    animate={{ width: `${on ? light.level : 0}%` }} transition={{ type: 'spring', stiffness: dragging ? 700 : 200, damping: 34 }} />
            )}
            <span className="lamp-tile-top">
                <span className="lamp-bulb" style={on ? { background: light.color, boxShadow: `0 0 24px ${light.color}66` } : undefined}>
                    <Icon name="lights" size={20} strokeWidth={2} />
                </span>
                {on && <span className="room-pct">{light.dimmable ? `${light.level} %` : 'on'}</span>}
            </span>
            <span className="lamp-label">
                <span className="lamp-tile-name">{light.name}</span>
                <span className="muted">{!light.dimmable ? 'Prise' : on ? 'Allumée' : 'Éteinte'}</span>
            </span>
        </div>
    );
}

// ── Panneau complet ──────────────────────────────────────────────────────────

export function LightsPanel({ home, room, onRoom }: {
    home: ReturnType<typeof useHome>;
    room: string | null;
    onRoom: (room: string) => void;
}) {
    const roomLights = useRoomLights(home);
    const [colors, setColors] = useState(false);

    const live = home.lights.filter((l) => l.reachable);
    const onCount = live.filter((l) => l.level > 0).length;
    const houseLevel = avgLevel(home.lights);
    const allIds = live.map((l) => l.id);

    const current = roomLights.find(([r]) => r === room) ?? roomLights[0];
    const [roomName, lights] = current ?? ['', []];
    const roomIds = lights.filter((l) => l.reachable).map((l) => l.id);
    const roomLevel = avgLevel(lights);

    return (
        <div className="lights-layout">
            <section className="card lights-house" aria-label="Toute la maison">
                <div className="card-head">
                    <span>Toute la maison</span>
                    <span className="pill">{onCount} / {home.lights.length} allumées</span>
                </div>
                <div className="lights-big mono">{houseLevel}<span> %</span></div>
                <Slider value={houseLevel} label="Intensité de toute la maison" onChange={(v) => home.setLevel(allIds, v)} className="big" />
                <div className="lights-pair">
                    <button type="button" className="pill-btn" onClick={() => home.setLevel(allIds, 70)}>Tout allumer</button>
                    <button type="button" className="pill-btn solid" onClick={() => home.setLevel(allIds, 0)}>Tout éteindre</button>
                </div>
                {home.moments.length > 0 && (
                    <>
                        <h2 className="sub-title">Moments</h2>
                        <div className="lights-moments">
                            {home.moments.map((m) => (
                                <button key={m.id} type="button" onClick={() => home.runMoment(m.id)}>
                                    <Icon name={m.icon as IconName} size={20} />{m.label}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </section>

            <section className="lights-rooms" aria-label="Pièces">
                <div className="section-head">
                    <h2>Pièces</h2>
                    <span className="muted lights-tip">Toucher : voir ses lampes</span>
                </div>
                <div className="lights-room-list">
                    {roomLights.map(([r, ls]) => (
                        <RoomTile key={r} name={r} lights={ls} selected={r === roomName}
                            onSelect={() => onRoom(r)}
                            onLevel={(v) => home.setLevel(ls.map((l) => l.id), v)} />
                    ))}
                    {!home.online.hue && !home.lights.length && <div className="muted">Pont Hue injoignable…</div>}
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
                    <div className="lamp-grid">
                        {lights.map((l) => (
                            <LampTile key={l.id} light={l} onLevel={(v) => home.setLevel([l.id], v)} />
                        ))}
                    </div>
                    <span className="hint">Toucher une lampe : marche / arrêt · Glisser : intensité</span>
                </section>
            )}
        </div>
    );
}
