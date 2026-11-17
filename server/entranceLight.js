/**
 * Lampe de l'entrée (Yeelight) : s'allume quand la porte d'entrée s'ouvre ou que le
 * capteur de mouvement de l'entrée voit quelqu'un, à toute heure, et s'éteint 2 min
 * après le dernier passage.
 *
 * L'interrupteur est bloqué sur ON : l'ampoule s'éteint toujours 2 min après le dernier
 * passage, même allumée autrement (appli, retour du courant) ; une ronde chaque minute
 * rattrape ces cas. La nuit, blanc plus chaud.
 *
 * Le matin, autour de la sortie (même plage que lightSignals), elle montre d'abord
 * quelques secondes la couleur de ce qui attend dehors (pluie, orage, verglas, BIXI,
 * courrier), une fois par matin, puis passe en blanc. En mode alarme ou vacances
 * (guard.js), elle clignote en rouge à chaque allumage.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { bus } from './events.js';
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as journal from './journal.js';
import * as yeelight from './yeelight.js';
import * as lightSignals from './lightSignals.js';

const FILE = dataFile('entrance-light.json');
const TZ = process.env.TZ || 'America/Toronto';
const RETRY_DISCOVERY_MS = 10 * 60_000;

const DEFAULTS = {
    enabled: true,
    ip: null, // trouvée toute seule (SSDP puis balayage), gardée ici
    bulbId: null,
    offAfterSec: 120,
    nightFrom: '22:30',
    nightTo: '06:30',
    day: { ct: 4000, bright: 100 },
    night: { ct: 2700, bright: 100 },
    morningColors: true,
    colorsShownOn: null, // date locale du dernier signal du matin
};

// Couleurs Yeelight (0xRRGGBB), mêmes sens que les lampes-signal Hue
export const COLORS = {
    rain: 0x1e5cff, // pluie
    storm: 0xff9000, // orage, tempête
    ice: 0x9fdcff, // verglas, neige, grand froid
    bixi: 0xff2a00, // plus de BIXI
    aurora: 0x20ff70, // aurores
    alert: 0xff5a00, // alerte en ville
    mail: 0xffd000, // courrier qui attend
};
const ALARM_RED = 0xff0000;

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
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

/**
 * Animation Yeelight (set_scene « cf ») : chaque couleur tenue 3 s, ou le rouge qui clignote.
 * Renvoie { count, expr, ms } ; count = nombre d'étapes, la lampe reste sur la dernière.
 */
export const flowFor = (kinds) => {
    const steps = [];
    if (kinds.includes('alarm')) {
        for (let i = 0; i < 8; i++) steps.push([300, 1, ALARM_RED, 100], [300, 1, ALARM_RED, 1]);
    } else {
        for (const k of kinds) if (COLORS[k] != null) steps.push([300, 1, COLORS[k], 100], [2700, 7, 0, 0]);
    }
    return { count: steps.length, expr: steps.flat().join(','), ms: steps.reduce((t, s) => t + s[0], 0) };
};

const localDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });

/**
 * Ronde : faut-il vérifier que l'ampoule est bien éteinte ? Oui dès qu'aucun passage n'a eu
 * lieu depuis le délai d'extinction et qu'on n'a pas déjà une extinction programmée.
 */
export const shouldSweep = (now, lastTriggerAt, offAfterSec, owned) => !owned && (!lastTriggerAt || now - lastTriggerAt >= offAfterSec * 1000);

// --- Ampoule ---

let lastDiscoveryAt = 0;
let discovering = null;

