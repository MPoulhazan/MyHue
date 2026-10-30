/**
 * Tarif Flex D : pointes critiques d'Hydro-Québec (données ouvertes, offre TPC-DPC).
 *
 * - La veille (dès que la pointe est publiée) : un message Telegram, avec un bouton pour l'ignorer.
 * - Avant la pointe : consigne +1 °C pour emmagasiner de la chaleur ; pendant : −2 °C ; après : retour.
 * - Jamais d'arrêt ni de relance de la thermopompe : on ne fait que décaler la consigne,
 *   et seulement si elle chauffe déjà. Si quelqu'un change la consigne pendant l'événement,
 *   on ne la touche plus jusqu'à la fin.
 * - Thermostat intelligent actif : il applique lui-même le décalage (deltaNow()).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import axios from 'axios';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';
import * as broadlinkService from './broadlinkService.js';
import * as thermostat from './thermostat.js';

const FILE = dataFile('flexd.json');
const API = 'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/evenements-pointe/records';
const OFFER = process.env.FLEXD_OFFER || 'TPC-DPC';
const TZ = process.env.TZ || 'America/Toronto';
const POLL_MS = 30 * 60_000;
const TICK_MS = 60_000;

const DEFAULTS = {
    enabled: true,
    preheatMinutes: 60,
    boost: 1, // °C avant la pointe
    reduction: 2, // °C pendant la pointe
    events: [], // [{ id, start, end }]
    notified: [],
    skipped: [],
    applied: null, // { id, phase, base, sent, userTook }
    lastFetchAt: 0,
    lastError: null,
};

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ flexd.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde Flex D impossible:', err.message);
    }
};

// --- Calculs purs (testés dans flexd.test.js) ---

/** Phase à un instant : { event, phase: 'preheat' | 'peak' } ou null. */
export const phaseAt = (events, now, preheatMinutes, skipped = []) => {
    for (const e of [...events].sort((a, b) => a.start - b.start)) {
        if (skipped.includes(e.id)) continue;
        if (now >= e.start && now < e.end) return { event: e, phase: 'peak' };
        if (now >= e.start - preheatMinutes * 60_000 && now < e.start) return { event: e, phase: 'preheat' };
    }
    return null;
};

/** Décalage de consigne d'une phase. */
export const deltaFor = (phase, { boost, reduction }) => (phase === 'preheat' ? boost : phase === 'peak' ? -reduction : 0);

/** Événements Hydro-Québec → { id, start, end } (ms epoch). */
export const parseRecords = (records) =>
    records
        .filter((r) => r.offre === OFFER && r.datedebut && r.datefin)
        .map((r) => ({ id: `${r.offre}:${r.datedebut}`, start: Date.parse(r.datedebut), end: Date.parse(r.datefin) }))
        .filter((e) => Number.isFinite(e.start) && e.end > e.start);

// --- Hydro-Québec ---

const fetchEvents = async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data } = await axios.get(API, {
        timeout: 15000,
        params: { where: `offre="${OFFER}" and datefin >= "${since}"`, order_by: 'datedebut', limit: 50 },
    });
    return parseRecords(data.results || []);
};

const fmtDay = (ts) => {
    const day = (d) => new Date(d).toLocaleDateString('fr-CA', { timeZone: TZ });
    const diff = Math.round((Date.parse(day(ts)) - Date.parse(day(Date.now()))) / 86_400_000);
    if (diff === 0) return 'aujourd’hui';
    if (diff === 1) return 'demain';
    return new Date(ts).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
};
const fmtHour = (ts) => {
    const [h, m] = new Date(ts).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).split(':');
    return `${Number(h)} h${m !== '00' ? m : ''}`;
};
export const describe = (e, preheatMinutes = config.preheatMinutes) =>
    `${fmtDay(e.start)} de ${fmtHour(e.start)} à ${fmtHour(e.end)} (préchauffage dès ${fmtHour(e.start - preheatMinutes * 60_000)})`;

const announce = async (e) => {
    const text =
        `⚡ Pointe critique Flex D ${fmtDay(e.start)} de ${fmtHour(e.start)} à ${fmtHour(e.end)}.\n` +
        `Je monte la consigne de ${config.boost} °C dès ${fmtHour(e.start - config.preheatMinutes * 60_000)}, ` +
        `puis je la baisse de ${config.reduction} °C pendant la pointe. La thermopompe reste allumée.\n` +
        'Évite sécheuse, lave-vaisselle et four pendant ces heures.';
    const sent = await notifier.notify({
        text,
        buttons: [
            {
                label: 'Ignorer cette pointe',
                run: async () => {
                    skip(e.id);
                    return 'Pointe ignorée : je ne touche pas à la consigne.';
                },
            },
        ],
    });
    journal.log({ kind: 'heating', title: `Pointe Flex D annoncée : ${describe(e)}`, data: { event: e.id } });
    return sent;
};

const refresh = async () => {
    try {
        const events = await fetchEvents();
        const known = new Set(config.events.map((e) => e.id));
        config.events = events;
        config.lastFetchAt = Date.now();
        config.lastError = null;
        // Annonce chaque pointe à venir une seule fois
        for (const e of events) {
            if (e.start <= Date.now() || config.notified.includes(e.id)) continue;
            if (config.enabled && (await announce(e))) config.notified.push(e.id);
            else if (!known.has(e.id)) console.log(`⚡ Pointe Flex D à venir : ${describe(e)}`);
        }
        // Ne garde que l'historique récent
        const ids = new Set(events.map((e) => e.id));
        config.notified = config.notified.filter((id) => ids.has(id)).slice(-50);
        config.skipped = config.skipped.filter((id) => ids.has(id)).slice(-50);
        save();
    } catch (err) {
        config.lastError = err.response ? `HTTP ${err.response.status}` : err.message;
        console.warn('⚠️  Flex D : données Hydro-Québec indisponibles:', config.lastError);
    }
};

