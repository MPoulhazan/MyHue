/**
 * Passages visibles de la Station spatiale internationale.
 * Orbite : éléments TLE publics de Celestrak (cache 12 h, aussi gardé sur disque), calcul SGP4 par satellite.js.
 * Un passage est visible quand la station est à plus de 10° au-dessus de l'horizon, éclairée par le soleil,
 * pendant que le ciel est assez sombre ici (soleil à plus de 6° sous l'horizon).
 */
import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as S from 'satellite.js';
import * as A from 'astronomy-engine';
import { dataFile } from './dataDir.js';

const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE';
const TLE_FILE = dataFile('iss-tle.json');
const TLE_MAX_AGE = 12 * 3600_000;
const STEP_MS = 30_000;
const MIN_EL = 10;
const EARTH_RADIUS_KM = 6371;

// --- Détection des passages (pure, testée dans iss.test.js) ---

const DIRS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
export const dirName = (az) => DIRS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

export function brightness(maxEl) {
    if (maxEl >= 60) return 'très brillante';
    if (maxEl >= 30) return 'brillante';
    return 'basse sur l’horizon';
}

/**
 * Regroupe des échantillons { ts, el, az, sunlit, dark } en passages visibles.
 * Seule la partie où la station est éclairée et le ciel sombre compte.
 */
export function findPasses(samples) {
    const passes = [];
    let cur = null;
    const close = () => {
        if (cur && cur.length >= 2) {
            const peak = cur.reduce((m, s) => (s.el > m.el ? s : m), cur[0]);
            const first = cur[0];
            const last = cur[cur.length - 1];
            passes.push({
                start: first.ts, end: last.ts, durationMin: Math.max(1, Math.round((last.ts - first.ts) / 60_000)),
                maxEl: Math.round(peak.el), peakTs: peak.ts,
                from: dirName(first.az), to: dirName(last.az), brightness: brightness(peak.el),
            });
        }
        cur = null;
    };
    for (const s of samples) {
        if (s.el >= MIN_EL && s.sunlit && s.dark) (cur ||= []).push(s);
        else close();
    }
    close();
    return passes;
}

/** La station est-elle au soleil ? Ombre cylindrique de la Terre (r en km, sun = direction du soleil). */
export function isSunlit(r, sun) {
    const n = Math.hypot(sun.x, sun.y, sun.z);
    const s = { x: sun.x / n, y: sun.y / n, z: sun.z / n };
    const d = r.x * s.x + r.y * s.y + r.z * s.z;
    if (d > 0) return true;
    const perp = Math.hypot(r.x - d * s.x, r.y - d * s.y, r.z - d * s.z);
    return perp > EARTH_RADIUS_KM;
}

// --- TLE ---

let tle = null;
try {
    if (existsSync(TLE_FILE)) tle = JSON.parse(readFileSync(TLE_FILE, 'utf8'));
} catch { tle = null; }

async function getTle() {
    if (tle && Date.now() - tle.at < TLE_MAX_AGE) return tle;
    try {
        const { data } = await axios.get(TLE_URL, { timeout: 10000, responseType: 'text' });
        const lines = String(data).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const l1 = lines.find((l) => l.startsWith('1 '));
        const l2 = lines.find((l) => l.startsWith('2 '));
        if (!l1 || !l2) throw new Error('TLE illisible');
        tle = { at: Date.now(), l1, l2 };
        try { writeFileSync(TLE_FILE, JSON.stringify(tle), 'utf8'); } catch { /* cache disque facultatif */ }
    } catch (err) {
        // Un TLE de quelques jours reste assez précis pour des passages à la minute près
        if (!tle || Date.now() - tle.at > 7 * 24 * 3600_000) throw err;
        console.warn('[ISS] TLE non rafraîchi, ancien gardé :', err.message);
    }
    return tle;
}

// --- Calcul (cache 1 h) ---

let cache = { at: 0, key: '', value: null };

/** Prochains passages visibles sur `days` jours. */
export async function getPasses(lat, lon, now = Date.now(), days = 3) {
    const key = `${lat},${lon}`;
    if (cache.value && cache.key === key && now - cache.at < 3600_000) return cache.value.filter((p) => p.end > now);
    const { l1, l2 } = await getTle();
    const satrec = S.twoline2satrec(l1, l2);
    const observerGd = { latitude: S.degreesToRadians(lat), longitude: S.degreesToRadians(lon), height: 0.03 };
    const obs = new A.Observer(lat, lon, 30);
    const samples = [];
    let sunCache = { ts: 0, vec: null, alt: 0 };
    for (let ts = now; ts < now + days * 24 * 3600_000; ts += STEP_MS) {
        const date = new Date(ts);
        const pv = S.propagate(satrec, date);
        if (!pv?.position || typeof pv.position === 'boolean') continue;
        const look = S.ecfToLookAngles(observerGd, S.eciToEcf(pv.position, S.gstime(date)));
        const el = (look.elevation * 180) / Math.PI;
        if (el < MIN_EL) { samples.push({ ts, el, az: 0, sunlit: false, dark: false }); continue; }
        // Le soleil bouge peu : recalculé toutes les 5 min
        if (ts - sunCache.ts > 5 * 60_000) {
            const vec = A.GeoVector(A.Body.Sun, date, true);
            const eq = A.Equator(A.Body.Sun, date, obs, true, true);
            sunCache = { ts, vec, alt: A.Horizon(date, obs, eq.ra, eq.dec, 'normal').altitude };
        }
        samples.push({
            ts, el, az: (look.azimuth * 180) / Math.PI,
            sunlit: isSunlit(pv.position, sunCache.vec),
            dark: sunCache.alt < -6,
        });
    }
    const passes = findPasses(samples);
    cache = { at: now, key, value: passes };
    return passes;
}
