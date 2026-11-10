/**
 * Données du graphique « Dernières 24 h » de l'écran Climat : la pièce, le dehors
 * (Open-Meteo, past_days: 1) et la consigne appliquée, plus les nuits à ombrer.
 *
 * La consigne n'a pas d'historique ailleurs : on note ici ses changements (fichier
 * data/setpoint-history.json, 48 h gardées). Thermostat actif : sa cible pour la pièce.
 * Sinon : la consigne de la thermopompe quand elle chauffe, rien quand elle est éteinte.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as broadlinkService from './broadlinkService.js';
import * as thermostat from './thermostat.js';

const FILE = dataFile('setpoint-history.json');
const HOUR = 3600_000;
const KEEP_MS = 48 * HOUR;
const SAMPLE_MS = 5 * 60_000;

let history = []; // [{ ts, target }] ; target null = pas de consigne (éteinte, autre mode)
try {
    if (existsSync(FILE)) history = JSON.parse(readFileSync(FILE, 'utf8'));
} catch { /* fichier abîmé : on repart de zéro */ }

/** Consigne qui s'applique à la pièce en ce moment. */
export const effectiveSetpoint = (thermo, heating) => {
    if (thermo.enabled) return thermo.target ?? null;
    if (heating?.power && heating.mode === 'heat' && typeof heating.temperature === 'number') return heating.temperature;
    return null;
};

/** Ajoute un échantillon s'il change quelque chose ; renvoie la nouvelle liste. */
export const pushSetpoint = (list, ts, target) => {
    const kept = list.filter((p) => p.ts >= ts - KEEP_MS);
    // Garde au moins le dernier point d'avant la fenêtre : il dit ce qui valait à son début
    const before = list.filter((p) => p.ts < ts - KEEP_MS).pop();
    const out = before ? [before, ...kept] : kept;
    const last = out[out.length - 1];
    if (last && last.target === target) return out;
    return [...out, { ts, target }];
};

const sample = () => {
    try {
        const next = pushSetpoint(history, Date.now(), effectiveSetpoint(thermostat.getStatus(), broadlinkService.getState()));
        if (next.length !== history.length || next[next.length - 1] !== history[history.length - 1]) {
            history = next;
            writeFileSync(FILE, JSON.stringify(history), 'utf8');
        }
    } catch (err) {
        console.error('❌ Historique de consigne:', err.message);
    }
};

export const start = () => {
    setTimeout(sample, 40_000);
    setInterval(sample, SAMPLE_MS);
};

/** Note tout de suite un changement venu de l'interface (sans attendre les 5 min). */
export const touch = () => setTimeout(sample, 2_000);

/**
 * Marches de consigne sur [from, to] : [{ from, to, target }] sans les trous (target null).
 */
export const setpointSteps = (list, from, to) => {
    const steps = [];
    let current = list.filter((p) => p.ts <= from).pop() ?? null;
    let start = from;
    for (const p of list.filter((x) => x.ts > from && x.ts <= to)) {
        if (current && current.target != null) steps.push({ from: start, to: p.ts, target: current.target });
        current = p;
        start = p.ts;
    }
    if (current && current.target != null) steps.push({ from: start, to, target: current.target });
    // Fusionne les marches voisines à la même valeur
    return steps.reduce((acc, s) => {
        const prev = acc[acc.length - 1];
        if (prev && prev.to === s.from && prev.target === s.target) prev.to = s.to;
        else acc.push({ ...s });
        return acc;
    }, []);
};

/** Nuits (coucher → lever) qui touchent [from, to], bornées à la fenêtre. */
export const nightsBetween = (days, from, to) => {
    const sorted = [...days].sort((a, b) => a.sunrise - b.sunrise);
    const nights = [];
    for (let i = 0; i < sorted.length; i++) {
        const dusk = sorted[i].sunset;
        const dawn = sorted[i + 1]?.sunrise ?? dusk + 12 * HOUR;
        if (dawn > from && dusk < to) nights.push({ from: Math.max(dusk, from), to: Math.min(dawn, to) });
    }
    // La nuit qui finit au premier lever de la liste
    if (sorted.length && sorted[0].sunrise > from) {
        nights.unshift({ from, to: Math.min(sorted[0].sunrise, to) });
    }
    return nights.filter((n) => n.to > n.from);
};

/**
 * Assemble la réponse : mesures de la pièce, dehors à l'heure, consigne et nuits.
 * `withSetpoint` : seulement pour le capteur qui pilote le chauffage.
 */
export const buildChart = ({ points, forecast, withSetpoint, setpoints = history, now = Date.now(), hours = 24 }) => {
    const from = now - hours * HOUR;
    return {
        from,
        to: now,
        points: points
            .filter((p) => p.temperature != null && p.ts >= from)
            .map((p) => ({ ts: p.ts, temperature: p.temperature, humidity: p.humidity ?? null })),
        outdoor: (forecast?.hours || [])
            .filter((h) => h.ts >= from - HOUR && h.ts <= now + HOUR && h.temp != null)
            .map((h) => ({ ts: h.ts, temperature: h.temp })),
        setpoint: withSetpoint ? setpointSteps(setpoints, from, now) : null,
        nights: forecast?.days ? nightsBetween(forecast.days, from, now) : [],
    };
};
