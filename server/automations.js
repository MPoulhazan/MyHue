/**
 * Moteur d'automatismes : déclencheur capteur (+ durée) → conditions → actions,
 * et actions de retour quand le déclencheur cesse (ex. porte refermée → clim relancée).
 *
 * Réagit aux événements des capteurs (bus) et réévalue toutes les 30 s pour les durées
 * (« ouverte depuis 10 min ») et la santé des capteurs (pile, silence).
 *
 * Remplace l'ancien rulesEngine : rules.json est migré une fois vers automations.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';
import * as broadlinkService from './broadlinkService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as alarm from './alarm.js';
import { bus } from './events.js';

const FILE = dataFile('automations.json');
const LEGACY_FILE = dataFile('rules.json');
const TICK_MS = 30_000;
const TZ = process.env.TZ || 'America/Toronto';
// Capteur sans nouvelle depuis le démarrage : son silence compte à partir d'ici
const STARTED_AT = Date.now();

let automations = [];
let getSensorsFn = null;

// État d'exécution par (automatisme, capteur) : { since, fired, lastFiredAt }
const runtime = new Map();
// État de la clim avant une pause automatique, pour la relancer à l'identique
let pausedHeating = null;

// --- Persistance ---

const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(automations, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des automatismes impossible:', err.message);
    }
};

// --- Libellés ---

const PROP_LABELS = {
    isOpen: 'ouverte',
    temperature: 'température',
    humidity: 'humidité',
    battery: 'pile',
    silentHours: 'silence (h)',
};
const OP_LABELS = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', neq: '≠' };

const sensorLabel = (trigger) => {
    if (trigger.did !== '*') return sensorRegistry.find(trigger.did)?.name || trigger.did;
    return trigger.sensorType === 'door' ? 'toute porte' : trigger.sensorType === 'water_leak' ? 'tout détecteur de fuite' : 'tout capteur';
};

/** Résumé lisible d'un automatisme, pour l'interface, Telegram et l'agent. */
export const summarize = (a) => {
    const t = a.trigger;
    let what;
    const who = t.type === 'sensor' ? sensorLabel(t) : '';
    if (t.type === 'presence') what = t.state === 'away' ? 'plus personne à la maison' : 'quelqu’un rentre';
    else if (t.prop === 'isOpen') what = t.operator === 'is_false' ? `${who} fermée` : `${who} ouverte`;
    else if (t.prop === 'leak') what = `${who} mouillé`;
    else what = `${who} : ${PROP_LABELS[t.prop] || t.prop} ${OP_LABELS[t.operator] || t.operator} ${t.value}`;
    if (t.forMinutes) what += ` depuis ${t.forMinutes} min`;
    const when = (a.conditions || [])
        .map((c) => (c.type === 'time' ? `entre ${c.from} et ${c.to}` : c.type === 'heating' ? 'clim allumée' : c.type === 'dark' ? 'à la nuit tombée' : c.type === 'draught' ? `la pièce perd ${c.drop}° ou ${c.orMinutes} min sous ${c.below}° dehors` : ''))
        .filter(Boolean);
    const does = a.actions
        .map((x) => ({ notify: 'notifier', heating_pause: 'pause clim', heating_resume: 'relancer clim', home: 'action maison', alarm: 'alarme lampes + enceintes', moment: `moment ${x.id}` })[x.type])
        .filter(Boolean);
    return `Si ${what}${when.length ? ` (${when.join(', ')})` : ''} → ${does.join(' + ')}`;
};

// --- Modèles prêts à l'emploi ---

// Courant d'air : la pièce perd 1° depuis l'ouverture, ou 30 min ouverte sous 5° dehors.
// Mieux vaut couper à tort que chauffer les oiseaux toute une nuit.
const DRAUGHT_CONDITIONS = [{ type: 'heating', power: true }, { type: 'draught', drop: 1, orMinutes: 30, below: 5 }];

