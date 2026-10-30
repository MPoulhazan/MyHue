/**
 * Thermostat intelligent : régule la pièce avec le capteur Aqara, pas avec la sonde
 * de la thermopompe (au plafond, elle se croit plus au chaud qu'on ne l'est).
 *
 * - Programme : périodes { label, from: 'HH:MM', target }, chacune jusqu'à la suivante.
 * - Absence : consigne réduite, à la main ou quand HA Companion dit que personne n'est là.
 * - Dérogation : « 22° jusqu'à la prochaine période » depuis l'interface.
 * - Boucle fermée : la consigne envoyée à la thermopompe = cible arrondie + un décalage
 *   appris (−3 à +3) qui corrige l'écart entre sa sonde et la pièce. Au plus une commande
 *   infrarouge toutes les 15 min, un ajustement du décalage toutes les 30 min.
 *
 * Désactivé par défaut. Ne régule qu'en chauffage, et jamais porte extérieure ouverte
 * (l'automatisme « pause chauffage » s'en occupe).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as broadlinkService from './broadlinkService.js';
import * as presence from './presence.js';
import * as flexd from './flexd.js';
import { bus } from './events.js';

const FILE = dataFile('thermostat.json');
const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 5 * 60_000;
const MIN_COMMAND_GAP_MS = 15 * 60_000;
const MIN_ADJUST_GAP_MS = 30 * 60_000;
const MAX_OFFSET = 3;

const DEFAULTS = {
    enabled: false,
    sensorDid: null, // null = premier capteur de température
    schedule: [
        { label: 'Jour', from: '07:00', target: 21 },
        { label: 'Nuit', from: '22:00', target: 18.5 },
    ],
    awayTarget: 17,
    away: false, // absence forcée à la main
    override: null, // { target, until }
    offset: 0,
};

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ thermostat.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du thermostat impossible:', err.message);
    }
};

let getSensorsFn = null;
let lastCommandAt = 0;
let lastAdjustAt = 0;
let lastStatus = { state: 'off', text: 'Thermostat désactivé' };

// --- Heures locales ---

const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};
const nowParts = (d = new Date()) => {
    const [h, m] = d.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).split(':');
    return Number(h) * 60 + Number(m);
};
const fmtTime = (min) => `${Math.floor(min / 60)} h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

/** Période en cours et heure (minutes locales) à laquelle elle se termine. */
export const currentPeriod = (date = new Date()) => {
    const periods = [...config.schedule].sort((a, b) => toMinutes(a.from) - toMinutes(b.from));
    if (!periods.length) return null;
    const now = nowParts(date);
    let idx = periods.findLastIndex((p) => toMinutes(p.from) <= now);
    if (idx < 0) idx = periods.length - 1; // avant la première période : la dernière de la veille continue
    const next = periods[(idx + 1) % periods.length];
    return { ...periods[idx], until: toMinutes(next.from), nextLabel: next.label };
};

/** Minutes avant l'heure locale `untilMin` (passe minuit si besoin). */
const msUntil = (untilMin) => {
    let delta = untilMin - nowParts();
    if (delta <= 0) delta += 24 * 60;
    return delta * 60_000;
};

const isAway = () => config.away || presence.anyoneHome() === false;

/** Cible du moment et pourquoi. */
export const computeTarget = () => {
    if (config.override && config.override.until > Date.now()) {
        return { target: config.override.target, why: 'dérogation', until: config.override.until };
    }
    // Pointe Flex D : préchauffage puis consigne réduite (une dérogation garde la priorité)
    const flex = flexd.deltaNow();
    const withFlex = (t) => (flex ? { ...t, target: t.target + flex, why: `${t.why} · ${flex > 0 ? 'préchauffage' : 'pointe'} Flex D` } : t);
    if (isAway()) return withFlex({ target: config.awayTarget, why: config.away ? 'absence' : 'personne à la maison' });
    const p = currentPeriod();
    if (!p) return { target: null, why: 'aucun programme' };
    return withFlex({ target: p.target, why: p.label, untilMin: p.until });
};

// --- Boucle de régulation ---

const roomSensor = (sensors) =>
    sensors.find((s) => s.did === config.sensorDid && s.props.temperature != null) ||
    sensors.find((s) => s.props.temperature != null);

const send = async (patch) => {
    lastCommandAt = Date.now();
    await broadlinkService.applyPatch(patch, 'thermostat');
};

