/**
 * Lampe de l'entrée (Hue) : s'allume quand la porte d'entrée s'ouvre ou que le capteur de
 * mouvement de l'entrée voit quelqu'un, à toute heure, et s'éteint 2 min après le dernier passage.
 * Vue une 2ᵉ fois par le détecteur pendant qu'elle est allumée, quelqu'un est resté en bas
 * (lessive, chaussures) : la minuterie passe à 5 min, relancée à chaque mouvement.
 *
 * L'interrupteur est bloqué sur ON : l'ampoule s'éteint toujours 2 min après le dernier
 * passage, même allumée autrement (appli Hue, retour du courant) ; une ronde chaque minute
 * rattrape ces cas. Allumée à la main depuis MyHue, elle reste allumée jusqu'à ce qu'on l'éteigne
 * (les passages et la ronde la laissent tranquille). La nuit, blanc plus chaud.
 *
 * Le matin, autour de la sortie (même plage que lightSignals), elle montre d'abord quelques
 * secondes la couleur de ce qui attend dehors (pluie, orage, verglas, BIXI, courrier), une fois
 * par matin, puis passe en blanc. En mode alarme ou vacances (guard.js), elle clignote en rouge.
 * Les couleurs ne servent que si l'ampoule est une Hue couleur.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { bus } from './events.js';
import { hueClient, hueBaseUrl } from './hue.js';
import * as sensorPause from './sensorPause.js';
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as journal from './journal.js';
import * as builtins from './builtins.js';
import * as circadian from './circadian.js';
import * as lightSignals from './lightSignals.js';

const FILE = dataFile('entrance-light.json');
const TZ = process.env.TZ || 'America/Toronto';

const DEFAULTS = {
    enabled: true,
    lightId: null, // lampe Hue ; null = celle qui s'appelle « Entrée » ou qui est dans la pièce Entrée
    offAfterSec: 120,
    longOffAfterSec: 300, // quelqu'un est resté en bas (vu deux fois)
    nightFrom: '22:30',
    nightTo: '06:30',
    day: { ct: 4000, bright: 100 },
    night: { ct: 2700, bright: 100 },
    morningColors: true,
    colorsShownOn: null, // date locale du dernier signal du matin
    manual: false, // allumée à la main depuis MyHue : gardée jusqu'à ce qu'on l'éteigne (survit au redémarrage)
};

// Couleurs en xy (gamut C), mêmes sens que les lampes-signal du salon
export const COLORS = {
    rain: [0.167, 0.04], // pluie
    storm: [0.56, 0.41], // orage, tempête
    ice: [0.21, 0.29], // verglas, neige, grand froid
    bixi: [0.675, 0.322], // plus de BIXI
    aurora: [0.17, 0.7], // aurores
    alert: [0.62, 0.36], // alerte en ville
    mail: [0.46, 0.47], // courrier qui attend
};
const ALARM_RED = [0.69, 0.3];

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) {
        const saved = JSON.parse(readFileSync(FILE, 'utf8'));
        delete saved.ip; // ancienne Yeelight
        delete saved.bulbId;
        config = { ...DEFAULTS, ...saved };
    }
} catch (err) {
    console.error('❌ entrance-light.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde de la lampe de l’entrée impossible:', err.message);
    }
};

// --- Décisions (testées dans entranceLight.test.js) ---

export const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
};

/** Plage qui peut passer minuit (22:30 → 06:30). */
export const inRange = (min, from, to) => {
    const a = toMin(from);
    const b = toMin(to);
    return a <= b ? min >= a && min < b : min >= a || min < b;
};

const localMinutes = (ts) => {
    const [h, m] = new Date(ts).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return h * 60 + m;
};

/** Réglage d'allumage selon l'heure. */
export const sceneFor = (ts, cfg = config) => (inRange(localMinutes(ts), cfg.nightFrom, cfg.nightTo) ? { ...cfg.night, mode: 'night' } : { ...cfg.day, mode: 'day' });