export const TEMPLATES = {
    window_pause_heating: {
        label: 'Courant d’air → chauffage coupé',
        description: 'Porte ou fenêtre ouverte et la pièce perd 1° (ou 30 min ouverte sous 5° dehors) : la thermopompe s’arrête avec une alerte, puis reprend à la fermeture.',
        sensorType: 'door',
        build: ({ did, minutes = 3 }) => ({
            name: `${sensorRegistry.find(did)?.name || 'Ouverture'} → chauffage coupé`,
            trigger: { type: 'sensor', did, sensorType: 'door', prop: 'isOpen', operator: 'is_true', forMinutes: minutes },
            conditions: DRAUGHT_CONDITIONS,
            actions: [
                { type: 'heating_pause' },
                { type: 'notify', level: 'alert', message: '🥶 {sensor} ouverte depuis {elapsed} min, {why} : thermopompe coupée, elle repartira à la fermeture.', buttons: ['heating_resume'] },
            ],
            onRelease: [{ type: 'heating_resume' }],
            cooldownMinutes: 0,
        }),
    },
    door_left_open: {
        label: 'Porte oubliée',
        description: 'Prévient quand une porte reste ouverte trop longtemps, puis toutes les 30 min.',
        sensorType: 'door',
        build: ({ did = '*', minutes = 10 }) => ({
            name: `${did === '*' ? 'Porte' : sensorRegistry.find(did)?.name || 'Porte'} oubliée`,
            trigger: { type: 'sensor', did, sensorType: 'door', prop: 'isOpen', operator: 'is_true', forMinutes: minutes },
            conditions: [],
            actions: [{ type: 'notify', message: '{sensor} est ouverte depuis {elapsed} min.', buttons: ['heating_off', 'snooze_1h'] }],
            repeatMinutes: 30,
            cooldownMinutes: 0,
        }),
    },
    door_night: {
        label: 'Ouverture la nuit',
        description: 'Alerte immédiate si une porte s’ouvre la nuit.',
        sensorType: 'door',
        build: ({ did = '*', from = '23:00', to = '06:00' }) => ({
            name: 'Ouverture la nuit',
            trigger: { type: 'sensor', did, sensorType: 'door', prop: 'isOpen', operator: 'is_true', forMinutes: 0 },
            conditions: [{ type: 'time', from, to }],
            actions: [{ type: 'notify', level: 'alert', message: '🌙 {sensor} vient de s’ouvrir en pleine nuit.' }],
            cooldownMinutes: 5,
        }),
    },
    leave_home: {
        label: 'Je pars',
        description: 'Quand plus personne n’est à la maison (HA Companion) : tout s’éteint et le chauffage passe en éco.',
        build: () => ({
            name: 'Je pars',
            trigger: { type: 'presence', state: 'away' },
            conditions: [],
            actions: [
                { type: 'moment', id: 'depart' },
                { type: 'notify', message: '🏃 Plus personne à la maison : lumières éteintes, chauffage en éco.' },
            ],
            cooldownMinutes: 10,
        }),
    },
    arrive_home: {
        label: 'Je rentre',
        description: 'À ton retour, s’il fait nuit : le salon s’allume doucement en blanc chaud.',
        build: ({ groupId = '1' } = {}) => ({
            name: 'Je rentre',
            trigger: { type: 'presence', state: 'home' },
            conditions: [{ type: 'dark' }],
            actions: [{ type: 'home', action: { type: 'set_group_state', id: groupId, state: { on: true, bri: 140, ct: 400 } } }],
            cooldownMinutes: 10,
        }),
    },
    water_leak: {
        label: 'Fuite d’eau',
        description: 'Alerte immédiate, répétée toutes les 15 min tant que le détecteur est mouillé : Telegram, lampes Hue en rouge et annonce sur les enceintes.',
        sensorType: 'water_leak',
        build: ({ did = '*' } = {}) => ({
            name: 'Fuite d’eau',
            trigger: { type: 'sensor', did, sensorType: 'water_leak', prop: 'leak', operator: 'is_true', forMinutes: 0 },
            conditions: [],
            actions: [
                { type: 'notify', level: 'alert', message: '💧 FUITE D’EAU détectée : {sensor}. Va vérifier tout de suite.', buttons: ['leak_fixed', 'leak_false'] },
                { type: 'alarm', speech: 'Attention : fuite d’eau détectée, {sensor}. Va vérifier tout de suite.' },
            ],
            onRelease: [{ type: 'alarm_clear' }, { type: 'notify', message: '✅ {sensor} est de nouveau sec.' }],
            repeatMinutes: 15,
            cooldownMinutes: 0,
        }),
    },
    leak_sensor_silent: {
        label: 'Détecteur de fuite muet',
        description: 'Prévient si un détecteur de fuite n’envoie plus rien depuis 3 h : il donne signe de vie toutes les heures, muet il ne protège plus.',
        sensorType: 'water_leak',
        build: ({ hours = 3 } = {}) => ({
            name: 'Détecteur de fuite muet',
            trigger: { type: 'sensor', did: '*', sensorType: 'water_leak', prop: 'silentHours', operator: 'gt', value: hours, forMinutes: 0 },
            conditions: [],
            actions: [{ type: 'notify', level: 'alert', message: '📡 {sensor} n’a rien envoyé depuis {value} h : la fuite d’eau n’est plus surveillée. Pile, ou capteur hors de portée de la clé Zigbee ?' }],
            cooldownMinutes: 12 * 60,
        }),
    },
    low_battery: {
        label: 'Pile faible',
        description: 'Prévient quand la pile d’un capteur passe sous 15 %.',
        build: () => ({
            name: 'Pile faible',
            trigger: { type: 'sensor', did: '*', prop: 'battery', operator: 'lt', value: 15, forMinutes: 0 },
            conditions: [],
            actions: [{ type: 'notify', message: '🔋 Pile faible : {sensor} ({value} %).' }],
            cooldownMinutes: 24 * 60,
        }),
    },
    sensor_silent: {
        label: 'Capteur muet',
        description: 'Prévient si un capteur n’envoie plus rien depuis 6 h (pile morte, hors de portée).',
        build: ({ hours = 6 } = {}) => ({
            name: 'Capteur muet',
            trigger: { type: 'sensor', did: '*', prop: 'silentHours', operator: 'gt', value: hours, forMinutes: 0 },
            conditions: [],
            actions: [{ type: 'notify', message: '📡 {sensor} n’a rien envoyé depuis {value} h : pile morte ou hors de portée ?' }],
            cooldownMinutes: 24 * 60,
        }),
    },
};

