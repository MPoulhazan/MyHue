import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import './Heating.css';

interface HeatingState {
    power: boolean;
    mode: 'heat' | 'cool' | 'dry' | 'fan' | 'auto';
    temperature: number;
    fanSpeed: 'auto' | 'low' | 'med' | 'high' | 'quiet';
    vaneVertical: 'auto' | '1' | '2' | '3' | '4' | '5' | 'swing';
    lastUpdated: string | null;
}

interface SensorData {
    did: string;
    name: string;
    model: string;
    props?: {
        temperature?: number;
        humidity?: number;
    };
}

const MODES = [
    { value: 'heat', icon: '🔥', label: 'Chaud' },
    { value: 'cool', icon: '❄️', label: 'Froid' },
    { value: 'dry', icon: '💧', label: 'Sec' },
    { value: 'fan', icon: '🌀', label: 'Ventilo' },
    { value: 'auto', icon: '🔄', label: 'Auto' },
] as const;

const FAN_SPEEDS = [
    { value: 'auto', label: 'Auto' },
    { value: 'quiet', label: 'Silence' },
    { value: 'low', label: 'Faible' },
    { value: 'med', label: 'Moyen' },
    { value: 'high', label: 'Fort' },
] as const;

const VANE_POSITIONS = [
    { value: 'auto', label: 'Auto' },
    { value: '1', label: '↑' },
    { value: '2', label: '↗' },
    { value: '3', label: '→' },
    { value: '4', label: '↘' },
    { value: '5', label: '↓' },
    { value: 'swing', label: '🔄' },
] as const;

