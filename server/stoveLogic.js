/**
 * Cuisinière : logique pure (testée dans stoveLogic.test.js).
 *
 * La sonde est sur la hotte : elle ne voit pas la plaque, mais la chaleur qui monte.
 * - Allumée : la hotte dépasse la pièce (plus son écart habituel) de `onDelta`°,
 *   ou grimpe de `riseDelta`° en 10 min.
 * - Éteinte : l'écart redescend sous `offDelta`°.
 * - L'eau bout : l'humidité de la hotte bondit de `boilJump` points en 10 min.
 * L'écart habituel hotte − pièce s'apprend tout seul quand rien ne chauffe.
 */

export const DEFAULTS = {
    onDelta: 2.5,
    riseDelta: 1.5,
    offDelta: 1.2,
    minOnMin: 5, // pas d'extinction dans les 5 premières minutes (anti-clignotement)
    boilJump: 8,
    boilCooldownMin: 30,
    awayAfterMin: 3,
    awayRepeatMin: 20,
    longCookMin: 90,
    longRepeatMin: 60,
};

const WINDOW_MS = 10 * 60_000;

export const initialState = () => ({ on: false, since: null, offset: 1, peak: null, lastBoilAt: 0 });

/** Plus petite valeur de `prop` sur les 10 dernières minutes (hors mesure courante). */
const minRecent = (samples, prop, now) => {
    const vals = samples.filter((s) => s.ts >= now - WINDOW_MS && s.ts < now && s[prop] != null).map((s) => s[prop]);
    return vals.length ? Math.min(...vals) : null;
};

/**
 * Un pas d'analyse.
 * @param state état précédent (initialState)
 * @param p { stove, humidity, indoor, samples: [{ ts, t, h }], now }
 * @returns {{ state, events: ('start'|'stop'|'boil')[] }}
 */
export const step = (state, { stove, humidity = null, indoor = null, samples = [], now = Date.now() }, cfg = DEFAULTS) => {
    const s = { ...state };
    const events = [];
    if (stove == null) return { state: s, events };

    const minT = minRecent(samples, 't', now);
    const rise = minT != null ? stove - minT : 0;
    // Sans sonde de pièce : la hotte se compare à elle-même (plus basse valeur récente)
    const base = indoor != null ? indoor + s.offset : minT ?? stove;
    const delta = stove - base;

    if (!s.on) {
        // Rien ne chauffe : l'écart hotte − pièce sert de référence (glisse lentement)
        if (indoor != null && Math.abs(stove - indoor - s.offset) < 2) s.offset = s.offset * 0.95 + (stove - indoor) * 0.05;
        if (delta >= cfg.onDelta || rise >= cfg.riseDelta) {
            Object.assign(s, { on: true, since: now, peak: stove });
            events.push('start');
        }
    } else {
        s.peak = Math.max(s.peak ?? stove, stove);
        if (delta <= cfg.offDelta && now - s.since >= cfg.minOnMin * 60_000) {
            Object.assign(s, { on: false, since: null, peak: null });
            events.push('stop');
        }
    }

    const minH = minRecent(samples, 'h', now);
    if (humidity != null && minH != null && humidity - minH >= cfg.boilJump && now - s.lastBoilAt >= cfg.boilCooldownMin * 60_000) {
        s.lastBoilAt = now;
        events.push('boil');
    }
    return { state: s, events };
};

/**
 * Alerte « cuisinière oubliée » à envoyer maintenant, ou null.
 * @param p { on, since, away (personne / mode garde), awaySince, lastAwayAlertAt, lastLongAlertAt, mutedUntil, now }
 */
export const alertDue = ({ on, since, away, awaySince, lastAwayAlertAt = 0, lastLongAlertAt = 0, mutedUntil = 0, now = Date.now() }, cfg = DEFAULTS) => {
    if (!on || !since || now < mutedUntil) return null;
    const awayFor = away && awaySince ? (now - Math.max(awaySince, since)) / 60_000 : 0;
    if (away && awayFor >= cfg.awayAfterMin && now - lastAwayAlertAt >= cfg.awayRepeatMin * 60_000) return 'away';
    const cooking = (now - since) / 60_000;
    if (!away && cooking >= cfg.longCookMin && now - lastLongAlertAt >= cfg.longRepeatMin * 60_000) return 'long';
    return null;
};

const hm = (ts, tz) => new Date(ts).toLocaleTimeString('fr-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(':', ' h ');
const dur = (ms) => {
    const min = Math.round(ms / 60_000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;
};
const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

export const alertText = (kind, { since, stove, now = Date.now(), tz = 'America/Toronto' }) =>
    kind === 'away'
        ? `🔥 Personne à la maison et la cuisinière est encore chaude : ${fmt(stove)}° sur la hotte, allumée depuis ${hm(since, tz)}. Une plaque ou le four oublié ?`
        : `⏲️ La cuisinière chauffe depuis ${dur(now - since)} (${fmt(stove)}° sur la hotte). Tout va bien ?`;

/** Contexte ajouté à l'alarme fumée (n'atténue jamais l'alerte). */
export const smokeContext = ({ on, since, stove, now = Date.now() }) =>
    on && since ? `🍳 La cuisinière chauffe depuis ${dur(now - since)} (${fmt(stove)}° sur la hotte).` : '🍳 La cuisinière ne chauffe pas en ce moment.';

export const statusText = ({ on, since, now = Date.now() }) => (on && since ? `allumée depuis ${dur(now - since)}` : 'éteinte');
