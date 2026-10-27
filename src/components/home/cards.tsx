import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { useHome, DashLight, LogEntry, Sensor } from '../../hooks/useHome';
import { Icon } from '../Icon';

// Cartes du tableau de bord, partagées par la tablette et le téléphone

export const fmt = (n: number | null | undefined, decimals = 1) =>
    n == null ? '--' : n.toFixed(decimals).replace('.', ',');

export const hhmm = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function useClock() {
    const [d, setD] = useState(new Date());
    useEffect(() => {
        const t = setInterval(() => setD(new Date()), 15_000);
        return () => clearInterval(t);
    }, []);
    return d;
}

export const greeting = (d: Date) => {
    const h = d.getHours();
    if (h >= 23 || h < 5) return 'Bonne nuit';
    if (h >= 18) return 'Bonsoir';
    return 'Bonjour';
};

const avgLevel = (lights: DashLight[]) => {
    const on = lights.filter((l) => l.reachable && l.level > 0);
    return on.length ? Math.round(on.reduce((a, l) => a + l.level, 0) / on.length) : 0;
};

// ── Carte de pièce : toucher = marche/arrêt, glisser = intensité ─────────────

export function RoomCard({ name, lights, sensors, onLevel, onOpen }: {
    name: string;
    lights: DashLight[];
    sensors: Sensor[];
    onLevel: (v: number) => void;
    onOpen: () => void;
}) {
    const live = lights.filter((l) => l.reachable);
    const on = live.filter((l) => l.level > 0);
    const level = avgLevel(lights);
    const lastLevel = useRef(level || 70);
    if (level) lastLevel.current = level;
    const gesture = useRef<{ x: number; base: number; moved: boolean; width: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const toggle = () => onLevel(on.length ? 0 : lastLevel.current);

    if (!lights.length) {
        // Pièce sans lampe : seulement ses capteurs
        return (
            <div className="room-card empty">
                <span className="room-name">{name}</span>
                <span className="room-sub">{sensors.length ? `${sensors.length} capteur${sensors.length > 1 ? 's' : ''}` : 'Aucun appareil'}</span>
            </div>
        );
    }

    const handlers = {
        onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
            if ((e.target as HTMLElement).closest('button')) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            gesture.current = { x: e.clientX, base: level, moved: false, width: e.currentTarget.clientWidth };
        },
        onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
            const g = gesture.current;
            if (!g) return;
            const dx = e.clientX - g.x;
            if (!g.moved && Math.abs(dx) < 10) return;
            if (!g.moved) {
                g.moved = true;
                setDragging(true);
            }
            const v = Math.round(Math.max(0, Math.min(100, g.base + (dx / g.width) * 100)) / 5) * 5;
            onLevel(v);
        },
        onPointerUp: () => {
            const g = gesture.current;
            gesture.current = null;
            setDragging(false);
            if (g && !g.moved) toggle();
        },
        onPointerCancel: () => {
            gesture.current = null;
            setDragging(false);
        },
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
            if (e.key === 'ArrowRight') onLevel(Math.min(100, level + 10));
            if (e.key === 'ArrowLeft') onLevel(Math.max(0, level - 10));
        },
    };

    const sub = on.length
        ? `${on.length} sur ${lights.length} allumée${on.length > 1 ? 's' : ''}`
        : live.length ? `Éteinte · ${lights.length} lampe${lights.length > 1 ? 's' : ''}` : 'Injoignable';

    return (
        <div className={`room-card ${on.length ? 'on' : ''} ${dragging ? 'dragging' : ''}`}
            role="slider" tabIndex={0} aria-label={`Lumière ${name}`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} aria-valuetext={on.length ? `${level} %` : 'éteinte'}
            {...handlers}>
            <motion.span className="room-fill" aria-hidden="true"
                animate={{ width: `${level}%` }} transition={{ type: 'spring', stiffness: dragging ? 700 : 200, damping: 34 }} />
            <span className="room-top">
                <span className="room-name">{name}</span>
                <button type="button" className="room-more" aria-label={`Détail ${name}`} onClick={onOpen}>
                    <Icon name="lights" size={20} strokeWidth={2} />
                </button>
            </span>
            <span className="room-bottom">
                <span className="room-sub">{sub}</span>
                {on.length > 0 && <span className="room-pct">{level} %</span>}
            </span>
        </div>
    );
}