const normalize = (a) => ({
    id: a.id || randomUUID(),
    name: a.name || 'Automatisme',
    template: a.template || null,
    enabled: a.enabled !== false,
    trigger: { forMinutes: 0, value: null, ...a.trigger },
    conditions: a.conditions || [],
    actions: a.actions || [],
    onRelease: a.onRelease || [],
    cooldownMinutes: a.cooldownMinutes ?? 30,
    repeatMinutes: a.repeatMinutes ?? null,
    snoozedUntil: a.snoozedUntil ?? null,
    createdAt: a.createdAt || new Date().toISOString(),
    lastTriggeredAt: a.lastTriggeredAt ?? null,
    triggerCount: a.triggerCount ?? 0,
});

export const createFromTemplate = (templateId, params = {}) => {
    const tpl = TEMPLATES[templateId];
    if (!tpl) throw new Error(`Modèle inconnu: ${templateId}`);
    const automation = normalize({ ...tpl.build(params), template: templateId });
    if (automation.trigger.type === 'sensor' && !automation.trigger.did) throw new Error(`Le modèle « ${tpl.label} » demande un capteur`);
    automations.push(automation);
    save();
    console.log(`⚙️  Automatisme créé: "${automation.name}"`);
    return automation;
};

// --- Migration depuis rules.json + automatismes par défaut ---

