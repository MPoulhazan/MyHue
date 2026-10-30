/**
 * Compagnon de la maison : remarque ce qui sort de l'ordinaire et prévient, sans spammer.
 *
 * 1. Détecteurs déterministes sur les mesures récentes (aucune IA) → constats chiffrés.
 * 2. Décision : niveau (journal / info / alerte), anti-répétition, heures calmes, regroupement.
 * 3. Rédaction : Groq reformule le constat en français naturel (repli sur le texte brut).
 *
 * Chaque message porte 👍 / 🔕 : un « pas utile » rend le détecteur moins sensible
 * et plus espacé, un « utile » le ramène vers son réglage d'origine (data/companion.json).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';
import * as broadlinkService from './broadlinkService.js';
import { bus } from './events.js';
import { rewrite } from './llm.js';
import { getSensorHistory, getOutdoorWeather } from './sensors.js';

const FILE = dataFile('companion.json');
const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 2 * 60_000;
const BUFFER_MS = 24 * 3600_000;
const QUIET = { from: 22 * 60 + 30, to: 7 * 60 }; // 22 h 30 → 7 h : seules les alertes partent
const GROUP_WINDOW_MS = 90_000; // constats rapprochés = un seul message

let getSensorsFn = null;

// --- Réglages appris (sensibilité par détecteur) ---

let prefs = { detectors: {} }; // { [detector]: { factor, useful, notUseful } }
try {
    if (existsSync(FILE)) prefs = JSON.parse(readFileSync(FILE, 'utf8'));
} catch { /* fichier abîmé : réglages par défaut */ }
const savePrefs = () => {
    try {
        writeFileSync(FILE, JSON.stringify(prefs, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du compagnon impossible:', err.message);
    }
};
const factor = (detector) => prefs.detectors[detector]?.factor ?? 1;

export const feedback = (detector, useful) => {
    const p = (prefs.detectors[detector] ??= { factor: 1, useful: 0, notUseful: 0 });
    if (useful) {
        p.useful++;
        p.factor = Math.max(1, p.factor * 0.9);
    } else {
        p.notUseful++;
        p.factor = Math.min(4, p.factor * 1.4);
    }
    savePrefs();
    return p;
};

// --- Mesures récentes par capteur : { [did]: [{ ts, temperature, humidity, pressure }] } ---

const buffers = new Map();
const pushSample = (did, sample) => {
    const buf = buffers.get(did) || [];
    buf.push(sample);
    const limit = Date.now() - BUFFER_MS;
    while (buf.length && buf[0].ts < limit) buf.shift();
    buffers.set(did, buf);
};

/** Valeur la plus proche de « il y a `ms` » (au plus tard à ce moment). */
const valueAgo = (did, prop, ms) => {
    const target = Date.now() - ms;
    const buf = buffers.get(did) || [];
    let found = null;
    for (const s of buf) {
        if (s.ts > target) break;
        if (s[prop] != null) found = s;
    }
    return found?.[prop] ?? null;
};
const extremeSince = (did, prop, ms, pick) => {
    const since = Date.now() - ms;
    const values = (buffers.get(did) || []).filter((s) => s.ts >= since && s[prop] != null).map((s) => s[prop]);
    return values.length ? pick(...values) : null;
};

/** Plus forte baisse de température d'une pièce depuis `ts` (porte ouverte → courant d'air). */
export const dropSince = (ts) => {
    let worst = 0;
    for (const [did, buf] of buffers) {
        const temps = buf.filter((s) => s.temperature != null);
        if (!temps.length) continue;
        const ms = Date.now() - ts;
        const peak = Math.max(...[valueAgo(did, 'temperature', ms), extremeSince(did, 'temperature', ms, Math.max)].filter((v) => v != null));
        worst = Math.max(worst, peak - temps[temps.length - 1].temperature);
    }
    return round1(worst);
};

// --- Contexte commun aux détecteurs ---

const localMinutes = () => {
    const [h, m] = new Date().toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).split(':');
    return Number(h) * 60 + Number(m);
};
const isQuiet = () => {
    const now = localMinutes();
    return now >= QUIET.from || now < QUIET.to;
};

const round1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => String(round1(n)).replace('.', ',');

/** Minutes depuis la dernière ouverture encore en cours de chaque porte. */
const openDoors = (sensors) =>
    sensors
        .filter((s) => s.type === 'door' && s.props.isOpen)
        .map((s) => {
            const opened = journal.list({ limit: 200, kind: 'door' }).find((e) => e.data?.did === s.did && e.data?.isOpen);
            return { name: s.name, minutes: opened ? Math.round((Date.now() - opened.ts) / 60_000) : null };
        });

// --- Détecteurs : (ctx) => constats [{ key, detector, level, text, facts, buttons? }] ---

const DETECTORS = {
    // Chute rapide de température : porte ouverte (cause connue) ou inexpliquée
    temp_drop(ctx) {
        const out = [];
        for (const s of ctx.climate) {
            const now = s.props.temperature;
            const peak = extremeSince(s.did, 'temperature', 30 * 60_000, Math.max);
            if (now == null || peak == null) continue;
            const drop = peak - now;
            if (drop < 1.5 * factor('temp_drop')) continue;
            const doors = ctx.openDoors;
            const cause = doors.length ? `${doors.map((d) => d.name).join(', ')} ouverte` : null;
            out.push({
                key: `temp_drop:${s.did}`,
                detector: 'temp_drop',
                // Porte ouverte et clim déjà gérée par l'automatisme : simple trace
                level: cause ? 'journal' : 'alert',
                text: cause
                    ? `${s.name} : −${fmt(drop)}° en 30 min (${cause}).`
                    : `🥶 ${s.name} a perdu ${fmt(drop)}° en 30 min (${fmt(now)}° maintenant) sans porte ouverte. Fenêtre ouverte ailleurs ou souci de chauffage ?`,
                facts: { piece: s.name, baisse: round1(drop), temperature: round1(now), minutes: 30, porte_ouverte: cause, exterieur: ctx.outdoor?.temperature ?? null },
            });
        }
        return out;
    },

    // La clim tourne mais la température ne suit pas : commande IR perdue ou panne
    heating_ineffective(ctx) {
        const h = ctx.heating;
        if (!h.power || !h.lastUpdated || !['heat', 'cool'].includes(h.mode)) return [];
        const runningMin = (Date.now() - Date.parse(h.lastUpdated)) / 60_000;
        const window = 45 * factor('heating_ineffective');
        if (runningMin < window || ctx.openDoors.length) return [];
        const out = [];
        for (const s of ctx.climate) {
            const now = s.props.temperature;
            const before = valueAgo(s.did, 'temperature', window * 60_000);
            if (now == null || before == null) continue;
            const gap = h.mode === 'heat' ? h.temperature - now : now - h.temperature;
            const progress = h.mode === 'heat' ? now - before : before - now;
            if (gap < 1 || progress > 0.3) continue;
            // La pièce part dans le mauvais sens : plus probablement éteinte à la télécommande
            const wrongWay = progress <= -0.3;
            out.push({
                key: `heating_ineffective:${s.did}`,
                detector: 'heating_ineffective',
                level: 'alert',
                text: wrongWay
                    ? `🤔 La thermopompe devrait ${h.mode === 'heat' ? 'chauffer' : 'refroidir'} à ${h.temperature}°, mais ${s.name} est passé de ${fmt(before)}° à ${fmt(now)}° en ${Math.round(window)} min. Éteinte à la télécommande ? Je ne lui envoie plus rien en attendant.`
                    : `🤔 La thermopompe est en ${h.mode === 'heat' ? 'chauffage' : 'clim'} à ${h.temperature}° depuis ${Math.round(runningMin)} min, mais ${s.name} reste à ${fmt(now)}°. Commande infrarouge passée à côté, ou éteinte à la télécommande ?`,
                facts: { mode: h.mode, consigne: h.temperature, depuis_min: Math.round(runningMin), piece: s.name, temperature: round1(now), il_y_a: round1(before) },
                buttons: ['mark_off', 'resend'],
            });
        }
        return out;
    },

    // Grand froid dehors et porte ouverte : prévenir plus tôt que l'automatisme « porte oubliée »
    cold_door(ctx) {
        const out = [];
        const outside = ctx.outdoor?.temperature;
        if (outside == null || outside > -5 + (factor('cold_door') - 1) * -5) return out;
        for (const d of ctx.openDoors) {
            if (d.minutes == null || d.minutes < 4 || d.minutes >= 10) continue;
            out.push({
                key: `cold_door:${d.name}`,
                detector: 'cold_door',
                level: 'alert',
                text: `🧊 Il fait ${fmt(outside)}° dehors et ${d.name} est ouverte depuis ${d.minutes} min.`,
                facts: { porte: d.name, minutes: d.minutes, exterieur: outside },
            });
        }
        return out;
    },

    // Risque de gel ou de surchauffe à l'intérieur
    indoor_extreme(ctx) {
        const out = [];
        for (const s of ctx.climate) {
            const t = s.props.temperature;
            if (t == null) continue;
            if (t < 14) {
                out.push({
                    key: `indoor_cold:${s.did}`,
                    detector: 'indoor_extreme',
                    level: 'alert',
                    text: `🥶 Seulement ${fmt(t)}° dans ${s.name}. Panne de chauffage ou coupure de courant ?`,
                    facts: { piece: s.name, temperature: t, clim: broadlinkService.describeState(ctx.heating), exterieur: ctx.outdoor?.temperature ?? null },
                });
            } else if (t > 28 && ctx.heating.power && ctx.heating.mode === 'heat') {
                out.push({
                    key: `indoor_hot:${s.did}`,
                    detector: 'indoor_extreme',
                    level: 'info',
                    text: `🔥 ${fmt(t)}° dans ${s.name} alors que la thermopompe chauffe encore. Baisser la consigne ?`,
                    facts: { piece: s.name, temperature: t, consigne: ctx.heating.temperature },
                    buttons: ['heating_off'],
                });
            }
        }
        return out;
    },

    // Humidité durablement trop haute (moisissure) ou trop basse (air sec l'hiver)
    humidity(ctx) {
        const out = [];
        const f = factor('humidity');
        for (const s of ctx.climate) {
            const min2h = extremeSince(s.did, 'humidity', 2 * 3600_000, Math.min);
            const max6h = extremeSince(s.did, 'humidity', 6 * 3600_000, Math.max);
            const covered = (buffers.get(s.did) || [])[0]?.ts < Date.now() - 2 * 3600_000;
            if (!covered) continue;
            if (min2h != null && min2h > 65 + (f - 1) * 5) {
                out.push({
                    key: `humid_high:${s.did}`,
                    detector: 'humidity',
                    level: 'info',
                    text: `💧 L'humidité de ${s.name} reste au-dessus de ${Math.round(min2h)} % depuis 2 h : aérer quelques minutes éviterait la moisissure.`,
                    facts: { piece: s.name, humidite_min_2h: Math.round(min2h), exterieur: ctx.outdoor?.temperature ?? null },
                });
            } else if (max6h != null && max6h < 25 - (f - 1) * 3 && (buffers.get(s.did) || [])[0]?.ts < Date.now() - 6 * 3600_000) {
                out.push({
                    key: `humid_low:${s.did}`,
                    detector: 'humidity',
                    level: 'info',
                    text: `🏜️ Air très sec dans ${s.name} : pas plus de ${Math.round(max6h)} % d'humidité depuis 6 h.`,
                    facts: { piece: s.name, humidite_max_6h: Math.round(max6h) },
                });
            }
        }
        return out;
    },

    // Chute de pression atmosphérique : perturbation en approche
    pressure_drop(ctx) {
        const out = [];
        for (const s of ctx.climate) {
            const now = s.props.pressure;
            const before = valueAgo(s.did, 'pressure', 3 * 3600_000);
            if (now == null || before == null) continue;
            const drop = before - now;
            if (drop < 4 * factor('pressure_drop')) continue;
            out.push({
                key: 'pressure_drop',
                detector: 'pressure_drop',
                level: 'info',
                text: `🌧️ La pression a chuté de ${fmt(drop)} hPa en 3 h : du mauvais temps arrive probablement.`,
                facts: { baisse_hpa: round1(drop), pression: now },
            });
        }
        return out.slice(0, 1);
    },
};

// Délai minimal avant de répéter un même constat (multiplié par la sensibilité apprise)
const COOLDOWN_H = {
    temp_drop: 3,
    heating_ineffective: 2,
    cold_door: 1,
    indoor_extreme: 6,
    humidity: 24,
    pressure_drop: 12,
};
const lastSent = new Map(); // key -> ts

// --- Envoi : regroupement, heures calmes, boutons ---

let outbox = []; // constats en attente d'envoi groupé
let flushTimer = null;
let nightQueue = []; // infos de la nuit, envoyées au réveil

const buttonsFor = (finding) => {
    const extra = {
        resend: {
            label: '🔁 Renvoyer la commande',
            run: async () => {
                const state = broadlinkService.getState();
                await broadlinkService.applyPatch(state, 'compagnon');
                return 'Commande renvoyée à la thermopompe.';
            },
        },
        mark_off: {
            label: '📴 Oui, elle est éteinte',
            run: async () => {
                broadlinkService.markState({ power: false }, 'Telegram');
                return 'Noté : thermopompe éteinte, rien ne lui a été envoyé.';
            },
        },
        heating_off: {
            label: '❄️ Couper la clim',
            run: async () => {
                await broadlinkService.applyPatch({ power: false }, 'compagnon');
                return 'Thermopompe arrêtée.';
            },
        },
    };
    return [
        ...(finding.buttons || []).map((b) => extra[b]).filter(Boolean),
        { label: '👍', run: async () => (feedback(finding.detector, true), 'Merci, je garde ce réglage.') },
        { label: '🔕 Pas utile', run: async () => (feedback(finding.detector, false), 'Compris, je serai moins bavard là-dessus.') },
    ];
};

const flush = async () => {
    flushTimer = null;
    const batch = outbox;
    outbox = [];
    if (!batch.length) return;
    const alert = batch.some((f) => f.level === 'alert');

    if (batch.length === 1) {
        const f = batch[0];
        const text = await rewrite(f.facts, f.text);
        journal.log({ kind: 'companion', title: text, data: { detector: f.detector, level: f.level } });
        await notifier.notify({ text, buttons: buttonsFor(f), silent: !alert });
        return;
    }
    // Plusieurs constats en même temps : un seul message, sans reformulation
    const text = batch.map((f) => f.text).join('\n\n');
    for (const f of batch) journal.log({ kind: 'companion', title: f.text, data: { detector: f.detector, level: f.level } });
    await notifier.notify({ text, silent: !alert });
};

const dispatch = (finding) => {
    const now = Date.now();
    const cooldown = (COOLDOWN_H[finding.detector] ?? 6) * 3600_000 * factor(finding.detector);
    if (now - (lastSent.get(finding.key) || 0) < cooldown) return;
    lastSent.set(finding.key, now);

    if (finding.level === 'journal') {
        journal.log({ kind: 'companion', title: finding.text, data: { detector: finding.detector, level: 'journal' } });
        return;
    }
    if (finding.level === 'info' && isQuiet()) {
        nightQueue.push(finding);
        return;
    }
    outbox.push(finding);
    flushTimer ??= setTimeout(flush, finding.level === 'alert' ? 5_000 : GROUP_WINDOW_MS);
};

const flushNight = async () => {
    if (isQuiet() || !nightQueue.length) return;
    const batch = nightQueue;
    nightQueue = [];
    const text = `☀️ Pendant la nuit :\n\n${batch.map((f) => f.text).join('\n\n')}`;
    for (const f of batch) journal.log({ kind: 'companion', title: f.text, data: { detector: f.detector, level: f.level } });
    await notifier.notify({ text, silent: true });
};

// --- Boucle ---

const run = async () => {
    if (!getSensorsFn) return;
    try {
        const sensors = await getSensorsFn();
        const ctx = {
            sensors,
            climate: sensors.filter((s) => s.props.temperature != null),
            openDoors: openDoors(sensors),
            heating: broadlinkService.getState(),
            outdoor: await getOutdoorWeather(),
        };
        for (const detect of Object.values(DETECTORS)) {
            for (const finding of detect(ctx)) {
                if (finding.detector === 'heating_ineffective') broadlinkService.markUncertain('la pièce ne suit pas la consigne');
                dispatch(finding);
            }
        }
        // Doute levé tout seul si la pièce se remet à chauffer
        if (broadlinkService.isUncertain() && ctx.heating.power && ctx.heating.mode === 'heat') {
            const warming = ctx.climate.some((s) => {
                const low = extremeSince(s.did, 'temperature', 45 * 60_000, Math.min);
                return low != null && s.props.temperature - low >= 0.5;
            });
            if (warming) {
                broadlinkService.clearUncertain();
                journal.log({ kind: 'heating', title: 'Thermopompe : la pièce se réchauffe, elle tourne bien', data: {} });
            }
        }
        await flushNight();
    } catch (err) {
        console.error('❌ Compagnon:', err.message);
    }
};

/** Constats actuels sans rien envoyer (diagnostic, page de réglages). */
export const inspect = async () => {
    const sensors = await getSensorsFn();
    const ctx = {
        sensors,
        climate: sensors.filter((s) => s.props.temperature != null),
        openDoors: openDoors(sensors),
        heating: broadlinkService.getState(),
        outdoor: await getOutdoorWeather(),
    };
    return {
        findings: Object.values(DETECTORS).flatMap((d) => d(ctx)),
        prefs,
        buffered: Object.fromEntries([...buffers].map(([did, b]) => [did, b.length])),
    };
};

export const start = (getSensors) => {
    getSensorsFn = getSensors;

    bus.on('sensor', ({ sensor, prop, value, ts }) => {
        if (!['temperature', 'humidity', 'pressure'].includes(prop)) return;
        pushSample(sensor.did, { ts, [prop]: value });
    });

    // Historique des dernières 24 h pour juger les tendances dès le démarrage
    setTimeout(async () => {
        const sensors = await getSensors();
        for (const s of sensors.filter((x) => x.type === 'temperature_humidity')) {
            const { points } = await getSensorHistory(s.did, 24);
            for (const p of points) pushSample(s.did, p);
        }
        console.log(`🧠 Compagnon prêt (${buffers.size} capteur(s) suivis)`);
        run();
        setInterval(run, TICK_MS);
    }, 20_000);
};
