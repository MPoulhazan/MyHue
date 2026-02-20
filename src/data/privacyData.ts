/**
 * Privacy & Data Storage Documentation
 * Describes where data is stored and how it's handled for each feature
 */

export interface DataLocation {
    name: string;
    icon: string;
    description: string;
    color: string;
}

export interface PrivacyFeature {
    id: string;
    name: string;
    icon: string;
    description: string;
    dataLocations: {
        location: DataLocation;
        details: string[];
    }[];
    authentication: {
        required: boolean;
        type?: string;
        storedCredentials?: boolean;
        externalProvider?: string;
    };
    dataTypes: string[];
    privacyScore: number;
    risks: string[];
    positives: string[];
}

// Data locations
export const DATA_LOCATIONS: Record<string, DataLocation> = {
    LOCAL_STORAGE: {
        name: 'Browser Local Storage',
        icon: '💾',
        description: 'Stored in your browser on this device',
        color: '#4CAF50',
    },
    HUE_BRIDGE: {
        name: 'Hue Bridge (Local)',
        icon: '🌐',
        description:
            'Stored on your local Philips Hue Bridge (never leaves your network)',
        color: '#FF6B9D',
    },
    XIAOMI_HUB: {
        name: 'Xiaomi Mi Control Hub (Local)',
        icon: '📡',
        description:
            'Stored on your local Xiaomi Hub via UDP multicast (LAN only)',
        color: '#FF9500',
    },
    SERVER_LOCAL: {
        name: 'Application Server (Local Network)',
        icon: '🖥️',
        description:
            'Stored in memory on your local app server (not persisted)',
        color: '#2196F3',
    },
    GOOGLE_CLOUD: {
        name: 'Google Cloud (External)',
        icon: '☁️',
        description: 'Transmitted to Google services for processing',
        color: '#F44336',
    },
    DEVICE_MEMORY: {
        name: 'Device Memory (Cast)',
        icon: '📺',
        description: 'Stored on your local Cast device/speaker',
        color: '#9C27B0',
    },
};

