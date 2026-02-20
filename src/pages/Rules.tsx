import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import './Rules.css';

interface RuleCondition {
    property: string;
    operator: string;
    value: number | null;
}

interface Rule {
    id: string;
    name: string;
    sensorDid: string;
    sensorName: string;
    condition: RuleCondition;
    message: string;
    cooldownMinutes: number;
    enabled: boolean;
    createdAt: string;
    lastTriggeredAt: string | null;
    triggerCount: number;
}

const OPERATOR_LABELS: Record<string, string> = {
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
    eq: '=',
    neq: '!=',
    is_true: 'est vrai',
    is_false: 'est faux',
};

const PROPERTY_LABELS: Record<string, string> = {
    temperature: 'Température',
    humidity: 'Humidité',
    isOpen: 'Ouverture',
    smokeDetected: 'Fumée',
    leakDetected: 'Fuite',
};

const PROPERTY_UNITS: Record<string, string> = {
    temperature: '°C',
    humidity: '%',
};

const SENSOR_ICONS: Record<string, string> = {
    temperature: '🌡️',
    humidity: '💧',
    isOpen: '🚪',
    smokeDetected: '🔥',
    leakDetected: '💧',
};

const formatCondition = (condition: RuleCondition) => {
    const label = PROPERTY_LABELS[condition.property] || condition.property;
    const op = OPERATOR_LABELS[condition.operator] || condition.operator;
    const unit = PROPERTY_UNITS[condition.property] || '';

    if (condition.operator === 'is_true' || condition.operator === 'is_false') {
        return `${label} ${op}`;
    }
    return `${label} ${op} ${condition.value}${unit}`;
};

const formatTimeAgo = (isoDate: string) => {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes}min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours}h`;
    const days = Math.floor(hours / 24);
    return `il y a ${days}j`;
};

export const Rules = () => {
    const [rules, setRules] = useState<Rule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadRules();
    }, []);

    const loadRules = async () => {
        try {
            setError(null);
            const { data } = await axios.get('/api/rules');
            setRules(data);
        } catch {
            setError('Erreur lors du chargement des règles');
        } finally {
            setLoading(false);
        }
    };

    const toggleRule = async (id: string) => {
        try {
            const { data } = await axios.patch(`/api/rules/${id}/toggle`);
            setRules(prev => prev.map(r => r.id === id ? data : r));
        } catch {
            setError('Erreur lors de la modification');
        }
    };

    const deleteRule = async (id: string) => {
        try {
            await axios.delete(`/api/rules/${id}`);
            setRules(prev => prev.filter(r => r.id !== id));
        } catch {
            setError('Erreur lors de la suppression');
        }
    };

    return (
        <div className="rules-container">
            <div className="rules-header">
                <div>
                    <h1>Règles de notification</h1>
                    <p className="subtitle">
                        {rules.length > 0
                            ? `${rules.filter(r => r.enabled).length} règle(s) active(s) sur ${rules.length}`
                            : 'Aucune règle configurée'}
                    </p>
                </div>
                <button className="rules-refresh" onClick={loadRules}>↻</button>
            </div>

            <AnimatePresence mode="wait">
                {error && (
                    <motion.div
                        className="rules-error"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {loading && (
                <div className="rules-loading">
                    <div className="spinner" />
                    <p>Chargement des règles...</p>
                </div>
            )}

            {!loading && rules.length === 0 && (
                <motion.div
                    className="rules-empty"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className="rules-empty-icon">🔔</div>
                    <h2>Aucune règle de notification</h2>
                    <p>Demande à l'assistant IA de créer des alertes :</p>
                    <ul>
                        <li>"Préviens-moi si la température dépasse 26°C"</li>
                        <li>"Alerte-moi quand la porte d'entrée s'ouvre"</li>
                        <li>"Notifie-moi si de la fumée est détectée"</li>
                        <li>"Préviens-moi en cas de fuite d'eau"</li>
                    </ul>
                </motion.div>
            )}

            <div className="rules-grid">
                {rules.map((rule, index) => (
                    <motion.div
                        key={rule.id}
                        className={`rule-card ${rule.enabled ? '' : 'disabled'}`}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ delay: index * 0.05 }}
                        whileHover={{ scale: 1.02 }}
                    >
                        <div className="rule-card-header">
                            <span className="rule-icon">
                                {SENSOR_ICONS[rule.condition.property] || '📋'}
                            </span>
                            <div className="rule-title-area">
                                <h3>{rule.name}</h3>
                                <span className="rule-sensor">{rule.sensorName}</span>
                            </div>
                            <label className="rule-toggle">
                                <input
                                    type="checkbox"
                                    checked={rule.enabled}
                                    onChange={() => toggleRule(rule.id)}
                                />
                                <span className="toggle-slider" />
                            </label>
                        </div>

                        <div className="rule-condition">
                            {formatCondition(rule.condition)}
                        </div>

                        <div className="rule-message">
                            💬 {rule.message}
                        </div>

                        <div className="rule-footer">
                            <div className="rule-meta">
                                <span className="rule-cooldown">⏱️ {rule.cooldownMinutes}min</span>
                                {rule.triggerCount > 0 && (
                                    <span className="rule-triggers">
                                        🔔 {rule.triggerCount}x
                                        {rule.lastTriggeredAt && (
                                            <> · {formatTimeAgo(rule.lastTriggeredAt)}</>
                                        )}
                                    </span>
                                )}
                            </div>
                            <button
                                className="rule-delete"
                                onClick={() => deleteRule(rule.id)}
                                title="Supprimer"
                            >
                                🗑️
                            </button>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
};