const migrate = () => {
    let legacy = [];
    try {
        if (existsSync(LEGACY_FILE)) legacy = JSON.parse(readFileSync(LEGACY_FILE, 'utf8'));
    } catch { /* ancien fichier illisible : ignoré */ }

    const registry = sensorRegistry.getAll();
    // Les anciennes règles visaient des identifiants Xiaomi (lumi.*) : on retrouve le capteur par son nom
    for (const r of legacy) {
        const sensor =
            registry.find((s) => s.ieee === r.sensorDid) ||
            registry.find((s) => s.name.toLowerCase() === (r.sensorName || '').toLowerCase());
        automations.push(
            normalize({
                id: r.id,
                name: r.name,
                enabled: r.enabled,
                trigger: {
                    type: 'sensor',
                    did: sensor?.ieee || r.sensorDid,
                    prop: r.condition?.property,
                    operator: r.condition?.operator,
                    value: r.condition?.value ?? null,
                    forMinutes: 0,
                },
                actions: [{ type: 'notify', message: r.message }],
                cooldownMinutes: r.cooldownMinutes,
                createdAt: r.createdAt,
                lastTriggeredAt: r.lastTriggeredAt,
                triggerCount: r.triggerCount,
            }),
        );
    }

    // Par défaut : les ouvertures vers l'extérieur pilotent la clim et préviennent si oubliées
    const outside = registry.filter((s) => s.type === 'door' && /balcon|fen[eê]tre|patio|terrasse|entr[ée]e|ext/i.test(s.name));
    for (const s of outside) {
        automations.push(normalize({ ...TEMPLATES.window_pause_heating.build({ did: s.ieee }), template: 'window_pause_heating' }));
        automations.push(normalize({ ...TEMPLATES.door_left_open.build({ did: s.ieee }), template: 'door_left_open' }));
    }
    automations.push(normalize({ ...TEMPLATES.door_night.build({}), template: 'door_night', enabled: false }));
    automations.push(normalize({ ...TEMPLATES.low_battery.build(), template: 'low_battery' }));
    automations.push(normalize({ ...TEMPLATES.sensor_silent.build(), template: 'sensor_silent' }));
    save();
    console.log(`⚙️  Automatismes initialisés (${legacy.length} règle(s) migrée(s))`);
};

const load = () => {
    try {
        if (existsSync(FILE)) {
            automations = JSON.parse(readFileSync(FILE, 'utf8')).map(normalize);
            ensureSafety();
            return;
        }
    } catch (err) {
        console.error('❌ automations.json illisible:', err.message);
        return; // ne pas écraser un fichier abîmé
    }
    migrate();
    ensureSafety();
};

// Alertes de sécurité présentes d'office, même sur une installation plus ancienne (désactivables)
const ensureSafety = () => {
    // Les anciennes pauses (2 min, sans condition) coupaient la clim à chaque aération
    let upgraded = false;
    for (const a of automations) {
        if (a.template !== 'window_pause_heating' || a.conditions.some((c) => c.type === 'draught')) continue;
        const fresh = TEMPLATES.window_pause_heating.build({ did: a.trigger.did });
        Object.assign(a, { name: fresh.name, trigger: fresh.trigger, conditions: fresh.conditions, actions: fresh.actions });
        upgraded = true;
    }
    // L'alerte fuite d'avant ne faisait que notifier : alarme dans la maison et boutons en plus
    for (const a of automations) {
        if (a.template !== 'water_leak' || a.actions.some((x) => x.type === 'alarm')) continue;
        const fresh = TEMPLATES.water_leak.build({ did: a.trigger.did });
        Object.assign(a, { actions: fresh.actions, onRelease: fresh.onRelease });
        upgraded = true;
    }
    for (const id of ['water_leak', 'leak_sensor_silent']) {
        if (automations.some((a) => a.template === id)) continue;
        automations.push(normalize({ ...TEMPLATES[id].build(), template: id }));
        upgraded = true;
    }
    if (upgraded) save();
};

// --- CRUD (API, agent) ---

export const getAll = () => automations.map((a) => ({ ...a, summary: summarize(a) }));

/** Version compacte pour le contexte des LLM. */
export const getForAgent = () =>
    automations.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled, summary: summarize(a) }));

