import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import './GoogleHome.css';

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
        lastMotion?: string | null;
        lastOpen?: string | null;
    };
    lastUpdated: string | null;
}

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
        return '🖥️';
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
    const [devices, setDevices] = useState<GoogleHomeDevice[]>([]);
    const [sensors, setSensors] = useState<XiaomiSensor[]>([]);
    const [xiaomiLoggedIn, setXiaomiLoggedIn] = useState(false);
    const [xiaomiLogging, setXiaomiLogging] = useState(false);
    const [xiaomiError, setXiaomiError] = useState<string | null>(null);
    const [sensorsLoading, setSensorsLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        loadAll();
    }, []);

    const loadAll = async () => {
        await Promise.all([loadDevices(), loadXiaomi()]);
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
            const statusRes = await axios.get(`/api/xiaomi/status`);
            setXiaomiLoggedIn(statusRes.data.loggedIn);
            if (statusRes.data.loggedIn) {
                setSensorsLoading(true);
                const sensorsRes = await axios.get(`/api/xiaomi/sensors`);
                setSensors(sensorsRes.data.sensors || []);
            }
        } catch (err) {
            console.error('Failed to fetch Xiaomi sensors:', err);
        } finally {
            setSensorsLoading(false);
        }
    };

    const handleXiaomiLogin = async () => {
        setXiaomiLogging(true);
        setXiaomiError(null);
        try {
            // Opens Chrome for Xiaomi login — waits until user completes auth
            const res = await axios.post(
                `/api/xiaomi/login`,
                {},
                { timeout: 360000 },
            );
            if (res.data.status === 'ok') {
                setXiaomiLoggedIn(true);
                loadXiaomi();
            } else {
                setXiaomiError(res.data.message || 'Connexion échouée');
            }
        } catch (err: unknown) {
            const msg =
                err instanceof Error ? err.message : 'Erreur de connexion';
            setXiaomiError(
                axios.isAxiosError(err)
                    ? err.response?.data?.error || msg
                    : msg,
            );
        } finally {
            setXiaomiLogging(false);
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
                                    <stop offset="0%" stopColor="#6366f1" />
                                    <stop offset="100%" stopColor="#ec4899" />
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

            {/* Xiaomi Section */}
            {!xiaomiLoggedIn && (
                <motion.section
                    className="xiaomi-section"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <h2 className="section-title">Capteurs Xiaomi</h2>
                    <div className="xiaomi-auth glass">
                        <div className="auth-prompt">
                            <p>
                                {xiaomiLogging
                                    ? "Chrome s'est ouvert. Connectez-vous à Xiaomi dans le navigateur, puis revenez ici."
                                    : 'Connectez-vous à votre compte Xiaomi pour voir vos capteurs.'}
                            </p>
                            <motion.button
                                className="auth-btn"
                                onClick={handleXiaomiLogin}
                                disabled={xiaomiLogging}
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.97 }}
                            >
                                {xiaomiLogging
                                    ? 'En attente de connexion dans Chrome...'
                                    : 'Se connecter à Xiaomi'}
                            </motion.button>
                        </div>
                        {xiaomiError && (
                            <p className="xiaomi-error">{xiaomiError}</p>
                        )}
                    </div>
                </motion.section>
            )}

            {xiaomiLoggedIn && sensors.length > 0 && (
                <motion.section
                    className="xiaomi-section"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <h2 className="section-title">Capteurs Xiaomi</h2>
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
                                    className={`sensor-card glass ${sensor.isOnline ? 'sensor-online' : 'sensor-offline'}`}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: index * 0.05 }}
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
                                                <span className="event-status ok">
                                                    Fermé
                                                </span>
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
                                        </div>
                                    )}
                                </motion.div>
                            ))}
                    </div>
                </motion.section>
            )}

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
        </div>
    );
};
