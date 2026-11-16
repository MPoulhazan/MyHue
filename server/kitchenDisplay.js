/**
 * Écran de la cuisine : MyHue affiche sa vue /cuisine sur le Nest Hub, via DashCast.
 *
 * Toutes les minutes, pendant les heures réglées : si le Hub ne fait rien, on y renvoie la vue.
 * On ne coupe jamais une autre appli (musique, YouTube). Si la vue disparaît alors que le Hub
 * est resté libre, quelqu'un l'a arrêtée (« Hey Google, arrête ») : on attend 30 min.
 * Hors des heures, on ferme notre vue et le Hub retrouve son horloge.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as castService from './castService.js';
import { step } from './kitchenDisplayLogic.js';

const FILE = dataFile('kitchen-display.json');
const TZ = process.env.TZ || 'America/Toronto';
const PORT = Number(process.env.AGENT_PORT || 5174);
const TICK_MS = 60_000;

const DEFAULTS = { enabled: true, device: 'Cuisine', from: '06:30', to: '23:00' };

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ kitchen-display.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde de l’écran de la cuisine impossible:', err.message);
    }
};

// --- Boucle ---

let state = { session: null, pausedUntil: 0, lastTryAt: 0, keepUntil: 0 };
let lastError = null;

const localMin = (ts) => {
    const [h, m] = new Date(ts)
        .toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .split(':')
        .map(Number);
    return h * 60 + m;
};

const hub = () => castService.findDevice(config.device);

export const kitchenUrl = () => {
    if (process.env.KITCHEN_URL) return process.env.KITCHEN_URL;
    const device = hub();
    const ip = device ? castService.localAddressFor(device.host) : null;
    return ip ? `http://${ip}:${PORT}/cuisine` : null;
};

const show = async () => {
    const device = hub();
    if (!device) throw new Error(`Écran « ${config.device} » introuvable sur le réseau`);
    const url = kitchenUrl();
    if (!url) throw new Error('Adresse du serveur sur le réseau local inconnue');
    await castService.showPage(device.id, url);
    const dash = (await castService.getApps(device.id)).find((a) => a.appId === castService.DASHCAST_APP_ID);
    state.session = dash?.sessionId || null;
    lastError = null;
};

let ticking = false;
async function tick() {
    if (ticking) return;
    ticking = true;
    try {
        const device = hub();
        if (!device || !config.enabled) return;
        const now = Date.now();
        const apps = await castService.getApps(device.id);
        const res = step({ now, min: localMin(now), apps, config, state });
        state = res.state;
        if (res.action === 'show') await show();
        else if (res.action === 'stop') await castService.stopApp(device.id, res.sessionId);
    } catch (err) {
        lastError = err.message;
        console.warn('⚠️  Écran de la cuisine:', err.message);
    } finally {
        ticking = false;
    }
}

// --- API ---

export const getView = () => ({
    ...config,
    url: kitchenUrl(),
    found: Boolean(hub()),
    showing: Boolean(state.session),
    pausedUntil: state.pausedUntil > Date.now() ? state.pausedUntil : null,
    lastError,
});

export const update = (patch = {}) => {
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (patch.enabled !== undefined) config.enabled = Boolean(patch.enabled);
    if (patch.device !== undefined) config.device = String(patch.device).trim() || DEFAULTS.device;
    for (const k of ['from', 'to']) {
        if (patch[k] === undefined) continue;
        if (!HHMM.test(patch[k])) throw new Error(`${k} : format HH:MM`);
        config[k] = patch[k];
    }
    save();
    return getView();
};

/** Afficher tout de suite, même hors des heures ou pendant la pause. */
export const showNow = async () => {
    state.pausedUntil = 0;
    state.keepUntil = Date.now() + 60 * 60_000;
    await show();
    return getView();
};

export const start = () => {
    setTimeout(tick, 20_000);
    setInterval(tick, TICK_MS).unref?.();
};
