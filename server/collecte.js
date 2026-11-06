/**
 * Collecte des bacs : le soir de la sortie, la lampe du bar (sous laquelle sont les poubelles)
 * s'allume tamisée dans la couleur du bac, jusqu'à « C'est sorti » (Telegram ou tablette).
 *
 * 19 h : Telegram silencieux + lampe. Porte d'entrée ouverte : « Le bac est sorti ? ».
 * 22 h : relance avec son. « Dodo » ou 23 h 30 : on arrête pour ce soir.
 * Le bar passe après Cooper ; le courrier (jaune) lui laisse la place.
 *
 * Réglages dans data/collecte.json : bins [{ id, label, weekday, from, color }].
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { hueClient, hueBaseUrl, restoreLight } from './hue.js';
import * as notifier from './notifier.js';
import * as journal from './journal.js';
import * as presence from './presence.js';
import * as alarm from './alarm.js';
import * as cooper from './cooper.js';
import * as mailbox from './mailbox.js';
import * as city from './city.js';
import { isEntrance } from './sensorRegistry.js';
import { localParts, hm } from './cooper.js';
import { bus } from './events.js';
import { activeBin, nextBin, toMin, reminderText, lateText, doorText } from './collecteLogic.js';

const FILE = dataFile('collecte.json');
const TICK_MS = 30_000;
const ASK_AGAIN_MS = 15 * 60_000; // une question par sortie, pas à chaque aller-retour
// Couleurs xy (gamut C), tamisées
const COLORS = { teal: [0.17, 0.34], green: [0.25, 0.6], blue: [0.16, 0.12], yellow: [0.44, 0.5] };
const BRI = 110;

const DEFAULTS = {
    enabled: true,
    bins: [],
    lateAt: '22:00',
    stopAt: '23:30',
    lamp: true,
    askOnDoor: true,
    nights: {}, // 'AAAA-MM-JJ:id' → { sent, done, doneAt, late, askedAt, stopped, dismissed }
    lampState: null, // { id, before, color, for }
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ collecte.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde de la collecte impossible:', err.message);
    }
};

const local = (now = Date.now()) => {
    const { date, minutes } = localParts(now);
    return { date, minutes, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
};

/** Le bac de ce soir et son suivi, ou null. */
const tonight = (now = Date.now()) => {
    if (!config.enabled) return null;
    const l = local(now);
    const bin = activeBin(config.bins, l, config.stopAt);
    if (!bin) return null;
    const key = `${l.date}:${bin.id}`;
    config.nights[key] ??= {};
    return { bin, key, night: config.nights[key], minutes: l.minutes };
};

const pending = (t) => t && !t.night.done && !t.night.stopped;

// --- Lampe du bar ---

const xyOf = (bin) => COLORS[bin.color] || COLORS.teal;
const isOurs = (s, lamp) =>
    s.on && Math.abs(s.bri - BRI) <= 5 && (lamp.color
        ? s.colormode === 'xy' && Math.abs(s.xy[0] - lamp.xy[0]) < 0.03 && Math.abs(s.xy[1] - lamp.xy[1]) < 0.03
        : s.colormode === 'ct');

const wantLamp = (t) => pending(t) && config.lamp && !t.night.dismissed && Boolean(hueBaseUrl)
    && presence.anyoneHome() !== false && !alarm.anyActive() && !cooper.lampBusy() && !mailbox.lampHeld();

const lightLamp = async (t) => {
    const id = await cooper.pickBarLight();
    if (!id) return;
    const { data } = await hueClient.get(`/lights/${id}`);
    const color = Boolean(data.state.xy);
    const xy = xyOf(t.bin);
    config.lampState = { id, before: data.state, color, xy, for: t.key };
    save();
    await hueClient.put(`/lights/${id}/state`, color ? { on: true, bri: BRI, xy, transitiontime: 30 } : { on: true, bri: BRI, ct: 250, transitiontime: 30 });
};