// ── Climat ───────────────────────────────────────────────────────────────────

const MODES: { id: string; label: string }[] = [
    { id: 'heat', label: 'Chaud' },
    { id: 'cool', label: 'Froid' },
    { id: 'auto', label: 'Auto' },
];

export function ClimateCard({ home, onSchedule }: { home: ReturnType<typeof useHome>; onSchedule: () => void }) {
    const h = home.heating;
    const t = home.thermostat;
    const smart = Boolean(t?.enabled && t.target != null);
    const room = home.sensors.find((s) => s.props.temperature != null);
    const openOutside = home.sensors.filter((s) => s.type === 'door' && s.outside && s.props.isOpen);
    // Thermostat actif : la consigne est celle de la pièce, et la changer crée une dérogation
    const setpoint = smart ? t!.target! : h?.temperature ?? 22;
    const step = smart ? 0.5 : 1;
    const changeSetpoint = (v: number) =>
        smart ? home.overrideTarget(v) : home.controlHeating({ temperature: v, power: true });
    const programLabel = !t?.enabled
        ? 'désactivé'
        : t.why === 'dérogation'
            ? `${fmtTarget(t.target)}° jusqu'à ${t.untilLabel ?? 'la prochaine période'}`
            : t.untilLabel
                ? `${t.why} ${fmtTarget(t.target)}° jusqu'à ${t.untilLabel}`
                : `${t.why} ${fmtTarget(t.target)}°`;
    const modeLabel = !h?.power ? 'Arrêt' : MODES.find((m) => m.id === h.mode)?.label ?? h.mode;

    return (
        <section className="card climate" aria-label="Climat">
            <div className="card-head">
                <span>Climat · {room?.name ?? 'Salon'}</span>
                <span className={`pill ${h?.power ? 'cool' : ''}`}>{modeLabel}</span>
            </div>
            <div>
                <div className="big-temp">{fmt(room?.props.temperature)}°</div>
                <div className="muted">Humidité {fmt(room?.props.humidity, 0)} % · {fmt(room?.props.pressure, 0)} hPa</div>
            </div>
            {openOutside.length > 0 && (
                <div className="warn-line">{openOutside.map((s) => s.name).join(', ')} ouverte : chauffage en pause automatique</div>
            )}
            <div className="stepper">
                <button type="button" aria-label="Baisser la consigne" onClick={() => changeSetpoint(setpoint - step)}>−</button>
                <div>
                    <div className="stepper-label">{smart ? 'Consigne pièce' : 'Consigne'}</div>
                    <div className="stepper-value">{fmtTarget(setpoint)}°</div>
                </div>
                <button type="button" aria-label="Monter la consigne" onClick={() => changeSetpoint(setpoint + step)}>+</button>
            </div>
            <div className="modes">
                {MODES.map((m) => (
                    <button key={m.id} type="button" className={h?.power && h.mode === m.id ? 'active' : ''}
                        aria-pressed={!!h?.power && h.mode === m.id}
                        onClick={() => home.controlHeating({ mode: m.id, power: true })}>{m.label}</button>
                ))}
                <button type="button" className={!h?.power ? 'active off' : ''} aria-pressed={!h?.power}
                    onClick={() => home.controlHeating({ power: false })}>Arrêt</button>
            </div>
            <div className="card-foot">
                <button type="button" className="foot-link" onClick={onSchedule}>
                    <span>Programme</span><span>{programLabel} ›</span>
                </button>
                {smart && t?.status.text && <div className="foot-note">{t.status.text}</div>}
                <div><span>Dernière commande</span><span>{h?.lastUpdated ? hhmm(new Date(h.lastUpdated)) : 'aucune'}</span></div>
                {!h?.connected && <div><span>Émetteur infrarouge</span><span className="warn">non connecté</span></div>}
            </div>
        </section>
    );
}