const DEFAULT_STATE: HeatingState = {
    power: false,
    mode: 'heat',
    temperature: 22,
    fanSpeed: 'auto',
    vaneVertical: 'auto',
    lastUpdated: null,
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

export const Heating = () => {
    const [state, setState] = useState<HeatingState>(DEFAULT_STATE);
    const [connected, setConnected] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [sensors, setSensors] = useState<SensorData[]>([]);

    const loadStatus = useCallback(async () => {
        try {
            setError(null);
            const { data } = await axios.get('/api/heating/status');
            setConnected(data.connected);
            if (data.state) {
                setState(data.state);
            }
        } catch {
            setError('Erreur de connexion au serveur');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadSensors = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/xiaomi/sensors');
            const tempSensors = (data.sensors || []).filter(
                (s: SensorData) => s.props?.temperature !== undefined,
            );
            setSensors(tempSensors);
        } catch {
            // Sensors are optional, don't show error
        }
    }, []);

    useEffect(() => {
        loadStatus();
        loadSensors();
    }, [loadStatus, loadSensors]);

    const sendControl = async (changes: Partial<HeatingState>) => {
        const newState = { ...state, ...changes };
        // Optimistic update
        setState(newState);
        setSending(true);
        setError(null);

        try {
            const { data } = await axios.post('/api/heating/control', changes);
            setState(data);
        } catch {
            // Revert on error
            setState(state);
            setError("Erreur lors de l'envoi de la commande");
        } finally {
            setSending(false);
        }
    };

    const togglePower = () => sendControl({ power: !state.power });
    const setMode = (mode: HeatingState['mode']) => sendControl({ mode });
    const setTemp = (delta: number) => {
        const newTemp = Math.max(16, Math.min(31, state.temperature + delta));
        if (newTemp !== state.temperature)
            sendControl({ temperature: newTemp });
    };
    const setFan = (fanSpeed: HeatingState['fanSpeed']) =>
        sendControl({ fanSpeed });
    const setVane = (vaneVertical: HeatingState['vaneVertical']) =>
        sendControl({ vaneVertical });

    if (loading) {
        return (
            <div className="heating-container">
                <div className="heating-loading">
                    <div className="spinner" />
                    <p>Connexion au chauffage...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="heating-container">
            <div className="heating-header">
                <div className="heating-header-left">
                    <h1>
                        Chauffage
                        <span
                            className={`heating-status-dot ${connected ? 'connected' : 'disconnected'}`}
                            title={
                                connected
                                    ? 'Broadlink connecté'
                                    : 'Broadlink non connecté'
                            }
                        />
                    </h1>
                    <p className="subtitle">Pompe à chaleur Mitsubishi</p>
                </div>
            </div>

            <AnimatePresence mode="wait">
                {error && (
                    <motion.div
                        className="heating-error"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Thermostat */}
            <motion.div
                className={`thermostat-card ${state.power ? '' : 'off'}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <motion.button
                    className={`power-button ${state.power ? 'on' : ''}`}
                    onClick={togglePower}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    disabled={sending}
                >
                    ⏻
                </motion.button>

                <div className="temp-display">
                    <div className="temp-controls">
                        <motion.button
                            className="temp-btn"
                            onClick={() => setTemp(-1)}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            disabled={
                                !state.power ||
                                state.temperature <= 16 ||
                                sending
                            }
                        >
                            −
                        </motion.button>

                        <motion.div
                            className="temp-value"
                            key={state.temperature}
                            initial={{ scale: 1.1, opacity: 0.5 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: 'spring', stiffness: 300 }}
                        >
                            {state.temperature}
                            <span className="unit">°C</span>
                        </motion.div>

                        <motion.button
                            className="temp-btn"
                            onClick={() => setTemp(1)}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            disabled={
                                !state.power ||
                                state.temperature >= 31 ||
                                sending
                            }
                        >
                            +
                        </motion.button>
                    </div>
                    <div className="temp-label">
                        {state.power
                            ? MODES.find((m) => m.value === state.mode)
                                  ?.label || state.mode
                            : 'Éteint'}
                    </div>
                </div>
            </motion.div>

            {/* Mode */}
            <motion.div
                className={`control-card ${!state.power ? 'controls-disabled' : ''}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
            >
                <div className="control-label">Mode</div>
                <div className="control-options">
                    {MODES.map((mode) => (
                        <motion.button
                            key={mode.value}
                            className={`control-option ${state.mode === mode.value ? 'active' : ''}`}
                            onClick={() => setMode(mode.value)}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            disabled={!state.power || sending}
                        >
                            <span className="option-icon">{mode.icon}</span>
                            <span className="option-label">{mode.label}</span>
                        </motion.button>
                    ))}
                </div>
            </motion.div>

            {/* Fan speed */}
            <motion.div
                className={`control-card ${!state.power ? 'controls-disabled' : ''}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
            >
                <div className="control-label">Ventilateur</div>
                <div className="control-options">
                    {FAN_SPEEDS.map((fan) => (
                        <motion.button
                            key={fan.value}
                            className={`control-option ${state.fanSpeed === fan.value ? 'active' : ''}`}
                            onClick={() => setFan(fan.value)}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            disabled={!state.power || sending}
                        >
                            {fan.label}
                        </motion.button>
                    ))}
                </div>
            </motion.div>

            {/* Vane position */}
            <motion.div
                className={`control-card ${!state.power ? 'controls-disabled' : ''}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
            >
                <div className="control-label">Volet</div>
                <div className="control-options">
                    {VANE_POSITIONS.map((vane) => (
                        <motion.button
                            key={vane.value}
                            className={`control-option ${state.vaneVertical === vane.value ? 'active' : ''}`}
                            onClick={() => setVane(vane.value)}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            disabled={!state.power || sending}
                        >
                            {vane.label}
                        </motion.button>
                    ))}
                </div>
            </motion.div>

            {/* Temperature sensors */}
            {sensors.length > 0 && (
                <motion.div
                    className="sensors-section"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <div className="control-label">Température ambiante</div>
                    <div className="sensors-grid">
                        {sensors.map((sensor) => (
                            <div key={sensor.did} className="sensor-chip">
                                <span className="sensor-chip-icon">🌡️</span>
                                <div className="sensor-chip-info">
                                    <span className="sensor-chip-name">
                                        {sensor.name}
                                    </span>
                                    <span className="sensor-chip-value">
                                        {sensor.props?.temperature?.toFixed(1)}
                                        °C
                                        {sensor.props?.humidity !==
                                            undefined && (
                                            <> · {sensor.props.humidity}%</>
                                        )}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>
            )}

            {/* Last updated */}
            {state.lastUpdated && (
                <div className="last-updated">
                    Dernière commande : {formatTimeAgo(state.lastUpdated)}
                </div>
            )}
        </div>
    );
};
