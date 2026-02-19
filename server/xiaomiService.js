// --- Xiaomi Service (Mock mode - waiting for Zigbee dongle) ---

const MOCK_SENSORS = [
    {
        did: 'lumi.weather.salon',
        name: 'Salon',
        model: 'lumi.weather.v1',
        type: 'temperature_humidity',
        icon: '🌡️',
        isOnline: true,
        mac: '54:EF:44:A2:3B:10',
        props: {
            temperature: 21.3,
            humidity: 47,
        },
        lastUpdated: new Date(Date.now() - 3 * 60_000).toISOString(),
    },
    {
        did: 'lumi.magnet.entree',
        name: 'Porte entrée',
        model: 'lumi.sensor_magnet.aq2',
        type: 'door',
        icon: '🚪',
        isOnline: true,
        mac: '54:EF:44:A2:3B:11',
        props: {
            lastOpen: new Date(Date.now() - 45 * 60_000).toISOString(),
            isOpen: false,
        },
        lastUpdated: new Date(Date.now() - 45 * 60_000).toISOString(),
    },
    {
        did: 'lumi.magnet.balcon',
        name: 'Porte balcon',
        model: 'lumi.sensor_magnet.aq2',
        type: 'door',
        icon: '🚪',
        isOnline: true,
        mac: '54:EF:44:A2:3B:12',
        props: {
            lastOpen: new Date(Date.now() - 2 * 3600_000).toISOString(),
            isOpen: false,
        },
        lastUpdated: new Date(Date.now() - 2 * 3600_000).toISOString(),
    },
    {
        did: 'lumi.magnet.chambre',
        name: 'Porte chambre',
        model: 'lumi.sensor_magnet.aq2',
        type: 'door',
        icon: '🚪',
        isOnline: true,
        mac: '54:EF:44:A2:3B:13',
        props: {
            lastOpen: new Date(Date.now() - 8 * 3600_000).toISOString(),
            isOpen: true,
        },
        lastUpdated: new Date(Date.now() - 8 * 3600_000).toISOString(),
    },
    {
        did: 'lumi.smoke.salon',
        name: 'Détecteur fumée',
        model: 'lumi.sensor_smoke.v1',
        type: 'smoke',
        icon: '🔥',
        isOnline: true,
        mac: '54:EF:44:A2:3B:14',
        props: {
            smokeDetected: false,
        },
        lastUpdated: new Date(Date.now() - 10 * 60_000).toISOString(),
    },
    {
        did: 'lumi.wleak.cuisine',
        name: 'Capteur inondation',
        model: 'lumi.sensor_wleak.aq1',
        type: 'water_leak',
        icon: '💧',
        isOnline: true,
        mac: '54:EF:44:A2:3B:15',
        props: {
            leakDetected: false,
        },
        lastUpdated: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
];

// Add small random variations to temperature/humidity on each call
const addVariation = (sensors) => {
    return sensors.map(s => {
        if (s.type === 'temperature_humidity') {
            return {
                ...s,
                props: {
                    temperature: +(21.3 + (Math.random() - 0.5) * 0.8).toFixed(1),
                    humidity: Math.round(47 + (Math.random() - 0.5) * 4),
                },
                lastUpdated: new Date(Date.now() - Math.floor(Math.random() * 5) * 60_000).toISOString(),
            };
        }
        return { ...s };
    });
};

export const isConfigured = () => true;

export const isLoggedIn = () => true;

export const getAuthStatus = () => ({
    configured: true,
    loggedIn: true,
    loginInProgress: false,
    username: 'mock-user',
    mock: true,
});

export const startLogin = async () => {
    return { status: 'ok', message: 'Mode mock actif - données simulées.' };
};

export const getDevices = async () => {
    return addVariation(MOCK_SENSORS);
};

export const getSensorsWithData = async () => {
    return addVariation(MOCK_SENSORS);
};

export const logout = () => {
    console.log('🏠 Xiaomi mock logout (no-op)');
};
