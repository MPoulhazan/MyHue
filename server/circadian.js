/**
 * Éclairage circadien : le blanc des lampes allumées suit le soleil
 * (≈ 4000 K en plein jour, 3000 K au coucher, 2200 K la nuit).
 *
 * - Ne touche qu'à la température de blanc (ct), jamais à l'intensité.
 * - Ignore les lampes en couleur, et celles réglées à la main (ambiance, scène, couleur)
 *   jusqu'à ce qu'elles soient éteintes.
 * - Une lampe qu'on allume passe tout de suite au bon blanc.
 * Désactivé par défaut (data/circadian.json).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as haService from './haService.js';
import * as journal from './journal.js';
import { hueClient, hueBaseUrl, getHueContext } from './hue.js';

const FILE = dataFile('circadian.json');
const TICK_MS = 60_000;

let config = { enabled: false };
try {
    if (existsSync(FILE)) config = { ...config, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch { /* fichier abîmé : désactivé */ }
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde circadien impossible:', err.message);
    }
};

const manual = new Set(); // lampes réglées à la main, laissées tranquilles jusqu'à extinction
const applied = new Map(); // id -> ct envoyé
const wasOn = new Map(); // id -> allumée au tour précédent

// --- Soleil ---

let sunCache = { at: 0, elevation: null };
const sunElevation = async () => {
    if (Date.now() - sunCache.at < 5 * 60_000) return sunCache.elevation;
    try {
        const sun = await haService.getState('sun.sun');
        sunCache = { at: Date.now(), elevation: Number(sun.attributes?.elevation) };
    } catch {
        sunCache = { at: Date.now(), elevation: null };
    }
    return sunCache.elevation;
};

// Mireds (1e6 / kelvins) : 250 = 4000 K, 333 = 3000 K, 400 = 2500 K, 454 = 2200 K
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
export const targetCt = (elevation) => {
    if (elevation == null) return null;
    if (elevation >= 20) return 250;
    if (elevation >= 0) return Math.round(lerp(333, 250, elevation / 20));
    if (elevation >= -6) return Math.round(lerp(400, 333, (elevation + 6) / 6));
    return 454;
};
const kelvin = (ct) => Math.round(1e6 / ct / 100) * 100;

// --- Réglages manuels (signalés par le proxy Hue et les actions) ---

const COLOR_KEYS = ['ct', 'xy', 'hue', 'sat', 'scene', 'effect'];

/** Un réglage de couleur ou de blanc fait à la main sur ces lampes : on ne les touche plus. */
export const markManual = (ids) => ids.forEach((id) => manual.add(String(id)));

/** Appelé pour chaque commande Hue sortante : lampe (`/lights/3/state`) ou groupe (`/groups/1/action`). */
export const noteHueCommand = async (path, body) => {
    if (!body || !COLOR_KEYS.some((k) => k in body)) return;
    const light = path.match(/^\/lights\/(\d+)\/state/);
    if (light) return markManual([light[1]]);
    const group = path.match(/^\/groups\/(\d+)\/action/);
    if (!group) return;
    try {
        const { lights, groups } = await getHueContext();
        markManual(group[1] === '0' ? lights.map((l) => l.id) : groups.find((g) => g.id === group[1])?.lights ?? []);
    } catch { /* pont injoignable : tant pis */ }
};

// --- Boucle ---

const tick = async () => {
    if (!config.enabled || !hueBaseUrl) return;
    const ct = targetCt(await sunElevation());
    if (ct == null) return;
    let lights;
    try {
        ({ data: lights } = await hueClient.get('/lights'));
    } catch {
        return;
    }
    for (const [id, l] of Object.entries(lights)) {
        const s = l.state || {};
        const on = Boolean(s.on && s.reachable !== false);
        const justOn = on && wasOn.get(id) === false;
        wasOn.set(id, on);
        if (!on) {
            manual.delete(id);
            applied.delete(id);
            continue;
        }
        if (s.ct === undefined || manual.has(id)) continue; // pas de blanc réglable, ou réglée à la main
        // En couleur (sauf si on vient de l'allumer) : on n'y touche pas
        if (s.colormode && s.colormode !== 'ct' && !justOn) continue;
        // Blanc modifié par quelqu'un d'autre (appli Hue, interrupteur) depuis notre dernier envoi
        const last = applied.get(id);
        if (last != null && Math.abs(s.ct - last) > 25 && !justOn) {
            manual.add(id);
            continue;
        }
        if (Math.abs(s.ct - ct) <= 8 && s.colormode === 'ct') continue;
        try {
            // Transition douce, sauf à l'allumage où l'on veut le bon blanc tout de suite
            await hueClient.put(`/lights/${id}/state`, { ct, transitiontime: justOn ? 4 : 300 });
            applied.set(id, ct);
        } catch { /* lampe injoignable : prochain tour */ }
    }
};

export const getStatus = async () => {
    const elevation = await sunElevation();
    const ct = targetCt(elevation);
    return {
        enabled: config.enabled,
        elevation,
        ct,
        kelvin: ct ? kelvin(ct) : null,
        manual: [...manual],
    };
};

export const setEnabled = async (enabled) => {
    config.enabled = Boolean(enabled);
    save();
    if (config.enabled) {
        // Les lampes déjà allumées et en blanc s'alignent ; les réglages manuels antérieurs sont oubliés
        manual.clear();
        applied.clear();
    }
    journal.log({ kind: 'system', title: `Lumière qui suit le soleil ${config.enabled ? 'activée' : 'désactivée'}`, data: {} });
    tick();
    return getStatus();
};

export const start = () => {
    setInterval(tick, TICK_MS);
    setTimeout(tick, 10_000);
};