// --- Consigne ---

/** Décalage à appliquer maintenant (pour le thermostat intelligent). */
export const deltaNow = () => {
    if (!config.enabled) return 0;
    const p = phaseAt(config.events, Date.now(), config.preheatMinutes, config.skipped);
    return p ? deltaFor(p.phase, config) : 0;
};

const clampT = (t) => Math.max(16, Math.min(31, t));

/**
 * Décision d'une minute, sans effet de bord (testée dans flexd.test.js).
 * @param applied  ce qui a été fait jusqu'ici (config.applied)
 * @param p        phaseAt(...) : { event, phase } ou null
 * @param heating  état connu de la thermopompe { power, mode, temperature }
 * @returns null si rien ne change, sinon { applied, patch?, log? }
 *          patch ne contient JAMAIS power ni mode : seulement { temperature }.
 */
export const decide = (applied, p, heating, cfg, thermostatOn = false) => {
    const a = applied;
    const phase = p?.phase ?? null;
    if ((a?.phase ?? null) === phase && (a?.id ?? null) === (p?.event.id ?? null)) return null;

    // Le thermostat intelligent applique lui-même le décalage (deltaNow)
    if (thermostatOn) {
        return {
            applied: phase ? { id: p.event.id, phase, base: null, sent: null, userTook: false } : null,
            log: phase === 'peak' ? `Pointe Flex D : consigne −${cfg.reduction} °C` : phase ? `Pointe Flex D : préchauffage +${cfg.boost} °C` : null,
        };
    }

    const sameEvent = Boolean(a && p && a.id === p.event.id);
    // Quelqu'un a changé la consigne depuis notre dernier envoi : on lui laisse la main
    const userTook = Boolean(a && (a.userTook || (a.sent != null && heating.temperature !== a.sent)));
    const heatingOn = heating.power && heating.mode === 'heat';

    if (!phase) {
        // Fin de la pointe : on remet la consigne d'avant, si personne n'y a touché
        if (a && !userTook && a.base != null && heatingOn && heating.temperature !== a.base) {
            return { applied: null, patch: { temperature: a.base }, log: `Fin de la pointe Flex D : consigne remise à ${a.base} °C` };
        }
        return { applied: null };
    }
    if (sameEvent && userTook) return { applied: { ...a, phase, userTook: true } };
    // Jamais de relance : thermopompe à l'arrêt ou dans un autre mode, on ne fait rien
    if (!heatingOn) {
        return {
            applied: { id: p.event.id, phase, base: sameEvent ? a.base : null, sent: null, userTook: false },
            log: 'Pointe Flex D : thermopompe pas en chauffage, consigne inchangée',
        };
    }
    const base = sameEvent && a.base != null ? a.base : heating.temperature;
    const target = clampT(base + deltaFor(phase, cfg));
    return {
        applied: { id: p.event.id, phase, base, sent: target, userTook: false },
        patch: target !== heating.temperature ? { temperature: target } : undefined,
        log: `${phase === 'peak' ? 'Pointe' : 'Préchauffage'} Flex D : consigne ${base} → ${target} °C`,
    };
};

const tick = async () => {
    const p = config.enabled ? phaseAt(config.events, Date.now(), config.preheatMinutes, config.skipped) : null;
    const d = decide(config.applied, p, broadlinkService.getState(), config, thermostat.isEnabled());
    if (!d) return;
    // État douteux : une trame rallumerait peut-être la clim, on retente au prochain tour
    if (d.patch && broadlinkService.isUncertain()) return;
    if (d.patch) await broadlinkService.applyPatch({ temperature: d.patch.temperature }, 'Flex D');
    if (d.log) journal.log({ kind: 'heating', title: d.log, data: {} });
    config.applied = d.applied;
    save();
};

let ticking = false;
const safeTick = async () => {
    if (ticking) return;
    ticking = true;
    try {
        await tick();
    } catch (err) {
        console.error('❌ Flex D:', err.message);
    } finally {
        ticking = false;
    }
};

// --- API ---

export const skip = (id) => {
    if (!config.skipped.includes(id)) config.skipped.push(id);
    save();
    safeTick();
};

export const getStatus = () => {
    const now = Date.now();
    const p = phaseAt(config.events, now, config.preheatMinutes, config.skipped);
    const upcoming = config.events
        .filter((e) => e.end > now)
        .sort((a, b) => a.start - b.start)
        .map((e) => ({ ...e, skipped: config.skipped.includes(e.id), label: describe(e) }));
    return {
        enabled: config.enabled,
        offer: OFFER,
        preheatMinutes: config.preheatMinutes,
        boost: config.boost,
        reduction: config.reduction,
        phase: config.enabled && p ? p.phase : null,
        current: p ? p.event : null,
        upcoming,
        lastFetchAt: config.lastFetchAt || null,
        lastError: config.lastError,
    };
};

export const update = (patch = {}) => {
    if (patch.enabled !== undefined) config.enabled = Boolean(patch.enabled);
    for (const [key, min, max] of [['preheatMinutes', 0, 240], ['boost', 0, 3], ['reduction', 0, 5]]) {
        if (patch[key] === undefined) continue;
        const v = Number(patch[key]);
        if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${key} invalide`);
        config[key] = v;
    }
    if (patch.skip) skip(String(patch.skip));
    save();
    safeTick();
    return getStatus();
};

export const start = () => {
    refresh().then(safeTick);
    setInterval(refresh, POLL_MS);
    setInterval(safeTick, TICK_MS);
    console.log(`⚡ Flex D ${config.enabled ? 'actif' : 'désactivé'} (offre ${OFFER})`);
};
