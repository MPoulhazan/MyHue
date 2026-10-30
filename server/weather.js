/**
 * Écran Météo : prévision Open-Meteo (gratuite, sans clé) + baromètre maison.
 * La pression vient du capteur Aqara (historique du recorder HA), ramenée au niveau
 * de la mer avec l'écart médian au modèle sur 24 h. On en tire la tendance, un score
 * de tempête, la tenue pour les sorties du jour et le conseil d'aération.
 */
import axios from 'axios';
import * as haService from './haService.js';
import { getSensors, getSensorHistory } from './sensors.js';

const HOUR = 3600 * 1000;
// Heures de sortie (aller, retour) : WEATHER_OUTINGS=8,17
const OUTINGS = (process.env.WEATHER_OUTINGS || '8,17').split(',').map(Number).slice(0, 2);

// --- Position (Home Assistant) et prévision (cache 15 min) ---

let location = null;
async function getLocation() {
    if (location) return location;
    const lat = Number(process.env.WEATHER_LAT);
    const lon = Number(process.env.WEATHER_LON);
    if (lat && lon) return (location = { lat, lon });
    const config = await haService.getConfig();
    return (location = { lat: config.latitude, lon: config.longitude });
}

const HOURLY = [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m',
    'precipitation_probability', 'precipitation', 'snowfall', 'weather_code',
    'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'uv_index', 'cape',
];
const CURRENT = [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m',
    'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'pressure_msl', 'is_day',
];

let forecastCache = { at: 0, value: null };
export async function getForecast() {
    if (Date.now() - forecastCache.at < 15 * 60 * 1000 && forecastCache.value) return forecastCache.value;
    const { lat, lon } = await getLocation();
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
        timeout: 10000,
        params: {
            latitude: lat,
            longitude: lon,
            hourly: HOURLY.join(','),
            current: CURRENT.join(','),
            daily: 'sunrise,sunset',
            // Pluie au quart d'heure pour « il va pleuvoir dans 30 min »
            minutely_15: 'precipitation,precipitation_probability',
            forecast_minutely_15: 12,
            timezone: 'auto',
            timeformat: 'unixtime',
            past_days: 1,
            forecast_days: 3,
        },
    });
    const h = data.hourly;
    const hours = h.time.map((t, i) => ({
        ts: t * 1000,
        temp: h.temperature_2m[i],
        feels: h.apparent_temperature[i],
        humidity: h.relative_humidity_2m[i],
        dewPoint: h.dew_point_2m[i],
        rainProb: h.precipitation_probability[i] ?? 0,
        precip: h.precipitation[i] ?? 0,
        snow: h.snowfall[i] ?? 0,
        code: h.weather_code[i],
        pressure: h.pressure_msl[i],
        wind: h.wind_speed_10m[i],
        gust: h.wind_gusts_10m[i],
        windDir: h.wind_direction_10m[i],
        uv: h.uv_index[i] ?? 0,
        cape: h.cape[i] ?? 0,
    }));
    const q = data.minutely_15;
    const quarters = q
        ? q.time.map((t, i) => ({ ts: t * 1000, precip: q.precipitation[i] ?? 0, prob: q.precipitation_probability?.[i] ?? 0 }))
        : [];
    const value = {
        offsetSec: data.utc_offset_seconds,
        current: data.current,
        hours,
        quarters,
        days: data.daily.time.map((t, i) => ({ ts: t * 1000, sunrise: data.daily.sunrise[i] * 1000, sunset: data.daily.sunset[i] * 1000 })),
    };
    forecastCache = { at: Date.now(), value };
    return value;
}

// --- Petits calculs ---

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
// Heure locale (fuseau de la prévision) d'un instant
const localHour = (ts, offsetSec) => new Date(ts + offsetSec * 1000).getUTCHours();
const localDay = (ts, offsetSec) => Math.floor((ts + offsetSec * 1000) / (24 * HOUR));
// Humidité absolue en g/m³
const absHumidity = (t, rh) => (6.112 * Math.exp((17.67 * t) / (t + 243.5)) * rh * 2.1674) / (273.15 + t);
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
};
const valueAt = (points, ts) => {
    let v = null;
    for (const p of points) {
        if (p.ts > ts) break;
        v = p.value;
    }
    return v;
};

