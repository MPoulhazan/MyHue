/**
 * Pause d'un capteur : il continue de remonter son état (page Capteurs, journal),
 * mais plus rien n'y réagit (automatismes, lampe de l'entrée, garde, compagnon...).
 *
 * data/sensor-pauses.json : { [ieee]: { until: ts | null (= jusqu'à réactivation), since: ts } }
 * Les détecteurs de fumée et de fuite ne se mettent en pause qu'avec `force`, 1 h au plus.
 */
import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as journal from './journal.js';

const FILE = dataFile('sensor-pauses.json');
export const SAFETY_TYPES = new Set(['smoke', 'water_leak']);
export const SAFETY_MAX_MS = 60 * 60 * 1000;
const NOT_PAUSABLE = new Set(['temperature_humidity']); // mesures : rien à « déclencher »

export const emitter = new EventEmitter();

let pauses = {};
try {
    if (existsSync(FILE)) pauses = JSON.parse(readFileSync(FILE, 'utf8')) || {};
} catch (err) {
    console.warn('[Pause capteurs] Fichier illisible, on repart de zéro:', err.message);
}

const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(pauses, null, 2), 'utf8');
    } catch (err) {
        console.error('[Pause capteurs] Sauvegarde impossible:', err.message);
    }
};

const nameOf = (ieee) => sensorRegistry.find(ieee)?.name || ieee;

/** Prochain 7 h (aujourd'hui si on est avant 7 h, sinon demain). */
export const nextMorning = (now = new Date()) => {
    const d = new Date(now);
    d.setHours(7, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.getTime();
};

/** Traduit une durée demandée ('1h' | 'morning' | 'forever' | minutes) en échéance (null = sans fin). */
export const resolveUntil = (duration, now = Date.now()) => {
    if (duration === 'forever' || duration == null) return null;
    if (duration === 'morning') return nextMorning(new Date(now));
    if (duration === '1h') return now + 60 * 60 * 1000;
    const minutes = Number(duration);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Durée de pause invalide');
    return now + minutes * 60 * 1000;
};

const expire = () => {
    const now = Date.now();
    for (const [ieee, p] of Object.entries(pauses)) {
        if (p.until && p.until <= now) resume(ieee, 'fin de la pause');
    }
};

/** Le capteur est-il en pause en ce moment ? */
export const isPaused = (ieee) => {
    const p = ieee && pauses[ieee];
    if (!p) return false;
    if (p.until && p.until <= Date.now()) {
        resume(ieee, 'fin de la pause');
        return false;
    }
    return true;
};

/** { until, since } ou null. */
export const get = (ieee) => (isPaused(ieee) ? pauses[ieee] : null);

/** Toutes les pauses actives : [{ ieee, name, type, until, since }]. */
export const list = () => {
    expire();
    return Object.entries(pauses).map(([ieee, p]) => {
        const e = sensorRegistry.find(ieee);
        return { ieee, name: e?.name || ieee, type: e?.type || 'other', until: p.until, since: p.since };
    });
};

/**
 * Met un capteur en pause.
 * @param {string} ieee
 * @param {string|number} duration '1h' | 'morning' | 'forever' | minutes
 * @param {{ force?: boolean, source?: string }} [opts]
 */
export const pause = (ieee, duration, { force = false, source = 'app' } = {}) => {
    const entry = sensorRegistry.find(ieee);
    if (!entry) throw new Error('Capteur inconnu');
    if (NOT_PAUSABLE.has(entry.type)) throw new Error('Ce capteur ne fait que mesurer : rien à mettre en pause');
    const now = Date.now();
    let until = resolveUntil(duration, now);
    if (SAFETY_TYPES.has(entry.type)) {
        if (!force) throw new Error('Détecteur de sécurité : confirmation requise (1 h au plus)');
        if (until === null || until - now > SAFETY_MAX_MS) until = now + SAFETY_MAX_MS;
    }
    pauses[ieee] = { until, since: now };
    save();
    const when = until ? `jusqu'à ${new Date(until).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}` : "jusqu'à réactivation";
    journal.log({ kind: 'sensor', title: `${entry.name} : en pause ${when}`, data: { did: ieee, paused: true, until, source } });
    emitter.emit('change', { ieee, paused: true, until });
    return { ieee, name: entry.name, until, since: now };
};

/** Réactive un capteur. Retourne false s'il n'était pas en pause. */
export function resume(ieee, reason = 'réactivé') {
    if (!pauses[ieee]) return false;
    delete pauses[ieee];
    save();
    journal.log({ kind: 'sensor', title: `${nameOf(ieee)} : reprise de la détection (${reason})`, data: { did: ieee, paused: false } });
    emitter.emit('change', { ieee, paused: false });
    return true;
}

// Ce que le capteur aurait déclenché pendant la pause : une ligne au journal toutes les 5 min au plus
const lastIgnored = new Map();
export const noteIgnored = (ieee, what) => {
    const now = Date.now();
    if (now - (lastIgnored.get(ieee) || 0) < 5 * 60 * 1000) return;
    lastIgnored.set(ieee, now);
    journal.log({ kind: 'sensor', title: `${what} ${nameOf(ieee)} (en pause, ignoré)`, data: { did: ieee, ignored: true } });
};

setInterval(expire, 30 * 1000).unref?.();
