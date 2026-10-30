import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import {
    buildPacket,
    broadlinkToPulses,
    pulsesToFrames,
    decodeState,
    encodeState,
    toHex,
} from './mitsubishiIr.js';

dotenv.config();

const STATE_FILE = dataFile('heating-state.json');

let device = null;
let broadlink = null;

const DEFAULT_STATE = {
    power: false,
    mode: 'heat',
    temperature: 22,
    fanSpeed: 'auto',
    vaneVertical: 'auto',
    lastUpdated: null,
};

// --- State persistence ---

const loadState = () => {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        }
    } catch (err) {
        console.error('❌ Failed to load heating state:', err.message);
    }
    return { ...DEFAULT_STATE };
};

const saveState = (state) => {
    try {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
        console.error('❌ Failed to save heating state:', err.message);
    }
};

let currentState = loadState();

// --- Broadlink device communication ---

export const discover = async () => {
    try {
        const BroadlinkJS = (await import('kiwicam-broadlinkjs-rm')).default;
        broadlink = new BroadlinkJS();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Broadlink discovery timed out (10s)'));
            }, 10000);

            broadlink.on('deviceReady', (dev) => {
                const ip = process.env.BROADLINK_IP;
                // If IP is specified, only accept that device
                if (ip && dev.host?.address !== ip) {
                    return; // Skip, wait for the right one
                }
                clearTimeout(timeout);
                device = dev;

                console.log(`🔌 Broadlink RM4 Mini discovered at ${dev.host?.address}`);
                resolve(dev);
            });

            broadlink.discover();
        });
    } catch (err) {
        console.error('❌ Broadlink discovery failed:', err.message);
        throw err;
    }
};

export const isConnected = () => device !== null;

export const getState = () => ({ ...currentState });

// --- État douteux ---
// L'infrarouge ne renvoie rien : éteinte à la télécommande, MyHue la croit encore allumée.
// Chaque trame porte l'état complet (marche comprise) : changer la consigne la rallumerait.
// Tant que l'état est douteux, thermostat et Flex D n'envoient plus rien.

let uncertain = null; // { since, reason }

export const markUncertain = (reason) => {
    if (uncertain) return;
    uncertain = { since: Date.now(), reason };
    journal.log({ kind: 'heating', title: `Thermopompe : état incertain (${reason})`, data: {} });
};
export const clearUncertain = () => {
    uncertain = null;
};
export const isUncertain = () => uncertain !== null;

/** L'utilisateur a changé la thermopompe lui-même (télécommande) : on recopie sans rien envoyer. */
export const markState = (patch = {}, source = 'interface') => {
    currentState = { ...currentState, ...patch, lastUpdated: new Date().toISOString() };
    saveState(currentState);
    uncertain = null;
    journal.log({
        kind: 'heating',
        title: `Thermopompe : ${describeState(currentState)} (réglée à la télécommande)`,
        data: { state: currentState, source, synced: true },
    });
    return currentState;
};

export const getStatus = () => ({
    connected: isConnected(),
    deviceIp: device?.host?.address || null,
    state: { ...currentState },
    uncertain,
});

export const sendCommand = async (newState) => {
    if (!device) {
        throw new Error('Broadlink device not connected. Run discovery first.');
    }

    // La télécommande transmet aussi son heure : on envoie l'heure locale
    const packet = buildPacket(newState, localClockMinutes());
    // sendData renvoie une promesse (pas de callback : l'ancien code restait bloqué)
    await device.sendData(packet);

    // L'infrarouge ne renvoie rien : c'est l'état de la dernière commande envoyée
    currentState = {
        ...newState,
        lastUpdated: new Date().toISOString(),
    };
    saveState(currentState);

    console.log(`🔥 Heating command sent: power=${newState.power}, mode=${newState.mode}, temp=${newState.temperature}°C, fan=${newState.fanSpeed}`);
    return currentState;
};