// --- Baromètre ---

function trendLabel(per3h) {
    if (per3h <= -6) return { level: 'storm', label: 'Chute rapide : tempête probable' };
    if (per3h <= -3) return { level: 'falling', label: 'Baisse marquée : ça se gâte' };
    if (per3h <= -1) return { level: 'easing', label: 'Légère baisse' };
    if (per3h >= 3) return { level: 'rising', label: 'Hausse marquée : ça se dégage' };
    if (per3h >= 1) return { level: 'rising', label: 'Légère hausse' };
    return { level: 'stable', label: 'Stable' };
}

async function buildBarometer(forecast, sensors) {
    const now = Date.now();
    const sensor = sensors.find((s) => s.props.pressure != null);
    const model = forecast.hours.filter((h) => h.pressure != null);
    let measured = [];
    let offset = 0;
    if (sensor) {
        const hist = await getSensorHistory(sensor.did, 30);
        measured = hist.points.filter((p) => p.pressure != null).map((p) => ({ ts: p.ts, value: p.pressure }));
        // Écart capteur → niveau de la mer : médiane sur les heures où l'on a les deux
        const diffs = model
            .filter((h) => h.ts <= now && h.ts >= now - 24 * HOUR)
            .map((h) => {
                const v = valueAt(measured, h.ts);
                return v == null ? null : h.pressure - v;
            })
            .filter((d) => d != null);
        offset = median(diffs) ?? (forecast.current.pressure_msl - sensor.props.pressure);
    }
    const rawNow = sensor?.props.pressure ?? null;
    const nowP = rawNow != null ? rawNow + offset : forecast.current.pressure_msl;
    const past = (h) => {
        if (measured.length) {
            const v = valueAt(measured, now - h * HOUR);
            if (v != null) return v + offset;
        }
        const m = model.filter((x) => x.ts <= now - h * HOUR).pop();
        return m?.pressure ?? null;
    };
    const refs = Object.fromEntries([3, 6, 24].map((h) => [h, round1(past(h))]));
    const delta3 = refs[3] != null ? nowP - refs[3] : 0;

    // Courbe : 24 h mesurées (une valeur par heure) + 24 h prévues, recollées sur la mesure
    const curve = [];
    for (let h = -24; h <= 0; h++) {
        const ts = now + h * HOUR;
        const v = measured.length ? valueAt(measured, ts) : null;
        const p = v != null ? v + offset : model.filter((x) => x.ts <= ts).pop()?.pressure;
        if (p != null) curve.push({ ts, value: round1(p), kind: 'measured' });
    }
    const nextModel = model.filter((x) => x.ts > now && x.ts <= now + 24 * HOUR);
    const modelNow = model.filter((x) => x.ts <= now).pop()?.pressure ?? nowP;
    const shift = nowP - modelNow;
    for (const x of nextModel) curve.push({ ts: x.ts, value: round1(x.pressure + shift), kind: 'forecast' });

    return {
        source: sensor ? 'sensor' : 'forecast',
        sensorName: sensor?.name ?? null,
        raw: round1(rawNow),
        value: round1(nowP),
        refs,
        delta3h: round1(delta3),
        trend: trendLabel(delta3),
        curve,
    };
}

// --- Tempête (48 h) ---

