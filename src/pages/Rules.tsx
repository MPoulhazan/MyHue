import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import './Rules.css';

interface Automation {
    id: string;
    name: string;
    template: string | null;
    enabled: boolean;
    summary: string;
    trigger: { prop: string; did: string };
    lastTriggeredAt: string | null;
    triggerCount: number;
}

interface Template {
    id: string;
    label: string;
    description: string;
    sensorType: string | null;
}

interface Sensor {
    did: string;
    name: string;
    type: string;
}

const ICONS: Record<string, string> = {
    isOpen: '🚪',
    temperature: '🌡',
    humidity: '💧',
    battery: '🔋',
    silentHours: '📡',
};

const formatTimeAgo = (isoDate: string) => {
    const minutes = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
};

export const Rules = () => {
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [doors, setDoors] = useState<Sensor[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        try {
            setError(null);
            const [a, t, s] = await Promise.all([
                axios.get('/api/automations'),
                axios.get('/api/automations/templates'),
                axios.get('/api/sensors'),
            ]);
            setAutomations(a.data.automations);
            setTemplates(t.data.templates);
            setDoors((s.data.sensors as Sensor[]).filter((x) => x.type === 'door'));
        } catch {
            setError('Erreur lors du chargement des automatismes');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const toggle = async (id: string) => {
        try {
            const { data } = await axios.patch(`/api/automations/${id}/toggle`);
            setAutomations((prev) => prev.map((a) => (a.id === id ? data : a)));
        } catch {
            setError('Erreur lors de la modification');
        }
    };

    const remove = async (id: string) => {
        try {
            await axios.delete(`/api/automations/${id}`);
            setAutomations((prev) => prev.filter((a) => a.id !== id));
        } catch {
            setError('Erreur lors de la suppression');
        }
    };

    const add = async (template: string, did?: string) => {
        try {
            await axios.post('/api/automations', { template, params: did ? { did } : {} });
            load();
        } catch {
            setError("Impossible d'ajouter cet automatisme");
        }
    };

    // Modèles pas encore utilisés ; ceux liés aux portes se proposent porte par porte
    const suggestions = templates.flatMap((t): { t: Template; did?: string; label: string }[] => {
        const used = automations.filter((a) => a.template === t.id);
        if (t.sensorType !== 'door') return used.length ? [] : [{ t, did: undefined, label: t.label }];
        return doors
            .filter((d) => !used.some((a) => a.trigger.did === d.did || a.trigger.did === '*'))
            .map((d) => ({ t, did: d.did, label: `${t.label} · ${d.name}` }));
    });

    return (
        <div className="rules-container">
            <div className="rules-header">
                <div>
                    <h1>Automatismes</h1>
                    <p className="subtitle">
                        {automations.length > 0
                            ? `${automations.filter((a) => a.enabled).length} actif(s) sur ${automations.length}`
                            : 'Aucun automatisme'}
                    </p>
                </div>
                <button className="rules-refresh" onClick={load}>↻</button>
            </div>

            <AnimatePresence mode="wait">
                {error && (
                    <motion.div className="rules-error" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {loading && (
                <div className="rules-loading">
                    <div className="spinner" />
                    <p>Chargement…</p>
                </div>
            )}

            <div className="rules-grid">
                {automations.map((a, index) => (
                    <motion.div
                        key={a.id}
                        className={`rule-card ${a.enabled ? '' : 'disabled'}`}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.04 }}
                    >
                        <div className="rule-card-header">
                            <span className="rule-icon">{ICONS[a.trigger.prop] || '⚙️'}</span>
                            <div className="rule-title-area">
                                <h3>{a.name}</h3>
                            </div>
                            <label className="rule-toggle">
                                <input type="checkbox" checked={a.enabled} onChange={() => toggle(a.id)} />
                                <span className="toggle-slider" />
                            </label>
                        </div>
                        <div className="rule-condition">{a.summary}</div>
                        <div className="rule-footer">
                            <div className="rule-meta">
                                {a.triggerCount > 0 && a.lastTriggeredAt ? (
                                    <span>🔔 {a.triggerCount}× · {formatTimeAgo(a.lastTriggeredAt)}</span>
                                ) : (
                                    <span>Jamais déclenché</span>
                                )}
                            </div>
                            <button className="rule-delete" onClick={() => remove(a.id)} title="Supprimer">🗑</button>
                        </div>
                    </motion.div>
                ))}
            </div>

            {suggestions.length > 0 && (
                <>
                    <h2 className="rules-suggest-title">Suggestions</h2>
                    <div className="rules-grid">
                        {suggestions.map(({ t, did, label }) => (
                            <div key={`${t.id}-${did ?? ''}`} className="rule-card disabled">
                                <div className="rule-card-header">
                                    <div className="rule-title-area">
                                        <h3>{label}</h3>
                                    </div>
                                </div>
                                <div className="rule-message">{t.description}</div>
                                <div className="rule-footer">
                                    <span />
                                    <button className="rules-refresh" onClick={() => add(t.id, did)}>+ Activer</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {!loading && (
                <p className="subtitle" style={{ marginTop: 24 }}>
                    Tu peux aussi demander à l’agent : « Préviens-moi si la température du salon passe sous 18° ».
                </p>
            )}
        </div>
    );
};
