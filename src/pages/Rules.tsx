import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { useHomeData } from '../hooks/useHome';
import type { Sensor } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { fmt } from '../components/home/cards';
import { AutomationTabs } from '../components/rules/AutomationTabs';
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

interface ExternalRow {
    name: string;
    on: boolean;
    when: string;
    does: string;
    plan: 'keep' | 'remove' | 'replaced';
    planLabel: string;
    auto?: boolean;
}

interface External {
    hue: ExternalRow[];
    hueError: string | null;
    google: ExternalRow[];
    googleSeenAt: string;
}

interface WifiDevice {
    mac: string;
    ip: string;
    name: string | null;
    phone: boolean;
    privateMac: boolean;
    lastSeen: number;
    here: boolean;
}

interface WifiPresence {
    available: boolean;
    anyoneHome: boolean | null;
    devices: WifiDevice[];
}

interface Template {
    id: string;
    label: string;
    description: string;
    sensorType: string | null;
}

const iconOf = (a: Automation): IconName => {
    if (a.trigger.type === 'presence') return 'home';
    if (a.trigger.type === 'time') return 'music';
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

// Modèles qui acceptent « toutes les portes » (did '*')
const ANY_DOOR = new Set(['door_left_open', 'door_night']);

type Tab = 'recent' | 'builtin' | 'mine' | 'external';
const TABS: [Tab, string][] = [['recent', 'Récemment'], ['builtin', 'Intégrés'], ['mine', 'Mes automatisations'], ['external', 'Hors MyHue']];

/** Automatismes : ce qui a tourné, les intégrés, les miens et ceux hors MyHue, chacun avec son interrupteur. */
export function Rules() {
    const home = useHomeData();
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [armed, setArmed] = useState<string | null>(null); // suppression à confirmer
    const [external, setExternal] = useState<External | null>(null);
    const [showVoice, setShowVoice] = useState(false);
    const [tab, setTab] = useState<Tab>('recent');
    const [builtinCount, setBuiltinCount] = useState<number | null>(null);
    const onCounts = useCallback((c: { builtin: number }) => setBuiltinCount(c.builtin), []);

    // Hors MyHue : chargé à part, la page ne l'attend pas
    useEffect(() => {
        axios.get('/api/automations/external').then(({ data }) => setExternal(data)).catch(() => {});
    }, []);

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

    const remove = async (id: string, confirmed = false) => {
        if (!confirmed && armed !== id) return setArmed(id);
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

            <div className="au-tabs" role="tablist" aria-label="Automatismes">
                {TABS.map(([id, label]) => (
                    <button key={id} type="button" role="tab" className="au-tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                        {label}
                        {id === 'builtin' && builtinCount != null && <span className="n">{builtinCount}</span>}
                        {id === 'mine' && loaded && <span className="n">{automations.length}</span>}
                        {id === 'external' && external && <span className="n">{external.hue.length + external.google.length}</span>}
                    </button>
                ))}
            </div>

            {(tab === 'recent' || tab === 'builtin') && (
                <AutomationTabs tab={tab} mine={automations} onToggleMine={toggle} onRemoveMine={(id) => remove(id, true)} onCounts={onCounts} />
            )}

            {tab === 'mine' && <>
            <PresenceSection />

            <h2 className="rules-sub">Mes automatisations</h2>
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
                    Tu peux aussi le demander à l’agent : « Préviens-moi si la température du salon passe sous 18° ».
                </p>
            )}
            </>}

            {tab === 'external' && external && <ExternalSection external={external} showVoice={showVoice} onToggleVoice={() => setShowVoice((v) => !v)} />}
            {tab === 'external' && !external && <p className="muted settings-note">Chargement…</p>}

            <AnimatePresence>
                {creating && (
                    <CreateSheet key="create" templates={templates} automations={automations} sensors={home.sensors}
                        onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Présence par le Wi-Fi ────────────────────────────────────────────────────

const seenAgo = (ts: number) => ago(new Date(ts).toISOString());

/**
 * Qui est à la maison : au moins un téléphone vu sur le Wi-Fi depuis 15 min = quelqu'un.
 * On coche les téléphones (devinés d'après le nom donné par la box) ; rien à installer dessus.
 */
function PresenceSection() {
    const [data, setData] = useState<WifiPresence | null>(null);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        const load = () => axios.get('/api/presence/wifi').then(({ data: d }) => setData(d)).catch(() => {});
        load();
        const id = setInterval(load, 60_000);
        return () => clearInterval(id);
    }, []);

    if (!data) return null;
    if (!data.available) {
        return <p className="muted settings-note">Présence Wi-Fi indisponible ici : elle tourne sur le Pi.</p>;
    }

    const setPhone = async (d: WifiDevice, phone: boolean) => {
        setData((x) => x && { ...x, devices: x.devices.map((y) => (y.mac === d.mac ? { ...y, phone } : y)) });
        try {
            const { data: next } = await axios.put(`/api/presence/wifi/${encodeURIComponent(d.mac)}`, { phone });
            setData(next);
        } catch {
            /* on garde l'affichage, la prochaine actualisation corrigera */
        }
    };

    const phones = data.devices.filter((d) => d.phone);
    const others = data.devices.filter((d) => !d.phone);
    const row = (d: WifiDevice) => (
        <div key={d.mac} className="item-row static rule">
            <span className={`item-icon ${d.here ? '' : 'off'}`}><Icon name={d.phone ? 'agent' : 'wifi'} size={22} strokeWidth={2} /></span>
            <span className="item-text">
                <strong>{d.name ?? (d.privateMac ? 'Appareil sans nom (adresse privée)' : 'Appareil sans nom')}</strong>
                <span className="muted small">{d.here ? 'Sur le Wi-Fi' : `Vu ${seenAgo(d.lastSeen)}`} · {d.ip}</span>
            </span>
            <button type="button" className={`switch ${d.phone ? 'on' : ''}`} aria-pressed={d.phone}
                aria-label={`${d.name ?? d.ip} : ${d.phone ? 'ne plus compter comme téléphone' : 'compter comme téléphone'}`}
                onClick={() => setPhone(d, !d.phone)}>
                <span />
            </button>
        </div>
    );

    return (
        <section className="external-block" aria-labelledby="presence-title">
            <h2 id="presence-title">Présence</h2>
            <p className="muted settings-note">
                {data.anyoneHome === null
                    ? 'Coche au moins un téléphone : MyHue saura si quelqu’un est à la maison.'
                    : data.anyoneHome
                        ? 'Quelqu’un est à la maison : au moins un téléphone est sur le Wi-Fi.'
                        : 'Personne : aucun téléphone sur le Wi-Fi depuis 15 min.'}
                {' '}Un téléphone suffit, peu importe à qui. « Je pars » attend que tous aient quitté le Wi-Fi depuis 15 min.
            </p>
            <div className="settings-items">
                {phones.map(row)}
                {!phones.length && <span className="muted">Aucun téléphone repéré pour l’instant.</span>}
            </div>
            <button type="button" className="ghost-btn external-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Masquer' : 'Voir'} les {others.length} autres appareils du réseau
            </button>
            {showAll && <div className="settings-items">{others.map(row)}</div>}
        </section>
    );
}

// ── Hors MyHue ───────────────────────────────────────────────────────────────

const seenLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' });

function ExternalRowItem({ r, source }: { r: ExternalRow; source: string }) {
    return (
        <div className={`item-row static rule external ${r.on ? '' : 'disabled'}`}>
            <span className="item-icon off"><Icon name={source === 'Appli Hue' ? 'lights' : 'cast'} size={22} strokeWidth={2} /></span>
            <span className="item-text">
                <strong>{r.name}</strong>
                <span className="muted">{r.when} → {r.does}</span>
                <span className="ext-tags">
                    <span className="ext-tag source">Hors MyHue · {source}</span>
                    {!r.on && <span className="ext-tag">Désactivée</span>}
                    <span className={`ext-tag plan-${r.plan}`}>{r.planLabel}</span>
                </span>
            </span>
        </div>
    );
}

/**
 * Ce qui agit sans passer par MyHue, en lecture seule : on voit d'où vient une lampe qui
 * s'éteint ou une radio qui démarre. Les routines vocales Google sont repliées.
 */
function ExternalSection({ external, showVoice, onToggleVoice }: { external: External; showVoice: boolean; onToggleVoice: () => void }) {
    const googleAuto = external.google.filter((r) => r.auto && r.on);
    const googleOther = external.google.filter((r) => !(r.auto && r.on));
    return (
        <section className="external-block" aria-labelledby="external-title">
            <h2 id="external-title">Hors MyHue</h2>
            <p className="muted settings-note">
                Ces routines agissent sans passer par MyHue. Si une lampe ou une radio part toute seule, la réponse est
                probablement ici. Lecture seule : elles se modifient dans leur appli.
            </p>

            <h3 className="external-sub">Appli Hue <span className="muted">· lue en direct</span></h3>
            <div className="settings-items">
                {external.hue.map((r) => <ExternalRowItem key={`hue-${r.name}`} r={r} source="Appli Hue" />)}
                {!external.hue.length && <span className="muted">{external.hueError ? 'Pont Hue injoignable.' : 'Aucune routine.'}</span>}
            </div>

            <h3 className="external-sub">Google Home <span className="muted">· relevé le {seenLabel(external.googleSeenAt)}</span></h3>
            <div className="settings-items">
                {googleAuto.map((r) => <ExternalRowItem key={`g-${r.name}`} r={r} source="Google Home" />)}
            </div>
            <button type="button" className="ghost-btn external-more" aria-expanded={showVoice} onClick={onToggleVoice}>
                {showVoice ? 'Masquer' : 'Voir'} les {googleOther.length} routines vocales ou désactivées
            </button>
            {showVoice && (
                <div className="settings-items">
                    {googleOther.map((r) => <ExternalRowItem key={`g-${r.name}`} r={r} source="Google Home" />)}
                </div>
            )}
            <p className="muted settings-note">
                Google ne laisse pas lire ses routines : pour savoir laquelle vient de tourner, appli Google Home → Activité.
            </p>
        </section>
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