function buildStorm(forecast, barometer) {
    const now = Date.now();
    const next = forecast.hours.filter((h) => h.ts > now && h.ts <= now + 48 * HOUR);
    // Plus forte chute sur 3 h : prévue, ou mesurée à l'instant
    let fall = Math.max(0, -barometer.delta3h);
    for (let i = 3; i < next.length; i++) fall = Math.max(fall, next[i - 3].pressure - next[i].pressure);
    const gust = Math.max(0, ...next.map((h) => h.gust));
    const cape = Math.max(0, ...next.map((h) => h.cape));
    const thunder = next.some((h) => h.code >= 95);
    const heavy = Math.max(0, ...next.map((h) => h.precip + h.snow * 0.7));

    const factors = [
        { id: 'pressure', label: 'Chute de pression', value: `−${String(round1(fall)).replace('.', ',')} hPa / 3 h`, score: clamp01((fall - 1) / 7) * 35 },
        { id: 'gust', label: 'Rafales', value: `${Math.round(gust)} km/h`, score: clamp01((gust - 40) / 50) * 35 },
        { id: 'thunder', label: 'Orage', value: thunder ? 'prévu' : cape > 800 ? 'possible' : 'faible', score: thunder ? 20 : clamp01((cape - 300) / 1200) * 20 },
        { id: 'precip', label: 'Pluie ou neige forte', value: `${String(round1(heavy)).replace('.', ',')} mm/h`, score: clamp01((heavy - 1) / 5) * 10 },
    ];
    const score = Math.round(Math.min(100, factors.reduce((s, f) => s + f.score, 0)));

    // Fenêtre la plus marquée : heures venteuses, orageuses ou très arrosées
    const bad = (h) => h.gust >= 60 || h.code >= 95 || h.precip >= 4 || h.snow >= 2;
    let window = null;
    for (const h of next) {
        if (bad(h)) {
            if (!window) window = { from: h.ts, to: h.ts + HOUR };
            else if (h.ts <= window.to) window.to = h.ts + HOUR;
        } else if (window) break;
    }
    const level = score >= 75 ? 'storm' : score >= 50 ? 'likely' : score >= 25 ? 'watch' : 'calm';
    const label = { storm: 'Tempête', likely: 'Probable', watch: 'À surveiller', calm: 'Rien à signaler' }[level];
    return {
        score,
        level,
        label,
        window,
        maxGust: Math.round(gust),
        factors: factors.map((f) => ({ ...f, score: Math.round(f.score), max: f.id === 'thunder' ? 20 : f.id === 'precip' ? 10 : 35 })),
        hours: next.map((h) => ({ ts: h.ts, bad: bad(h), gust: Math.round(h.gust), rainProb: h.rainProb })),
    };
}

// --- Tenue ---

function outfitFor(h) {
    const f = h.feels;
    const items = [];
    const gear = { hat: false, gloves: false, scarf: false, hood: false, umbrella: false, boots: false, sunglasses: false };
    let coat;
    let layers;
    if (f <= -15) { coat = 'winter'; layers = 4; items.push('Manteau grand froid'); Object.assign(gear, { hat: true, gloves: true, scarf: true }); items.push('Tuque', 'Mitaines', 'Foulard'); }
    else if (f <= -5) { coat = 'winter'; layers = 3; items.push('Manteau d’hiver', 'Tuque', 'Gants', 'Foulard'); Object.assign(gear, { hat: true, gloves: true, scarf: true }); }
    else if (f <= 3) { coat = 'winter'; layers = 3; items.push('Manteau d’hiver', 'Tuque', 'Gants'); Object.assign(gear, { hat: true, gloves: true }); }
    else if (f <= 10) { coat = 'mid'; layers = 2; items.push('Manteau mi-saison'); }
    else if (f <= 17) { coat = 'light'; layers = 2; items.push('Veste légère'); }
    else if (f <= 23) { coat = 'none'; layers = 1; items.push('Chandail léger'); }
    else { coat = 'none'; layers = 1; items.push('T-shirt'); }

    const wet = h.rainProb >= 50 || h.precip >= 0.5;
    const snowy = h.snow > 0.2;
    const tips = [];
    if (wet && snowy) { gear.boots = true; items.push('Bottes d’hiver'); }
    else if (wet && h.gust >= 50) {
        gear.hood = true;
        coat = 'rain';
        items.push('Imperméable à capuche');
        tips.push(`Rafales à ${Math.round(h.gust)} km/h : le parapluie va se retourner, mise sur la capuche.`);
    } else if (wet) { gear.umbrella = true; items.push('Parapluie'); }
    // Sloche : autour de zéro avec des précipitations
    if (!gear.boots && wet && (h.precip >= 2 || (h.temp >= -2 && h.temp <= 3))) { gear.boots = true; items.push('Bottes imperméables'); }
    if (h.uv >= 6) { gear.sunglasses = true; items.push('Lunettes de soleil', 'Crème solaire'); }
    if (!wet && h.gust >= 55) tips.push('Ça souffle fort : évite le vélo.');

    let headline;
    if (wet && h.gust >= 60) headline = 'Tempête : imperméable et bottes, oublie le parapluie.';
    else if (wet && snowy) headline = 'Neige : bottes d’hiver et tuque.';
    else if (wet) headline = gear.umbrella ? 'Prends le parapluie : pluie probable.' : 'Pluie et vent : capuche plutôt que parapluie.';
    else if (f <= -15) headline = 'Grand froid : couvre tout, même le visage.';
    else if (f <= 3) headline = 'Manteau chaud, tuque et gants : ça pince.';
    else if (f <= 10) headline = 'Manteau mi-saison, ça suffit.';
    else if (f <= 17) headline = 'Une veste légère et c’est parti.';
    else headline = 'Temps doux : pas besoin de manteau.';
    if (gear.sunglasses && !wet) headline += ' Soleil fort.';

    return {
        ts: h.ts,
        temp: Math.round(h.temp),
        feels: Math.round(f),
        rainProb: h.rainProb,
        gust: Math.round(h.gust),
        uv: round1(h.uv),
        coat,
        layers,
        gear,
        items,
        headline,
        tip: tips[0] ?? null,
    };
}