/** Ordre Hue pour un blanc : kelvins → mireds (bornés par l'ampoule), luminosité % → 1-254. */
export const whiteState = ({ ct, bright }, ctRange = { min: 153, max: 500 }) => {
    const state = { on: true, bri: Math.max(1, Math.min(254, Math.round((bright / 100) * 254))), transitiontime: 3 };
    if (ctRange) state.ct = Math.max(ctRange.min, Math.min(ctRange.max, Math.round(1e6 / ct)));
    return state;
};

/**
 * Étapes de couleurs : chaque couleur tenue 3 s, ou le rouge qui clignote.
 * Renvoie [{ state, ms }] à envoyer l'une après l'autre.
 */
export const flowFor = (kinds) => {
    if (kinds.includes('alarm')) {
        const out = [];
        for (let i = 0; i < 6; i++) out.push({ state: { on: true, xy: ALARM_RED, bri: 254, transitiontime: 0 }, ms: 400 }, { state: { bri: 1, transitiontime: 0 }, ms: 400 });
        return out;
    }
    return kinds.filter((k) => COLORS[k]).map((k) => ({ state: { on: true, xy: COLORS[k], bri: 254, transitiontime: 3 }, ms: 3000 }));
};

const localDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });

/**
 * Ronde : faut-il vérifier que l'ampoule est bien éteinte ? Oui dès qu'aucun passage n'a eu
 * lieu depuis le délai d'extinction et qu'on n'a pas déjà une extinction programmée.
 */
export const shouldSweep = (now, lastTriggerAt, offAfterSec, owned) => !owned && (!lastTriggerAt || now - lastTriggerAt >= offAfterSec * 1000);

/** La lampe de l'entrée parmi celles du pont : réglée, sinon nommée « Entrée », sinon seule dans la pièce Entrée. */
export const pickEntrance = (lights = {}, groups = {}, wanted = null) => {
    if (wanted && lights[wanted]) return String(wanted);
    const named = Object.entries(lights).find(([, l]) => /^entr[ée]e$/i.test((l.name || '').trim()));
    if (named) return named[0];
    const room = Object.values(groups).find((g) => g.type === 'Room' && /entr[ée]e/i.test(g.name || ''));
    return room?.lights?.length ? String(room.lights[0]) : null;
};

/** Deux messages du détecteur à moins de 20 s : le même passage (le capteur se tait ensuite ~1 min). */
export const MOTION_GAP_MS = 20_000;

/**
 * Compte les mouvements d'une même période d'allumage. Le capteur Aqara ne dit pas combien de
 * temps dure un mouvement : il prévient, puis se tait environ une minute. Vu une 2ᵉ fois alors
 * que la lampe est encore allumée, quelqu'un est resté en bas : on passe à la minuterie longue.
 */
export const countMotion = (session = {}, now = Date.now()) => {
    const motions = session.motions || 0;
    if (session.lastMotionAt && now - session.lastMotionAt < MOTION_GAP_MS) return { motions, lastMotionAt: session.lastMotionAt, long: Boolean(session.long) };
    const n = motions + 1;
    return { motions: n, lastMotionAt: now, long: Boolean(session.long) || n >= 2 };
};

// --- Ampoule ---

let bulb = null; // { id, color, ct: {min,max} | null }

const locate = async () => {
    const [{ data: lights }, { data: groups }] = await Promise.all([hueClient.get('/lights'), hueClient.get('/groups')]);
    const id = pickEntrance(lights, groups, config.lightId);
    if (!id) {
        bulb = null;
        return null;
    }
    const l = lights[id];
    bulb = { id, name: l.name, color: Boolean(l.state?.xy), ct: l.capabilities?.control?.ct || (l.state?.ct != null ? { min: 153, max: 500 } : null) };
    if (config.lightId !== id) {
        config.lightId = id;
        save();
        console.log(`💡 Lampe de l’entrée : Hue ${id} (${l.name})`);
        journal.log({ kind: 'system', title: `Lampe de l’entrée : Hue « ${l.name} »`, data: { lightId: id } });
    }
    return bulb;
};

