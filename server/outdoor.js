/**
 * Sonde du balcon :
 * - température extérieure réelle pour les règles, l'écran météo et l'agent (repli : Open-Meteo) ;
 * - aérer gratuitement : « ouvre la porte terrasse » quand dehors est plus frais, « ferme » quand ça s'inverse ;
 * - gel / verglas dans le briefing du matin ;
 * - records : nuit la plus froide de l'hiver, journée la plus chaude de l'année, premiers seuils.
 * Journées min/max dans data/outdoor-records.json. Logique pure : outdoorLogic.js.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as notifier from './notifier.js';
import * as journal from './journal.js';
import * as presence from './presence.js';
import * as broadlinkService from './broadlinkService.js';
import * as briefing from './briefing.js';
import { bus } from './events.js';
import { getForecast, buildRainSoon } from './weather.js';
import { getSensors, getSensorHistory } from './sensors.js';
import { roleOf, indoorClimate, outdoorSensor } from './sensorRoles.js';
import {
    localOutdoor, coolingAdvice, coolingText, frostLine, addSample, prune, coldNews, heatNews, summary, recordsSpeech, emptyRecords, round1,
} from './outdoorLogic.js';

const FILE = dataFile('outdoor-records.json');
const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 60_000;
const COLD_AT = 8 * 60 + 20; // avant le briefing de 8 h 30
const HEAT_AT = 19 * 60;
const COOL_FROM = 7 * 60;
const COOL_TO = 22 * 60 + 30;
const COOL_COOLDOWN_MS = 6 * 3600_000;

let records = { ...emptyRecords(), announced: { cold: null, heat: null }, morning: { day: null, lines: [] }, cooling: { open: 0, close: 0 } };
try {
    if (existsSync(FILE)) records = { ...records, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ outdoor-records.json illisible, on repart de zéro:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(records), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde des records du balcon impossible:', err.message);
    }
};

const dayKey = (ts = Date.now()) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });
const localMinutes = (ts = Date.now()) => {
    const [h, m] = new Date(ts).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
    return Number(h) * 60 + Number(m);
};

// --- Température du moment ---

const forecastTemp = async () => {
    try {
        const t = (await getForecast()).current?.temperature_2m;
        return typeof t === 'number' ? t : null;
    } catch {
        return null;
    }
};

/** Mesure du balcon fiable (fraîche, proche de la météo), ou null. */
export const getLocal = async () => localOutdoor(await getSensors(), await forecastTemp());

/** Température dehors : balcon d'abord, sinon météo. */
export const currentOutdoorTemp = async () => {
    const forecast = await forecastTemp();
    return localOutdoor(await getSensors(), forecast)?.temperature ?? forecast;
};

// --- Mesures des dernières 24 h (gel de la nuit) ---

let samples = []; // [{ ts, t, h }]
const keep = () => {
    const limit = Date.now() - 24 * 3600_000;
    samples = samples.filter((s) => s.ts >= limit);
};

let lastForecast = { at: 0, t: null };
const onSample = async (t, h, ts) => {
    // Contrôle de vraisemblance avec la météo (sonde au soleil, rentrée à l'intérieur…)
    if (Date.now() - lastForecast.at > 15 * 60_000) lastForecast = { at: Date.now(), t: await forecastTemp() };
    if (lastForecast.t != null && Math.abs(t - lastForecast.t) > 8) return;
    samples.push({ ts, t, h });
    keep();
    const day = dayKey(ts);
    const before = records.days[day] ? { ...records.days[day] } : null;
    addSample(records, day, t, ts);
    const d = records.days[day];
    if (!before || d.min !== before.min || d.max !== before.max) save();
};

const nightStats = () => {
    const now = Date.now();
    const night = samples.filter((s) => s.ts >= now - 12 * 3600_000);
    if (!night.length) return null;
    const coldest = night.reduce((a, b) => (b.t < a.t ? b : a));
    return { min: coldest.t, max: Math.max(...samples.map((s) => s.t)), humidityAtMin: coldest.h ?? null };
};

const precipLast18h = async () => {
    try {
        const f = await getForecast();
        const now = Date.now();
        return f.hours.filter((x) => x.ts <= now && x.ts >= now - 18 * 3600_000).reduce((sum, x) => sum + (x.precip || 0), 0);
    } catch {
        return 0;
    }
};

// --- Briefing ---

const briefingLines = async () => {
    const lines = [];
    const night = nightStats();
    if (night) {
        let cooper = false;
        try {
            const { getView } = await import('./cooper.js');
            cooper = Boolean(getView().enabled);
        } catch { /* pas de Cooper */ }
        const line = frostLine({ ...night, precip: await precipLast18h() }, { cooper });
        if (line) lines.push(line);
    }
    if (records.morning.day === dayKey()) lines.push(...records.morning.lines.map((l) => l.replace(/^\p{Extended_Pictographic}\s*/u, '')));
    return lines.length ? lines.join(' ') : null;
};
briefing.addExtra(briefingLines);

// --- Records ---

const announce = async (news) => {
    for (const n of news) {
        journal.log({ kind: 'weather', title: n.text, data: { kind: n.kind } });
        await notifier.notify({ text: n.text, silent: true }).catch(() => {});
    }
};