const fmtTarget = (n: number | null | undefined) => (n == null ? '--' : String(n).replace('.', ','));

// ── Maison : ouvertures, piles ───────────────────────────────────────────────

export function HouseCard({ sensors, onAdd }: { sensors: Sensor[]; onAdd: () => void }) {
    const doors = sensors.filter((s) => s.type === 'door');
    const open = doors.filter((s) => s.props.isOpen);
    const batteries = sensors.map((s) => s.props.battery).filter((b): b is number => b != null);
    const lowest = batteries.length ? Math.min(...batteries) : null;
    const offline = sensors.filter((s) => !s.isOnline);

    return (
        <section className="card house" aria-label="Maison">
            <div className={`house-status ${open.length ? 'alert' : ''}`}>
                <span className="house-icon"><Icon name={open.length ? 'door' : 'check'} size={18} strokeWidth={2.2} /></span>
                <span>{open.length ? `${open.map((s) => s.name).join(', ')} ouverte${open.length > 1 ? 's' : ''}` : 'Tout est fermé'}</span>
            </div>
            <ul className="house-list">
                {doors.map((s) => (
                    <li key={s.did}><span>{s.name}</span><span className={s.props.isOpen ? 'warn' : 'muted'}>
                        {s.props.isOpen ? 'ouverte' : 'fermée'}{s.lastUpdated ? ` · ${hhmm(new Date(s.lastUpdated))}` : ''}</span></li>
                ))}
                {lowest != null && <li><span>Piles</span><span className={lowest < 20 ? 'warn' : 'muted'}>{lowest} % au plus bas</span></li>}
                {offline.length > 0 && <li><span>Hors ligne</span><span className="warn">{offline.map((s) => s.name).join(', ')}</span></li>}
            </ul>
            <button type="button" className="ghost-btn" onClick={onAdd}><Icon name="plus" size={18} /> Ajouter un capteur</button>
        </section>
    );
}

export function Journal({ log }: { log: LogEntry[] }) {
    return (
        <section className="card journal" aria-label="Journal">
            <h2 className="card-title">Journal</h2>
            <ul>
                <AnimatePresence initial={false}>
                    {log.map((e) => (
                        <motion.li key={e.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                            <span className="journal-time">{e.t}</span>
                            <span style={{ color: e.color }}>{e.msg}
                                {e.href && <a className="journal-link" href={e.href} target="_blank" rel="noreferrer"> Demander à Claude ↗</a>}
                            </span>
                        </motion.li>
                    ))}
                </AnimatePresence>
                {!log.length && <li className="muted">Rien pour l'instant.</li>}
            </ul>
        </section>
    );
}

// ── Menu des autres écrans ───────────────────────────────────────────────────

const PAGES: { to: string; label: string }[] = [
    { to: '/music', label: 'Musique' },
    { to: '/agent', label: 'Conversation avec l’agent' },
    { to: '/rules', label: 'Automatismes' },
    { to: '/heating', label: 'Chauffage avancé' },
    { to: '/google-home', label: 'Capteurs et appareils Cast' },
    { to: '/scenes', label: 'Scènes Hue' },
];

export function MenuSheet({ onClose }: { onClose: () => void }) {
    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <motion.div className="sheet menu-sheet" role="dialog" aria-modal="true" aria-label="Menu"
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <h2>Autres écrans</h2>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>
                <nav className="menu-list">
                    {PAGES.map((p) => <Link key={p.to} to={p.to}>{p.label}</Link>)}
                </nav>
            </motion.div>
        </div>
    );
}