const locate = () => {
    if (discovering) return discovering;
    discovering = (async () => {
        lastDiscoveryAt = Date.now();
        // Plusieurs Yeelight à la maison (chambre d'amis…) : on ne suit que la nôtre, par son identifiant
        const bulbs = await yeelight.discover();
        const mine = config.bulbId ? bulbs.find((b) => b.id === config.bulbId) : bulbs.find((b) => b.ip === config.ip);
        if (mine && mine.id !== config.bulbId) {
            config.bulbId = mine.id;
            save();
        }
        let ip = mine?.ip || null;
        if (!ip && !config.bulbId && !config.ip) {
            // Première recherche : seulement s'il n'y a aucun doute sur l'ampoule
            if (bulbs.length === 1) {
                ip = bulbs[0].ip;
                config.bulbId = bulbs[0].id;
            } else if (!bulbs.length) {
                const hits = await yeelight.scan();
                if (hits.length === 1) ip = hits[0];
            }
        }
        if (ip && ip !== config.ip) {
            config.ip = ip;
            save();
            console.log(`💡 Lampe de l’entrée trouvée : Yeelight ${ip}`);
            journal.log({ kind: 'system', title: `Lampe de l’entrée trouvée (Yeelight ${ip})`, data: { ip } });
        }
        return config.ip;
    })().finally(() => {
        discovering = null;
    });
    return discovering;
};

/** Commande avec une nouvelle recherche si l'ampoule a changé d'adresse. */
const withBulb = async (fn) => {
    if (!config.ip) await locate();
    if (!config.ip) throw new Error('Yeelight introuvable : activer « Contrôle LAN » dans l’appli Yeelight');
    try {
        return await fn(config.ip);
    } catch (err) {
        if (Date.now() - lastDiscoveryAt < 60_000) throw err;
        const before = config.ip;
        await locate();
        if (!config.ip || config.ip === before) throw err;
        return fn(config.ip);
    }
};

// --- Allumage / extinction ---

let owned = null; // { scene } quand c'est nous qui l'avons allumée
// Allumée à la main depuis MyHue (page Lumières) : on la laisse tranquille jusqu'à cette heure
let manualUntil = 0;
export const MANUAL_HOLD_MS = 15 * 60_000;
const manualHold = () => Date.now() < manualUntil;
let offTimer = null;
let busy = Promise.resolve();
const lastTrigger = { at: null, source: null };

const OFF_RETRY_MS = 30_000;
const OFF_MAX_TRIES = 40; // ~20 min de Wi-Fi capricieux avant d'abandonner

const scheduleOff = (delayMs = config.offAfterSec * 1000) => {
    clearTimeout(offTimer);
    offTimer = setTimeout(() => {
        busy = busy.then(turnOff, turnOff);
    }, delayMs);
};

