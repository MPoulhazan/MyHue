import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { useHomeData } from '../hooks/useHome';
import type { Sensor } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { AddSensorSheet } from '../components/home/AddSensorSheet';
import { RoomPicker } from '../components/home/RoomPicker';
import { fmt, hhmm } from '../components/home/cards';
import './Dashboard.css';
import './Settings.css';

const TYPES: { id: string; label: string; icon: IconName }[] = [
    { id: 'door', label: 'Porte / fenêtre', icon: 'door' },
    { id: 'temperature_humidity', label: 'Température', icon: 'thermo' },
    { id: 'motion', label: 'Mouvement', icon: 'alert' },
    { id: 'water_leak', label: 'Fuite d’eau', icon: 'drop' },
    { id: 'smoke', label: 'Fumée', icon: 'alert' },
    { id: 'button', label: 'Bouton', icon: 'power' },
    { id: 'other', label: 'Autre', icon: 'grid' },
];
const typeOf = (id: string) => TYPES.find((t) => t.id === id) ?? TYPES[TYPES.length - 1];

const NO_ROOM = 'Sans pièce';

/** Valeur principale d'un capteur, en mots. */
const reading = (s: Sensor) => {
    const p = s.props;
    if (s.type === 'door') return p.isOpen == null ? '…' : p.isOpen ? 'ouverte' : 'fermée';
    if (p.temperature != null) return `${fmt(p.temperature)}°${p.humidity != null ? ` · ${fmt(p.humidity, 0)} %` : ''}`;
    if (s.type === 'water_leak') return p.leak == null ? '…' : p.leak ? 'FUITE !' : 'au sec';
    if (s.type === 'smoke') return p.smoke == null ? '…' : p.smoke ? 'FUMÉE !' : 'pas de fumée';
    return '';
};

/** « en pause jusqu’à 07:00 », « en pause »… */
const pauseLabel = (until: number | 'forever' | null) => {
    if (until == null) return '';
    if (until === 'forever') return 'en pause';
    const d = new Date(until);
    const today = d.toDateString() === new Date().toDateString();
    return `en pause jusqu’à ${today ? '' : 'demain '}${hhmm(d)}`;
};
const NOT_PAUSABLE = new Set(['temperature_humidity']);
const SAFETY = new Set(['smoke', 'water_leak']);

