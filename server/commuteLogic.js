/**
 * Conseil de trajet du matin : BIXI, BIXI électrique, bus ou à pied. Décisions pures, testées
 * dans commuteLogic.test.js. Les réglages (lieux, arrêts, horaires) vivent dans data/commute.json.
 */

const WALK_M_PER_MIN = 75;
const DETOUR = 1.3; // rues contre vol d'oiseau
const BIKE_BONUS_MIN = 4; // à temps à peu près égal, le vélo d'abord (c'est le choix de la personne)
const EBIKE_PENALTY_MIN = 2;
const LOW_WEATHER_PENALTY_MIN = 5;

export const walkMinutes = (m) => Math.max(1, Math.round((m * DETOUR) / WALK_M_PER_MIN));

const localDow = (now, tz) => new Date(new Date(now).toLocaleString('en-US', { timeZone: tz })).getDay();
const localMinutes = (now, tz) => {
    const [h, m] = new Date(now).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return h * 60 + m;
};
const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

/** « 8 h 05 », « 12 h » */
export const hm = (ts, tz) => {
    const [h, m] = new Date(ts).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};

/**
 * Le programme du jour d'une personne.
 * @param p { days: { '2': '08:00-08:30' }, rest: ['3'] }
 * @returns { kind: 'work', from, to, fromMin, toMin } | { kind: 'rest' } | { kind: 'off' }
 */
export const todayPlan = (p, now = Date.now(), tz = 'America/Toronto') => {
    const dow = String(localDow(now, tz));
    if ((p.rest || []).includes(dow)) return { kind: 'rest' };
    const w = p.days?.[dow];
    if (!w) return { kind: 'off' };
    const [from, to] = w.split('-');
    return { kind: 'work', from, to, fromMin: toMin(from), toMin: toMin(to) };
};

/** Où en est-on de la fenêtre de départ : before (plus de 45 min avant), soon, now, after. */
export const phase = (plan, now = Date.now(), tz = 'America/Toronto') => {
    if (plan?.kind !== 'work') return null;
    const m = localMinutes(now, tz);
    if (m < plan.fromMin - 45) return 'before';
    if (m < plan.fromMin) return 'soon';
    if (m <= plan.toMin) return 'now';
    return 'after';
};

/**
 * Prochains passages du bus à l'arrêt : le temps réel s'il y en a, sinon l'horaire prévu.
 * @param realtime [{ at, rideMin? }] passages STM en temps réel, ou null
 * @param schedule ['07:45', …] horaire de semaine à l'arrêt
 * @param from     ms : on cherche les passages à partir de ce moment
 * @returns [{ at, realtime, rideMin? }] au plus `count`
 */
export const busDepartures = ({ realtime, schedule = [], from, tz = 'America/Toronto', count = 3 }) => {
    if (realtime?.length) return realtime.filter((d) => d.at >= from).sort((a, b) => a.at - b.at).slice(0, count).map((d) => ({ ...d, realtime: true }));
    const base = from - localMinutes(from, tz) * 60_000 - (from % 60_000);
    return schedule.map((t) => ({ at: base + toMin(t) * 60_000, realtime: false })).filter((d) => d.at >= from).slice(0, count);
};

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const short = (name = '') => name.replace(/^(du|de la|des|de l’|de)\s+/i, '');

/**
 * Les façons d'y aller, classées. Chaque option : { mode, ok, minutes, leaveAt, arriveAt, title, detail, warn }.
 * @param f.trip     trajet BIXI de bixi.getView() pour cette personne (ou null)
 * @param f.verdict  bikeVerdict { level, text }
 * @param f.destWalkMin minutes à pied de la station d'arrivée au travail
 * @param f.bus      { label, stopName, walkToStopMin, rideMin, walkFromStopMin, departures: [{ at, realtime, rideMin? }] }
 * @param f.walkMin  minutes à pied de la maison au travail
 * @param f.start    ms : l'heure où la personne part au plus tôt (maintenant, ou le début de sa fenêtre)
 */