/** Remet le bar comme avant, sauf si quelqu'un l'a changé (ou si tout a été éteint : on laisse éteint). */
const releaseLamp = async ({ restore = true } = {}) => {
    const lamp = config.lampState;
    if (!lamp) return;
    config.lampState = null;
    save();
    if (!restore) return;
    try {
        const { data } = await hueClient.get(`/lights/${lamp.id}`);
        if (isOurs(data.state, lamp)) await restoreLight(lamp.id, lamp.before);
    } catch (err) {
        console.warn('⚠️  Collecte, lampe:', err.message);
    }
};

let syncing = false;
const syncLamp = async (t = tonight()) => {
    if (syncing) return;
    syncing = true;
    try {
        cooper.claimBar('collecte', Boolean(pending(t) && config.lamp && !t.night.dismissed));
        const want = wantLamp(t);
        if (want && !config.lampState) await lightLamp(t);
        else if (!want && config.lampState) await releaseLamp();
        else if (config.lampState) {
            // Le bar a été changé à la main : on n'y touche plus ce soir
            const { data } = await hueClient.get(`/lights/${config.lampState.id}`);
            if (data.state.reachable !== false && !isOurs(data.state, config.lampState)) {
                if (t) t.night.dismissed = true;
                config.lampState = null;
                save();
                cooper.claimBar('collecte', false);
            }
        }
    } catch (err) {
        console.warn('⚠️  Collecte, lampe:', err.message);
    } finally {
        syncing = false;
    }
};

// --- Rappels ---

const doneButton = (t) => ({ label: '✅ C’est sorti', run: async () => (await markDone('Telegram'), `Noté, ${t.bin.label.toLowerCase()} sortie.`) });

const tick = async () => {
    const t = tonight();
    if (t && pending(t)) {
        if (!t.night.sent) {
            t.night.sent = Date.now();
            save();
            await notifier.notify({ text: reminderText(t.bin), silent: true, buttons: [doneButton(t)] }).catch(() => {});
        } else if (!t.night.late && t.minutes >= toMin(config.lateAt)) {
            t.night.late = Date.now();
            save();
            await notifier.notify({ text: lateText(t.bin), buttons: [doneButton(t)] }).catch(() => {});
        }
    }
    await syncLamp(t);
    // Ménage : deux semaines d'historique
    const keys = Object.keys(config.nights).sort();
    if (keys.length > 14) {
        for (const k of keys.slice(0, keys.length - 14)) delete config.nights[k];
        save();
    }
};

/** « C'est sorti » (Telegram, tablette, Jarvis). */
export const markDone = async (source = 'bouton') => {
    const t = tonight();
    if (!t) throw new Error('Pas de collecte ce soir');
    if (!t.night.done) {
        t.night.done = true;
        t.night.doneAt = Date.now();
        save();
        journal.log({ kind: 'system', title: `${t.bin.label} : bac sorti (${hm(Date.now())})`, data: { bin: t.bin.id, source } });
    }
    await syncLamp(t);
    return getView();
};

const onDoor = async () => {
    const t = tonight();
    if (!pending(t) || !config.askOnDoor || Date.now() - (t.night.askedAt || 0) < ASK_AGAIN_MS) return;
    t.night.askedAt = Date.now();
    save();
    await notifier.notify({
        text: doorText(t.bin),
        silent: true,
        buttons: [doneButton(t), { label: 'Pas encore', run: async () => 'D’accord, je garde le rappel.' }],
    }).catch(() => {});
};

/** « Dodo » : tout est éteint, on ne rallume pas le bar ce soir. */
const onBedtime = async () => {
    const t = tonight();
    if (!t) return;
    t.night.stopped = true;
    save();
    cooper.claimBar('collecte', false);
    await releaseLamp({ restore: false });
};

// --- Vue ---