const updated = (iso: string | null) => {
    if (!iso) return 'jamais mis à jour';
    const d = new Date(iso);
    const today = d.toDateString() === new Date().toDateString();
    return `mis à jour ${today ? `à ${hhmm(d)}` : `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}`;
};

/** Capteurs Zigbee : nom, pièce, état. Un toucher pour renommer ou déplacer. */
export function Sensors() {
    const home = useHomeData();
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<Sensor | null>(null);
    const [waiting, setWaiting] = useState(0);

    const loadWaiting = useCallback(() => {
        axios.get('/api/zigbee/unregistered').then(({ data }) => setWaiting(data.devices?.length ?? 0)).catch(() => {});
    }, []);
    useEffect(loadWaiting, [loadWaiting]);

    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            setEditing(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Regroupés par pièce, dans l'ordre des pièces Hue ; ceux sans pièce en premier pour qu'on les range
    const groups = [NO_ROOM, ...home.rooms, ...new Set(home.sensors.map((s) => s.room).filter((r): r is string => !!r && !home.rooms.includes(r)))]
        .map((room) => [room, home.sensors.filter((s) => (s.room ?? NO_ROOM) === room)] as const)
        .filter(([, list]) => list.length);

    return (
        <div className="home settings-page">
            <header className="home-top">
                <div className="home-hello"><h1>Capteurs</h1>
                    <span className="muted">{home.sensors.length} capteur{home.sensors.length > 1 ? 's' : ''}</span></div>
                <button type="button" className="pill-btn light with-icon" onClick={() => setAdding(true)}>
                    <Icon name="plus" size={20} strokeWidth={2.4} /> Ajouter un capteur
                </button>
            </header>

            {waiting > 0 && (
                <button type="button" className="settings-notice" onClick={() => setAdding(true)}>
                    <Icon name="alert" size={20} strokeWidth={2.2} />
                    <span>{waiting} appareil{waiting > 1 ? 's' : ''} appairé{waiting > 1 ? 's' : ''} sans nom : touche ici pour {waiting > 1 ? 'les' : 'le'} configurer</span>
                    <Icon name="chevron" size={18} strokeWidth={2.2} />
                </button>
            )}

            {!home.online.zigbee && !home.sensors.length && <p className="muted">Connexion aux capteurs…</p>}

            {groups.map(([room, list]) => (
                <section key={room} className="settings-group" aria-label={room}>
                    <h2 className="card-title">{room}</h2>
                    <div className="settings-items">
                        {list.map((s) => {
                            const t = typeOf(s.type);
                            const low = s.props.battery != null && s.props.battery < 20;
                            return (
                                <button key={s.did} type="button" className={`item-row ${s.pausedUntil ? 'paused' : ''}`} onClick={() => setEditing(s)}>
                                    <span className={`item-icon ${s.type === 'door' && s.props.isOpen ? 'amber' : ''}`}><Icon name={t.icon} size={22} strokeWidth={2} /></span>
                                    <span className="item-text">
                                        <strong>{s.name}</strong>
                                        <span className="muted">
                                            {s.pausedUntil && <><span className="pause-badge"><Icon name="pause" size={13} strokeWidth={2.4} />{pauseLabel(s.pausedUntil)}</span> · </>}
                                            {s.isOnline ? updated(s.lastUpdated) : <span className="warn">hors ligne</span>}
                                            {s.props.battery != null && <> · <span className={low ? 'warn' : ''}>pile {s.props.battery} %</span></>}
                                        </span>
                                    </span>
                                    <span className={`item-value ${s.props.temperature != null ? 'mono' : ''} ${s.type === 'door' && s.props.isOpen ? 'warn' : ''}`}>{reading(s)}</span>
                                    <Icon name="chevron" size={20} strokeWidth={2.2} />
                                </button>
                            );
                        })}
                    </div>
                </section>
            ))}

            <AnimatePresence>
                {adding && <AddSensorSheet key="add" rooms={home.rooms} onClose={() => { setAdding(false); loadWaiting(); }} />}
                {editing && <SensorSheet key="edit" sensor={editing} rooms={home.rooms} onClose={() => setEditing(null)} />}
            </AnimatePresence>
        </div>
    );
}

function SensorSheet({ sensor, rooms, onClose }: { sensor: Sensor; rooms: string[]; onClose: () => void }) {
    const [name, setName] = useState(sensor.name);
    const [type, setType] = useState(sensor.type);
    const [room, setRoom] = useState(sensor.room);
    const [outside, setOutside] = useState(sensor.outside);
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Le nouvel état arrive par le flux des capteurs (SSE), il suffit de fermer
    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            await axios.post('/api/sensors/registry', { ieee: sensor.did, name: name.trim(), type, room, outside: type === 'door' && outside });
            onClose();
        } catch {
            setError('Enregistrement impossible, réessaie.');
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!confirmDelete) return setConfirmDelete(true);
        setSaving(true);
        try {
            await axios.delete(`/api/sensors/registry/${encodeURIComponent(sensor.did)}`);
            onClose();
        } catch {
            setError('Suppression impossible, réessaie.');
            setSaving(false);
        }
    };

    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <motion.div className="sheet settings-sheet" role="dialog" aria-modal="true" aria-label={sensor.name}
                initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <div className="sheet-title"><h2>{sensor.name}</h2><span className="muted">{reading(sensor)}</span></div>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>

                {error && <div className="warn-line">{error}</div>}

                <label className="field">
                    <span>Nom</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save(); }} />
                </label>
                <RoomPicker rooms={rooms} value={room} onChange={setRoom} />
                <fieldset className="field">
                    <legend>Type</legend>
                    <div className="chips">
                        {TYPES.map((t) => (
                            <button key={t.id} type="button" className={type === t.id ? 'active' : ''} aria-pressed={type === t.id}
                                onClick={() => setType(t.id)}>{t.label}</button>
                        ))}
                    </div>
                </fieldset>
                {type === 'door' && (
                    <label className="check">
                        <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} />
                        Elle donne sur l’extérieur (pilote le chauffage quand elle s’ouvre)
                    </label>
                )}

                {!NOT_PAUSABLE.has(sensor.type) && <PauseBox sensor={sensor} onDone={onClose} />}

                <div className="card-foot">
                    <div><span>État</span><span className={sensor.isOnline ? '' : 'warn'}>{sensor.isOnline ? updated(sensor.lastUpdated) : 'hors ligne'}</span></div>
                    {sensor.props.battery != null && <div><span>Pile</span><span>{sensor.props.battery} %</span></div>}
                    <div><span>Adresse Zigbee</span><span className="mono">{sensor.did}</span></div>
                </div>

                <div className="sheet-foot">
                    <button type="button" className={`ghost-btn danger ${confirmDelete ? 'armed' : ''}`} disabled={saving} onClick={remove}>
                        <Icon name="trash" size={18} strokeWidth={2.2} /> {confirmDelete ? 'Confirmer le retrait' : 'Retirer'}
                    </button>
                    <button type="button" className="primary-btn" disabled={!name.trim() || saving} onClick={save}>Enregistrer</button>
                </div>
            </motion.div>
        </div>
    );
}

/** Pause : le capteur reste visible mais ne déclenche plus rien (automatismes, lampe, garde). */
function PauseBox({ sensor, onDone }: { sensor: Sensor; onDone: () => void }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [armed, setArmed] = useState(false); // détecteurs de sécurité : second toucher pour confirmer
    const safety = SAFETY.has(sensor.type);
    const url = `/api/sensors/${encodeURIComponent(sensor.did)}/pause`;

    // Le nouvel état arrive par le flux des capteurs (SSE), il suffit de fermer
    const run = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setErr(null);
        try {
            await fn();
            onDone();
        } catch (e) {
            setErr((axios.isAxiosError(e) && e.response?.data?.error) || 'Échec, réessaie.');
            setBusy(false);
        }
    };
    const pause = (duration: string) => {
        if (safety && !armed) return setArmed(true);
        run(() => axios.post(url, { duration, force: safety }));
    };

    if (sensor.pausedUntil) {
        return (
            <div className="field pause-box">
                <span>Pause</span>
                <p>{sensor.name} est {pauseLabel(sensor.pausedUntil)} : il ne déclenche plus rien.</p>
                <div className="chips">
                    <button type="button" className="active" disabled={busy} onClick={() => run(() => axios.delete(url))}>Réactiver maintenant</button>
                </div>
                {err && <div className="warn-line">{err}</div>}
            </div>
        );
    }
    return (
        <div className="field pause-box">
            <span>Mettre en pause</span>
            <p>{safety
                ? armed ? 'Détecteur de sécurité : touche encore pour confirmer. 1 h au plus, il se réactive tout seul.' : 'Détecteur de sécurité : pause d’1 h au plus, avec confirmation.'
                : 'Il continue de remonter son état, mais plus rien n’y réagit (automatismes, lampe de l’entrée, garde).'}</p>
            <div className="chips">
                {safety
                    ? <button type="button" className={armed ? 'active' : ''} disabled={busy} onClick={() => pause('1h')}>{armed ? 'Confirmer 1 h' : '1 h'}</button>
                    : <>
                        <button type="button" disabled={busy} onClick={() => pause('1h')}>1 h</button>
                        <button type="button" disabled={busy} onClick={() => pause('morning')}>Jusqu’à 7 h</button>
                        <button type="button" disabled={busy} onClick={() => pause('forever')}>Jusqu’à réactivation</button>
                    </>}
            </div>
            {err && <div className="warn-line">{err}</div>}
        </div>
    );
}
