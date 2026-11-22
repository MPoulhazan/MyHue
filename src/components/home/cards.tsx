import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useHomeData, isRoomThermo } from '../../hooks/useHome';
import type { useHome, DashLight, LogEntry, Sensor } from '../../hooks/useHome';
import { Icon } from '../Icon';
import { avgLevel, useLastLevel, useLevelGesture } from './levels';
import { WidgetCard } from './widgets/WidgetCard';

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

/** Ligne à la place des pièces tant que le pont Hue n'a pas donné ses lampes. */
export function HueStatus() {
    const home = useHomeData();
    if (home.lights.length || home.online.hue) return null;
    return <div className="muted">{home.online.hue === null ? 'Connexion au pont Hue…' : 'Pont Hue injoignable'}</div>;
}

// ── Carte de pièce, la même partout : toucher = ouvrir, interrupteur = marche/arrêt,
// glisser = intensité

export function RoomCard({ name, lights, sensors = [], selected = false, onLevel, onOpen }: {
    name: string;
    lights: DashLight[];
    sensors?: Sensor[];
    selected?: boolean;
    onLevel: (v: number) => void;
    onOpen: () => void;
}) {
    const live = lights.filter((l) => l.reachable);
    const on = live.filter((l) => l.level > 0);
    const level = avgLevel(lights);
    const lastLevel = useLastLevel(level);
    const { dragging, handlers } = useLevelGesture(level, onLevel, onOpen);

    if (!lights.length) {
        // Pièce sans lampe : seulement ses capteurs
        return (
            <div className="room-card empty">
                <span className="room-name">{name}</span>
                <span className="room-sub">{sensors.length ? `${sensors.length} capteur${sensors.length > 1 ? 's' : ''}` : 'Aucun appareil'}</span>
            </div>
        );
    }

    const sub = on.length
        ? `${on.length} sur ${lights.length} allumée${on.length > 1 ? 's' : ''}`
        : live.length ? `Éteinte · ${lights.length} lampe${lights.length > 1 ? 's' : ''}` : 'Injoignable';

    return (
        <div className={`room-card ${on.length ? 'on' : ''} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
            role="slider" tabIndex={0} aria-label={`${name}, ouvrir ses lampes`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} aria-valuetext={on.length ? `${level} %` : 'éteinte'}
            {...handlers}>
            <motion.span className="room-fill" aria-hidden="true"
                animate={{ width: `${level}%` }} transition={{ type: 'spring', stiffness: dragging ? 700 : 200, damping: 34 }} />
            <span className="room-top">
                <span className="room-name">{name}<Icon name="chevron" size={18} strokeWidth={2.4} /></span>
                <button type="button" className={`switch ${on.length ? 'on light' : ''}`} aria-pressed={on.length > 0}
                    aria-label={`${on.length ? 'Éteindre' : 'Allumer'} ${name}`} disabled={!live.length}
                    onClick={() => onLevel(on.length ? 0 : lastLevel.current)}>
                    <span />
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

// Modes rares, proposés dans les réglages fins de l'écran Climat
export const EXTRA_MODES: { id: string; label: string }[] = [
    { id: 'dry', label: 'Sec' },
    { id: 'fan', label: 'Ventilation' },
];

const modeName = (id: string) => [...MODES, ...EXTRA_MODES].find((m) => m.id === id)?.label ?? id;

/**
 * Carte Climat. `compact` (accueil de la tablette) : température, consigne et mode ; le titre
 * mène à l'écran Climat, où sont le programme et le reste.
 */
export function ClimateCard({ home, onSchedule, compact = false }: { home: ReturnType<typeof useHome>; onSchedule?: () => void; compact?: boolean }) {
    const h = home.heating;
    const t = home.thermostat;
    const smart = Boolean(t?.enabled && t.target != null);
    const room = home.sensors.find(isRoomThermo);
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
    // Un mode rare (sec, ventilation) n'a pas de bouton ici : la pastille le dit
    const extraMode = h?.power && !MODES.some((m) => m.id === h.mode);
    // Froid par temps froid : un effleurement de la tablette ne suffit pas, il faut toucher deux fois
    const [armedCool, setArmedCool] = useState(false);
    useEffect(() => {
        if (!armedCool) return;
        const id = setTimeout(() => setArmedCool(false), 4000);
        return () => clearTimeout(id);
    }, [armedCool]);
    const balcony = home.sensors.find((s) => s.role === 'outdoor')?.props.temperature;
    const coldOutside = balcony != null ? balcony < 18 : [10, 11, 0, 1, 2, 3].includes(new Date().getMonth());
    const pickMode = (id: string) => {
        if (id === 'cool' && coldOutside && !(h?.power && h.mode === 'cool') && !armedCool) {
            setArmedCool(true);
            return;
        }
        setArmedCool(false);
        home.controlHeating({ mode: id, power: true });
    };

    return (
        <section className={`card climate ${compact ? 'compact' : ''}`} aria-label="Climat">
            <div className="card-head">
                {compact ? (
                    <Link to="/climate" className="climate-link">Climat · {room?.name ?? 'Salon'}<Icon name="chevron" size={16} strokeWidth={2.4} /></Link>
                ) : (
                    <span>Climat · {room?.name ?? 'Salon'}</span>
                )}
                {extraMode && <span className="pill cool">{modeName(h!.mode)}</span>}
            </div>
            {compact ? (
                <div className="climate-now">
                    <span className="big-temp">{fmt(room?.props.temperature)}°</span>
                    <span className="muted">{fmt(room?.props.humidity, 0)} %</span>
                </div>
            ) : (
                <div>
                    <div className="big-temp">{fmt(room?.props.temperature)}°</div>
                    <div className="muted">Humidité {fmt(room?.props.humidity, 0)} % · {fmt(room?.props.pressure, 0)} hPa</div>
                </div>
            )}
            {openOutside.length > 0 && (
                <div className="warn-line">{openOutside.map((s) => s.name).join(', ')} ouverte : chauffage coupé si la pièce se refroidit</div>
            )}
            {h?.uncertain && (
                <div className="warn-line">
                    La pièce ne suit pas la consigne : éteinte à la télécommande ?
                    <div className="row-actions">
                        <button type="button" className="ghost-btn" onClick={() => home.syncHeating(false)}>Oui, éteinte</button>
                        <button type="button" className="ghost-btn" onClick={() => home.syncHeating(true)}>Non, elle tourne</button>
                    </div>
                </div>
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
                        onClick={() => pickMode(m.id)}>{m.id === 'cool' && armedCool ? 'Froid ? Encore' : m.label}</button>
                ))}
                <button type="button" className={!h?.power ? 'active off' : ''} aria-pressed={!h?.power}
                    onClick={() => home.controlHeating({ power: false })}>Arrêt</button>
            </div>
            {!compact && <div className="card-foot">
                <button type="button" className="foot-link" onClick={onSchedule}>
                    <span>Programme</span><span>{programLabel} ›</span>
                </button>
                {smart && t?.status.text && <div className="foot-note">{t.status.text}</div>}
                <div><span>Dernière commande</span><span>{h?.lastUpdated ? hhmm(new Date(h.lastUpdated)) : 'aucune'}</span></div>
                {h && !h.uncertain && (
                    <button type="button" className="foot-link" onClick={() => home.syncHeating(!h.power)}>
                        <span>{h.power ? 'Éteinte à la télécommande ?' : 'Allumée à la télécommande ?'}</span><span>Corriger ›</span>
                    </button>
                )}
                {!h?.connected && <div><span>Émetteur infrarouge</span><span className="warn">non connecté</span></div>}
            </div>}
            {/* L'émetteur muet empêche toute commande : même compacte, la carte le dit */}
            {compact && !h?.connected && <div className="warn-line">Émetteur infrarouge non connecté</div>}
        </section>
    );
}

const fmtTarget = (n: number | null | undefined) => (n == null ? '--' : String(n).replace('.', ','));

function JournalList({ log }: { log: LogEntry[] }) {
    return (
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
    );
}

/** Dans la carte : les derniers évènements ; tout le journal dans le détail. */
const JOURNAL_COMPACT = 3;

export function Journal({ log }: { log: LogEntry[] }) {
    return (
        <WidgetCard className="journal" label="Journal" title="Journal"
            detail={log.length > JOURNAL_COMPACT ? { title: 'Journal', className: 'journal-sheet', body: <JournalList log={log} /> } : undefined}>
            <JournalList log={log.slice(0, JOURNAL_COMPACT)} />
        </WidgetCard>
    );
}
