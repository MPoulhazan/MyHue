/**
 * « Ce soir à deux » (lot 4 de « Sortie à deux v2 ») : le jour d'une sortie prévue, l'heure de départ,
 * Cooper, la météo à l'aller et au retour, et ce qu'on en dit (carte, briefing, Telegram, voix).
 * Fonctions pures, testées dans tonightLogic.test.js.
 */

export const MARGIN_MIN = 10; // arriver un peu avant le début
export const REMIND_BEFORE_MIN = 20; // Telegram et lampe du bar, avant l'heure de départ
export const COOPER_ALONE_MIN = 120; // au-delà, on pense à sa promenade et à son repas
const WALK_MAX_MIN = 35; // plus loin, la marche n'est proposée que s'il n'y a rien d'autre

const dayOf = (ts, tz) => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });
const deg = (n) => `${Math.round(n) < 0 ? '−' : ''}${Math.abs(Math.round(n))}°`;

/** « 18 h 40 », « 19 h » */
export const hm = (ts, tz = 'America/Toronto') => {
    const [h, m] = new Date(ts).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};

/** La sortie prévue a lieu aujourd'hui, n'est pas refusée et n'est pas finie. */
export const isTonight = (plan, now = Date.now(), tz = 'America/Toronto') =>
    Boolean(plan && plan.status !== 'declined' && dayOf(plan.start, tz) === dayOf(now, tz) && plan.end > now);

/** L'heure de prévision la plus proche d'un instant (null si la prévision ne va pas jusque-là). */
export const hourAt = (hours = [], ts) => {
    let best = null;
    for (const h of hours) if (!best || Math.abs(h.ts - ts) < Math.abs(best.ts - ts)) best = h;
    return best && Math.abs(best.ts - ts) <= 90 * 60_000 ? best : null;
};

/** Mauvais temps pour pédaler : pluie probable, neige qui tombe ou grand froid. */
export const badForBike = (h) => Boolean(h && ((h.rainProb ?? 0) >= 60 || (h.snow ?? 0) >= 0.3 || (h.feels ?? 0) <= -15));

/**
 * Le moyen d'y aller : le plus rapide parmi BIXI (sauf mauvais temps), bus ou métro, et la marche.
 * @param trip tripTo() : { walk, bike, transit }
 * @returns { mode: 'bike'|'transit'|'walk', minutes } ou null sans trajet connu
 */
export const pickMode = (trip, weatherGo = null) => {
    if (!trip) return null;
    const options = [
        trip.bike != null && !badForBike(weatherGo) ? { mode: 'bike', minutes: trip.bike } : null,
        trip.transit != null ? { mode: 'transit', minutes: trip.transit } : null,
        trip.walk <= WALK_MAX_MIN ? { mode: 'walk', minutes: trip.walk } : null,
    ].filter(Boolean);
    if (!options.length) return { mode: 'walk', minutes: trip.walk };
    return options.sort((a, b) => a.minutes - b.minutes)[0];
};

const MODE_LABEL = { bike: 'en BIXI', transit: 'en bus ou métro', walk: 'à pied' };

/** « −4°, sec », « −1°, neige probable », « 3°, pluie probable (70 %) » */
export const weatherLine = (h) => {
    if (!h) return null;
    const t = deg(h.temp);
    if ((h.snow ?? 0) >= 0.3) return `${t}, neige probable`;
    if ((h.rainProb ?? 0) >= 50) return `${t}, pluie probable (${h.rainProb} %)`;
    if ((h.feels ?? h.temp) <= -15) return `${t}, ressenti ${deg(h.feels)}`;
    return `${t}, sec`;
};

/**
 * Le programme du soir.
 * @param d { plan, trip, hours, now, tz }  plan = planView() + to ; trip = tripTo() ou null
 */
export const tonightPlan = ({ plan, trip = null, hours = [], now = Date.now(), tz = 'America/Toronto' }) => {
    if (!isTonight(plan, now, tz)) return null;
    const firstGuess = hourAt(hours, plan.start - 20 * 60_000);
    const way = pickMode(trip, firstGuess);
    const travel = way?.minutes ?? null;
    // Arrondi aux 5 min d'avant : « 18 h 40 » plutôt que « 18 h 41 »
    const leaveAt = travel != null ? Math.floor((plan.start - (travel + MARGIN_MIN) * 60_000) / 300_000) * 300_000 : null;
    const homeAt = travel != null ? plan.end + travel * 60_000 : plan.end;
    const go = hourAt(hours, leaveAt ?? plan.start);
    const back = hourAt(hours, plan.end);
    const awayMin = Math.round((homeAt - (leaveAt ?? plan.start)) / 60_000);
    return {
        ideaId: plan.ideaId,
        title: plan.title,
        where: plan.where,
        start: plan.start,
        end: plan.end,
        status: plan.status,
        to: plan.to || null,
        mode: way?.mode ?? null,
        modeLabel: way ? MODE_LABEL[way.mode] : null,
        travelMin: travel,
        leaveAt,
        homeAt,
        bikes: way?.mode === 'bike' ? trip?.bikes ?? null : null,
        station: way?.mode === 'bike' ? trip?.startName ?? null : null,
        bikeSkipped: Boolean(trip?.bike != null && way?.mode !== 'bike' && badForBike(firstGuess)),
        weather: { go: weatherLine(go), back: weatherLine(back) },
        cooper: awayMin > COOPER_ALONE_MIN ? { awayMin, before: (leaveAt ?? plan.start) - 15 * 60_000 } : null,
    };
};

