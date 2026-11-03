/**
 * Alertes du ciel : un message Telegram quand des aurores deviennent possibles cette nuit
 * (Kp suffisant, nuit noire, ciel dégagé), puis la lampe-signal qui respire en vert
 * au début de la fenêtre si quelqu'un est à la maison. Une fois par nuit chacun.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';
import * as presence from './presence.js';
import * as lightSignals from './lightSignals.js';
import { getSky, nightStart, AURORA_KP } from './astro.js';

const FILE = dataFile('sky.json');
const TICK_MS = 15 * 60_000;

const DEFAULTS = {
    auroraAlerts: true, // message Telegram
    auroraLamp: true, // lampe-signal en vert au début de la fenêtre
    notifiedNight: null, // début (ts) de la nuit déjà annoncée
    pulsedNight: null,
};

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ sky.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des alertes du ciel impossible:', err.message);
    }
};

/**
 * Que faire maintenant (testé dans skyAlerts.test.js).
 * @param {object|null} aurora  sky.aurora
 * @param {object} state  { night, notifiedNight, pulsedNight, auroraAlerts, auroraLamp, lampEnabled, anyoneHome, localHour }
 */
export function decide(aurora, state, now = Date.now()) {
    const out = { notify: false, pulse: false };
    if (aurora?.level !== 'alert') return out;
    out.notify = state.auroraAlerts && state.notifiedNight !== state.night;
    const w = aurora.window;
    // La lampe au début de la fenêtre, en soirée seulement (pas de lumière qui réveille)
    out.pulse = Boolean(state.auroraLamp && state.lampEnabled && state.pulsedNight !== state.night && w
        && now >= w.from && now < w.to && state.anyoneHome !== false && state.localHour >= 17 && state.localHour <= 23);
    return out;
}

const hourText = (ts, off) => `${new Date(ts + off * 1000).getUTCHours()} h`;

export function alertText(aurora, offsetSec) {
    const when = aurora.window ? ` entre ${hourText(aurora.window.from, offsetSec)} et ${hourText(aurora.window.to, offsetSec)}` : '';
    const kp = String(aurora.maxTonight).replace('.', ',');
    return `🌌 Aurores boréales possibles cette nuit${when}.\nKp ${kp} prévu et ciel dégagé. Regarde plein nord, loin des lampadaires : un pic dure souvent 20 à 40 minutes.`;
}

const tick = async () => {
    if (!config.auroraAlerts && !config.auroraLamp) return;
    const sky = await getSky();
    const now = Date.now();
    const night = nightStart(now, sky.offsetSec);
    const action = decide(sky.aurora, {
        night,
        notifiedNight: config.notifiedNight,
        pulsedNight: config.pulsedNight,
        auroraAlerts: config.auroraAlerts,
        auroraLamp: config.auroraLamp,
        lampEnabled: lightSignals.getStatus().enabled,
        anyoneHome: presence.anyoneHome(),
        localHour: new Date(now + sky.offsetSec * 1000).getUTCHours(),
    }, now);
    if (action.notify) {
        config.notifiedNight = night;
        save();
        await notifier.notify({ text: alertText(sky.aurora, sky.offsetSec) });
        journal.log({ kind: 'system', title: `Aurores possibles cette nuit (Kp ${sky.aurora.maxTonight})`, data: { kp: sky.aurora.maxTonight } });
    }
    if (action.pulse) {
        config.pulsedNight = night;
        save();
        await lightSignals.pulse(['aurora'], 'aurores');
    }
};

let ticking = false;
const safeTick = async () => {
    if (ticking) return;
    ticking = true;
    try {
        await tick();
    } catch (err) {
        console.warn('⚠️  Alertes du ciel:', err.message);
    } finally {
        ticking = false;
    }
};

export const start = () => {
    setTimeout(safeTick, 60_000);
    setInterval(safeTick, TICK_MS);
    console.log(`🌌 Alertes aurores ${config.auroraAlerts ? 'actives' : 'désactivées'}`);
};

export const getStatus = () => ({ auroraAlerts: config.auroraAlerts, auroraLamp: config.auroraLamp, kpThreshold: AURORA_KP });

export const update = (patch = {}) => {
    if (patch.auroraAlerts !== undefined) config.auroraAlerts = Boolean(patch.auroraAlerts);
    if (patch.auroraLamp !== undefined) config.auroraLamp = Boolean(patch.auroraLamp);
    save();
    return getStatus();
};
