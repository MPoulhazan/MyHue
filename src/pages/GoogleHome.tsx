import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import QrScanner from 'qr-scanner';
import {
    ResponsiveContainer,
    ComposedChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from 'recharts';
import './GoogleHome.css';
import { themeColor, useTheme } from '../theme/useTheme';

interface EurekaInfo {
    name: string;
    buildVersion: string | null;
    castBuildRevision: string | null;
    model: string | null;
    manufacturer: string | null;
    hardwareVersion: string | null;
    locale: string | null;
    timezone: string | null;
    uptime: string | null;
    uptimeSeconds: number | null;
    ssid: string | null;
    signalLevel: number | null;
    noiseLevel: number | null;
    ipAddress: string;
    macAddress: string | null;
}

interface GoogleHomeDevice {
    id: string;
    name: string;
    host: string;
    port: number;
    manual: boolean;
    online: boolean;
    eureka: EurekaInfo | null;
}

interface XiaomiSensor {
    did: string;
    name: string;
    model: string;
    type: string;
    icon: string;
    isOnline: boolean;
    mac: string | null;
    props: {
        temperature?: number | null;
        humidity?: number | null;
        pressure?: number | null;
        battery?: number | null;
        lastMotion?: string | null;
        lastOpen?: string | null;
        isOpen?: boolean | null;
    };
    lastUpdated: string | null;
    source?: string;
    zigbeeName?: string;
}

interface HistoryPoint {
    ts: number;
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
    battery: number | null;
}

interface ZigbeeRawDevice {
    ieeeAddr: string;
    friendlyName: string;
    model: string | null;
    vendor: string | null;
    description: string | null;
    lastSeen: string | null;
}

const SENSOR_TYPE_OPTIONS = [
    { value: 'temperature_humidity', label: 'Température / Humidité' },
    { value: 'door', label: 'Porte / Fenêtre' },
    { value: 'motion', label: 'Mouvement' },
    { value: 'smoke', label: 'Fumée' },
    { value: 'water_leak', label: 'Inondation' },
    { value: 'vibration', label: 'Vibration' },
    { value: 'button', label: 'Bouton' },
    { value: 'other', label: 'Autre' },
];

const getDeviceIcon = (device: GoogleHomeDevice): string => {
    const name = (device.eureka?.name || device.name).toLowerCase();
    const model = (device.eureka?.model || '').toLowerCase();

    if (model.includes('chromecast') || name.includes('chromecast'))
        return '📺';
    if (
        model.includes('hub') ||
        name.includes('hub') ||
        name.includes('nest hub')
    )
        return '🖥';
    if (model.includes('mini') || name.includes('mini')) return '🔘';
    if (model.includes('max') || name.includes('max')) return '🔊';
    if (name.includes('nest') || name.includes('google home')) return '🏠';
    if (name.includes('tv') || name.includes('shield')) return '📺';
    return '🔈';
};

const getSignalQuality = (
    level: number | null,
): { label: string; className: string } => {
    if (level == null) return { label: 'N/A', className: 'signal-unknown' };
    if (level >= -50)
        return { label: 'Excellent', className: 'signal-excellent' };
    if (level >= -60) return { label: 'Bon', className: 'signal-good' };
    if (level >= -70) return { label: 'Correct', className: 'signal-fair' };
    return { label: 'Faible', className: 'signal-weak' };
};

const formatTimeAgo = (isoDate: string | null): string => {
    if (!isoDate) return 'N/A';
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "A l'instant";
    if (mins < 60) return `Il y a ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Il y a ${hours}h`;
    const days = Math.floor(hours / 24);
    return `Il y a ${days}j`;
};

export const GoogleHome = () => {
    useTheme(); // couleurs des graphiques recalculées au crépuscule
    const [devices, setDevices] = useState<GoogleHomeDevice[]>([]);
    const [sensors, setSensors] = useState<XiaomiSensor[]>([]);
    const [sensorsLoading, setSensorsLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    // Historique
    const [selectedSensor, setSelectedSensor] = useState<XiaomiSensor | null>(
        null,
    );
    const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    // Appairage
    const [pairingActive, setPairingActive] = useState(false);
    const [pairingSecondsLeft, setPairingSecondsLeft] = useState(0);
    const [pairingError, setPairingError] = useState<string | null>(null);
    const pairingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Édition / enregistrement capteur dans le registre
    const [unregistered, setUnregistered] = useState<ZigbeeRawDevice[]>([]);
    const [editTarget, setEditTarget] = useState<{
        ieee: string;
        name: string;
        type: string;
        model?: string | null;
    } | null>(null);
    const [editName, setEditName] = useState('');
    const [editType, setEditType] = useState('temperature_humidity');
    const [editSaving, setEditSaving] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);

    // QR code scanner
    const [qrOpen, setQrOpen] = useState(false);
    const [qrDetected, setQrDetected] = useState<string | null>(null);
    const [qrManual, setQrManual] = useState('');
    const [qrSubmitting, setQrSubmitting] = useState(false);
    const [qrResult, setQrResult] = useState<'ok' | 'error' | null>(null);
    const qrVideoRef = useRef<HTMLVideoElement | null>(null);
    const qrScannerRef = useRef<QrScanner | null>(null);

    const openQrScanner = useCallback(() => {
        setQrDetected(null);
        setQrManual('');
        setQrResult(null);
        setQrOpen(true);
    }, []);

    const closeQrScanner = useCallback(() => {
        qrScannerRef.current?.stop();
        qrScannerRef.current?.destroy();
        qrScannerRef.current = null;
        setQrOpen(false);
        setQrDetected(null);
        setQrManual('');
        setQrResult(null);
    }, []);

    // Start camera when QR modal opens
    useEffect(() => {
        if (!qrOpen || !qrVideoRef.current) return;
        const video = qrVideoRef.current;
        const scanner = new QrScanner(
            video,
            (result) => {
                if (qrDetected) return; // already detected
                setQrDetected(result.data);
                scanner.stop();
            },
            {
                returnDetailedScanResult: true,
                highlightScanRegion: true,
                highlightCodeOutline: true,
                preferredCamera: 'environment',
            },
        );
        qrScannerRef.current = scanner;
        scanner.start().catch(() => {
            // Camera not available — user can type manually
        });
        return () => {
            scanner.stop();
            scanner.destroy();
        };
    }, [qrOpen]);

    const startPairing = useCallback(async () => {
        const DURATION = 120;
        setPairingError(null);
        try {
            await axios.post('/api/zigbee/permit-join', { seconds: DURATION });
            setPairingActive(true);
            setPairingSecondsLeft(DURATION);
            let tick = 0;
            pairingTimerRef.current = setInterval(() => {
                tick++;
                setPairingSecondsLeft((s) => {
                    if (s <= 1) {
                        clearInterval(pairingTimerRef.current!);
                        pairingTimerRef.current = null;
                        setPairingActive(false);
                        loadXiaomi();
                        loadUnregistered();
                        return 0;
                    }
                    // Poll toutes les 3s pour détecter les nouveaux appareils rapidement
                    if (tick % 3 === 0) {
                        loadUnregistered();
                    }
                    return s - 1;
                });
            }, 1000);
        } catch {
            setPairingError(
                "Impossible de démarrer l'appairage. Vérifiez que le service Zigbee est actif.",
            );
        }
    }, []);

    const stopPairing = useCallback(async () => {
        if (pairingTimerRef.current) {
            clearInterval(pairingTimerRef.current);
            pairingTimerRef.current = null;
        }
        setPairingActive(false);
        setPairingSecondsLeft(0);
        try {
            await axios.post('/api/zigbee/stop-join');
        } catch {
            /* ignore */
        }
        loadXiaomi();
    }, []);

    const loadUnregistered = useCallback(async () => {
        try {
            const res = await axios.get('/api/zigbee/unregistered');
            setUnregistered(res.data.devices || []);
        } catch {
            setUnregistered([]);
        }
    }, []);

    const submitInstallCode = useCallback(async () => {
        const code = (qrDetected || qrManual).trim();
        if (!code) return;
        setQrSubmitting(true);
        try {
            await axios.post('/api/zigbee/install-code', { code });
            setQrResult('ok');
            setTimeout(() => {
                closeQrScanner();
                loadUnregistered();
            }, 2000);
        } catch {
            setQrResult('error');
        } finally {
            setQrSubmitting(false);
        }
    }, [qrDetected, qrManual, closeQrScanner, loadUnregistered]);

    const openEdit = useCallback((sensor: XiaomiSensor) => {
        setEditTarget({
            ieee: sensor.did,
            name: sensor.name,
            type: sensor.type,
            model: sensor.model,
        });
        setEditName(sensor.name);
        setEditType(sensor.type);
        setEditError(null);
    }, []);

    const openRegister = useCallback((device: ZigbeeRawDevice) => {
        const label =
            device.vendor && device.model
                ? `${device.vendor} ${device.model}`
                : device.friendlyName || device.ieeeAddr;
        setEditTarget({
            ieee: device.ieeeAddr,
            name: label,
            type: 'temperature_humidity',
            model: device.model,
        });
        setEditName(label);
        setEditType('temperature_humidity');
        setEditError(null);
    }, []);

    const handleSaveEdit = useCallback(async () => {
        if (!editTarget || !editName.trim()) return;
        setEditSaving(true);
        setEditError(null);
        try {
            await axios.post('/api/sensors/registry', {
                ieee: editTarget.ieee,
                name: editName.trim(),
                type: editType,
            });
            setEditTarget(null);
            await Promise.all([loadXiaomi(), loadUnregistered()]);
        } catch (err) {
            setEditError(
                axios.isAxiosError(err)
                    ? err.response?.data?.error || "Erreur d'enregistrement"
                    : "Erreur d'enregistrement",
            );
        } finally {
            setEditSaving(false);
        }
    }, [editTarget, editName, editType, loadUnregistered]);

    const handleDelete = useCallback(
        async (ieee: string) => {
            setDeleting(ieee);
            try {
                await axios.delete(
                    `/api/sensors/registry/${encodeURIComponent(ieee)}`,
                );
                await Promise.all([loadXiaomi(), loadUnregistered()]);
            } catch {
                /* ignore */
            } finally {
                setDeleting(null);
            }
        },
        [loadUnregistered],
    );

    // Nettoyage au démontage
    useEffect(
        () => () => {
            if (pairingTimerRef.current) clearInterval(pairingTimerRef.current);
        },
        [],
    );

    const openHistory = useCallback(async (sensor: XiaomiSensor) => {
        setSelectedSensor(sensor);
        setHistoryData([]);
        setHistoryLoading(true);
        try {
            const res = await axios.get(
                `/api/zigbee/history/${encodeURIComponent(sensor.did)}`,
            );
            setHistoryData(res.data.points || []);
        } catch {
            setHistoryData([]);
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, []);

    // SSE: real-time sensor updates without polling
    useEffect(() => {
        const es = new EventSource('/api/sensors/events');
        es.onmessage = (e) => {
            try {
                const sensors = JSON.parse(e.data);
                setSensors(sensors);
            } catch { /* ignore */ }
        };
        return () => es.close();
    }, []);

    const loadAll = async () => {
        await Promise.all([loadDevices(), loadXiaomi(), loadUnregistered()]);
    };

    const loadDevices = async () => {
        try {
            setError(null);
            const response = await axios.get(`/api/google-home/devices`);
            setDevices(response.data.devices || []);
        } catch (err) {
            console.error('Failed to fetch Google Home devices:', err);
            setError(
                'Impossible de charger les appareils. Vérifiez que le serveur agent est lancé.',
            );
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const loadXiaomi = async () => {
        try {
            setSensorsLoading(true);
            const { data } = await axios.get('/api/sensors');
            setSensors(data.sensors || []);
        } catch (err) {
            console.error('Failed to fetch Xiaomi sensors:', err);
        } finally {
            setSensorsLoading(false);
        }
    };

    const handleRefresh = () => {
        setRefreshing(true);
        loadAll();
    };

    const onlineCount = devices.filter((d) => d.online).length;
    const offlineCount = devices.filter((d) => !d.online).length;

    if (loading) {
        return (
            <div className="ghome-page">
                <div className="loading-container">
                    <motion.div
                        className="loading-spinner"
                        animate={{ rotate: 360 }}
                        transition={{
                            duration: 1,
                            repeat: Infinity,
                            ease: 'linear',
                        }}
                    >
                        <svg
                            width="64"
                            height="64"
                            viewBox="0 0 24 24"
                            fill="none"
                        >
                            <path
                                d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22"
                                stroke="url(#gradient-gh)"
                                strokeWidth="3"
                                strokeLinecap="round"
                            />
                            <defs>
                                <linearGradient
                                    id="gradient-gh"
                                    x1="0%"
                                    y1="0%"
                                    x2="100%"
                                    y2="100%"
                                >
                                    <stop offset="0%" style={{ stopColor: 'var(--accent)' }} />
                                    <stop offset="100%" style={{ stopColor: 'var(--primary-dark)' }} />
                                </linearGradient>
                            </defs>
                        </svg>
                    </motion.div>
                    <p className="loading-text">Recherche des appareils...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="ghome-page">
            <motion.header
                className="ghome-header"
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
            >
                <div className="ghome-header-top">
                    <div>
                        <h1>Maison</h1>
                        <p className="subtitle">Appareils & Capteurs</p>
                    </div>
                    <motion.button
                        className="refresh-btn glass"
                        onClick={handleRefresh}
                        disabled={refreshing}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <motion.span
                            animate={refreshing ? { rotate: 360 } : {}}
                            transition={
                                refreshing
                                    ? {
                                          duration: 1,
                                          repeat: Infinity,
                                          ease: 'linear',
                                      }
                                    : {}
                            }
                            style={{ display: 'inline-block' }}
                        >
                            &#x21bb;
                        </motion.span>
                        {refreshing ? 'Scan...' : 'Rafraichir'}
                    </motion.button>
                </div>

                <div className="ghome-stats">
                    <div className="stat-item glass">
                        <span className="stat-value">{devices.length}</span>
                        <span className="stat-label">Cast</span>
                    </div>
                    <div className="stat-item glass">
                        <span className="stat-value stat-online">
                            {onlineCount}
                        </span>
                        <span className="stat-label">En ligne</span>
                    </div>
                    {sensors.length > 0 && (
                        <div className="stat-item glass">
                            <span className="stat-value stat-xiaomi">
                                {sensors.length}
                            </span>
                            <span className="stat-label">Capteurs</span>
                        </div>
                    )}
                    <div className="stat-item glass">
                        <span className="stat-value stat-offline">
                            {offlineCount}
                        </span>
                        <span className="stat-label">Hors ligne</span>
                    </div>
                </div>
            </motion.header>

            {error && (
                <motion.div
                    className="error-banner"
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    {error}
                </motion.div>
            )}

            {(
                <motion.section
                    className="xiaomi-section"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="section-title-row">
                        <h2 className="section-title">Capteurs</h2>
                        <motion.button
                            className={`pair-btn glass ${pairingActive ? 'pair-btn-active' : ''}`}
                            onClick={pairingActive ? stopPairing : startPairing}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            {pairingActive ? (
                                <>
                                    <span className="pair-pulse" />
                                    Appairage… {pairingSecondsLeft}s — Annuler
                                </>
                            ) : (
                                <>+ Ajouter un capteur</>
                            )}
                        </motion.button>
                        <motion.button
                            className="qr-btn glass"
                            onClick={openQrScanner}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            title="Appairer via QR code (Zigbee 3.0)"
                        >
                            QR
                        </motion.button>
                    </div>
                    {pairingError && (
                        <div className="pairing-error">{pairingError}</div>
                    )}
                    {pairingActive && (
                        <motion.div
                            className={`pairing-banner glass ${unregistered.length > 0 ? 'pairing-banner-found' : ''}`}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <span className="pair-pulse-lg" />
                            <div>
                                {unregistered.length > 0 ? (
                                    <>
                                        <strong style={{ color: '#4ade80' }}>
                                            ✓ Appareil détecté !
                                        </strong>
                                        <p>
                                            Cliquez sur{' '}
                                            <strong>+ Configurer</strong>{' '}
                                            ci-dessous pour lui donner un nom.
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <strong>Mode appairage actif</strong>
                                        <p>
                                            Maintenez le bouton de votre
                                            capteur appuyé 5 secondes jusqu'au
                                            clignotement, puis relâchez.
                                        </p>
                                    </>
                                )}
                            </div>
                            <span className="pairing-countdown">
                                {pairingSecondsLeft}s
                            </span>
                        </motion.div>
                    )}
                    <div className="sensors-grid">
                        {sensors
                            .filter(
                                (s) =>
                                    s.type !== 'gateway' &&
                                    s.type !== 'unknown',
                            )
                            .map((sensor, index) => (
                                <motion.div
                                    key={sensor.did}
                                    className={`sensor-card glass ${sensor.isOnline ? 'sensor-online' : 'sensor-offline'}${sensor.type === 'temperature_humidity' ? ' sensor-clickable' : ''}`}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: index * 0.05 }}
                                    onClick={
                                        sensor.type === 'temperature_humidity'
                                            ? () => openHistory(sensor)
                                            : undefined
                                    }
                                >
                                    <div className="sensor-header">
                                        <span className="sensor-icon">
                                            {sensor.icon}
                                        </span>
                                        <div className="sensor-info">
                                            <h4 className="sensor-name">
                                                {sensor.name}
                                            </h4>
                                            <span className="sensor-model">
                                                {sensor.model}
                                            </span>
                                        </div>
                                        {sensor.source === 'zigbee' && (
                                            <div className="sensor-actions">
                                                <button
                                                    className="sensor-rename-btn"
                                                    title="Modifier ce capteur"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openEdit(sensor);
                                                    }}
                                                >
                                                    ✏
                                                </button>
                                                <button
                                                    className="sensor-delete-btn"
                                                    title="Retirer ce capteur"
                                                    disabled={
                                                        deleting === sensor.did
                                                    }
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDelete(
                                                            sensor.did,
                                                        );
                                                    }}
                                                >
                                                    🗑
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="sensor-data">
                                        {sensor.type ===
                                            'temperature_humidity' && (
                                            <>
                                                <div className="sensor-value-big">
                                                    {sensor.props.temperature !=
                                                    null ? (
                                                        <>
                                                            <span className="value-number">
                                                                {sensor.props.temperature.toFixed(
                                                                    1,
                                                                )}
                                                            </span>
                                                            <span className="value-unit">
                                                                °C
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <span className="value-na">
                                                            --
                                                        </span>
                                                    )}
                                                </div>
                                                {sensor.props.humidity !=
                                                    null && (
                                                    <div className="sensor-value-secondary">
                                                        💧{' '}
                                                        {sensor.props.humidity.toFixed(
                                                            0,
                                                        )}
                                                        %
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {sensor.type === 'motion' && (
                                            <div className="sensor-value-event">
                                                <span className="event-label">
                                                    Dernier mouvement
                                                </span>
                                                <span className="event-time">
                                                    {formatTimeAgo(
                                                        sensor.props
                                                            .lastMotion ?? null,
                                                    )}
                                                </span>
                                            </div>
                                        )}

                                        {sensor.type === 'door' && (
                                            <div className="sensor-value-event">
                                                <span className="event-label">
                                                    Porte/Fenêtre
                                                </span>
                                                {sensor.props.isOpen != null ? (
                                                    <span
                                                        className={`event-status ${sensor.props.isOpen ? '' : 'ok'}`}
                                                        style={
                                                            sensor.props.isOpen
                                                                ? {
                                                                      color: '#f97316',
                                                                  }
                                                                : undefined
                                                        }
                                                    >
                                                        {sensor.props.isOpen
                                                            ? 'Ouverte'
                                                            : 'Fermée'}
                                                    </span>
                                                ) : (
                                                    <span className="event-status ok">
                                                        {sensor.props.lastOpen
                                                            ? formatTimeAgo(
                                                                  sensor.props
                                                                      .lastOpen,
                                                              )
                                                            : 'Fermée'}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {sensor.type === 'water_leak' && (
                                            <div className="sensor-value-event">
                                                <span className="event-label">
                                                    Fuite d'eau
                                                </span>
                                                <span className="event-status ok">
                                                    Aucune
                                                </span>
                                            </div>
                                        )}

                                        {sensor.type === 'smoke' && (
                                            <div className="sensor-value-event">
                                                <span className="event-label">
                                                    Fumée
                                                </span>
                                                <span className="event-status ok">
                                                    Non détectée
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {sensor.lastUpdated && (
                                        <div className="sensor-footer">
                                            Mis à jour{' '}
                                            {formatTimeAgo(sensor.lastUpdated)}
                                            {sensor.type ===
                                                'temperature_humidity' && (
                                                <span className="sensor-history-hint">
                                                    📈 24h
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </motion.div>
                            ))}
                    </div>

                    {/* Appareils Zigbee non enregistrés */}
                    {unregistered.length > 0 && (
                        <div className="unregistered-section">
                            <h3 className="unregistered-title">
                                Appareils non configurés
                            </h3>
                            <div className="unregistered-list">
                                {unregistered.map((d) => (
                                    <div
                                        key={d.ieeeAddr}
                                        className="unregistered-card glass"
                                    >
                                        <div className="unregistered-info">
                                            <span className="unregistered-icon">
                                                📡
                                            </span>
                                            <div>
                                                <p className="unregistered-name">
                                                    {d.vendor && d.model
                                                        ? `${d.vendor} ${d.model}`
                                                        : d.friendlyName}
                                                </p>
                                                <p className="unregistered-ieee">
                                                    {d.ieeeAddr}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            className="unregistered-add-btn"
                                            onClick={() => openRegister(d)}
                                        >
                                            + Configurer
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </motion.section>
            )}

            {/* Modal édition / enregistrement capteur */}
            <AnimatePresence>
                {editTarget && (
                    <motion.div
                        className="history-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setEditTarget(null)}
                    >
                        <motion.div
                            className="rename-modal glass"
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="history-modal-header">
                                <div>
                                    <h3>
                                        {sensors.some(
                                            (s) => s.did === editTarget.ieee,
                                        )
                                            ? 'Modifier le capteur'
                                            : 'Configurer le capteur'}
                                    </h3>
                                    <p className="history-modal-subtitle">
                                        {editTarget.model || editTarget.ieee}
                                    </p>
                                </div>
                                <button
                                    className="history-close-btn"
                                    onClick={() => setEditTarget(null)}
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="rename-body">
                                <label className="rename-label">Nom</label>
                                <input
                                    className="rename-input"
                                    type="text"
                                    value={editName}
                                    onChange={(e) =>
                                        setEditName(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveEdit();
                                        if (e.key === 'Escape')
                                            setEditTarget(null);
                                    }}
                                    placeholder="Ex: Salon"
                                    autoFocus
                                    maxLength={60}
                                />
                                <label
                                    className="rename-label"
                                    style={{ marginTop: '12px' }}
                                >
                                    Type
                                </label>
                                <select
                                    className="rename-input edit-type-select"
                                    value={editType}
                                    onChange={(e) =>
                                        setEditType(e.target.value)
                                    }
                                >
                                    {SENSOR_TYPE_OPTIONS.map((opt) => (
                                        <option
                                            key={opt.value}
                                            value={opt.value}
                                        >
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                                {editError && (
                                    <p className="rename-error">{editError}</p>
                                )}
                                <div className="rename-actions">
                                    <button
                                        className="rename-cancel-btn"
                                        onClick={() => setEditTarget(null)}
                                        disabled={editSaving}
                                    >
                                        Annuler
                                    </button>
                                    <motion.button
                                        className="rename-save-btn"
                                        onClick={handleSaveEdit}
                                        disabled={
                                            editSaving || !editName.trim()
                                        }
                                        whileHover={{ scale: 1.03 }}
                                        whileTap={{ scale: 0.97 }}
                                    >
                                        {editSaving
                                            ? 'Enregistrement…'
                                            : '✓ Enregistrer'}
                                    </motion.button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modal historique */}
            <AnimatePresence>
                {selectedSensor && (
                    <motion.div
                        className="history-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedSensor(null)}
                    >
                        <motion.div
                            className="history-modal glass"
                            initial={{ scale: 0.9, opacity: 0, y: 30 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 30 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="history-modal-header">
                                <div>
                                    <h3>{selectedSensor.name}</h3>
                                    <p className="history-modal-subtitle">
                                        Historique des dernières 24h
                                    </p>
                                </div>
                                <button
                                    className="history-close-btn"
                                    onClick={() => setSelectedSensor(null)}
                                >
                                    ✕
                                </button>
                            </div>

                            {historyLoading && (
                                <div className="history-loading">
                                    Chargement...
                                </div>
                            )}

                            {!historyLoading && historyData.length === 0 && (
                                <div className="history-empty">
                                    <p>Aucune donnée disponible.</p>
                                    <p className="history-empty-hint">
                                        Les mesures s'accumulent
                                        automatiquement. Revenez dans quelques
                                        minutes.
                                    </p>
                                </div>
                            )}

                            {!historyLoading && historyData.length > 0 && (
                                <>
                                    <div className="history-chart-container">
                                        <p className="history-chart-label">
                                            Température (°C)
                                        </p>
                                        <ResponsiveContainer
                                            width="100%"
                                            height={180}
                                        >
                                            <ComposedChart
                                                data={historyData.map((p) => ({
                                                    time: new Date(
                                                        p.ts,
                                                    ).toLocaleTimeString(
                                                        'fr-FR',
                                                        {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        },
                                                    ),
                                                    temp:
                                                        p.temperature != null
                                                            ? Math.round(
                                                                  p.temperature *
                                                                      10,
                                                              ) / 10
                                                            : null,
                                                    hum:
                                                        p.humidity != null
                                                            ? Math.round(
                                                                  p.humidity *
                                                                      10,
                                                              ) / 10
                                                            : null,
                                                }))}
                                            >
                                                <CartesianGrid
                                                    strokeDasharray="3 3"
                                                    stroke={themeColor('ink', 0.1)}
                                                />
                                                <XAxis
                                                    dataKey="time"
                                                    tick={{
                                                        fontSize: 11,
                                                        fill: themeColor('text-secondary'),
                                                    }}
                                                    interval="preserveStartEnd"
                                                />
                                                <YAxis
                                                    yAxisId="temp"
                                                    domain={['auto', 'auto']}
                                                    tick={{
                                                        fontSize: 11,
                                                        fill: '#f87171',
                                                    }}
                                                    unit="°"
                                                    width={35}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        background:
                                                            'rgba(var(--panel-rgb), 0.95)',
                                                        border: '1px solid var(--line)',
                                                        borderRadius: 8,
                                                    }}
                                                    labelStyle={{
                                                        color: 'var(--text-primary)',
                                                        fontSize: 12,
                                                    }}
                                                    formatter={(
                                                        v: number | undefined,
                                                        name: string | undefined,
                                                    ) =>
                                                        name === 'temp'
                                                            ? [
                                                                  `${v}°C`,
                                                                  'Température',
                                                              ]
                                                            : [
                                                                  `${v}%`,
                                                                  'Humidité',
                                                              ]
                                                    }
                                                />
                                                <Legend
                                                    formatter={(v) =>
                                                        v === 'temp'
                                                            ? 'Température'
                                                            : 'Humidité'
                                                    }
                                                    wrapperStyle={{
                                                        fontSize: 12,
                                                    }}
                                                />
                                                <Line
                                                    yAxisId="temp"
                                                    type="monotone"
                                                    dataKey="temp"
                                                    stroke="#f87171"
                                                    strokeWidth={2}
                                                    dot={false}
                                                    connectNulls
                                                />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="history-chart-container">
                                        <p className="history-chart-label">
                                            Humidité (%)
                                        </p>
                                        <ResponsiveContainer
                                            width="100%"
                                            height={160}
                                        >
                                            <ComposedChart
                                                data={historyData.map((p) => ({
                                                    time: new Date(
                                                        p.ts,
                                                    ).toLocaleTimeString(
                                                        'fr-FR',
                                                        {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        },
                                                    ),
                                                    hum:
                                                        p.humidity != null
                                                            ? Math.round(
                                                                  p.humidity *
                                                                      10,
                                                              ) / 10
                                                            : null,
                                                }))}
                                            >
                                                <CartesianGrid
                                                    strokeDasharray="3 3"
                                                    stroke={themeColor('ink', 0.1)}
                                                />
                                                <XAxis
                                                    dataKey="time"
                                                    tick={{
                                                        fontSize: 11,
                                                        fill: themeColor('text-secondary'),
                                                    }}
                                                    interval="preserveStartEnd"
                                                />
                                                <YAxis
                                                    domain={['auto', 'auto']}
                                                    tick={{
                                                        fontSize: 11,
                                                        fill: '#60a5fa',
                                                    }}
                                                    unit="%"
                                                    width={35}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        background:
                                                            'rgba(var(--panel-rgb), 0.95)',
                                                        border: '1px solid var(--line)',
                                                        borderRadius: 8,
                                                    }}
                                                    labelStyle={{
                                                        color: 'var(--text-primary)',
                                                        fontSize: 12,
                                                    }}
                                                    formatter={(v: number | undefined) => [
                                                        `${v}%`,
                                                        'Humidité',
                                                    ]}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="hum"
                                                    stroke="#60a5fa"
                                                    strokeWidth={2}
                                                    dot={false}
                                                    connectNulls
                                                />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="history-stats">
                                        {(() => {
                                            const temps = historyData
                                                .map((p) => p.temperature)
                                                .filter(
                                                    (v): v is number =>
                                                        v != null,
                                                );
                                            const hums = historyData
                                                .map((p) => p.humidity)
                                                .filter(
                                                    (v): v is number =>
                                                        v != null,
                                                );
                                            return (
                                                <>
                                                    {temps.length > 0 && (
                                                        <div className="history-stat glass">
                                                            <span className="hstat-label">
                                                                Temp min
                                                            </span>
                                                            <span className="hstat-value">
                                                                {Math.min(
                                                                    ...temps,
                                                                ).toFixed(1)}
                                                                °C
                                                            </span>
                                                        </div>
                                                    )}
                                                    {temps.length > 0 && (
                                                        <div className="history-stat glass">
                                                            <span className="hstat-label">
                                                                Temp max
                                                            </span>
                                                            <span className="hstat-value">
                                                                {Math.max(
                                                                    ...temps,
                                                                ).toFixed(1)}
                                                                °C
                                                            </span>
                                                        </div>
                                                    )}
                                                    {hums.length > 0 && (
                                                        <div className="history-stat glass">
                                                            <span className="hstat-label">
                                                                Humidité moy.
                                                            </span>
                                                            <span className="hstat-value">
                                                                {(
                                                                    hums.reduce(
                                                                        (
                                                                            a,
                                                                            b,
                                                                        ) =>
                                                                            a +
                                                                            b,
                                                                        0,
                                                                    ) /
                                                                    hums.length
                                                                ).toFixed(0)}
                                                                %
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="history-stat glass">
                                                        <span className="hstat-label">
                                                            Points
                                                        </span>
                                                        <span className="hstat-value">
                                                            {historyData.length}
                                                        </span>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {sensorsLoading && (
                <motion.div
                    className="sensors-loading glass"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                >
                    Chargement des capteurs Xiaomi...
                </motion.div>
            )}

            {/* Google Home / Cast Devices Section */}
            <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
            >
                <h2 className="section-title">Appareils Cast</h2>
                <div className="ghome-grid">
                    {devices.length === 0 ? (
                        <motion.div
                            className="empty-state"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                        >
                            <p>
                                Aucun appareil trouvé. Vérifiez que vos
                                appareils Google Home sont allumés et connectés
                                au même réseau.
                            </p>
                        </motion.div>
                    ) : (
                        devices.map((device, index) => {
                            const signal = getSignalQuality(
                                device.eureka?.signalLevel ?? null,
                            );

                            return (
                                <motion.div
                                    key={device.id}
                                    className={`ghome-card glass ${device.online ? 'device-online' : 'device-offline'}`}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                >
                                    <div className="ghome-card-header">
                                        <div className="device-icon">
                                            {getDeviceIcon(device)}
                                        </div>
                                        <div className="device-main-info">
                                            <h3 className="device-name">
                                                {device.eureka?.name ||
                                                    device.name}
                                            </h3>
                                            <p className="device-model">
                                                {device.eureka?.model ||
                                                    'Google Cast'}
                                                {device.eureka?.manufacturer &&
                                                    ` - ${device.eureka.manufacturer}`}
                                            </p>
                                        </div>
                                        <span
                                            className={`online-badge ${device.online ? 'online' : 'offline'}`}
                                        >
                                            {device.online
                                                ? 'En ligne'
                                                : 'Hors ligne'}
                                        </span>
                                    </div>

                                    {device.online && device.eureka && (
                                        <div className="device-details">
                                            <div className="detail-grid">
                                                <div className="detail-item">
                                                    <span className="detail-label">
                                                        IP
                                                    </span>
                                                    <span className="detail-value">
                                                        {
                                                            device.eureka
                                                                .ipAddress
                                                        }
                                                    </span>
                                                </div>

                                                {device.eureka.ssid && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">
                                                            WiFi
                                                        </span>
                                                        <span className="detail-value">
                                                            {device.eureka.ssid}
                                                        </span>
                                                    </div>
                                                )}

                                                {device.eureka.signalLevel !=
                                                    null && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">
                                                            Signal
                                                        </span>
                                                        <span
                                                            className={`detail-value ${signal.className}`}
                                                        >
                                                            {signal.label} (
                                                            {
                                                                device.eureka
                                                                    .signalLevel
                                                            }{' '}
                                                            dBm)
                                                        </span>
                                                    </div>
                                                )}

                                                {device.eureka.uptime && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">
                                                            Uptime
                                                        </span>
                                                        <span className="detail-value">
                                                            {
                                                                device.eureka
                                                                    .uptime
                                                            }
                                                        </span>
                                                    </div>
                                                )}

                                                {device.eureka.buildVersion && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">
                                                            Firmware
                                                        </span>
                                                        <span className="detail-value">
                                                            {
                                                                device.eureka
                                                                    .buildVersion
                                                            }
                                                        </span>
                                                    </div>
                                                )}

                                                {device.eureka.locale && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">
                                                            Langue
                                                        </span>
                                                        <span className="detail-value">
                                                            {
                                                                device.eureka
                                                                    .locale
                                                            }
                                                        </span>
                                                    </div>
                                                )}

                                                {device.eureka.timezone && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">
                                                            Timezone
                                                        </span>
                                                        <span className="detail-value">
                                                            {
                                                                device.eureka
                                                                    .timezone
                                                            }
                                                        </span>
                                                    </div>
                                                )}

                                                {device.eureka.macAddress && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">
                                                            MAC
                                                        </span>
                                                        <span className="detail-value mono">
                                                            {
                                                                device.eureka
                                                                    .macAddress
                                                            }
                                                        </span>
                                                    </div>
                                                )}

                                                {device.eureka
                                                    .hardwareVersion && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">
                                                            Hardware
                                                        </span>
                                                        <span className="detail-value">
                                                            {
                                                                device.eureka
                                                                    .hardwareVersion
                                                            }
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {!device.online && (
                                        <div className="device-offline-msg">
                                            <p>
                                                L'appareil ne répond pas sur{' '}
                                                {device.host}
                                            </p>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })
                    )}
                </div>
            </motion.section>

            {/* QR code scanner modal (Zigbee 3.0 install code) */}
            <AnimatePresence>
                {qrOpen && (
                    <motion.div
                        className="history-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={closeQrScanner}
                    >
                        <motion.div
                            className="qr-modal glass"
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="history-modal-header">
                                <div>
                                    <h3>Appairer via QR code</h3>
                                    <p className="history-modal-subtitle">
                                        Zigbee 3.0 — Install code
                                    </p>
                                </div>
                                <button
                                    className="history-close-btn"
                                    onClick={closeQrScanner}
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="qr-body">
                                {!qrDetected ? (
                                    <div className="qr-video-container">
                                        <video
                                            ref={qrVideoRef}
                                            className="qr-video"
                                        />
                                        <div className="qr-frame" />
                                    </div>
                                ) : (
                                    <div className="qr-detected">
                                        <span className="qr-check">✓</span>
                                        <p className="qr-detected-label">
                                            Code détecté
                                        </p>
                                        <code className="qr-code-value">
                                            {qrDetected.length > 48
                                                ? qrDetected.substring(0, 48) +
                                                  '…'
                                                : qrDetected}
                                        </code>
                                    </div>
                                )}
                                <div className="qr-manual-section">
                                    <label className="rename-label">
                                        Ou saisir le code manuellement
                                    </label>
                                    <input
                                        className="rename-input"
                                        type="text"
                                        placeholder="Install code (ex: 83FED3407A939723…)"
                                        value={qrManual}
                                        onChange={(e) =>
                                            setQrManual(e.target.value)
                                        }
                                    />
                                </div>
                                {qrResult === 'ok' && (
                                    <div className="qr-result qr-result-ok">
                                        ✓ Code envoyé — activez le mode
                                        appairage sur le capteur.
                                    </div>
                                )}
                                {qrResult === 'error' && (
                                    <div className="qr-result qr-result-error">
                                        Erreur lors de l'envoi. Vérifiez que le
                                        service Zigbee est démarré.
                                    </div>
                                )}
                                <div className="qr-actions">
                                    <motion.button
                                        className="auth-btn"
                                        onClick={submitInstallCode}
                                        disabled={
                                            qrSubmitting ||
                                            (!qrDetected && !qrManual.trim())
                                        }
                                        whileHover={{ scale: 1.03 }}
                                        whileTap={{ scale: 0.97 }}
                                    >
                                        {qrSubmitting
                                            ? 'Envoi…'
                                            : 'Envoyer le code'}
                                    </motion.button>
                                    <motion.button
                                        className="pair-btn glass"
                                        onClick={closeQrScanner}
                                        whileHover={{ scale: 1.03 }}
                                        whileTap={{ scale: 0.97 }}
                                    >
                                        Annuler
                                    </motion.button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