const regulate = async () => {
    if (!config.enabled) {
        lastStatus = { state: 'off', text: 'Thermostat désactivé' };
        return;
    }
    if (!getSensorsFn) return;
    const sensors = await getSensorsFn();
    const room = roomSensor(sensors);
    const heating = broadlinkService.getState();
    const { target, why } = computeTarget();
    const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

    if (target == null || !room) {
        lastStatus = { state: 'idle', text: room ? 'Aucun programme' : 'Pas de capteur de température' };
        return;
    }
    if (heating.power && heating.mode !== 'heat') {
        lastStatus = { state: 'idle', text: `Thermopompe en ${heating.mode} : régulation en pause (chauffage seulement)` };
        return;
    }
    if (sensors.some((s) => s.type === 'door' && s.outside && s.props.isOpen)) {
        lastStatus = { state: 'paused', text: 'Porte extérieure ouverte : régulation en pause' };
        return;
    }
    if (broadlinkService.isUncertain()) {
        lastStatus = { state: 'paused', text: 'Thermopompe peut-être éteinte à la télécommande : régulation en pause' };
        return;
    }

    const temp = room.props.temperature;
    const error = target - temp; // > 0 : trop froid
    const now = Date.now();

    // Le décalage corrige l'écart durable entre la sonde de la thermopompe et la pièce
    if (now - lastAdjustAt >= MIN_ADJUST_GAP_MS && heating.power) {
        if (error > 0.5 && config.offset < MAX_OFFSET) {
            config.offset++;
            lastAdjustAt = now;
            save();
        } else if (error < -0.5 && config.offset > -MAX_OFFSET) {
            config.offset--;
            lastAdjustAt = now;
            save();
        }
    }
    const setpoint = Math.max(16, Math.min(31, Math.round(target) + config.offset));
    const canSend = now - lastCommandAt >= MIN_COMMAND_GAP_MS;

    // Jamais d'arrêt/relance automatique : les cycles usent la thermopompe. Trop chaud, la
    // consigne descend (jusqu'à 16°) ; éteinte, elle reste éteinte jusqu'à ce qu'on la rallume.
    if (!heating.power) {
        lastStatus = { state: 'off', text: `${room.name} ${fmt(temp)}° pour ${fmt(target)}° (${why}) : thermopompe éteinte, régulation en pause` };
        return;
    }
    if (heating.temperature !== setpoint && canSend) await send({ temperature: setpoint });
    const sign = config.offset > 0 ? `+${config.offset}` : String(config.offset);
    lastStatus = {
        state: 'heating',
        text: `${room.name} ${fmt(temp)}° pour ${fmt(target)}° (${why}) : thermopompe à ${setpoint}°${config.offset ? ` (correction ${sign})` : ''}`,
    };
};

let running = false;
const run = async () => {
    if (running) return;
    running = true;
    try {
        await regulate();
    } catch (err) {
        console.error('❌ Thermostat:', err.message);
    } finally {
        running = false;
    }
};

// --- API ---

export const getStatus = () => {
    const { target, why, until, untilMin } = computeTarget();
    const p = currentPeriod();
    return {
        enabled: config.enabled,
        target,
        why,
        until: until ?? (untilMin != null ? Date.now() + msUntil(untilMin) : null),
        untilLabel: untilMin != null ? fmtTime(untilMin) : null,
        period: p ? { label: p.label, target: p.target, nextLabel: p.nextLabel } : null,
        away: config.away,
        anyoneHome: presence.anyoneHome(),
        offset: config.offset,
        status: lastStatus,
        config: {
            schedule: config.schedule,
            awayTarget: config.awayTarget,
            sensorDid: config.sensorDid,
            override: config.override && config.override.until > Date.now() ? config.override : null,
        },
    };
};

const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const validTarget = (t) => typeof t === 'number' && t >= 10 && t <= 30;

export const update = (patch = {}) => {
    if (patch.schedule !== undefined) {
        const s = patch.schedule;
        if (!Array.isArray(s) || !s.length || s.length > 8 || !s.every((p) => p.label && validTime(p.from) && validTarget(p.target))) {
            throw new Error('Programme invalide (1 à 8 périodes, heures HH:MM, 10 à 30°)');
        }
        config.schedule = s.map(({ label, from, target }) => ({ label: String(label).slice(0, 20), from, target }));
    }
    if (patch.awayTarget !== undefined) {
        if (!validTarget(patch.awayTarget)) throw new Error('Consigne d’absence invalide');
        config.awayTarget = patch.awayTarget;
    }
    if (patch.sensorDid !== undefined) config.sensorDid = patch.sensorDid || null;
    if (patch.away !== undefined) config.away = Boolean(patch.away);
    if (patch.enabled !== undefined && Boolean(patch.enabled) !== config.enabled) {
        config.enabled = Boolean(patch.enabled);
        lastCommandAt = 0; // première régulation immédiate
        journal.log({ kind: 'heating', title: `Thermostat intelligent ${config.enabled ? 'activé' : 'désactivé'}`, data: {} });
    }
    save();
    run();
    return getStatus();
};

/** Dérogation jusqu'à la fin de la période en cours (ou `hours` heures). */
export const setOverride = (target, hours) => {
    if (!validTarget(target)) throw new Error('Consigne invalide');
    const p = currentPeriod();
    const until = hours ? Date.now() + hours * 3600_000 : Date.now() + (p ? msUntil(p.until) : 2 * 3600_000);
    config.override = { target, until };
    lastCommandAt = 0;
    save();
    run();
    return getStatus();
};

export const clearOverride = () => {
    config.override = null;
    save();
    run();
    return getStatus();
};

export const isEnabled = () => config.enabled;

/**
 * Commande de chauffage venant d'une personne (interface, agent, Claude).
 * Thermostat actif : une température devient une dérogation ; « arrêt » ou un autre
 * mode que le chauffage le désactive, sinon il relancerait la thermopompe tout seul.
 */
export const userCommand = async (patch = {}, source = 'interface') => {
    if (!config.enabled) return broadlinkService.applyPatch(patch, source);
    const leavesHeat = patch.power === false || (patch.mode && patch.mode !== 'heat');
    if (leavesHeat) {
        update({ enabled: false });
        return broadlinkService.applyPatch(patch, source);
    }
    if (patch.temperature) {
        setOverride(Math.max(16, Math.min(31, Number(patch.temperature))));
        return broadlinkService.getState();
    }
    return broadlinkService.applyPatch(patch, source);
};

export const start = (getSensors) => {
    getSensorsFn = getSensors;
    // La température qui change ou quelqu'un qui part/rentre : on réévalue (les délais anti-rafale s'appliquent)
    bus.on('sensor', ({ prop }) => prop === 'temperature' && run());
    bus.on('presence', () => run());
    setInterval(run, TICK_MS);
    setTimeout(run, 30_000);
    console.log(`🌡️  Thermostat intelligent ${config.enabled ? 'actif' : 'désactivé'}`);
};
