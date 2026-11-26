/**
 * Accès au bridge Philips Hue (API v1) : client, contexte lampes/groupes, scènes.
 */
import 'dotenv/config';
import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { parseArp } from './wifiPresenceLogic.js';

const USERNAME = process.env.VITE_HUE_USERNAME;

// Dernière adresse où le pont a répondu : la box peut lui en donner une autre (DHCP),
// on la retient pour qu'un redémarrage ne reparte pas sur l'ancienne adresse de l'option.
const BRIDGE_FILE = dataFile('hue-bridge.json');
let saved = {};
try {
    if (existsSync(BRIDGE_FILE)) saved = JSON.parse(readFileSync(BRIDGE_FILE, 'utf8'));
} catch {
    saved = {};
}

export let BRIDGE_IP = saved.ip || process.env.VITE_HUE_BRIDGE_IP;
const urlFor = (ip) => (ip && USERNAME ? `http://${ip}/api/${USERNAME}` : null);
export let hueBaseUrl = urlFor(BRIDGE_IP);

export const hueClient = axios.create({
    baseURL: hueBaseUrl ?? undefined,
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000,
});

// --- Pont introuvable : on le retrouve tout seul ---
const NETWORK_ERRORS = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET']);
const REDISCOVER_EVERY_MS = 2 * 60_000;
// Préfixes MAC de Philips / Signify
const PHILIPS_MAC = /^(00:17:88|ec:b5:fa)/i;

/** Le pont répond-il à cette adresse ? → son identifiant, sinon null. */
const probe = async (ip) => {
    try {
        const { data } = await axios.get(`http://${ip}/api/config`, { timeout: 3000 });
        return typeof data?.bridgeid === 'string' ? data.bridgeid.toLowerCase() : null;
    } catch {
        return null;
    }
};

const candidates = async () => {
    const ips = [process.env.VITE_HUE_BRIDGE_IP]; // l'adresse de l'option, si on l'a corrigée à la main
    // 1. Le service de découverte de Philips (le pont s'y annonce avec son adresse locale)
    try {
        const { data } = await axios.get('https://discovery.meethue.com/', { timeout: 5000 });
        for (const b of Array.isArray(data) ? data : []) {
            if (!saved.id || String(b.id).toLowerCase() === saved.id) ips.push(b.internalipaddress);
        }
    } catch {
        // hors ligne ou limité : on passe à la table ARP
    }
    // 2. Les appareils Philips vus sur le réseau local
    try {
        for (const { ip, mac } of parseArp(readFileSync('/proc/net/arp', 'utf8'))) {
            if (PHILIPS_MAC.test(mac)) ips.push(ip);
        }
    } catch {
        // pas de /proc/net/arp (PC de dev)
    }
    return [...new Set(ips.filter(Boolean))].filter((ip) => ip !== BRIDGE_IP);
};