/** Compatibilité outil « create_notification_rule » (agent, MCP). */
export const addRule = (r) => {
    const sensor = sensorRegistry.find(r.sensorDid);
    const automation = normalize({
        name: r.name || 'Règle sans nom',
        trigger: {
            type: 'sensor',
            did: r.sensorDid,
            sensorType: sensor?.type,
            prop: r.property,
            operator: r.operator,
            value: r.value ?? null,
            forMinutes: r.forMinutes || 0,
        },
        actions: [{ type: 'notify', message: r.message || 'Notification déclenchée' }],
        cooldownMinutes: r.cooldownMinutes ?? 30,
    });
    automations.push(automation);
    save();
    console.log(`⚙️  Automatisme créé: "${automation.name}"`);
    return automation;
};

export const remove = (id) => {
    const i = automations.findIndex((a) => a.id === id);
    if (i < 0) return false;
    automations.splice(i, 1);
    for (const key of runtime.keys()) if (key.startsWith(`${id}|`)) runtime.delete(key);
    save();
    return true;
};

export const toggle = (id) => {
    const a = automations.find((x) => x.id === id);
    if (!a) return null;
    a.enabled = !a.enabled;
    save();
    return { ...a, summary: summarize(a) };
};

export const snooze = (id, minutes) => {
    const a = automations.find((x) => x.id === id);
    if (!a) return null;
    a.snoozedUntil = Date.now() + minutes * 60_000;
    save();
    return a;
};

// --- Évaluation ---

const compare = (value, operator, threshold) => {
    switch (operator) {
        case 'gt': return value > threshold;
        case 'lt': return value < threshold;
        case 'gte': return value >= threshold;
        case 'lte': return value <= threshold;
        case 'eq': return value === threshold;
        case 'neq': return value !== threshold;
        case 'is_true': return value === true;
        case 'is_false': return value === false;
        default: return false;
    }
};

const localMinutes = (d = new Date()) => {
    const [h, m] = d.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).split(':');
    return Number(h) * 60 + Number(m);
};
const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
};

// Soleil couché d'après Home Assistant (sun.sun), en cache 5 min
let darkCache = { at: 0, dark: false };
const isDark = async () => {
    if (Date.now() - darkCache.at < 5 * 60_000) return darkCache.dark;
    try {
        const { getState } = await import('./haService.js');
        darkCache = { at: Date.now(), dark: (await getState('sun.sun')).state === 'below_horizon' };
    } catch {
        // Sans HA : nuit entre 18 h et 7 h
        const m = localMinutes();
        darkCache = { at: Date.now(), dark: m >= 18 * 60 || m < 7 * 60 };
    }
    return darkCache.dark;
};

// Température extérieure Open-Meteo (en cache 15 min) ; null si inconnue
const outsideTemp = async () => {
    try {
        const { getForecast } = await import('./weather.js');
        const temp = (await getForecast()).current?.temperature_2m;
        return typeof temp === 'number' ? temp : null;
    } catch {
        return null;
    }
};

const fmt1 = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Courant d'air depuis l'ouverture ? Renseigne ctx.why pour le message. */
const isDraught = async (c, ctx) => {
    if (!ctx.since) return false;
    const { dropSince } = await import('./companion.js');
    const drop = dropSince(ctx.since);
    if (drop >= c.drop) {
        ctx.why = `la pièce a perdu ${fmt1(drop)}°`;
        return true;
    }
    if (ctx.elapsed < c.orMinutes) return false;
    const outside = await outsideTemp();
    if (outside == null || outside >= c.below) return false;
    ctx.why = `il fait ${fmt1(outside)}° dehors`;
    return true;
};

/** @param {{ since?: number, elapsed?: number, why?: string }} [ctx] ouverture en cours (déclencheur capteur) */
const conditionsMet = async (a, ctx = {}) => {
    if (a.conditions.some((c) => c.type === 'dark') && !(await isDark())) return false;
    const draught = a.conditions.find((c) => c.type === 'draught');
    if (draught && !(await isDraught(draught, ctx))) return false;
    return a.conditions.every((c) => {
        if (c.type === 'time') {
            const now = localMinutes();
            const from = toMinutes(c.from);
            const to = toMinutes(c.to);
            return from <= to ? now >= from && now < to : now >= from || now < to; // plage qui passe minuit
        }
        if (c.type === 'heating') return broadlinkService.getState().power === c.power;
        return true;
    });
};

