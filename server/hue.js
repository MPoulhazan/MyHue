/**
 * Accès au bridge Philips Hue (API v1) : client, contexte lampes/groupes, scènes.
 */
import 'dotenv/config';
import axios from 'axios';

export const BRIDGE_IP = process.env.VITE_HUE_BRIDGE_IP;
const USERNAME = process.env.VITE_HUE_USERNAME;

export const hueBaseUrl =
    BRIDGE_IP && USERNAME ? `http://${BRIDGE_IP}/api/${USERNAME}` : null;

export const hueClient = axios.create({
    baseURL: hueBaseUrl ?? undefined,
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000,
});

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const rgbToXy = (r, g, b) => {
    const gamma = (c) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
    const r2 = gamma(r / 255);
    const g2 = gamma(g / 255);
    const b2 = gamma(b / 255);

    const X = r2 * 0.649926 + g2 * 0.103455 + b2 * 0.197109;
    const Y = r2 * 0.234327 + g2 * 0.743075 + b2 * 0.022598;
    const Z = g2 * 0.053077 + b2 * 1.035763;

    const sum = X + Y + Z;
    if (sum === 0) return [0, 0];
    return [X / sum, Y / sum];
};

export const ensureHueConfigured = () => {
    if (!hueBaseUrl) {
        const error = new Error(
            'Hue Bridge not configured. Check VITE_HUE_BRIDGE_IP and VITE_HUE_USERNAME.',
        );
        error.code = 'HUE_NOT_CONFIGURED';
        throw error;
    }
};

export const getHueContext = async () => {
    ensureHueConfigured();
    const [lightsResponse, groupsResponse] = await Promise.all([
        hueClient.get('/lights'),
        hueClient.get('/groups'),
    ]);

    const lights = Object.entries(lightsResponse.data).map(([id, light]) => ({
        id,
        name: light.name,
        on: light.state?.on ?? false,
        bri: light.state?.bri ?? 0,
        reachable: light.state?.reachable ?? false,
    }));

    const groups = Object.entries(groupsResponse.data)
        .filter(([_, group]) => group.type !== 'Room' || group.lights?.length > 0)
        .map(([id, group]) => ({
            id,
            name: group.name,
            type: group.type,
            lights: group.lights ?? [],
            any_on: group.state?.any_on ?? false,
        }));

    return { lights, groups };
};

// Scènes Hue, en cache 5 min (elles changent rarement)
let scenesCache = { at: 0, scenes: [] };
export const getHueScenes = async () => {
    if (!hueBaseUrl) return [];
    if (Date.now() - scenesCache.at < 5 * 60 * 1000) return scenesCache.scenes;
    try {
        const { data } = await hueClient.get('/scenes');
        const scenes = Object.entries(data)
            .filter(([_, scene]) => !scene.name?.startsWith('HIDDEN'))
            .map(([id, scene]) => ({
                id,
                name: scene.name,
                type: scene.type,
                group: scene.group,
            }));
        scenesCache = { at: Date.now(), scenes };
        return scenes;
    } catch {
        return scenesCache.scenes;
    }
};

/** Proxy /api/hue/* → bridge : le front ne connaît ni l'IP ni le username. */
export const hueProxy = async (req, res) => {
    try {
        const response = await axios({
            method: req.method,
            url: `http://${BRIDGE_IP}/api/${USERNAME}${req.url}`,
            data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
            timeout: 5000,
        });
        res.status(response.status).json(response.data);
    } catch (err) {
        res.status(err.response?.status || 502).json({ error: err.message });
    }
};