const withBulb = async (fn) => {
    if (!bulb) await locate();
    if (!bulb) throw new Error('Lampe Hue de l’entrée introuvable : nomme-la « Entrée » dans l’appli Hue');
    return fn(bulb);
};

const put = (state) => hueClient.put(`/lights/${bulb.id}/state`, state);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Allumage / extinction ---

let owned = null; // { scene } quand c'est nous qui l'avons allumée
// Allumée à la main depuis MyHue : l'appui volontaire passe avant le détecteur, sans minuterie
const manualHold = () => config.manual === true;
let offTimer = null;
let offAt = null; // heure d'extinction prévue (l'anneau de la tuile)
let offTotal = null; // durée de la minuterie en cours (ms), pour que l'anneau se vide juste
let busy = Promise.resolve();
const lastTrigger = { at: null, source: null };

const OFF_RETRY_MS = 15_000;
const OFF_MAX_TRIES = 40;

const currentDelayMs = () => (owned?.long ? config.longOffAfterSec : config.offAfterSec) * 1000;

const scheduleOff = (delayMs = currentDelayMs()) => {
    clearTimeout(offTimer);
    offAt = Date.now() + delayMs;
    offTotal = delayMs;
    offTimer = setTimeout(() => {
        busy = busy.then(turnOff, turnOff);
    }, delayMs);
};

const turnOff = async () => {
    if (!owned || manualHold()) return;
    try {
        await withBulb(() => put({ on: false, transitiontime: 8 }));
        owned = null;
        offAt = null;
    } catch (err) {
        owned.offTries = (owned.offTries || 0) + 1;
        console.warn(`⚠️  Lampe de l’entrée (extinction, essai ${owned.offTries}):`, err.message);
        if (owned.offTries >= OFF_MAX_TRIES) {
            owned = null;
            offAt = null;
        } else scheduleOff(OFF_RETRY_MS);
    }
};

// Mode alarme ou vacances actif ? (branché par guard.js)
let alarmActive = () => false;
export const setAlarmCheck = (fn) => {
    alarmActive = fn;
};

const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

/** Couleurs à montrer avant le blanc : rouge en alarme, sinon le signal du matin (une fois par jour). */
const colorsFor = async (now) => {
    if (alarmActive()) return ['alarm'];
    if (!config.morningColors || config.colorsShownOn === localDate(now) || !lightSignals.inMorningWindow(now)) return [];
    const kinds = (await within(lightSignals.leaveKinds().catch(() => []), 2000)) || [];
    const mailbox = await import('./mailbox.js');
    if (mailbox.getView(now).waiting) kinds.push('mail');
    return kinds;
};

const playFlow = async (steps) => {
    for (const s of steps) {
        await put(s.state);
        await wait(s.ms);
    }
};

const turnOn = async (source, kind) => {
    lastTrigger.at = Date.now();
    lastTrigger.source = source;
    if (manualHold()) return; // réglée à la main : un passage ne change ni la couleur ni l'intensité
    if (owned) {
        // déjà allumée par nous : on repousse l'extinction, plus loin si quelqu'un est resté en bas
        if (kind === 'motion') {
            const wasLong = owned.long;
            Object.assign(owned, countMotion(owned));
            if (owned.long && !wasLong) console.log(`💡 Lampe de l’entrée : quelqu’un est resté en bas, minuterie ${Math.round(config.longOffAfterSec / 60)} min`);
        }
        return scheduleOff();
    }
    if (!builtins.allows('entrance.light', 'lamp')) return;
    try {
        await withBulb(async (b) => {
            circadian.markManual([b.id]); // le circadien ne touche pas à son blanc
            const now = Date.now();
            const kinds = b.color ? await colorsFor(now) : alarmActive() ? ['alarm'] : [];
            if (kinds.length) {
                await playFlow(flowFor(kinds));
                if (!kinds.includes('alarm')) {
                    config.colorsShownOn = localDate(now);
                    save();
                    journal.log({ kind: 'system', title: `Lampe de l’entrée : ${kinds.join(', ')} (matin)`, data: { kinds } });
                }
            }
            const scene = sceneFor(Date.now());
            await put(whiteState(scene, b.ct));
            builtins.ran('entrance.light', 'lamp', source);
            circadian.markManual([b.id]);
            owned = { scene, ...(kind === 'motion' ? countMotion({}) : { motions: 0, long: false }) };
            scheduleOff();
        });
    } catch (err) {
        console.warn('⚠️  Lampe de l’entrée:', err.message);
    }
};