/** Faut-il prévenir (Telegram et lampe) maintenant ? Une seule fois, 20 min avant le départ. */
export const shouldRemind = (t, reminded, now = Date.now()) =>
    Boolean(t?.leaveAt && !reminded && now >= t.leaveAt - REMIND_BEFORE_MIN * 60_000 && now < t.leaveAt + 5 * 60_000);

const hours = (min) => {
    const h = Math.floor(min / 60);
    const m = Math.round((min % 60) / 15) * 15;
    return m === 60 ? `${h + 1} h` : m ? `${h} h ${m}` : `${h} h`;
};

/** La ligne Cooper : « Cooper sera seul environ 3 h : promenade et repas avant 18 h 25. » */
export const cooperLine = (t, tz = 'America/Toronto') => (t?.cooper ? `Cooper sera seul environ ${hours(t.cooper.awayMin)} : promenade et repas avant ${hm(t.cooper.before, tz)}.` : null);

/** Phrase du briefing de 8 h 30. */
export const briefingLine = (t, tz = 'America/Toronto') => {
    if (!t) return null;
    const leave = t.leaveAt ? `, départ ${hm(t.leaveAt, tz)} ${t.modeLabel}` : '';
    const wait = t.status === 'sent' || t.status === 'pending' ? `, en attente de la réponse${t.to ? ` de ${t.to.name}` : ''}` : '';
    return [`Ce soir à deux : ${t.title} à ${hm(t.start, tz)}${leave}${wait}.`, cooperLine(t, tz)].filter(Boolean).join(' ');
};

/** Le message Telegram, 20 min avant le départ. */
export const reminderText = (t, tz = 'America/Toronto') => {
    const lines = [`Ce soir : ${t.title} à ${hm(t.start, tz)}${t.where ? `, ${t.where}` : ''}.`];
    lines.push(`Départ à ${hm(t.leaveAt, tz)} ${t.modeLabel} (${t.travelMin} min)${t.bikes != null && t.station ? `, ${t.bikes} vélo${t.bikes > 1 ? 's' : ''} à ${t.station}` : ''}.`);
    if (t.bikeSkipped) lines.push('Pas de BIXI conseillé avec ce temps.');
    if (t.weather.go || t.weather.back) lines.push(`Météo : ${[t.weather.go && `aller ${t.weather.go}`, t.weather.back && `retour ${t.weather.back}`].filter(Boolean).join(', ')}.`);
    const c = cooperLine(t, tz);
    if (c) lines.push(c);
    return lines.join('\n');
};

/** Ce que Jean-Claude répond à « on fait quoi ce soir ? » quand une sortie est prévue. */
export const speech = (t, tz = 'America/Toronto') => {
    const say = (s) => s.replace(/(\d{1,2}) h (\d{2})/g, '$1 heures $2').replace(/(\d{1,2}) h\b/g, '$1 heures').replace(/−/g, 'moins ');
    const parts = [`Ce soir, ${t.title} à ${hm(t.start, tz)}${t.where ? `, ${t.where}` : ''}.`];
    if (t.leaveAt) parts.push(`Il faut partir à ${hm(t.leaveAt, tz)}, ${t.modeLabel}.`);
    if (t.weather.back) parts.push(`Au retour : ${t.weather.back.replace(/ \(\d+ %\)/, '')}.`);
    const c = cooperLine(t, tz);
    if (c) parts.push(c);
    if (t.status === 'sent' || t.status === 'pending') parts.push(`${t.to?.name || 'L’autre'} n’a pas encore répondu à l’invitation.`);
    return say(parts.join(' '));
};

/** Pertinence de la carte de l'accueil : en carte toute la journée de la sortie, jusqu'au retour. */
export const tonightRelevance = (t) => {
    if (!t) return { id: 'tonight', relevance: 'hidden', summary: 'rien de prévu', until: null };
    return { id: 'tonight', relevance: 'now', summary: `${t.title}${t.leaveAt ? `, départ ${hm(t.leaveAt)}` : ''}`, until: t.homeAt };
};