const sensorValue = (sensor, prop) => {
    if (prop === 'silentHours') {
        const last = sensor.lastUpdated ? Date.parse(sensor.lastUpdated) : STARTED_AT;
        return Math.floor((Date.now() - last) / 3_600_000);
    }
    return sensor.props?.[prop] ?? null;
};

const render = (template, vars) =>
    template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));

/** Alerte prise en charge : plus de rappel ni d'alarme jusqu'à ce que le capteur repasse au repos. */
const acknowledge = async (a, vars, how) => {
    const rt = runtime.get(`${a.id}|${vars.did}`);
    if (rt) rt.acked = true;
    await alarm.clear(vars.did);
    journal.log({ kind: 'automation', title: `${vars.sensor} : ${how}`, data: { automationId: a.id, did: vars.did } });
    return `Alerte « ${vars.sensor} » : ${how}. Plus de rappel, les lampes reprennent leur état.`;
};

// Boutons Telegram disponibles pour une notification
const BUTTONS = {
    heating_off: () => ({
        label: '❄️ Couper la clim',
        run: async () => {
            await broadlinkService.applyPatch({ power: false }, 'Telegram');
            return 'Thermopompe arrêtée.';
        },
    }),
    heating_resume: () => ({
        label: '▶️ Relancer la clim',
        run: async () => {
            const state = pausedHeating || { power: true };
            pausedHeating = null;
            const result = await broadlinkService.applyPatch({ ...state, power: true }, 'Telegram');
            return `Thermopompe relancée (${broadlinkService.describeState(result)}).`;
        },
    }),
    leak_fixed: (a, vars) => ({
        label: '✅ C’est réglé',
        run: async () => acknowledge(a, vars, 'réglée'),
    }),
    leak_false: (a, vars) => ({
        label: '🙅 Fausse alerte',
        run: async () => acknowledge(a, vars, 'fausse alerte'),
    }),
    snooze_1h: (a) => ({
        label: '🔕 Ignorer 1 h',
        run: async () => {
            snooze(a.id, 60);
            return `« ${a.name} » en sourdine pendant 1 h.`;
        },
    }),
};

const runActions = async (a, actions, vars) => {
    for (const action of actions) {
        try {
            switch (action.type) {
                case 'notify': {
                    const text = render(action.message, vars);
                    journal.log({ kind: 'automation', title: text, data: { automationId: a.id, did: vars.did, level: action.level || 'info' } });
                    await notifier.notify({
                        text,
                        buttons: (action.buttons || []).map((b) => BUTTONS[b]?.(a, vars)).filter(Boolean),
                    });
                    break;
                }
                case 'heating_pause': {
                    const state = broadlinkService.getState();
                    if (!state.power) break;
                    pausedHeating = state;
                    await broadlinkService.applyPatch({ power: false }, `automatisme « ${a.name} »`);
                    break;
                }
                case 'heating_resume': {
                    // Seulement si c'est nous qui avons coupé et que personne ne l'a rallumée depuis
                    if (!pausedHeating || broadlinkService.getState().power) {
                        pausedHeating = null;
                        break;
                    }
                    const state = pausedHeating;
                    pausedHeating = null;
                    await broadlinkService.applyPatch({ ...state, power: true }, `automatisme « ${a.name} »`);
                    journal.log({ kind: 'automation', title: `${vars.sensor} refermée : thermopompe relancée.`, data: { automationId: a.id } });
                    break;
                }
                case 'alarm':
                    await alarm.raise(vars.did, action.speech && render(action.speech, vars));
                    break;
                case 'alarm_clear':
                    await alarm.clear(vars.did);
                    break;
                case 'moment': {
                    const moments = await import('./moments.js');
                    await moments.run(action.id);
                    break;
                }
                case 'home': {
                    const { executeActions } = await import('./actions.js');
                    await executeActions([action.action], `automatisme « ${a.name} »`);
                    break;
                }
            }
        } catch (err) {
            console.error(`❌ Automatisme "${a.name}", action ${action.type}:`, err.message);
        }
    }
};