export const FEATURES: PrivacyFeature[] = [
    {
        id: 'hue',
        name: 'Philips Hue Lights',
        icon: '💡',
        description: 'Control and monitor your smart lights',
        dataLocations: [
            {
                location: DATA_LOCATIONS.HUE_BRIDGE,
                details: [
                    'Light on/off state',
                    'Brightness levels',
                    'Color values (RGB)',
                    'Light names and metadata',
                    'Room/zone assignments',
                ],
            },
            {
                location: DATA_LOCATIONS.LOCAL_STORAGE,
                details: ['Bridge IP address', 'Bridge username token'],
            },
        ],
        authentication: {
            required: true,
            type: 'Local API Token',
            storedCredentials: true,
            externalProvider: undefined,
        },
        dataTypes: ['Light States', 'Configuration', 'Metadata'],
        privacyScore: 92,
        risks: [
            'Bridge authentication token stored in browser if not using HTTPS',
        ],
        positives: [
            '✅ All data stays on local network',
            '✅ No cloud communication',
            '✅ No personal data collection',
            '✅ Direct device control',
        ],
    },
    {
        id: 'stats',
        name: 'Energy Statistics & Tracking',
        icon: '📊',
        description: 'Monitor light usage and estimated energy consumption',
        dataLocations: [
            {
                location: DATA_LOCATIONS.LOCAL_STORAGE,
                details: [
                    'Light on/off history',
                    'Usage duration per light',
                    'Estimated energy consumption',
                    'Daily/monthly statistics',
                    'Lamp wattage information',
                ],
            },
        ],
        authentication: {
            required: false,
        },
        dataTypes: ['Usage History', 'Statistical Data'],
        privacyScore: 95,
        risks: [],
        positives: [
            '✅ 100% local storage (never leaves your device)',
            '✅ No external transmission',
            '✅ Historical data aggregation only',
            '✅ Browsing data - clear anytime',
        ],
    },
    {
        id: 'xiaomi',
        name: 'Xiaomi Sensors (Aqara)',
        icon: '🌡️',
        description: 'Monitor temperature, humidity, motion & door sensors',
        dataLocations: [
            {
                location: DATA_LOCATIONS.XIAOMI_HUB,
                details: [
                    'Temperature readings',
                    'Humidity levels',
                    'Battery percentage',
                    'Motion detection status',
                    'Door/window open/close state',
                    'Sensor names and IDs',
                ],
            },
            {
                location: DATA_LOCATIONS.SERVER_LOCAL,
                details: [
                    'Temporary sensor state cache',
                    'Gateway discovery information',
                    'Real-time updates via UDP',
                ],
            },
        ],
        authentication: {
            required: true,
            type: 'Mi Control Hub Developer Mode Key',
            storedCredentials: true,
            externalProvider: undefined,
        },
        dataTypes: ['Sensor Readings', 'Environmental Data', 'Device Status'],
        privacyScore: 93,
        risks: [
            'Gateway key stored in .env file (server side)',
            'UDP multicast communication on local network',
        ],
        positives: [
            '✅ No cloud connection needed',
            '✅ Pure LAN/UDP protocol',
            '✅ All data stays on your network',
            '✅ No personal authentication to Xiaomi cloud',
        ],
    },
    {
        id: 'youtube',
        name: 'YouTube Music & Playlists',
        icon: '🎵',
        description:
            'Stream music and manage YouTube playlists on Cast devices',
        dataLocations: [
            {
                location: DATA_LOCATIONS.GOOGLE_CLOUD,
                details: [
                    'OAuth authentication token',
                    'YouTube account email',
                    'Playlist IDs and metadata',
                    'Watch history (for personalization)',
                    'Subscriber information',
                ],
            },
            {
                location: DATA_LOCATIONS.SERVER_LOCAL,
                details: [
                    'OAuth token (encrypted in memory)',
                    'Playlist cache',
                    'Audio stream proxying',
                ],
            },
            {
                location: DATA_LOCATIONS.DEVICE_MEMORY,
                details: ['Currently playing track info', 'Playback state'],
            },
        ],
        authentication: {
            required: true,
            type: 'Google OAuth 2.0',
            storedCredentials: true,
            externalProvider: 'Google',
        },
        dataTypes: [
            'Account Info',
            'Playlists',
            'Watch History',
            'Music Metadata',
        ],
        privacyScore: 55,
        risks: [
            '⚠️ Google OAuth token allows access to YouTube account',
            '⚠️ Watch history may be collected by Google',
            '⚠️ Playlist data synchronized with Google servers',
            '⚠️ Audio stream proxied through your server',
        ],
        positives: [
            '✅ Cast device audio is local network only',
            '✅ No separate app account needed (uses existing Google)',
            '✅ Token stored server-side (not in browser)',
        ],
    },
    {
        id: 'googleHome',
        name: 'Google Home & Cast Devices',
        icon: '🏠',
        description: 'Discover and control Cast devices on your network',
        dataLocations: [
            {
                location: DATA_LOCATIONS.SERVER_LOCAL,
                details: [
                    'Cast device discovery (mDNS)',
                    'Device names and IPs',
                    'Device type information',
                    'Playback status',
                ],
            },
            {
                location: DATA_LOCATIONS.DEVICE_MEMORY,
                details: ['Current playback information', 'Device settings'],
            },
        ],
        authentication: {
            required: false,
            type: 'Network-based (mDNS discovery)',
        },
        dataTypes: ['Device Info', 'Playback State'],
        privacyScore: 88,
        risks: ['Requires Cast devices to be discoverable on network'],
        positives: [
            '✅ No authentication required',
            '✅ Pure local network communication',
            '✅ No external API calls for device discovery',
            '✅ No persistent storage of device info',
        ],
    },
    {
        id: 'agent',
        name: 'AI Agent Assistant',
        icon: '🤖',
        description: 'Chat interface with access to home automation context',
        dataLocations: [
            {
                location: DATA_LOCATIONS.GOOGLE_CLOUD,
                details: [
                    'Chat messages sent to Groq API for processing',
                    'System context summary (light states, sensor readings, scene info)',
                    'Model responses generated by Groq servers',
                    'Groq may retain data per their privacy policy',
                ],
            },
            {
                location: DATA_LOCATIONS.SERVER_LOCAL,
                details: [
                    'Temporary request processing in memory',
                    'API key storage (server-side only)',
                ],
            },
            {
                location: DATA_LOCATIONS.LOCAL_STORAGE,
                details: ['Chat message history (browser cache, local only)'],
            },
        ],
        authentication: {
            required: true,
            type: 'Groq API Key',
            storedCredentials: true,
            externalProvider: 'Groq',
        },
        dataTypes: ['Chat History', 'Home State Context', 'LLM Responses'],
        privacyScore: 62,
        risks: [
            '⚠️ Chat messages transmitted to Groq cloud servers',
            '⚠️ Home automation context (light states, sensors) sent with each request',
            '⚠️ Groq may use data for model improvement (per their ToS)',
            '⚠️ Conversations may be logged on Groq servers',
            'Chat history in browser storage may contain sensitive commands',
        ],
        positives: [
            '✅ Groq does not store credentials',
            '✅ API calls use HTTPS encryption in transit',
            '✅ Can disable agent completely to prevent cloud usage',
            '✅ No persistent storage of conversations on your server',
            '✅ Groq is a dedicated AI infrastructure provider (not a surveillance company)',
        ],
    },
    {
        id: 'scenes',
        name: 'Scenes & Automation',
        icon: '🎬',
        description: 'Create and manage light scenes and automation rules',
        dataLocations: [
            {
                location: DATA_LOCATIONS.LOCAL_STORAGE,
                details: [
                    'Scene definitions and names',
                    'Light state presets',
                    'Color and brightness values',
                    'Scene execution history',
                ],
            },
            {
                location: DATA_LOCATIONS.HUE_BRIDGE,
                details: ['Hue-native scenes (if synced)'],
            },
        ],
        authentication: {
            required: false,
        },
        dataTypes: ['Scene Config', 'Presets', 'Automation Rules'],
        privacyScore: 94,
        risks: [],
        positives: [
            '✅ Stored locally by default',
            '✅ No cloud synchronization required',
            '✅ Encrypted browser storage option available',
        ],
    },
    {
        id: 'rooms',
        name: 'Rooms Organization',
        icon: '🏠',
        description: 'Organize lights and devices by room',
        dataLocations: [
            {
                location: DATA_LOCATIONS.LOCAL_STORAGE,
                details: [
                    'Room names and descriptions',
                    'Light-to-room assignments',
                    'Room order and layout',
                ],
            },
        ],
        authentication: {
            required: false,
        },
        dataTypes: ['Organization Data', 'Metadata'],
        privacyScore: 96,
        risks: [],
        positives: [
            '✅ 100% local storage',
            '✅ No external transmission',
            '✅ Pure UI organization',
        ],
    },
];