const TZ = process.env.TZ || 'America/Toronto';
const localClockMinutes = () => {
    const [h, m] = new Date()
        .toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
        .split(':');
    return Number(h) * 60 + Number(m);
};

/**
 * Mode apprentissage : on vise le Broadlink avec la vraie télécommande et on appuie.
 * Renvoie la trame captée, décodée, et la comparaison avec ce que MyHue enverrait.
 * Chaque capture est gardée dans data/ir-learned.json pour analyse.
 */
export const learn = async (timeoutMs = 20000) => {
    if (!device) throw new Error('Broadlink non connecté');
    const raw = await new Promise((resolve, reject) => {
        const onData = (data) => {
            cleanup();
            resolve(Buffer.from(data));
        };
        const poll = setInterval(() => device.checkData(), 1000);
        const timer = setTimeout(() => {
            cleanup();
            device.cancelLearn?.();
            reject(new Error('Aucun signal reçu (20 s). Vise le Broadlink de près et réessaie.'));
        }, timeoutMs);
        const cleanup = () => {
            clearInterval(poll);
            clearTimeout(timer);
            device.removeListener('rawData', onData);
        };
        device.on('rawData', onData);
        device.enterLearning();
    });

    const frames = pulsesToFrames(broadlinkToPulses(raw));
    const decoded = frames[0] ? decodeState(frames[0]) : null;
    const ours = decoded ? encodeState(decoded, decoded.clockMinutes) : null;
    // Octets où notre encodeur diffère de la vraie télécommande
    const diff = ours && frames[0]
        ? [...ours].map((b, i) => (b !== frames[0][i] ? i : -1)).filter((i) => i >= 0)
        : null;
    const capture = {
        at: new Date().toISOString(),
        raw: raw.toString('hex'),
        frames: frames.map(toHex),
        decoded,
        ours: ours ? toHex(ours) : null,
        diff,
    };

    const file = dataFile('ir-learned.json');
    let all = [];
    try {
        if (fs.existsSync(file)) all = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch { /* fichier abîmé : on repart à zéro */ }
    all.push(capture);
    fs.writeFileSync(file, JSON.stringify(all.slice(-50), null, 2), 'utf-8');
    return capture;
};

const MODE_LABELS = { heat: 'chauffage', cool: 'clim', dry: 'déshumidification', fan: 'ventilation', auto: 'auto' };

/** Résumé lisible d'un état, pour le journal et les messages. */
export const describeState = (s) =>
    s.power ? `${MODE_LABELS[s.mode] || s.mode} ${s.temperature}°` : 'arrêt';

/**
 * Applique un changement partiel (power, mode, temperature...) et l'envoie.
 * @param {string} [source] qui a demandé (interface, agent, automatisme...) pour le journal
 */
export const applyPatch = async (patch = {}, source = 'interface') => {
    const cur = getState();
    const newState = {
        power: patch.power !== undefined ? Boolean(patch.power) : cur.power,
        mode: patch.mode || cur.mode,
        temperature: patch.temperature
            ? Math.max(16, Math.min(31, Number(patch.temperature)))
            : cur.temperature,
        fanSpeed: patch.fanSpeed || cur.fanSpeed,
        vaneVertical: patch.vaneVertical || cur.vaneVertical,
    };
    const result = isConnected() ? await sendCommand(newState) : sendCommandDryRun(newState);
    uncertain = null; // la clim vient de recevoir l'état complet : on sait de nouveau où elle en est
    journal.log({
        kind: 'heating',
        title: `Thermopompe : ${describeState(result)}`,
        data: { state: result, source, dryRun: !isConnected() },
    });
    return result;
};

// For testing without a Broadlink device
export const sendCommandDryRun = (newState) => {
    currentState = {
        ...newState,
        lastUpdated: new Date().toISOString(),
    };
    saveState(currentState);
    console.log(`🔥 [DRY RUN] Heating command: power=${newState.power}, mode=${newState.mode}, temp=${newState.temperature}°C, fan=${newState.fanSpeed}`);
    return currentState;
};