const matches = (trigger, sensor) =>
    trigger.did === '*' ? !trigger.sensorType || sensor.type === trigger.sensorType : sensor.did === trigger.did;

// Un événement qui arrive pendant une évaluation en relance une juste après
let evaluating = false;
let rerun = false;
const evaluate = async () => {
    if (!getSensorsFn) return;
    if (evaluating) {
        rerun = true;
        return;
    }
    evaluating = true;
    try {
        const sensors = await getSensorsFn();
        const now = Date.now();
        for (const a of automations) {
            if (!a.enabled || a.trigger.type !== 'sensor') continue;
            for (const sensor of sensors.filter((s) => matches(a.trigger, s))) {
                const value = sensorValue(sensor, a.trigger.prop);
                if (value === null) continue; // inconnu : on garde l'état précédent
                const key = `${a.id}|${sensor.did}`;
                const rt = runtime.get(key) || { since: null, fired: false, lastFiredAt: 0 };
                runtime.set(key, rt);
                const vars = { sensor: sensor.name, did: sensor.did, value };

                if (!compare(value, a.trigger.operator, a.trigger.value)) {
                    if (rt.fired && a.onRelease.length) await runActions(a, a.onRelease, vars);
                    rt.since = null;
                    rt.fired = false;
                    rt.acked = false;
                    continue;
                }

                rt.since ??= now;
                const elapsed = (now - rt.since) / 60_000;
                if (elapsed < a.trigger.forMinutes) continue;
                const repeatDue = rt.fired && !rt.acked && a.repeatMinutes && now - rt.lastFiredAt >= a.repeatMinutes * 60_000;
                if (rt.fired && !repeatDue) continue;
                if (!rt.fired && a.lastTriggeredAt && now - Date.parse(a.lastTriggeredAt) < a.cooldownMinutes * 60_000) continue;
                if (a.snoozedUntil && now < a.snoozedUntil) continue;
                const ctx = { since: rt.since, elapsed };
                if (!(await conditionsMet(a, ctx))) continue;

                console.log(`⚙️  Automatisme déclenché: "${a.name}" (${sensor.name})`);
                rt.fired = true;
                rt.lastFiredAt = now;
                a.lastTriggeredAt = new Date(now).toISOString();
                a.triggerCount++;
                save();
                await runActions(a, a.actions, { ...vars, elapsed: Math.round(elapsed), why: ctx.why });
            }
        }
    } catch (err) {
        console.error('❌ Automatismes:', err.message);
    } finally {
        evaluating = false;
        if (rerun) {
            rerun = false;
            evaluate();
        }
    }
};

// Départs et retours (presence.js) : déclencheurs ponctuels, sans durée
const onPresence = async ({ home, anyoneHome }) => {
    const state = home ? 'home' : anyoneHome === false ? 'away' : null;
    if (!state) return; // quelqu'un part mais d'autres restent
    const now = Date.now();
    for (const a of automations) {
        if (!a.enabled || a.trigger.type !== 'presence' || a.trigger.state !== state) continue;
        if (a.lastTriggeredAt && now - Date.parse(a.lastTriggeredAt) < a.cooldownMinutes * 60_000) continue;
        if (a.snoozedUntil && now < a.snoozedUntil) continue;
        if (!(await conditionsMet(a))) continue;
        console.log(`⚙️  Automatisme déclenché: "${a.name}" (présence)`);
        a.lastTriggeredAt = new Date(now).toISOString();
        a.triggerCount++;
        save();
        await runActions(a, a.actions, {});
    }
};

export const start = (getSensors) => {
    getSensorsFn = getSensors;
    load();
    bus.on('sensor', () => evaluate());
    bus.on('presence', onPresence);
    setInterval(evaluate, TICK_MS);
    setTimeout(evaluate, 5000);
    console.log(`⚙️  Automatismes: ${automations.filter((a) => a.enabled).length} actif(s) sur ${automations.length}`);
};