// Ronde chaque minute : l'ampoule est toujours alimentée (interrupteur bloqué sur ON). Si elle
// est allumée sans passage récent (courant revenu, appli Hue), on l'éteint.
const SWEEP_MS = 60_000;
let sweepFailing = false;
const sweep = async () => {
    if (!config.enabled) return;
    if (manualHold()) return checkManualStillOn();
    if (!shouldSweep(Date.now(), lastTrigger.at, config.offAfterSec, owned)) return;
    try {
        await withBulb(async (b) => {
            const { data } = await hueClient.get(`/lights/${b.id}`);
            sweepFailing = false;
            if (!data.state?.on || data.state.reachable === false || owned) return;
            await put({ on: false, transitiontime: 8 });
            console.log('💡 Lampe de l’entrée allumée sans passage : éteinte');
        });
    } catch (err) {
        if (!sweepFailing) console.warn('⚠️  Lampe de l’entrée (ronde):', err.message);
        sweepFailing = true;
    }
};

const setManual = (on) => {
    if (config.manual === on) return;
    config.manual = on;
    save();
};

// Allumée à la main mais éteinte ailleurs (appli Hue, courant coupé) : le détecteur reprend la main
const checkManualStillOn = async () => {
    try {
        await withBulb(async (b) => {
            const { data } = await hueClient.get(`/lights/${b.id}`);
            if (data.state && !data.state.on) setManual(false);
        });
    } catch {
        // pont injoignable : on garde l'état manuel
    }
};

/** @param kind 'motion' (détecteur) ou 'door' (porte) : seuls les mouvements comptent pour la minuterie longue */
export const trigger = (source, kind = 'door') => {
    if (!config.enabled) return busy;
    busy = busy.then(() => turnOn(source, kind), () => turnOn(source, kind));
    return busy;
};

/**
 * Commande Hue envoyée à la main depuis MyHue (proxy /api/hue) : allumée ainsi, elle reste
 * allumée jusqu'à ce qu'on l'éteigne ; éteinte ainsi, le détecteur reprend la main.
 */
export const noteHueCommand = (path, body) => {
    if (!bulb || !body) return;
    const m = path.match(/^\/lights\/(\d+)\/state/);
    if (!m || m[1] !== bulb.id) return;
    clearTimeout(offTimer);
    owned = null;
    offAt = null;
    setManual(body.on !== false);
};

// --- Déclencheurs ---

const entranceMotion = (ieee) => {
    const e = ieee && sensorRegistry.find(ieee);
    return e && e.type === 'motion' && (/entr[ée]e/i.test(e.room || '') || sensorRegistry.isEntrance(e.name)) ? e : null;
};

export const start = () => {
    if (!hueBaseUrl) return console.log('💡 Lampe de l’entrée : pont Hue non configuré');
    // Porte d'entrée qui s'ouvre
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop === 'isOpen' && value === true && sensor.type === 'door' && sensorRegistry.isEntrance(sensor.name)) trigger(sensor.name);
    });
    // Mouvement : chaque message « occupancy: true » compte, même répété (le bus ne voit que les changements)
    zigbeeService.emitter.on('update', (name) => {
        const device = zigbeeService.getDevice(name);
        if (device?.state?.occupancy !== true || Date.now() - (device.lastSeen || 0) > 5000) return;
        const e = entranceMotion(device.ieeeAddr);
        if (e && !sensorPause.isPaused(e.ieee)) trigger(e.name, 'motion');
    });
    setInterval(() => {
        busy = busy.then(sweep, sweep);
    }, SWEEP_MS);
    // Le matin, c'est elle qui montre la météo (si elle fait la couleur) : le salon ne « respire » plus à la porte
    lightSignals.setDoorDelegate(() => config.enabled && config.morningColors && Boolean(bulb?.color));
    locate()
        .then((b) => console.log(`💡 Lampe de l’entrée ${config.enabled ? 'active' : 'désactivée'}${b ? ` (Hue ${b.id}, ${b.name})` : ' (aucune lampe Hue « Entrée »)'}`))
        .catch((err) => console.warn('⚠️  Lampe de l’entrée (pont Hue):', err.message));
    // Ampoule renommée ou remplacée : on la retrouve de temps en temps
    setInterval(() => locate().catch(() => null), 10 * 60_000);
};

