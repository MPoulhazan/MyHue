import { useEffect, useState } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { Icon } from '../Icon';

interface Device {
    ieeeAddr: string;
    friendlyName: string;
    model: string | null;
    vendor: string | null;
    description: string | null;
}

type Step = 'intro' | 'pairing' | 'details' | 'automations' | 'done';

const PAIRING_SECONDS = 120;

const TYPES: { id: string; label: string }[] = [
    { id: 'door', label: 'Porte / fenêtre' },
    { id: 'temperature_humidity', label: 'Température' },
    { id: 'motion', label: 'Mouvement' },
    { id: 'water_leak', label: 'Fuite d’eau' },
    { id: 'smoke', label: 'Fumée' },
    { id: 'button', label: 'Bouton' },
    { id: 'other', label: 'Autre' },
];

/** Type deviné à partir de la description zigbee2mqtt (« Door and window sensor »...). */
const guessType = (d: Device) => {
    const s = `${d.description ?? ''} ${d.model ?? ''}`.toLowerCase();
    if (/door|window|contact|magnet/.test(s)) return 'door';
    if (/temperature|humidity|weather/.test(s)) return 'temperature_humidity';
    if (/motion|occupancy|presence/.test(s)) return 'motion';
    if (/water|leak|flood/.test(s)) return 'water_leak';
    if (/smoke/.test(s)) return 'smoke';
    if (/button|switch/.test(s)) return 'button';
    return 'other';
};

// Automatismes proposés pour une porte (les alertes pile/silence sont déjà globales)
const DOOR_AUTOMATIONS = [
    { id: 'window_pause_heating', label: 'Couper le chauffage si elle fait un courant d’air (la pièce perd 1°)', outsideOnly: true },
    { id: 'door_left_open', label: 'Me prévenir si elle reste ouverte 10 min', outsideOnly: false },
    { id: 'door_night', label: 'Me prévenir si elle s’ouvre la nuit', outsideOnly: false },
];

const STEPS: { id: Step; label: string }[] = [
    { id: 'intro', label: 'Mode appairage' },
    { id: 'pairing', label: 'Bouton du capteur' },
    { id: 'details', label: 'Nom et pièce' },
    { id: 'automations', label: 'Automatisme' },
];