const turnOff = async () => {
    if (!owned || manualHold()) return;
    try {
        await withBulb((ip) => yeelight.setPower(ip, false, 800));
        owned = null;
    } catch (err) {
        // Ampoule injoignable : on la garde à notre charge et on réessaie, sinon elle resterait
        // allumée et le prochain passage la prendrait pour une lampe allumée à la main.
        owned.offTries = (owned.offTries || 0) + 1;
        console.warn(`⚠️  Lampe de l’entrée (extinction, essai ${owned.offTries}):`, err.message);
        if (owned.offTries >= OFF_MAX_TRIES) {
            owned = null;
            journal.log({ kind: 'system', title: 'Lampe de l’entrée injoignable : extinction abandonnée', data: { error: err.message } });
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

const turnOn = async (source) => {
    lastTrigger.at = Date.now();
    lastTrigger.source = source;
    if (manualHold()) return; // réglée à la main : un passage ne change ni la couleur ni l'intensité
    if (owned) return scheduleOff(); // déjà allumée par nous : on repousse l'extinction
    try {
        await withBulb(async (ip) => {
            // Même déjà allumée (interrupteur, appli), on la prend en charge : elle s'éteindra après le délai
            const now = Date.now();
            const kinds = await colorsFor(now);
            if (kinds.length) {
                const flow = flowFor(kinds);
                // Ampoule sans couleur : l'animation échoue, on passe directement au blanc
                const ok = await yeelight.command(ip, 'set_scene', ['cf', flow.count, 1, flow.expr]).then(() => true, () => false);
                if (ok) {
                    if (!kinds.includes('alarm')) {
                        config.colorsShownOn = localDate(now);
                        save();
                        journal.log({ kind: 'system', title: `Lampe de l’entrée : ${kinds.join(', ')} (matin)`, data: { kinds } });
                    }
                    await new Promise((r) => setTimeout(r, flow.ms + 200));
                }
            }
            const scene = sceneFor(Date.now());
            // Ampoule blanche simple : pas de température de couleur, juste la luminosité
            await yeelight.setWhite(ip, scene.ct, scene.bright).catch(async () => {
                await yeelight.setPower(ip, true, 300);
                await yeelight.command(ip, 'set_bright', [scene.bright, 'sudden', 0]);
            });
            owned = { scene };
            scheduleOff();
        });
    } catch (err) {
        console.warn('⚠️  Lampe de l’entrée:', err.message);
    }
};

// Ronde chaque minute : l'ampoule est toujours alimentée (interrupteur bloqué sur ON). Si elle
// est allumée sans passage récent (courant revenu, extinction ratée, appli), on l'éteint.
const SWEEP_MS = 60_000;
let sweepFailing = false;
const sweep = async () => {
    if (!config.enabled || !config.ip || manualHold() || !shouldSweep(Date.now(), lastTrigger.at, config.offAfterSec, owned)) return;
    try {
        const props = await yeelight.getProps(config.ip);
        sweepFailing = false;
        if (props.power !== 'on' || owned) return;
        await yeelight.setPower(config.ip, false, 800);
        console.log('💡 Lampe de l’entrée allumée sans passage : éteinte');
    } catch (err) {
        if (!sweepFailing) console.warn('⚠️  Lampe de l’entrée (ronde):', err.message);
        sweepFailing = true;
    }
};

export const trigger = (source) => {
    if (!config.enabled) return busy;
    busy = busy.then(() => turnOn(source), () => turnOn(source));
    return busy;
};

// --- Déclencheurs ---

const entranceMotion = (ieee) => {
    const e = ieee && sensorRegistry.find(ieee);
    return e && e.type === 'motion' && (/entr[ée]e/i.test(e.room || '') || sensorRegistry.isEntrance(e.name)) ? e : null;
};

export const start = () => {
    // Porte d'entrée qui s'ouvre
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop === 'isOpen' && value === true && sensor.type === 'door' && sensorRegistry.isEntrance(sensor.name)) trigger(sensor.name);
    });
    // Mouvement : chaque message « occupancy: true » compte, même répété (le bus ne voit que les changements)
    zigbeeService.emitter.on('update', (name) => {
        const device = zigbeeService.getDevice(name);
        if (device?.state?.occupancy !== true || Date.now() - (device.lastSeen || 0) > 5000) return;
        const e = entranceMotion(device.ieeeAddr);
        if (e) trigger(e.name);
    });
    setInterval(() => {
        busy = busy.then(sweep, sweep);
    }, SWEEP_MS);
    // Le matin, c'est elle qui montre la météo : le salon ne « respire » plus à l'ouverture de la porte
    lightSignals.setDoorDelegate(() => config.enabled && config.morningColors && Boolean(config.ip));
    // Adresse donnée à la main : on apprend l'identifiant de l'ampoule pour la retrouver si l'adresse change
    if (config.ip && !config.bulbId) setTimeout(() => locate().catch(() => null), 5000);
    if (config.enabled && !config.ip) {
        const retry = () =>
            locate()
                .catch(() => null)
                .then((ip) => !ip && setTimeout(retry, RETRY_DISCOVERY_MS));
        setTimeout(retry, 8000);
    }
    console.log(`💡 Lampe de l’entrée ${config.enabled ? 'active' : 'désactivée'}${config.ip ? ` (Yeelight ${config.ip})` : ' (Yeelight à trouver)'}`);
};

// --- Lampe sur les pages Lumières et Accueil ---

let lightCache = { at: 0, value: null }; // dernière lecture réussie
let lastAsk = 0;

