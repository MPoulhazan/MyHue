/**
 * Maison vide : on s'occupe de Cooper, puis de la maison.
 *
 * - Sortie courte (plus aucun téléphone sur le Wi-Fi) : veilleuse pour Cooper quand il fait noir
 *   (Bibliothèque, blanc 2200 K à 20 %), radio douce tout bas sur l'enceinte du salon de 7 h à 21 h,
 *   volume réglé AVANT le son, radio qui change toutes les 90 min. Rien de tout ça si quelqu'un est là.
 * - Retour : la porte d'entrée s'ouvre (ou un téléphone revient) et il fait noir : toute la maison s'allume
 *   au blanc du moment (circadien). Radio et veilleuse s'arrêtent.
 * - Porte d'entrée fermée depuis 12 h et personne : week-end, Cooper est avec nous. Veilleuse et radio
 *   coupées, simulation de présence le soir (guard.js). Après 24 h : mode vacances armé (alarme).
 *   Ce mode-là se coupe tout seul quand un téléphone revient sur le Wi-Fi.
 * Réglages et état : data/away.json, GET/PUT /api/away.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { bus } from './events.js';
import * as presence from './presence.js';
import * as guard from './guard.js';
import * as circadian from './circadian.js';
import * as castService from './castService.js';
import * as musicPlayer from './musicPlayer.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';
import { hueClient, hueBaseUrl } from './hue.js';
import { phaseOf, radioAt, radioHours, isDark, ARRIVAL_DEDUP_MS, RETURN_HOLD_MS } from './awayLogic.js';

const FILE = dataFile('away.json');
const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 30_000;
const RADIO_RETRY_MS = 10 * 60_000;

const DEFAULTS = {
    enabled: true,
    lamp: { name: 'Bibliothèque', bri: 51, ct: 454 }, // 20 %, 2200 K : doux, peu de bleu, visible pour un chien
    radio: { enabled: true, deviceName: 'Salon', volume: 12 },
    arrival: { enabled: true, bri: 180 },
    // État
    phase: 'home',
    lastDoorAt: null,
    leftAt: null,
    returnedAt: null, // porte ouverte alors que la maison était vide, sans téléphone revu
    arrivedAt: null,
    departures: 0,
    lampLit: false,
    radioOn: null, // { deviceId, id, since }
    radioHeld: false, // quelqu'un a changé l'enceinte à distance : on n'y touche plus jusqu'au prochain départ
};

let s = { ...DEFAULTS };
try {
    if (existsSync(FILE)) {
        const saved = JSON.parse(readFileSync(FILE, 'utf8'));
        s = { ...DEFAULTS, ...saved, lamp: { ...DEFAULTS.lamp, ...saved.lamp }, radio: { ...DEFAULTS.radio, ...saved.radio }, arrival: { ...DEFAULTS.arrival, ...saved.arrival } };
    }
} catch (err) {
    console.error('❌ away.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(s, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde maison vide impossible:', err.message);
    }
};

const localMin = (ts = Date.now()) => {
    const [h, m] = new Date(ts).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return h * 60 + m;
};

const darkNow = async () => {
    let elevation = null;
    try {
        elevation = (await circadian.getStatus()).elevation;
    } catch { /* HA injoignable : on se rabat sur l'heure */ }
    return isDark(Number.isFinite(elevation) ? elevation : null, localMin());
};

// --- Veilleuse ---

const lampId = async () => {
    const { data: lights } = await hueClient.get('/lights');
    const re = new RegExp(s.lamp.name.normalize('NFD').replace(/[̀-ͯ]/g, ''), 'i');
    return Object.entries(lights).find(([, l]) => re.test(String(l.name).normalize('NFD').replace(/[̀-ͯ]/g, '')))?.[0] || null;
};

const syncLamp = async (want) => {
    if (!hueBaseUrl) return;
    if (!want && !s.lampLit) return;
    const id = await lampId();
    if (!id) return;
    if (want) {
        const { data } = await hueClient.get(`/lights/${id}`);
        if (data.state?.on) return; // déjà allumée (par nous, ou laissée allumée par quelqu'un)
        await hueClient.put(`/lights/${id}/state`, { on: true, bri: s.lamp.bri, ct: s.lamp.ct, transitiontime: 30 });
        if (!s.lampLit) journal.log({ kind: 'system', title: `Veilleuse de Cooper allumée (${s.lamp.name})`, data: {} });
        s.lampLit = true;
    } else {
        await hueClient.put(`/lights/${id}/state`, { on: false, transitiontime: 30 });
        s.lampLit = false;
        journal.log({ kind: 'system', title: 'Veilleuse de Cooper éteinte', data: {} });
    }
    save();
};