// --- API ---

export const getStatus = () => ({
    enabled: config.enabled,
    lightId: bulb?.id ?? config.lightId,
    lightName: bulb?.name ?? null,
    color: Boolean(bulb?.color),
    offAfterSec: config.offAfterSec,
    longOffAfterSec: config.longOffAfterSec,
    nightFrom: config.nightFrom,
    nightTo: config.nightTo,
    day: config.day,
    night: config.night,
    morningColors: config.morningColors,
    colorsShownOn: config.colorsShownOn,
    lit: Boolean(owned),
    manual: manualHold(),
    long: Boolean(owned?.long), // quelqu'un est resté en bas : minuterie longue
    offAt: owned && !manualHold() ? offAt : null, // fin de la minuterie du détecteur
    offTotalSec: owned && !manualHold() && offTotal ? Math.round(offTotal / 1000) : null, // durée de cette minuterie
    now: Date.now(), // l'horloge du Pi, pour que la tablette compte juste
    lastTrigger: lastTrigger.at ? { ...lastTrigger } : null,
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const level = (v, cur) => ({
    ct: v?.ct !== undefined ? Math.max(2000, Math.min(6500, Math.round(Number(v.ct)))) : cur.ct,
    bright: v?.bright !== undefined ? Math.max(1, Math.min(100, Math.round(Number(v.bright)))) : cur.bright,
});

export const update = (patch = {}) => {
    if (patch.enabled !== undefined) config.enabled = Boolean(patch.enabled);
    if (patch.morningColors !== undefined) config.morningColors = Boolean(patch.morningColors);
    if (patch.lightId !== undefined) {
        if (patch.lightId !== null && !/^\d+$/.test(String(patch.lightId))) throw new Error('Lampe invalide');
        config.lightId = patch.lightId === null ? null : String(patch.lightId);
        bulb = null;
        setTimeout(() => locate().catch(() => null), 0);
    }
    if (patch.offAfterSec !== undefined) {
        const s = Number(patch.offAfterSec);
        if (!(s >= 15 && s <= 3600)) throw new Error('Délai entre 15 s et 1 h');
        config.offAfterSec = Math.round(s);
    }
    if (patch.longOffAfterSec !== undefined) {
        const s = Number(patch.longOffAfterSec);
        if (!(s >= 60 && s <= 3600)) throw new Error('Délai long entre 1 min et 1 h');
        config.longOffAfterSec = Math.round(s);
    }
    for (const k of ['nightFrom', 'nightTo']) {
        if (patch[k] === undefined) continue;
        if (!HHMM.test(patch[k])) throw new Error(`${k} : format HH:MM`);
        config[k] = patch[k];
    }
    if (patch.day) config.day = level(patch.day, config.day);
    if (patch.night) config.night = level(patch.night, config.night);
    save();
    return getStatus();
};

/** Essai depuis l'interface : allume comme si quelqu'un passait, ou montre une couleur. */
export const test = async (kind) => {
    if (kind) {
        if (!COLORS[kind] && kind !== 'alarm') throw new Error('Couleur inconnue');
        await withBulb(async (b) => {
            if (!b.color && kind !== 'alarm') throw new Error('Cette ampoule ne fait pas la couleur');
            await playFlow(flowFor([kind], b.color));
            await put(whiteState(sceneFor(Date.now()), b.ct));
        });
        owned = owned || { scene: null };
        scheduleOff();
        return getStatus();
    }
    await trigger('essai');
    return getStatus();
};