export function AddSensorSheet({ rooms, onClose }: { rooms: string[]; onClose: () => void }) {
    const [step, setStep] = useState<Step>('intro');
    const [waiting, setWaiting] = useState<Device[]>([]); // déjà appairés, pas encore nommés
    const [device, setDevice] = useState<Device | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(PAIRING_SECONDS);
    const [name, setName] = useState('');
    const [type, setType] = useState('other');
    const [room, setRoom] = useState<string | null>(null);
    const [outside, setOutside] = useState(false);
    const [chosen, setChosen] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios.get('/api/zigbee/unregistered').then(({ data }) => setWaiting(data.devices)).catch(() => {});
    }, []);

    const pick = (d: Device) => {
        setDevice(d);
        setType(guessType(d));
        setStep('details');
        axios.post('/api/zigbee/stop-join').catch(() => {});
    };

    // Appairage : compte à rebours et attente d'un nouvel appareil
    useEffect(() => {
        if (step !== 'pairing') return;
        const known = new Set(waiting.map((d) => d.ieeeAddr));
        const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
        const poll = setInterval(async () => {
            try {
                const { data } = await axios.get('/api/zigbee/pairing-status');
                const fresh = (data.newDevices as Device[]).find((d) => !known.has(d.ieeeAddr));
                if (fresh) pick(fresh);
            } catch { /* on réessaie au prochain tour */ }
        }, 2000);
        return () => {
            clearInterval(tick);
            clearInterval(poll);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- démarré une fois par passage à l'étape
    }, [step]);

    const startPairing = async () => {
        setError(null);
        try {
            await axios.post('/api/zigbee/permit-join', { seconds: PAIRING_SECONDS });
            setSecondsLeft(PAIRING_SECONDS);
            setStep('pairing');
        } catch {
            setError('Impossible d’ouvrir l’appairage : zigbee2mqtt est-il démarré dans Home Assistant ?');
        }
    };

    const close = () => {
        if (step === 'pairing') axios.post('/api/zigbee/stop-join').catch(() => {});
        onClose();
    };

    const toAutomations = () => {
        if (type !== 'door') return save([]);
        setChosen(DOOR_AUTOMATIONS.filter((a) => (a.outsideOnly ? outside : a.id === 'door_left_open' && outside)).map((a) => a.id));
        setStep('automations');
    };

    const save = async (automations: string[]) => {
        if (!device) return;
        setSaving(true);
        setError(null);
        try {
            await axios.post('/api/sensors/registry', {
                ieee: device.ieeeAddr,
                name: name.trim(),
                type,
                room,
                outside: type === 'door' && outside,
                automations,
            });
            setStep('done');
        } catch {
            setError('Enregistrement impossible, réessaie.');
        } finally {
            setSaving(false);
        }
    };

    const stepIndex = STEPS.findIndex((s) => s.id === step);

    return (
        <div className="sheet-backdrop" onClick={close}>
            <motion.div className="sheet add-sheet" role="dialog" aria-modal="true" aria-label="Ajouter un capteur"
                initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <h2>Ajouter un capteur</h2>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={close}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>

                {step !== 'done' && (
                    <ol className="steps" aria-label="Étapes">
                        {STEPS.map((s, i) => (
                            <li key={s.id} className={i <= stepIndex ? 'reached' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
                                <span className="bar" />
                                <span>{i + 1} · {s.label}</span>
                            </li>
                        ))}
                    </ol>
                )}

                {error && <div className="warn-line">{error}</div>}

                {step === 'intro' && (
                    <div className="step-body">
                        <p className="lead">Garde le capteur à portée de main, pile en place. MyHue va ouvrir le réseau Zigbee pendant 2 minutes.</p>
                        <button type="button" className="primary-btn" onClick={startPairing}>Démarrer l’appairage</button>
                        {waiting.length > 0 && (
                            <div className="waiting">
                                <h3 className="sub-title">Déjà appairés, pas encore nommés</h3>
                                {waiting.map((d) => (
                                    <button key={d.ieeeAddr} type="button" className="device-row" onClick={() => pick(d)}>
                                        <span>{d.description || d.model || 'Appareil Zigbee'}</span>
                                        <span className="muted mono">{d.ieeeAddr}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {step === 'pairing' && (
                    <div className="step-body pairing">
                        <div className="countdown mono" aria-live="polite">{secondsLeft} s</div>
                        <p className="lead">
                            {secondsLeft > 0
                                ? 'Appuie 5 secondes sur le bouton du capteur, jusqu’à ce que sa lumière clignote, puis relâche.'
                                : 'Rien reçu. Rapproche le capteur de la box Home Assistant et recommence.'}
                        </p>
                        {secondsLeft === 0 && <button type="button" className="primary-btn" onClick={startPairing}>Recommencer</button>}
                    </div>
                )}

                {step === 'details' && device && (
                    <div className="step-body">
                        <div className="found">
                            <span className="found-icon"><Icon name={type === 'door' ? 'door' : 'thermo'} size={26} strokeWidth={2} /></span>
                            <div>
                                <div className="found-title">{TYPES.find((t) => t.id === type)?.label ?? 'Appareil'} détecté</div>
                                <div className="muted">{[device.vendor, device.model].filter(Boolean).join(' ')}</div>
                            </div>
                        </div>
                        <label className="field">
                            <span>Nom</span>
                            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Fenêtre cuisine" autoFocus />
                        </label>
                        <fieldset className="field">
                            <legend>Type</legend>
                            <div className="chips">
                                {TYPES.map((t) => (
                                    <button key={t.id} type="button" className={type === t.id ? 'active' : ''} aria-pressed={type === t.id}
                                        onClick={() => setType(t.id)}>{t.label}</button>
                                ))}
                            </div>
                        </fieldset>
                        <fieldset className="field">
                            <legend>Pièce</legend>
                            <div className="chips">
                                {rooms.map((r) => (
                                    <button key={r} type="button" className={room === r ? 'active' : ''} aria-pressed={room === r}
                                        onClick={() => setRoom(room === r ? null : r)}>{r}</button>
                                ))}
                            </div>
                        </fieldset>
                        {type === 'door' && (
                            <label className="check">
                                <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} />
                                Elle donne sur l’extérieur (pilote le chauffage quand elle s’ouvre)
                            </label>
                        )}
                        <div className="step-foot">
                            <button type="button" className="primary-btn" disabled={!name.trim() || saving} onClick={toAutomations}>
                                {type === 'door' ? 'Continuer' : 'Enregistrer'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 'automations' && (
                    <div className="step-body">
                        <p className="lead">Que doit faire « {name.trim()} » ? Tu pourras changer ça dans Automatismes.</p>
                        {DOOR_AUTOMATIONS.map((a) => (
                            <label key={a.id} className="check">
                                <input type="checkbox" checked={chosen.includes(a.id)}
                                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, a.id] : c.filter((x) => x !== a.id)))} />
                                {a.label}
                            </label>
                        ))}
                        <div className="step-foot">
                            <button type="button" className="primary-btn" disabled={saving} onClick={() => save(chosen)}>Terminer</button>
                        </div>
                    </div>
                )}

                {step === 'done' && (
                    <div className="step-body done">
                        <span className="found-icon big"><Icon name="check" size={36} strokeWidth={2.4} /></span>
                        <p className="lead">« {name.trim()} » est prêt.</p>
                        <button type="button" className="primary-btn" onClick={onClose}>Fermer</button>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
