/**
 * Matin de Noël « Il est passé ! ».
 *
 * Le 25 décembre entre 5 h et midi, au premier mouvement (le détecteur de l'escalier) :
 * le salon scintille en or, un chant de Noël joue au salon et la tablette affiche
 * « Il est passé ! » avec ce que Cooper a vu cette nuit. Au bout de 5 min, les lampes
 * reprennent leur état d'avant et l'écran se referme. Une fois par an.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as sensorPause from './sensorPause.js';
import * as guard from './guard.js';
import * as musicPlayer from './musicPlayer.js';
import * as castService from './castService.js';
import * as youtube from './youtubeService.js';
import { hueClient, hueBaseUrl, restoreLight } from './hue.js';
import { fireLights } from './veillee.js';
import { christmasSeason } from './seasonLogic.js';
import { MAGIC_MS, SPARKLE_MS, shouldFire, isChristmasMorning, sparkleStep, goldState, cooperLine } from './noelLogic.js';

const FILE = dataFile('noel.json');
const TZ = process.env.TZ || 'America/Toronto';
const SPEAKER = (process.env.MUSIC_DEFAULT_SPEAKER || 'Salon').trim();
const CAROL_QUERY = 'Petit Papa Noël Tino Rossi';
const SPARKLE_EVERY_MS = 700;

/** { firedYear, firedAt, endsAt, lights: { id: étatAvant } } */
let store = { firedYear: null, firedAt: null, endsAt: null, lights: {} };
try {
    if (existsSync(FILE)) store = { ...store, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ noel.json illisible:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du matin de Noël impossible:', err.message);
    }
};

let running = false;
let sparkleTimer = null;
let endTimer = null;

/** Ce que lit la tablette : l'écran plein s'affiche tant que la magie dure. */
export function getView(now = Date.now()) {
    const season = christmasSeason(now, TZ);
    const active = Boolean(store.endsAt && store.endsAt > now);
    return {
        morning: isChristmasMorning(now, TZ),
        fired: store.firedYear === season.year,
        active,
        firedAt: store.firedAt,
        endsAt: active ? store.endsAt : null,
        cooper: cooperLine(season.year),
        photo: '/cooper-dodo.webp',
    };
}

async function sparkle() {
    const lights = (await fireLights()).filter((l) => l.color);
    store.lights = Object.fromEntries(lights.map((l) => [l.id, l.state]));
    save();
    const ids = lights.map((l) => l.id);
    if (!ids.length) return;
    const startedAt = Date.now();
    clearInterval(sparkleTimer);
    sparkleTimer = setInterval(() => {
        if (Date.now() - startedAt > SPARKLE_MS) {
            clearInterval(sparkleTimer);
            for (const id of ids) hueClient.put(`/lights/${id}/state`, goldState()).catch(() => {});
            return;
        }
        const id = ids[Math.floor(Math.random() * ids.length)];
        hueClient.put(`/lights/${id}/state`, sparkleStep()).catch(() => {});
    }, SPARKLE_EVERY_MS);
    sparkleTimer.unref?.();
}

async function carol() {
    const speaker = castService.findDevice(SPEAKER) || musicPlayer.defaultDevice();
    if (!speaker) throw new Error('Aucune enceinte joignable');
    const [track] = await youtube.search(CAROL_QUERY, 1);
    if (!track) throw new Error('Chant introuvable');
    await musicPlayer.play({ deviceId: speaker.id, kind: 'tracks', tracks: [track], name: 'Matin de Noël' });
}

/** Lance la magie (le premier mouvement du 25, ou à la main pour essayer). */
export async function fire(source = 'mouvement', now = Date.now()) {
    if (running || (store.endsAt && store.endsAt > now)) return getView(now);
    running = true;
    try {
        // Un essai à la main ne compte pas pour le vrai matin de Noël
        if (isChristmasMorning(now, TZ)) store.firedYear = christmasSeason(now, TZ).year;
        store.firedAt = now;
        store.endsAt = now + MAGIC_MS;
        save();
        const notes = [];
        if (hueBaseUrl) await sparkle().catch((e) => notes.push(`lampes : ${e.message}`));
        await carol().catch((e) => notes.push(`chant : ${e.message}`));
        scheduleEnd();
        journal.log({ kind: 'noel', title: 'Il est passé ! Matin de Noël', data: { source, notes } });
        return getView(now);
    } finally {
        running = false;
    }
}

/** Retour à la normale : les lampes reprennent leur état d'avant, l'écran se referme. */
export async function end() {
    clearInterval(sparkleTimer);
    clearTimeout(endTimer);
    const lights = store.lights || {};
    store.endsAt = null;
    store.lights = {};
    save();
    for (const [id, before] of Object.entries(lights)) await restoreLight(id, before).catch(() => {});
    return getView();
}

function scheduleEnd() {
    clearTimeout(endTimer);
    if (!store.endsAt) return;
    endTimer = setTimeout(() => end().catch((e) => console.error('noël: fin', e.message)), Math.max(0, store.endsAt - Date.now()));
    endTimer.unref?.();
}

/** Réponse à « Est-ce qu'il est passé ? » */
export function voiceAnswer(now = Date.now()) {
    const season = christmasSeason(now, TZ);
    if (season.phase === 'christmas') return `Ho ho ho ! Oui, il est passé cette nuit. ${cooperLine(season.year)}`;
    if (season.phase === 'advent' || season.phase === 'before') {
        const n = season.daysToChristmas;
        return n === 1 ? 'Pas encore : il passe cette nuit. Au lit !' : `Pas encore : il passe dans ${n} dodos.`;
    }
    if (season.phase === 'after') return 'Oui, il est passé le 25. Ho ho ho !';
    return 'Il passera le 25 décembre, comme chaque année.';
}

export const start = () => {
    zigbeeService.emitter.on('update', (name) => {
        const device = zigbeeService.getDevice(name);
        if (device?.state?.occupancy !== true || Date.now() - (device.lastSeen || 0) > 5000) return;
        const entry = sensorRegistry.find(device.ieeeAddr);
        if (entry?.type !== 'motion' || sensorPause.isPaused(entry.ieee)) return;
        const now = Date.now();
        if (!shouldFire({ now, tz: TZ, firedYear: store.firedYear, year: christmasSeason(now, TZ).year, guardMode: guard.getView().mode })) return;
        fire(entry.name, now).catch((e) => console.error('noël: magie', e.message));
    });
    // Redémarrage pendant la magie : on finit à l'heure prévue
    if (store.endsAt) scheduleEnd();
};