function buildOutfits(forecast) {
    const { offsetSec, hours } = forecast;
    const today = localDay(Date.now(), offsetSec);
    const slots = [];
    for (const [d, day] of [[0, 'today'], [1, 'tomorrow']]) {
        OUTINGS.forEach((hour, i) => {
            const h = hours.find((x) => localDay(x.ts, offsetSec) === today + d && localHour(x.ts, offsetSec) === hour);
            if (h) slots.push({ day, moment: i === 0 ? 'out' : 'back', hour, past: h.ts + HOUR < Date.now(), ...outfitFor(h) });
        });
    }
    // Écart de ressenti aller → retour, utile pour les couches
    for (const day of ['today', 'tomorrow']) {
        const out = slots.find((s) => s.day === day && s.moment === 'out');
        const back = slots.find((s) => s.day === day && s.moment === 'back');
        if (out && back && !back.tip && back.feels - out.feels >= 5) back.tip = `Il fera ${back.feels - out.feels}° de plus qu’au départ : une couche en moins suffit.`;
        if (out && back && !out.tip && back.rainProb >= 50 && out.rainProb < 50) out.tip = `Pluie probable au retour (${back.rainProb} %) : prends de quoi te couvrir dès le matin.`;
    }
    return slots;
}

// --- Aérer ---