// --- Radio ---

let radioFailedAt = 0;

const stopRadio = async () => {
    const on = s.radioOn;
    if (!on) return;
    s.radioOn = null;
    save();
    // On n'arrête que si c'est encore notre radio qui joue
    if (musicPlayer.state().source?.id !== on.id) return;
    await castService.controlPlayback(on.deviceId, 'stop').catch(() => {});
    journal.log({ kind: 'system', title: 'Radio de Cooper arrêtée', data: {} });
};

const syncRadio = async (wantId) => {
    if (!wantId) return stopRadio();
    if (s.radioHeld) return;
    if (s.radioOn) {
        // Quelqu'un a changé l'enceinte (téléphone, voix) : on la lui laisse
        if (musicPlayer.state().source?.id !== s.radioOn.id) {
            s.radioOn = null;
            s.radioHeld = true;
            save();
            return;
        }
        if (s.radioOn.id === wantId) return;
    }
    if (Date.now() - radioFailedAt < RADIO_RETRY_MS) return;
    const device = castService.findDevice(s.radio.deviceName);
    if (!device) {
        radioFailedAt = Date.now();
        return;
    }
    try {
        // Le volume d'abord : l'enceinte ne doit jamais repartir au niveau de la dernière écoute
        await castService.setVolume(device.id, s.radio.volume / 100);
        await musicPlayer.play({ deviceId: device.id, kind: 'radio', id: wantId, habit: false });
        const name = musicPlayer.RADIOS.find((r) => r.id === wantId)?.name || wantId;
        journal.log({ kind: 'system', title: `Radio de Cooper : ${name} à ${s.radio.volume} %`, data: {} });
        s.radioOn = { deviceId: device.id, id: wantId, since: Date.now() };
        save();
    } catch (err) {
        radioFailedAt = Date.now();
        console.warn('⚠️  Radio de Cooper:', err.message);
    }
};

// --- Retour ---

/** Toutes les pièces (sauf l'entrée, qui a ses propres règles) au blanc du moment. */
const lightHouse = async () => {
    const { data: groups } = await hueClient.get('/groups');
    let ct = 454;
    try {
        ct = (await circadian.getStatus()).ct || ct;
    } catch { /* blanc chaud par défaut */ }
    const rooms = Object.entries(groups).filter(([, g]) => g.type === 'Room' && g.lights?.length && !sensorRegistry.isEntrance(g.name));
    for (const [id] of rooms) await hueClient.put(`/groups/${id}/action`, { on: true, bri: s.arrival.bri, ct, transitiontime: 10 });
    return rooms.map(([, g]) => g.name);
};

/** On rentre : radio et simulation s'arrêtent, et s'il fait noir toute la maison s'allume. */
export const arrive = async (via) => {
    const now = Date.now();
    if (s.arrivedAt && now - s.arrivedAt < ARRIVAL_DEDUP_MS) return { skipped: true };
    s.arrivedAt = now;
    save();
    await stopRadio().catch(() => {});
    guard.setAutoSim(false);
    if (!s.arrival.enabled || !hueBaseUrl) return { lit: false };
    if (!(await darkNow())) {
        await syncLamp(false).catch(() => {});
        return { lit: false };
    }
    s.lampLit = false; // la Bibliothèque fait partie du salon : elle reste allumée avec le reste
    save();
    const rooms = await lightHouse();
    journal.log({ kind: 'system', title: `Retour (${via}) : ${rooms.join(', ')} allumés`, data: {} });
    return { lit: true, rooms };
};

// --- Boucle ---

const onPhase = async (prev, next, now) => {
    if (prev === 'home' && next !== 'home') {
        // Porte ouverte sans téléphone, 30 min plus tard toujours personne (promeneur de chien, voisin) :
        // on éteint ce que le retour avait allumé
        if (s.returnedAt) {
            s.returnedAt = null;
            await hueClient.put('/groups/0/action', { on: false }).catch(() => {});
            journal.log({ kind: 'system', title: 'Porte ouverte mais aucun téléphone revenu en 30 min : lumières éteintes', data: {} });
        }
        s.leftAt = now;
        s.departures += 1;
        s.radioHeld = false;
    }
    // Cooper est avec nous : veilleuse et radio s'arrêtent avant que la simulation prenne le salon
    if (next === 'long' || next === 'guard') {
        await syncLamp(false).catch(() => {});
        await stopRadio().catch(() => {});
    }
    if (next === 'long' && prev !== 'guard') {
        guard.setAutoSim(true);
        if (prev === 'out' && !guard.getView().mode) {
            notifier.notify({ text: '🏡 Porte d’entrée fermée depuis 12 h et personne à la maison : simulation de présence le soir. Veilleuse et radio de Cooper coupées. L’alarme s’armera après 24 h.', builtin: 'away.simulation' }).catch(() => {});
        }
    }
    if (next === 'guard') {
        guard.setAutoSim(true);
        if (!guard.getView().mode) await guard.setMode('vacation', 'absence de 24 h', { auto: true, silent: false });
    }
    journal.log({ kind: 'system', title: `Maison vide : ${prev} → ${next}`, data: { prev, next } });
};