const checkRecords = async () => {
    const now = localMinutes();
    const today = dayKey();
    if (now >= COLD_AT && records.announced.cold !== today) {
        records.announced.cold = today;
        const news = coldNews(records, today);
        records.morning = { day: today, lines: news.map((n) => n.text) };
        prune(records, today);
        save();
        await announce(news);
    }
    if (now >= HEAT_AT && records.announced.heat !== today) {
        records.announced.heat = today;
        save();
        await announce(heatNews(records, today));
    }
};

// --- Aérer gratuitement ---

const checkCooling = async () => {
    const m = localMinutes();
    if (m < COOL_FROM || m >= COOL_TO || presence.anyoneHome() === false) return;
    const sensors = await getSensors();
    const local = localOutdoor(sensors, await forecastTemp());
    const indoor = indoorClimate(sensors)[0];
    if (!local || !indoor) return;
    const doors = sensors.filter((s) => s.type === 'door');
    const door = doors.find((s) => /balcon|fen[eê]tre|patio|terrasse/i.test(s.name)) || null;
    if (!door) return;
    let raining = false;
    try {
        raining = Boolean(buildRainSoon(await getForecast(), Date.now(), 60));
    } catch { /* météo injoignable */ }
    const heating = broadlinkService.getState();
    const advice = coolingAdvice({
        indoor: indoor.props.temperature,
        outdoor: local.temperature,
        doorOpen: Boolean(door.props.isOpen),
        heatingMode: heating.power ? heating.mode : null,
        raining,
    });
    if (!advice || Date.now() - (records.cooling[advice] || 0) < COOL_COOLDOWN_MS) return;
    records.cooling[advice] = Date.now();
    save();
    const text = coolingText(advice, { indoor: round1(indoor.props.temperature), outdoor: local.temperature, door: door.name.toLowerCase() });
    journal.log({ kind: 'weather', title: text, data: { advice } });
    await notifier.notify({ text, silent: true }).catch(() => {});
};

// --- Vue ---

/** Résumé court pour la carte Maison : mesure, tendance sur 1 h, min/max du jour. */
export const getBrief = async () => {
    const local = await getLocal();
    const now = Date.now();
    const latest = samples[samples.length - 1];
    const hourAgo = [...samples].reverse().find((s) => s.ts <= now - 50 * 60_000 && s.ts >= now - 120 * 60_000);
    const diff = latest && hourAgo ? latest.t - hourAgo.t : 0;
    const today = records.days[dayKey()] || null;
    return {
        temperature: local?.temperature ?? null,
        humidity: local?.humidity ?? null,
        trend: diff >= 0.5 ? 'up' : diff <= -0.5 ? 'down' : null,
        today: today ? { min: round1(today.min), max: round1(today.max) } : null,
    };
};

export const getView = async () => {
    const sensors = await getSensors();
    const forecast = await forecastTemp();
    const sensor = outdoorSensor(sensors);
    const local = localOutdoor(sensors, forecast);
    const s = summary(records, dayKey());
    return {
        found: Boolean(sensor),
        local,
        // Sonde présente mais écartée : trop vieille ou trop loin de la météo (soleil, mur)
        ignored: sensor && !local ? { temperature: sensor.props.temperature, lastUpdated: sensor.lastUpdated } : null,
        forecast: forecast != null ? round1(forecast) : null,
        gap: local && forecast != null ? round1(local.temperature - forecast) : null,
        records: s,
        speech: recordsSpeech(s),
    };
};

export const start = () => {
    bus.on('sensor', ({ sensor, prop, value, ts }) => {
        if (prop !== 'temperature' || roleOf({ ...sensor, props: { temperature: value } }) !== 'outdoor') return;
        const h = samples.length ? samples[samples.length - 1].h : null;
        onSample(value, h, ts).catch(() => {});
    });
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop !== 'humidity' || roleOf({ ...sensor, props: { temperature: 0 } }) !== 'outdoor' || !samples.length) return;
        samples[samples.length - 1].h = value;
    });
    // Nuit en cours dès le démarrage (historique HA), sans toucher aux records
    setTimeout(async () => {
        try {
            const sensor = outdoorSensor(await getSensors());
            if (!sensor) return;
            const forecast = await forecastTemp();
            const { points } = await getSensorHistory(sensor.did, 24);
            const recent = points.filter((p) => p.temperature != null && (forecast == null || Math.abs(p.temperature - forecast) <= 12));
            samples = [...recent.map((p) => ({ ts: p.ts, t: p.temperature, h: p.humidity })), ...samples].sort((a, b) => a.ts - b.ts);
            keep();
            console.log(`🌡️  Balcon suivi (${sensor.name}, ${samples.length} mesure(s) sur 24 h)`);
        } catch (err) {
            console.warn('⚠️  Balcon, historique:', err.message);
        }
    }, 25_000);
    setInterval(() => {
        checkRecords().catch((err) => console.warn('⚠️  Balcon, records:', err.message));
        checkCooling().catch((err) => console.warn('⚠️  Balcon, aération:', err.message));
    }, TICK_MS);
};