function buildAiring(forecast, sensors) {
    const indoor = sensors.find((s) => !s.outside && s.props.temperature != null && s.props.humidity != null);
    // Pour aérer : une porte balcon ou une fenêtre plutôt que la porte d'entrée
    const doors = sensors.filter((s) => s.type === 'door');
    const door = doors.find((s) => /balcon|fen[eê]tre|patio|terrasse/i.test(s.name)) || doors.find((s) => !/entr[ée]e/i.test(s.name)) || null;
    const c = forecast.current;
    if (!indoor) return null;
    const tIn = indoor.props.temperature;
    const rhIn = indoor.props.humidity;
    const ahIn = absHumidity(tIn, rhIn);
    const ahOut = absHumidity(c.temperature_2m, c.relative_humidity_2m);
    const nowHour = forecast.hours.filter((h) => h.ts <= Date.now()).pop();
    const raining = (nowHour?.precip ?? 0) >= 0.2 || (nowHour?.rainProb ?? 0) >= 70;

    let verdict;
    let reason;
    if (raining) { verdict = 'no'; reason = 'Il pleut dehors : attends une accalmie.'; }
    else if (c.temperature_2m >= tIn + 2 && c.temperature_2m > 24) { verdict = 'no'; reason = 'Plus chaud dehors que dedans : garde la fraîcheur.'; }
    else if (rhIn >= 55 && ahOut < ahIn - 1) { verdict = 'yes'; reason = 'L’air dehors est plus sec : aérer chasse l’humidité.'; }
    else if (rhIn < 35 && ahOut < ahIn) { verdict = 'short'; reason = 'L’air est déjà sec dedans : 5 min suffisent pour renouveler sans assécher.'; }
    else if (c.temperature_2m < tIn - 10) { verdict = 'short'; reason = 'Froid dehors : 5 à 10 min grand ouvert, pas en entrouvert.'; }
    else { verdict = 'yes'; reason = 'Bon moment pour renouveler l’air.'; }
    const rainSoon = forecast.hours.find((h) => h.ts > Date.now() && h.ts <= Date.now() + 4 * HOUR && h.rainProb >= 60);
    return {
        verdict,
        label: { yes: 'Oui', short: 'Brièvement', no: 'Pas maintenant' }[verdict],
        reason,
        rainSoon: rainSoon ? rainSoon.ts : null,
        indoor: { name: indoor.name, temp: round1(tIn), humidity: Math.round(rhIn) },
        outdoor: { temp: round1(c.temperature_2m), humidity: Math.round(c.relative_humidity_2m) },
        door: door ? { name: door.name, open: door.props.isOpen } : null,
    };
}

// --- Soleil ---

// --- Pluie imminente (30 min) ---

/** Premier quart d'heure de pluie dans les 30 min : { at, mm, prob } ou null. Repli sur l'heure en cours. */
export function buildRainSoon(forecast, now = Date.now(), withinMin = 30) {
    const limit = now + withinMin * 60_000;
    const q = (forecast.quarters || []).find((x) => x.ts + 15 * 60_000 > now && x.ts <= limit && (x.precip >= 0.1 || x.prob >= 60));
    if (q) return { at: Math.max(q.ts, now), mm: round1(q.precip), prob: q.prob };
    if (forecast.quarters?.length) return null;
    const h = forecast.hours.find((x) => x.ts <= now && x.ts + HOUR > now);
    return h && (h.precip >= 0.2 || h.rainProb >= 70) ? { at: now, mm: round1(h.precip), prob: h.rainProb } : null;
}

function buildSun(forecast) {
    const { days, offsetSec } = forecast;
    const today = days.find((d) => localDay(d.ts + 12 * HOUR, offsetSec) === localDay(Date.now(), offsetSec));
    const yesterday = days[days.indexOf(today) - 1];
    if (!today) return null;
    const len = (d) => d.sunset - d.sunrise;
    return {
        sunrise: today.sunrise,
        sunset: today.sunset,
        dayLengthMin: Math.round(len(today) / 60000),
        deltaMin: yesterday ? Math.round((len(today) - len(yesterday)) / 60000) : null,
    };
}

// --- Assemblage ---

export async function getWeatherDetails() {
    const [forecast, sensors] = await Promise.all([getForecast(), getSensors().catch(() => [])]);
    const barometer = await buildBarometer(forecast, sensors).catch((err) => {
        console.warn('[Météo] Baromètre :', err.message);
        return null;
    });
    const c = forecast.current;
    return {
        updatedAt: Date.now(),
        offsetSec: forecast.offsetSec,
        outings: OUTINGS,
        current: {
            temp: round1(c.temperature_2m),
            feels: round1(c.apparent_temperature),
            humidity: Math.round(c.relative_humidity_2m),
            dewPoint: round1(c.dew_point_2m),
            wind: Math.round(c.wind_speed_10m),
            gust: Math.round(c.wind_gusts_10m),
            windDir: c.wind_direction_10m,
            code: c.weather_code,
            isDay: Boolean(c.is_day),
        },
        barometer,
        storm: barometer ? buildStorm(forecast, barometer) : null,
        outfits: buildOutfits(forecast),
        airing: buildAiring(forecast, sensors),
        rainSoon: buildRainSoon(forecast),
        sun: buildSun(forecast),
    };
}
