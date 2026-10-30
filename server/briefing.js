/**
 * Briefing du matin, dit sur une enceinte Cast par la synthèse vocale de Home Assistant.
 * Météo, tenue pour l'aller et le retour, tempête à venir, pointe Flex D du jour.
 *
 * Heure : celle de la prochaine alarme du téléphone (capteur *_next_alarm de HA Companion)
 * + quelques minutes quand il existe, sinon une heure fixe les jours choisis.
 * Rien si personne n'est à la maison.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as haService from './haService.js';
import * as journal from './journal.js';
import * as presence from './presence.js';
import * as flexd from './flexd.js';
import { getWeatherDetails } from './weather.js';

const FILE = dataFile('briefing.json');
const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 60_000;
// Au-delà, un briefing manqué (serveur arrêté) n'est plus joué
const LATE_LIMIT_MIN = 30;

const DEFAULTS = {
    enabled: true,
    time: '07:00',
    days: [1, 2, 3, 4, 5], // 0 = dimanche
    useAlarm: true, // suit l'alarme du téléphone si HA Companion la fournit
    alarmDelayMin: 5,
    speaker: 'media_player.salon',
    volume: null, // 0-100, null = ne pas toucher
    lastPlayedDay: null,
};

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ briefing.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du briefing impossible:', err.message);
    }
};

// --- Heures locales ---

const localParts = (ts = Date.now()) => {
    const f = new Intl.DateTimeFormat('fr-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    const weekday = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay();
    return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday };
};
const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};
const sayHour = (ts) => {
    const [h, m] = new Date(ts).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).split(':');
    return `${Number(h)} heures${m !== '00' ? ` ${Number(m)}` : ''}`;
};

// --- Texte (testé dans briefing.test.js) ---

const join = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const things = (items) => join(items.map(lower));
// « moins 2 » plutôt que « -2 », que la synthèse vocale lit mal
const deg = (n) => (Math.round(n) < 0 ? `moins ${-Math.round(n)}` : String(Math.round(n)));

/**
 * Compose le briefing à partir de /api/weather/details et de l'état Flex D.
 * @param {object} w   getWeatherDetails()
 * @param {object} [flex]  flexd.getStatus()
 * @param {string} today  jour local AAAA-MM-JJ (pour la pointe du jour)
 */
export const composeBriefing = (w, flex, today, dayOf = (ts) => localParts(ts).day) => {
    const parts = [];
    const c = w.current;
    parts.push(`Bonjour ! Il fait ${deg(c.temp)} degrés dehors, ressenti ${deg(c.feels)}.`);

    const out = w.outfits.find((o) => o.day === 'today' && o.moment === 'out');
    const back = w.outfits.find((o) => o.day === 'today' && o.moment === 'back');
    if (out && !out.past) {
        parts.push(`Pour sortir à ${out.hour} heures : ${things(out.items)}.`);
    }
    if (back) {
        const rain = back.rainProb >= 50 ? `, pluie probable à ${back.rainProb} pour cent` : '';
        const changed = !out || out.past || out.items.join() !== back.items.join();
        parts.push(`Au retour, vers ${back.hour} heures, ressenti ${deg(back.feels)} degrés${rain}${changed ? ` : ${things(back.items)}` : ''}.`);
        if (back.tip && back.gust >= 50) parts.push(back.tip);
    }

    const s = w.storm;
    if (s && (s.level === 'likely' || s.level === 'storm')) {
        const when = s.window ? `${dayOf(s.window.from) === today ? "aujourd'hui" : 'demain'} de ${sayHour(s.window.from)} à ${sayHour(s.window.to)}` : 'dans les 48 heures';
        parts.push(`Attention, tempête probable ${when}, avec des rafales jusqu'à ${s.maxGust} kilomètres heure.`);
    } else if (s && s.level === 'watch') {
        parts.push(`Le temps se dégrade, rafales jusqu'à ${s.maxGust} kilomètres heure.`);
    }

    const peaks = (flex?.enabled ? flex.upcoming : []).filter((e) => !e.skipped && dayOf(e.start) === today);
    for (const e of peaks) {
        parts.push(`Pointe Flex D aujourd'hui de ${sayHour(e.start)} à ${sayHour(e.end)} : évite la sécheuse, le lave-vaisselle et le four.`);
    }

    parts.push('Bonne journée !');
    return parts.join(' ');
};

// --- Home Assistant : enceintes, alarme, synthèse vocale ---

const ttsEngine = async () => {
    if (process.env.BRIEFING_TTS) return process.env.BRIEFING_TTS;
    const engines = await haService.getStates('tts');
    if (!engines.length) throw new Error('Aucun moteur de synthèse vocale dans Home Assistant');
    return engines[0].entity_id;
};

/** Enceintes connues de HA. */
export const getSpeakers = async () => {
    const players = await haService.getStates('media_player');
    return players.map((p) => ({ id: p.entity_id, name: p.attributes.friendly_name || p.entity_id, available: p.state !== 'unavailable' }));
};