/** État de l'ampoule (relu au plus toutes les 2 s) : { present, reachable, on, bright, ct, rgb, mode, manualUntil } */
export const getLight = async () => {
    if (!config.ip) return { present: false };
    const withHold = (v) => ({ ...v, manualUntil: manualHold() ? manualUntil : null });
    if (Date.now() - lastAsk < 2000 && lightCache.value) return withHold(lightCache.value);
    lastAsk = Date.now();
    try {
        const p = await yeelight.getProps(config.ip, ['power', 'bright', 'ct', 'rgb', 'color_mode']);
        lightCache = {
            at: Date.now(),
            value: {
                present: true,
                reachable: true,
                on: p.power === 'on',
                bright: Number(p.bright) || 0,
                ct: Number(p.ct) || null,
                rgb: Number(p.rgb) || null,
                mode: p.color_mode === '1' ? 'color' : 'white',
            },
        };
        return withHold(lightCache.value);
    } catch {
        // Wi-Fi capricieux : la dernière lecture vaut encore 20 s avant de la dire injoignable
        if (lightCache.value && Date.now() - lightCache.at < 20_000) return withHold(lightCache.value);
        return withHold({ present: true, reachable: false, on: false, bright: 0, ct: null, rgb: null, mode: 'white' });
    }
};

/**
 * Réglage à la main : { on, bright 1-100, ct en kelvins, rgb 0xRRGGBB }.
 * Allumée ainsi, elle reste allumée MANUAL_HOLD_MS, puis la règle « éteinte 2 min après le dernier passage » reprend.
 */
export const setLight = async ({ on, bright, ct, rgb } = {}) => {
    const lit = on !== false;
    await withBulb(async (ip) => {
        if (!lit) {
            await yeelight.setPower(ip, false, 400);
            return;
        }
        const b = Math.max(1, Math.min(100, Math.round(Number(bright) || lightCache.value?.bright || 100)));
        if (rgb != null) await yeelight.setColor(ip, Number(rgb) & 0xffffff, b);
        else if (ct != null) await yeelight.setWhite(ip, Math.max(1700, Math.min(6500, Math.round(Number(ct)))), b);
        else if (bright != null) await yeelight.command(ip, 'set_scene', ['ct', lightCache.value?.ct || 4000, b]);
        else await yeelight.setPower(ip, true, 300);
    });
    clearTimeout(offTimer);
    owned = null;
    // Éteinte à la main : la règle normale reprend tout de suite
    manualUntil = lit ? Date.now() + MANUAL_HOLD_MS : 0;
    lastAsk = 0;
    return getLight();
};

// --- API ---

export const getStatus = () => ({
    enabled: config.enabled,
    ip: config.ip,
    bulbId: config.bulbId,
    offAfterSec: config.offAfterSec,
    nightFrom: config.nightFrom,
    nightTo: config.nightTo,
    day: config.day,
    night: config.night,
    morningColors: config.morningColors,
    colorsShownOn: config.colorsShownOn,
    lit: Boolean(owned),
    lastTrigger: lastTrigger.at ? { ...lastTrigger } : null,
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const level = (v, cur) => ({
    ct: v?.ct !== undefined ? Math.max(1700, Math.min(6500, Math.round(Number(v.ct)))) : cur.ct,
    bright: v?.bright !== undefined ? Math.max(1, Math.min(100, Math.round(Number(v.bright)))) : cur.bright,
});

export const update = (patch = {}) => {
    if (patch.enabled !== undefined) config.enabled = Boolean(patch.enabled);
    if (patch.morningColors !== undefined) config.morningColors = Boolean(patch.morningColors);
    if (patch.ip !== undefined) {
        if (patch.ip !== null && !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(patch.ip))) throw new Error('Adresse IP invalide');
        if (patch.ip !== config.ip) config.bulbId = null; // autre ampoule : on réapprend son identifiant
        config.ip = patch.ip;
        if (config.ip) setTimeout(() => locate().catch(() => null), 0);
    }
    if (patch.offAfterSec !== undefined) {
        const s = Number(patch.offAfterSec);
        if (!(s >= 15 && s <= 3600)) throw new Error('Délai entre 15 s et 1 h');
        config.offAfterSec = Math.round(s);
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

/** Essai depuis l'interface : allume comme si quelqu'un passait. */
export const test = async (kind) => {
    if (!config.ip) await locate();
    if (kind) {
        if (!COLORS[kind] && kind !== 'alarm') throw new Error('Couleur inconnue');
        const flow = flowFor([kind]);
        await withBulb((ip) => yeelight.command(ip, 'set_scene', ['cf', flow.count, 0, flow.expr]));
        return getStatus();
    }
    await trigger('essai');
    return getStatus();
};
