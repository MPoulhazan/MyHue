import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { useHomeData } from '../hooks/useHome';
import type { Sensor } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { fmt } from '../components/home/cards';
import './Dashboard.css';
import './Settings.css';

interface Automation {
    id: string;
    name: string;
    template: string | null;
    enabled: boolean;
    summary: string;
    trigger: { type?: string; prop?: string; did?: string };
    lastTriggeredAt: string | null;
    triggerCount: number;
}

interface Template {
    id: string;
    label: string;
    description: string;
    sensorType: string | null;
}

const iconOf = (a: Automation): IconName => {
    if (a.trigger.type === 'presence') return 'home';
    return ({ isOpen: 'door', temperature: 'thermo', humidity: 'drop', battery: 'battery', silentHours: 'wifi' } as Record<string, IconName>)[a.trigger.prop ?? ''] ?? 'rules';
};

const ago = (iso: string) => {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'à l’instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
};

// Modèles qui acceptent « toutes les portes » (did '*')
const ANY_DOOR = new Set(['door_left_open', 'door_night']);

/** Automatismes : ce qui tourne, un interrupteur chacun, et un bouton pour en créer. */
export function Rules() {
    const home = useHomeData();
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [armed, setArmed] = useState<string | null>(null); // suppression à confirmer

    const load = useCallback(async () => {
        try {
            const [a, t] = await Promise.all([axios.get('/api/automations'), axios.get('/api/automations/templates')]);
            setAutomations(a.data.automations);
            setTemplates(t.data.templates);
            setError(null);
        } catch {
            setError('Impossible de charger les automatismes.');
        } finally {
            setLoaded(true);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') setCreating(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const toggle = async (id: string) => {
        setAutomations((list) => list.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
        try {
            const { data } = await axios.patch(`/api/automations/${id}/toggle`);
            setAutomations((list) => list.map((a) => (a.id === id ? data : a)));
        } catch {
            setError('Modification refusée.');
            load();
        }
    };

    const remove = async (id: string) => {
        if (armed !== id) return setArmed(id);
        setArmed(null);
        try {
            await axios.delete(`/api/automations/${id}`);
            setAutomations((list) => list.filter((a) => a.id !== id));
        } catch {
            setError('Suppression impossible.');
        }
    };

    const active = automations.filter((a) => a.enabled).length;

    return (
        <div className="home settings-page">
            <header className="home-top">
                <div className="home-hello"><h1>Automatismes</h1>
                    {loaded && <span className="muted">{automations.length ? `${active} actif${active > 1 ? 's' : ''} sur ${automations.length}` : 'aucun pour l’instant'}</span>}</div>
                <button type="button" className="pill-btn light with-icon" onClick={() => setCreating(true)} disabled={!loaded}>
                    <Icon name="plus" size={20} strokeWidth={2.4} /> Créer
                </button>
            </header>

            {error && <div className="warn-line">{error}</div>}

            <div className="settings-items">
                {automations.map((a) => (
                    <div key={a.id} className={`item-row static rule ${a.enabled ? '' : 'disabled'}`}>
                        <span className="item-icon"><Icon name={iconOf(a)} size={22} strokeWidth={2} /></span>
                        <span className="item-text">
                            <strong>{a.name}</strong>
                            <span className="muted">{a.summary}</span>
                            <span className="muted small">{a.triggerCount > 0 && a.lastTriggeredAt ? `Déclenché ${a.triggerCount} fois, la dernière ${ago(a.lastTriggeredAt)}` : 'Jamais déclenché'}</span>
                        </span>
                        <button type="button" className={`ghost-btn danger icon-only ${armed === a.id ? 'armed' : ''}`}
                            aria-label={armed === a.id ? `Confirmer la suppression de ${a.name}` : `Supprimer ${a.name}`}
                            onClick={() => remove(a.id)} onBlur={() => setArmed((x) => (x === a.id ? null : x))}>
                            <Icon name="trash" size={18} strokeWidth={2.2} />{armed === a.id && ' Supprimer ?'}
                        </button>
                        <button type="button" className={`switch ${a.enabled ? 'on' : ''}`} aria-pressed={a.enabled}
                            aria-label={`${a.enabled ? 'Désactiver' : 'Activer'} ${a.name}`} onClick={() => toggle(a.id)}>
                            <span />
                        </button>
                    </div>
                ))}
            </div>

            {loaded && (
                <p className="muted settings-note">
                    Tu peux aussi le demander à l’agent : « Préviens-moi si la température du salon passe sous 18° ».
                </p>
            )}

            <AnimatePresence>
                {creating && (
                    <CreateSheet key="create" templates={templates} automations={automations} sensors={home.sensors}
                        onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Création ─────────────────────────────────────────────────────────────────

const THRESHOLD = 'threshold';

const MEASURES = {
    temperature: { label: 'Température', unit: '°', min: 0, max: 35, step: 0.5, initial: 18 },
    humidity: { label: 'Humidité', unit: ' %', min: 10, max: 90, step: 5, initial: 60 },
} as const;
type Measure = keyof typeof MEASURES;

function CreateSheet({ templates, automations, sensors, onClose, onCreated }: {
    templates: Template[];
    automations: Automation[];
    sensors: Sensor[];
    onClose: () => void;
    onCreated: () => void;
}) {
    const [kind, setKind] = useState<string | null>(null);
    const [did, setDid] = useState<string | null>(null);
    const [measure, setMeasure] = useState<Measure>('temperature');
    const [below, setBelow] = useState(true);
    const [value, setValue] = useState<number>(MEASURES.temperature.initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const doors = sensors.filter((s) => s.type === 'door');
    const meters = sensors.filter((s) => s.props.temperature != null || s.props.humidity != null);
    const template = templates.find((t) => t.id === kind);

    // Une même règle n'a pas de sens deux fois
    const used = (tid: string, target?: string) =>
        automations.some((a) => a.template === tid && (target === undefined || a.trigger.did === target || a.trigger.did === '*'));
    const targets = template?.sensorType === 'door'
        ? [...(ANY_DOOR.has(template.id) ? [{ id: '*', name: 'Toutes les portes' }] : []), ...doors.map((d) => ({ id: d.did, name: d.name }))]
        : [];

    const choose = (id: string) => {
        setKind(id);
        // Un seul capteur possible : déjà choisi
        setDid(id === THRESHOLD && meters.length === 1 ? meters[0].did : null);
        setError(null);
    };

    const pickMeasure = (m: Measure) => {
        setMeasure(m);
        setValue(MEASURES[m].initial);
    };

    const sensor = meters.find((s) => s.did === did);
    const m = MEASURES[measure];
    const ready = kind === THRESHOLD ? !!sensor : template ? (template.sensorType !== 'door' || (!!did && !used(template.id, did))) : false;

    const create = async () => {
        setSaving(true);
        setError(null);
        try {
            if (kind === THRESHOLD && sensor) {
                const what = `${m.label.toLowerCase()} ${below ? 'sous' : 'au-dessus de'} ${fmt(value, measure === 'temperature' ? 1 : 0)}${m.unit}`;
                await axios.post('/api/automations', {
                    rule: {
                        sensorDid: sensor.did,
                        property: measure,
                        operator: below ? 'lt' : 'gt',
                        value,
                        name: `${sensor.name} : ${what}`,
                        message: `${sensor.name} : ${what}.`,
                    },
                });
            } else if (template) {
                await axios.post('/api/automations', { template: template.id, params: did ? { did } : {} });
            }
            onCreated();
        } catch (err) {
            setError(axios.isAxiosError(err) ? err.response?.data?.error || 'Création impossible.' : 'Création impossible.');
            setSaving(false);
        }
    };

    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <motion.div className="sheet settings-sheet" role="dialog" aria-modal="true" aria-label="Créer un automatisme"
                initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <h2>Créer un automatisme</h2>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>

                {error && <div className="warn-line">{error}</div>}

                <fieldset className="field">
                    <legend>Quand</legend>
                    <div className="choice-grid">
                        {templates.map((t) => {
                            // Les modèles sans capteur ne servent qu'une fois
                            const taken = t.sensorType !== 'door' && used(t.id);
                            return (
                                <button key={t.id} type="button" className={`choice ${kind === t.id ? 'active' : ''}`} aria-pressed={kind === t.id}
                                    disabled={taken} onClick={() => choose(t.id)}>
                                    <strong>{t.label}</strong>
                                    <span className="muted">{taken ? 'Déjà en place' : t.description}</span>
                                </button>
                            );
                        })}
                        <button type="button" className={`choice ${kind === THRESHOLD ? 'active' : ''}`} aria-pressed={kind === THRESHOLD}
                            disabled={!meters.length} onClick={() => choose(THRESHOLD)}>
                            <strong>Seuil de température ou d’humidité</strong>
                            <span className="muted">Me prévenir quand une mesure passe sous ou au-dessus d’une valeur.</span>
                        </button>
                    </div>
                </fieldset>

                {template?.sensorType === 'door' && (
                    <fieldset className="field">
                        <legend>Quelle ouverture</legend>
                        <div className="chips">
                            {targets.map((t) => {
                                const taken = used(template.id, t.id);
                                return (
                                    <button key={t.id} type="button" className={did === t.id ? 'active' : ''} aria-pressed={did === t.id}
                                        disabled={taken} onClick={() => setDid(t.id)}>{t.name}{taken ? ' · déjà actif' : ''}</button>
                                );
                            })}
                        </div>
                        {!targets.length && <span className="muted">Aucun capteur de porte : ajoute-en un dans Capteurs.</span>}
                    </fieldset>
                )}

                {kind === THRESHOLD && (
                    <>
                        <fieldset className="field">
                            <legend>Capteur</legend>
                            <div className="chips">
                                {meters.map((s) => (
                                    <button key={s.did} type="button" className={did === s.did ? 'active' : ''} aria-pressed={did === s.did}
                                        onClick={() => setDid(s.did)}>{s.name}</button>
                                ))}
                            </div>
                        </fieldset>
                        <fieldset className="field">
                            <legend>Mesure</legend>
                            <div className="chips">
                                {(Object.keys(MEASURES) as Measure[]).map((k) => (
                                    <button key={k} type="button" className={measure === k ? 'active' : ''} aria-pressed={measure === k}
                                        onClick={() => pickMeasure(k)}>{MEASURES[k].label}</button>
                                ))}
                            </div>
                        </fieldset>
                        <fieldset className="field">
                            <legend>Me prévenir quand elle passe</legend>
                            <div className="threshold-row">
                                <div className="chips">
                                    <button type="button" className={below ? 'active' : ''} aria-pressed={below} onClick={() => setBelow(true)}>sous</button>
                                    <button type="button" className={!below ? 'active' : ''} aria-pressed={!below} onClick={() => setBelow(false)}>au-dessus de</button>
                                </div>
                                <div className="mini-stepper">
                                    <button type="button" aria-label="Moins" onClick={() => setValue((v) => Math.max(m.min, v - m.step))}>−</button>
                                    <span className="mono" aria-live="polite">{fmt(value, measure === 'temperature' ? 1 : 0)}{m.unit}</span>
                                    <button type="button" aria-label="Plus" onClick={() => setValue((v) => Math.min(m.max, v + m.step))}>+</button>
                                </div>
                            </div>
                            {sensor && sensor.props[measure] != null && (
                                <span className="muted">En ce moment : {fmt(sensor.props[measure], measure === 'temperature' ? 1 : 0)}{m.unit}</span>
                            )}
                        </fieldset>
                    </>
                )}

                <div className="sheet-foot end">
                    <button type="button" className="primary-btn" disabled={!ready || saving} onClick={create}>Créer</button>
                </div>
            </motion.div>
        </div>
    );
}
