/**
 * Alarme dans la maison (fuite d'eau) : pour qui est là sans son téléphone.
 * Toutes les lampes Hue joignables passent au rouge et clignotent une minute, puis restent rouges ;
 * les enceintes disponibles annoncent le message. Levée (sec, « C'est réglé », « Fausse alerte ») :
 * chaque lampe reprend exactement son état d'avant.
 */
import { hueClient, hueBaseUrl, restoreLight } from './hue.js';
import * as haService from './haService.js';
import { announce } from './briefing.js';

const RED = [0.675, 0.322];
const BLINK_MS = 60_000;
const LSELECT_MS = 15_000; // durée d'un clignotement Hue (alert lselect)

// did du capteur -> { before: { [lightId]: state }, timer }
const active = new Map();

const speakersAvailable = async () =>
    (await haService.getStates('media_player')).filter((p) => p.state !== 'unavailable').map((p) => p.entity_id);

const lightsToRed = async () => {
    const { data: lights } = await hueClient.get('/lights');
    const before = {};
    for (const [id, l] of Object.entries(lights)) {
        if (!l.state.reachable) continue;
        before[id] = l.state;
        const color = l.state.xy ? { xy: RED } : {};
        await hueClient.put(`/lights/${id}/state`, { on: true, bri: 254, ...color, alert: 'lselect', transitiontime: 0 }).catch(() => {});
    }
    return before;
};

/** Lève l'alarme d'un capteur ; un nouvel appel (rappel 15 min) relance clignotement et annonce. */
export const raise = async (did, speech) => {
    const current = active.get(did);
    clearInterval(current?.timer);
    const entry = { before: current?.before ?? null, timer: null };
    active.set(did, entry);

    if (hueBaseUrl) {
        try {
            // Au rappel, ou si un autre capteur est déjà en alarme, on garde l'état relevé
            // la première fois (sinon on mémoriserait le rouge)
            const shared = [...active.values()].find((e) => e !== entry && e.before)?.before;
            const before = await lightsToRed();
            entry.before ??= shared ?? before;
            let left = Math.floor(BLINK_MS / LSELECT_MS) - 1;
            entry.timer = setInterval(() => {
                if (left-- <= 0 || !active.has(did)) return clearInterval(entry.timer);
                for (const id of Object.keys(entry.before)) {
                    hueClient.put(`/lights/${id}/state`, { alert: 'lselect' }).catch(() => {});
                }
            }, LSELECT_MS);
        } catch (err) {
            console.warn('⚠️  Alarme, lampes:', err.message);
        }
    }

    if (haService.isConfigured() && speech) {
        try {
            const speakers = await speakersAvailable();
            if (speakers.length) await announce(speakers, speech);
        } catch (err) {
            console.warn('⚠️  Alarme, enceintes:', err.message);
        }
    }
};

/** Arrête l'alarme d'un capteur ; les lampes reviennent quand plus aucune alarme n'est active. */
export const clear = async (did) => {
    const entry = active.get(did);
    if (!entry) return false;
    clearInterval(entry.timer);
    active.delete(did);
    // Un autre capteur encore en alarme : les lampes restent rouges
    if (active.size) return true;
    for (const [id, state] of Object.entries(entry.before || {})) {
        await restoreLight(id, state).catch((err) => console.warn(`⚠️  Alarme, lampe ${id}:`, err.message));
    }
    return true;
};

export const isActive = (did) => active.has(did);