export const getView = (now = Date.now()) => {
    const t = tonight(now);
    const next = nextBin(config.bins, local(now), config.stopAt);
    return {
        enabled: config.enabled,
        configured: config.bins.length > 0,
        tonight: t ? { id: t.bin.id, label: t.bin.label, done: Boolean(t.night.done), doneAt: t.night.doneAt || null, stopped: Boolean(t.night.stopped), lamp: Boolean(config.lampState) } : null,
        next: next && { id: next.bin.id, label: next.bin.label, when: next.label, from: next.bin.from },
    };
};

/** Ligne de la carte « En ville » tant que le bac n'est pas sorti. */
const cityEvent = () => {
    const t = tonight();
    if (!pending(t)) return [];
    return [{
        id: `collecte:${t.key}`, level: 'heads', kind: 'bin', title: `${t.bin.label} : sors le bac`, detail: 'collecte demain matin', advice: '',
        start: null, end: null, source: 'Collecte', link: null, notify: false, action: 'collecte',
    }];
};

export const start = () => {
    if (!config.enabled) return console.log('🗑️  Collecte désactivée');
    // Bar resté coloré après un redémarrage : il reprend son état d'avant, puis le suivi décide
    if (config.lampState) releaseLamp().catch(() => {});
    cooper.setLampYield(() => releaseLamp());
    city.addSource(cityEvent);
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop === 'isOpen' && value === true && sensor.type === 'door' && isEntrance(sensor.name)) onDoor();
    });
    bus.on('moment', ({ id }) => id === 'dodo' && onBedtime());
    setInterval(() => tick().catch((err) => console.warn('[Collecte]', err.message)), TICK_MS).unref?.();
    setTimeout(() => tick().catch(() => {}), 5_000);
    console.log(`🗑️  Collecte : ${config.bins.map((b) => b.label).join(', ') || 'aucun bac réglé'}`);
};

// --- Réglages ---

export const getSettings = () => {
    const { nights, lampState, ...rest } = config;
    return structuredClone(rest);
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const update = (patch = {}) => {
    for (const key of ['enabled', 'lamp', 'askOnDoor']) {
        if (patch[key] !== undefined) config[key] = Boolean(patch[key]);
    }
    for (const key of ['lateAt', 'stopAt']) {
        if (patch[key] === undefined) continue;
        if (!HHMM.test(patch[key])) throw new Error(`${key} invalide`);
        config[key] = patch[key];
    }
    if (patch.bins !== undefined) {
        if (!Array.isArray(patch.bins)) throw new Error('bins invalide');
        config.bins = patch.bins.slice(0, 6).map((b, i) => {
            if (!b?.id || !b.label) throw new Error(`bac ${i + 1} : id et label requis`);
            if (!Number.isInteger(b.weekday) || b.weekday < 0 || b.weekday > 6) throw new Error(`bac ${i + 1} : weekday 0-6`);
            if (!HHMM.test(b.from || '')) throw new Error(`bac ${i + 1} : from HH:MM`);
            if (b.color && !COLORS[b.color]) throw new Error(`bac ${i + 1} : couleur ${Object.keys(COLORS).join(', ')}`);
            return { id: String(b.id).slice(0, 20), label: String(b.label).slice(0, 30), weekday: b.weekday, from: b.from, color: b.color || 'teal' };
        });
    }
    save();
    tick().catch(() => {});
    return getSettings();
};

/** Essai depuis l'API : la lampe dans la couleur d'un bac pendant 20 s. */
export const test = async (id) => {
    const bin = config.bins.find((b) => b.id === id) || config.bins[0];
    if (!bin) throw new Error('Aucun bac réglé');
    const lampId = await cooper.pickBarLight();
    const { data } = await hueClient.get(`/lights/${lampId}`);
    await hueClient.put(`/lights/${lampId}/state`, { on: true, bri: BRI, xy: xyOf(bin), transitiontime: 10 });
    setTimeout(() => restoreLight(lampId, data.state).catch(() => {}), 20_000);
    return { light: data.name, color: bin.color };
};