let busy = false;
const tick = async () => {
    if (busy || !s.enabled) return;
    busy = true;
    try {
        const now = Date.now();
        // Un téléphone est revenu : le mode armé par l'absence se coupe tout seul
        if (presence.anyoneHome() === true) await guard.disarmAuto('retour, téléphone sur le Wi-Fi');
        if (s.returnedAt && now - s.returnedAt >= RETURN_HOLD_MS && presence.anyoneHome() !== false) s.returnedAt = null;
        const phase = phaseOf({ anyoneHome: presence.anyoneHome(), lastDoorAt: s.lastDoorAt, returnedAt: s.returnedAt, guardMode: guard.getView().mode, now });
        if (phase !== s.phase) {
            const prev = s.phase;
            s.phase = phase;
            save();
            await onPhase(prev, phase, now);
            if (phase === 'home' && prev !== 'home') await arrive('Wi-Fi');
        }
        await syncLamp(phase === 'out' && (await darkNow()));
        await syncRadio(phase === 'out' && s.radio.enabled && radioHours(localMin(now)) ? radioAt(s.leftAt, now, s.departures) : null);
    } catch (err) {
        console.warn('⚠️  Maison vide:', err.message);
    } finally {
        busy = false;
    }
};

// --- API ---

export const getView = () => ({
    enabled: s.enabled,
    phase: s.phase,
    lamp: s.lamp,
    radio: s.radio,
    arrival: s.arrival,
    lastDoorAt: s.lastDoorAt,
    leftAt: s.phase === 'home' ? null : s.leftAt,
    lampLit: s.lampLit,
    radioOn: s.radioOn,
});

export const update = (patch = {}) => {
    if (patch.enabled !== undefined) s.enabled = Boolean(patch.enabled);
    if (patch.lamp) {
        if (patch.lamp.name) s.lamp.name = String(patch.lamp.name);
        if (patch.lamp.bri !== undefined) s.lamp.bri = Math.max(1, Math.min(254, Math.round(Number(patch.lamp.bri))));
        if (patch.lamp.ct !== undefined) s.lamp.ct = Math.max(153, Math.min(500, Math.round(Number(patch.lamp.ct))));
    }
    if (patch.radio) {
        if (patch.radio.enabled !== undefined) s.radio.enabled = Boolean(patch.radio.enabled);
        if (patch.radio.deviceName) s.radio.deviceName = String(patch.radio.deviceName);
        if (patch.radio.volume !== undefined) s.radio.volume = Math.max(5, Math.min(30, Math.round(Number(patch.radio.volume))));
    }
    if (patch.arrival) {
        if (patch.arrival.enabled !== undefined) s.arrival.enabled = Boolean(patch.arrival.enabled);
        if (patch.arrival.bri !== undefined) s.arrival.bri = Math.max(1, Math.min(254, Math.round(Number(patch.arrival.bri))));
    }
    save();
    setTimeout(tick, 500);
    return getView();
};

export const start = () => {
    if (!s.lastDoorAt) {
        // Inconnue au premier démarrage : on compte à partir de maintenant, jamais « 12 h » d'office
        s.lastDoorAt = Date.now();
        save();
    }
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop !== 'isOpen' || value !== true || sensor.type !== 'door' || !sensorRegistry.isEntrance(sensor.name)) return;
        const wasEmpty = s.phase !== 'home';
        s.lastDoorAt = Date.now();
        if (wasEmpty) {
            s.returnedAt = Date.now();
            s.phase = 'home';
        }
        save();
        if (wasEmpty) arrive('porte d’entrée').catch((err) => console.warn('⚠️  Retour:', err.message));
    });
    bus.on('presence', ({ anyoneHome }) => {
        if (anyoneHome) s.returnedAt = null; // un téléphone a pris le relais de la porte
        save();
        // Après « Je pars » (qui éteint tout) : la veilleuse et la radio arrivent ensuite
        setTimeout(tick, 6000);
    });
    setInterval(tick, TICK_MS).unref?.();
    setTimeout(tick, 15_000);
    console.log(`🐶 Maison vide : ${s.enabled ? `veilleuse ${s.lamp.name}, radio ${s.radio.enabled ? `${s.radio.volume} %` : 'non'}` : 'désactivé'}`);
};