/** Prochaine alarme du téléphone (HA Companion : sensor.*_next_alarm), en ms epoch. */
const nextAlarm = async () => {
    try {
        const sensors = await haService.getStates('sensor');
        const alarm = sensors.find((s) => s.entity_id.endsWith('_next_alarm') && !['unknown', 'unavailable', ''].includes(s.state));
        const ts = alarm ? Date.parse(alarm.state) : NaN;
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
};

const speak = async (message) => {
    const engine = await ttsEngine();
    if (config.volume != null) {
        await haService.callService('media_player', 'volume_set', { entity_id: config.speaker, volume_level: config.volume / 100 });
    }
    await haService.callService('tts', 'speak', {
        entity_id: engine,
        media_player_entity_id: config.speaker,
        message,
        language: 'fr',
        cache: false,
    });
};

/**
 * Annonce sur plusieurs enceintes (alarme) : volume monté le temps du message, puis remis.
 * @param {string[]} speakers entités media_player
 */
export const announce = async (speakers, message, { volume = 0.7, holdMs = 20_000 } = {}) => {
    const engine = await ttsEngine();
    const players = (await haService.getStates('media_player')).filter((p) => speakers.includes(p.entity_id));
    for (const p of players) {
        await haService.callService('media_player', 'volume_set', { entity_id: p.entity_id, volume_level: volume }).catch(() => {});
    }
    await haService.callService('tts', 'speak', {
        entity_id: engine,
        media_player_entity_id: speakers,
        message,
        language: 'fr',
        cache: false,
    });
    setTimeout(() => {
        for (const p of players) {
            if (p.attributes.volume_level == null) continue;
            haService.callService('media_player', 'volume_set', { entity_id: p.entity_id, volume_level: p.attributes.volume_level }).catch(() => {});
        }
    }, holdMs);
};

export const preview = async () => composeBriefing(await getWeatherDetails(), flexd.getStatus(), localParts().day);

/** Dit le briefing tout de suite. */
export const play = async (source = 'interface') => {
    const text = await preview();
    await speak(text);
    journal.log({ kind: 'system', title: `Briefing du matin dit sur ${config.speaker.replace('media_player.', '')}`, data: { source } });
    return { text, speaker: config.speaker };
};

// --- Planification ---

/** Heure du briefing aujourd'hui, en minutes locales, ou null si pas aujourd'hui. */
const plannedMinutes = async (now) => {
    const local = localParts(now);
    if (config.useAlarm) {
        const alarm = await nextAlarm();
        // L'alarme de ce matin : le capteur pointe déjà vers la prochaine, donc on retient la dernière vue
        if (alarm && localParts(alarm).day === local.day) lastAlarmSeen = { day: local.day, minutes: localParts(alarm).minutes };
        if (lastAlarmSeen?.day === local.day) return lastAlarmSeen.minutes + config.alarmDelayMin;
        if (alarm) return null; // une alarme existe, mais pas aujourd'hui : pas de briefing
    }
    return config.days.includes(local.weekday) ? toMin(config.time) : null;
};
let lastAlarmSeen = null;

const tick = async () => {
    if (!config.enabled || !haService.isConfigured()) return;
    const now = Date.now();
    const local = localParts(now);
    if (config.lastPlayedDay === local.day) return;
    const at = await plannedMinutes(now);
    if (at == null || local.minutes < at || local.minutes > at + LATE_LIMIT_MIN) return;
    if (presence.anyoneHome() === false) return;
    config.lastPlayedDay = local.day;
    save();
    try {
        await play('planifié');
    } catch (err) {
        console.error('❌ Briefing du matin:', err.message);
        journal.log({ kind: 'system', title: `Briefing du matin impossible : ${err.message}`, data: {} });
    }
};

let ticking = false;
const safeTick = async () => {
    if (ticking) return;
    ticking = true;
    try {
        await tick();
    } finally {
        ticking = false;
    }
};

// --- API ---

export const getStatus = () => ({
    enabled: config.enabled,
    time: config.time,
    days: config.days,
    useAlarm: config.useAlarm,
    alarmDelayMin: config.alarmDelayMin,
    speaker: config.speaker,
    volume: config.volume,
    lastPlayedDay: config.lastPlayedDay,
});

export const update = (patch = {}) => {
    if (patch.enabled !== undefined) config.enabled = Boolean(patch.enabled);
    if (patch.time !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.time)) throw new Error('Heure invalide (HH:MM)');
        config.time = patch.time;
    }
    if (patch.days !== undefined) {
        if (!Array.isArray(patch.days) || patch.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Jours invalides');
        config.days = [...new Set(patch.days)].sort();
    }
    if (patch.useAlarm !== undefined) config.useAlarm = Boolean(patch.useAlarm);
    if (patch.speaker !== undefined) {
        if (!/^media_player\.[a-z0-9_]+$/.test(patch.speaker)) throw new Error('Enceinte invalide');
        config.speaker = patch.speaker;
    }
    if (patch.volume !== undefined) {
        const v = patch.volume === null ? null : Number(patch.volume);
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) throw new Error('Volume invalide');
        config.volume = v;
    }
    save();
    return getStatus();
};

export const start = () => {
    setInterval(safeTick, TICK_MS);
    console.log(`☀️  Briefing du matin ${config.enabled ? `actif (${config.time}, ${config.speaker})` : 'désactivé'}`);
};