const persist = () => {
    try {
        writeFileSync(BRIDGE_FILE, JSON.stringify(saved, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ hue-bridge.json :', err.message);
    }
};

const useBridge = (ip, id) => {
    const from = BRIDGE_IP;
    BRIDGE_IP = ip;
    hueBaseUrl = urlFor(ip);
    hueClient.defaults.baseURL = hueBaseUrl;
    saved = { ip, id: id || saved.id || null, at: new Date().toISOString() };
    persist();
    console.log(`💡 Pont Hue retrouvé : ${from} → ${ip}`);
    import('./journal.js')
        .then((j) => j.log({ kind: 'system', title: `Pont Hue retrouvé à une nouvelle adresse (${from} → ${ip})`, data: { from, ip } }))
        .catch(() => {});
};

let lastSearch = 0;
let searching = null;
/** Cherche le pont ailleurs sur le réseau ; true s'il a changé d'adresse. */
export const rediscoverBridge = () => {
    if (!USERNAME) return Promise.resolve(false);
    if (searching) return searching;
    if (Date.now() - lastSearch < REDISCOVER_EVERY_MS) return Promise.resolve(false);
    lastSearch = Date.now();
    searching = (async () => {
        for (const ip of await candidates()) {
            const id = await probe(ip);
            if (id && (!saved.id || id === saved.id)) {
                useBridge(ip, id);
                return true;
            }
        }
        console.warn('💡 Pont Hue injoignable et introuvable sur le réseau');
        return false;
    })().finally(() => {
        searching = null;
    });
    return searching;
};

/** Une erreur réseau vers le pont : on le cherche ailleurs. true si on peut réessayer. */
const isBridgeDown = (err) => !err.response && NETWORK_ERRORS.has(err.code);

// Le pont répond : on retient son identifiant, pour ne jamais adopter le pont d'un voisin
let idAsked = false;
const rememberId = () => {
    if (saved.id || idAsked || !BRIDGE_IP) return;
    idAsked = true;
    const ip = BRIDGE_IP;
    probe(ip).then((id) => {
        if (!id || saved.id) return void (idAsked = false);
        saved = { ip, id, at: new Date().toISOString() };
        persist();
    });
};

hueClient.interceptors.response.use(
    (res) => {
        rememberId();
        return res;
    },
    async (err) => {
        const cfg = err.config;
        if (!cfg || cfg.__hueRetried || !isBridgeDown(err)) throw err;
        if (!(await rediscoverBridge())) throw err;
        return hueClient.request({ ...cfg, __hueRetried: true, baseURL: hueBaseUrl });
    },
);

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

/**
 * Remet une lampe dans un état relevé avant (lampes-signal, alarme fuite), couleur comprise.
 * Une lampe éteinte ne prend pas de couleur : on remet d'abord couleur et luminosité,
 * puis on éteint, sinon elle se rallumerait dans la couleur du signal.
 */
export const restoreLight = async (id, before) => {
    const put = (state) => hueClient.put(`/lights/${id}/state`, state);
    const restore = { on: true, alert: 'none', bri: before.bri, transitiontime: before.on ? 4 : 0 };
    if (before.colormode === 'ct' && before.ct) restore.ct = before.ct;
    else if (before.colormode === 'hs' && before.hue != null) Object.assign(restore, { hue: before.hue, sat: before.sat });
    else if (before.xy) restore.xy = before.xy;
    await put(restore);
    if (!before.on) {
        await new Promise((r) => setTimeout(r, 400));
        await put({ on: false, transitiontime: 4 });
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
    const send = () => axios({
        method: req.method,
        url: `http://${BRIDGE_IP}/api/${USERNAME}${req.url}`,
        data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
        timeout: 5000,
    });
    try {
        let response;
        try {
            response = await send();
        } catch (err) {
            if (!isBridgeDown(err) || !(await rediscoverBridge())) throw err;
            response = await send();
        }
        res.status(response.status).json(response.data);
    } catch (err) {
        res.status(err.response?.status || 502).json({ error: err.message });
    }
};

/**
 * Proxy /api/hue-v2/<resource>[/<id>] (GET, PUT, POST) → API v2 du pont (routines de l'appli Hue, interrupteurs,
 * pièces). Sert à rebrancher un interrupteur sur une autre pièce sans l'appli Hue.
 */
export const hueV2Proxy = async (req, res) => {
    if (!BRIDGE_IP || !USERNAME) return res.status(503).json({ error: 'Hue Bridge not configured' });
    if (!/^\/[a-z_]+(\/[0-9a-f-]{36})?\/?(\?.*)?$/.test(req.url)) return res.status(400).json({ error: 'ressource invalide' });
    if (!['GET', 'PUT', 'POST'].includes(req.method)) return res.status(405).json({ error: 'GET, PUT ou POST seulement' });
    try {
        const https = await import('https');
        const { status, data } = await axios({
            method: req.method,
            url: `https://${BRIDGE_IP}/clip/v2/resource${req.url}`,
            data: req.method === 'GET' ? undefined : req.body,
            headers: { 'hue-application-key': USERNAME },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            timeout: 8000,
        });
        res.status(status).json(data);
    } catch (err) {
        res.status(err.response?.status || 502).json(err.response?.data || { error: err.message });
    }
};

/** Lecture seule de l'API v2 du pont (routines de l'appli Hue : behavior_instance, etc.). */
export const hueV2Get = async (resource) => {
    if (!BRIDGE_IP || !USERNAME) throw new Error('Hue Bridge not configured');
    if (!/^[a-z_]+$/.test(resource)) throw new Error('ressource invalide');
    const https = await import('https');
    const { data } = await axios.get(`https://${BRIDGE_IP}/clip/v2/resource/${resource}`, {
        headers: { 'hue-application-key': USERNAME },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }), // certificat auto-signé du pont, réseau local
        timeout: 8000,
    });
    return data;
};