/**
 * Calculate privacy score based on multiple factors
 */
export function calculatePrivacyScore(feature: PrivacyFeature): {
    score: number;
    breakdown: Record<string, number>;
} {
    const breakdown: Record<string, number> = {};

    // Factor 1: Data location (0-30 points)
    let locationScore = 30;
    for (const loc of feature.dataLocations) {
        if (loc.location === DATA_LOCATIONS.GOOGLE_CLOUD) {
            locationScore -= 15;
        } else if (loc.location === DATA_LOCATIONS.SERVER_LOCAL) {
            locationScore -= 5;
        }
    }
    breakdown.dataLocation = Math.max(0, locationScore);

    // Factor 2: Authentication & Personal Data (0-25 points)
    let authScore = 25;
    if (feature.authentication.externalProvider) {
        authScore -= 10; // External oauth = less private
    }
    if (feature.authentication.storedCredentials) {
        authScore -= 3; // Credentials are stored
    }
    breakdown.authentication = Math.max(0, authScore);

    // Factor 3: Data sensitivity (0-20 points)
    let sensitivityScore = 20;
    if (
        feature.dataTypes.some(
            (dt) => dt.includes('Personal') || dt.includes('History'),
        )
    ) {
        sensitivityScore -= 10;
    }
    if (
        feature.dataTypes.some(
            (dt) => dt.includes('Account') || dt.includes('Email'),
        )
    ) {
        sensitivityScore -= 8;
    }
    breakdown.sensitivity = Math.max(0, sensitivityScore);

    // Factor 4: Security & Encryption (0-15 points)
    let securityScore = 15;
    if (feature.risks.length > 2) {
        securityScore -= 5;
    }
    breakdown.security = Math.max(0, securityScore);

    // Factor 5: User Control (0-10 points)
    let controlScore = 10;
    if (
        feature.authentication.required &&
        feature.dataLocations.some(
            (d) => d.location === DATA_LOCATIONS.GOOGLE_CLOUD,
        )
    ) {
        controlScore -= 5;
    }
    breakdown.control = Math.max(0, controlScore);

    const score = Math.round(
        breakdown.dataLocation +
            breakdown.authentication +
            breakdown.sensitivity +
            breakdown.security +
            breakdown.control,
    );

    return { score: Math.min(100, score), breakdown };
}

export function getPrivacyLevel(score: number): {
    level: 'Excellent' | 'Good' | 'Fair' | 'Poor';
    color: string;
    icon: string;
} {
    if (score >= 85) {
        return { level: 'Excellent', color: '#4CAF50', icon: '✅' };
    } else if (score >= 70) {
        return { level: 'Good', color: '#8BC34A', icon: '👍' };
    } else if (score >= 50) {
        return { level: 'Fair', color: '#FFC107', icon: '⚠️' };
    } else {
        return { level: 'Poor', color: '#F44336', icon: '❌' };
    }
}