export const commuteOptions = (f) => {
    const tz = f.tz || 'America/Toronto';
    const start = f.start;
    const v = f.verdict || { level: 'ok', text: '' };
    const snow = /neige/i.test(v.text);
    const noBike = v.level === 'no' && !snow; // verglas, orage : jamais le vélo
    const out = [];

    // BIXI classique, ou électrique en secours
    const t = f.trip;
    const destWalk = t?.to ? f.destWalkMin ?? 3 : null;
    if (t?.from && t.to && t.rideMin != null) {
        const minutes = walkMinutes(t.from.dist ?? 0) + t.rideMin + destWalk;
        out.push({
            mode: 'bike',
            ok: !noBike,
            minutes,
            score: minutes - BIKE_BONUS_MIN + (v.level === 'low' ? LOW_WEATHER_PENALTY_MIN : 0) + (snow ? 30 : 0) + (noBike ? 999 : 0),
            title: 'BIXI',
            detail: `${plural(t.from.bikes, 'vélo')} à ${short(t.from.name)} (${t.from.dist} m), ${plural(t.to.docks, 'place')} à ${short(t.to.name)}`,
            warn: snow ? 'Plein de neige : déconseillé' : noBike ? v.text : t.to.low ? 'Peu de places à l’arrivée' : t.from.scarce ? 'Dernier vélo, ça peut partir' : null,
        });
    } else if (t?.ebike && t.to) {
        const ride = f.ebikeRideMin ?? t.rideMin ?? 8;
        const minutes = walkMinutes(t.ebike.dist ?? 0) + ride + destWalk;
        out.push({
            mode: 'ebike',
            ok: !noBike,
            minutes,
            score: minutes - BIKE_BONUS_MIN + EBIKE_PENALTY_MIN + (v.level === 'low' ? LOW_WEATHER_PENALTY_MIN : 0) + (snow ? 30 : 0) + (noBike ? 999 : 0),
            title: 'BIXI électrique',
            detail: `Plus de vélo classique : ${plural(t.ebike.ebikes, 'électrique')} à ${short(t.ebike.name)} (${t.ebike.dist} m). Prends un casque`,
            warn: snow ? 'Plein de neige : déconseillé' : noBike ? v.text : 'Électrique : casque',
        });
    } else if (t) {
        out.push({ mode: 'bike', ok: false, minutes: null, score: 999, title: 'BIXI', detail: t.to ? 'Aucun vélo autour de la maison' : 'Station d’arrivée inconnue', warn: null });
    }

    // Bus : le premier qu'on peut attraper
    const b = f.bus;
    if (b) {
        const catchable = (b.departures || []).find((d) => d.at - b.walkToStopMin * 60_000 >= start - 60_000);
        if (catchable) {
            const ride = catchable.rideMin ?? b.rideMin;
            const leaveAt = catchable.at - b.walkToStopMin * 60_000;
            const arriveAt = catchable.at + (ride + b.walkFromStopMin) * 60_000;
            const minutes = Math.round((arriveAt - start) / 60_000);
            out.push({
                mode: 'bus',
                ok: true,
                minutes,
                leaveAt,
                arriveAt,
                score: minutes,
                title: b.label,
                detail: `${hm(catchable.at, tz)} à ${b.stopName}${catchable.realtime ? '' : ' (horaire prévu)'}, arrivée vers ${hm(arriveAt, tz)}`,
                warn: null,
            });
        }
    }

    // À pied
    if (f.walkMin) {
        out.push({
            mode: 'walk',
            ok: true,
            minutes: f.walkMin,
            score: f.walkMin + (v.level === 'no' && !snow ? 5 : 0),
            title: 'À pied',
            detail: `≈ ${f.walkMin} min, arrivée vers ${hm(start + f.walkMin * 60_000, tz)}`,
            warn: /verglas/i.test(v.text) ? 'Trottoirs glissants' : null,
        });
    }

    for (const o of out) {
        if (o.leaveAt == null && o.minutes != null) {
            o.leaveAt = start;
            o.arriveAt = start + o.minutes * 60_000;
        }
    }
    const ranked = out.filter((o) => o.ok && o.minutes != null).sort((a, b) => a.score - b.score);
    const best = ranked[0] || null;
    return { best, options: [...ranked, ...out.filter((o) => !ranked.includes(o))].map(({ score, ...o }) => o) };
};

/** Une phrase pour la carte, Telegram et Jean-Claude. */
export const adviceText = (who, best, verdict, tz = 'America/Toronto') => {
    if (!best) return `${who} : je n’ai aucune option fiable, regarde dehors.`;
    const snow = /neige/i.test(verdict?.text || '');
    if (best.mode === 'bike') return `${who} : BIXI, ${best.detail}. ≈ ${best.minutes} min.`;
    if (best.mode === 'ebike') return `${who} : BIXI électrique, ${best.detail.replace(/^Plus de vélo classique : /, '')}. ≈ ${best.minutes} min.`;
    const why = snow ? 'Plein de neige, le BIXI est déconseillé. ' : verdict?.level === 'no' ? `${verdict.text}. ` : 'Pas de BIXI. ';
    if (best.mode === 'bus') return `${who} : ${why}${best.title} à ${best.detail.split(' à ')[0]}, pars à ${hm(best.leaveAt, tz)}. Arrivée vers ${hm(best.arriveAt, tz)}.`;
    return `${who} : ${why}À pied, ≈ ${best.minutes} min.`;
};

/** « Comment j'y vais ? », « Je prends le bus ? », « Comment aller au travail ? » */
export const isCommuteQuestion = (text) =>
    /comment (j[e’']?\s*|tu |on )?(y vais|vas|va|aller|me rendre)|aller au (travail|boulot|bureau)|je prends (le )?(bus|bixi|v[ée]lo)|quel (bus|trajet)/i.test(text);
