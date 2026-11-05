/**
 * BIXI : décisions pures (stations, trajets, météo vélo), sans réseau, testées dans bixi.test.js.
 * Station GBFS : { station_id, name, lat, lon, capacity } + statut { num_bikes_available,
 * num_ebikes_available, num_docks_available, is_installed, is_renting, is_returning }.
 */

const TRIP_SCARCE_PENALTY_M = 150; // un dernier vélo vaut moins qu'une station mieux garnie un peu plus loin
const DOCKS_LOW = 3;
const BIKE_KMH = 15;
const DETOUR = 1.35; // rues contre vol d'oiseau

/** Distance en mètres (équirectangulaire, assez juste à l'échelle d'une ville). */
export const distM = (a, b) => {
    const r = Math.PI / 180;
    const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
    const y = (b.lat - a.lat) * r;
    return Math.round(Math.hypot(x, y) * 6_371_000);
};

/** Station rangée pour l'hiver ou fermée : null. */
const open = (st) => Boolean(st && st.is_installed && st.is_renting);

/** Vélos classiques disponibles (les électriques ne comptent pas), null si la station est fermée. */
export const classicBikes = (st) => (open(st) ? Math.max(0, (st.num_bikes_available || 0) - (st.num_ebikes_available || 0)) : null);

/** Places libres pour rendre un vélo, null si la station ne reprend pas de vélos. */
export const freeDocks = (st) => (st && st.is_installed && st.is_returning ? st.num_docks_available || 0 : null);

/** Variation du nombre de vélos sur les `windowMin` dernières minutes ; null sans assez de recul. */
export const trend = (samples = [], now = Date.now(), windowMin = 10) => {
    const from = now - windowMin * 60_000;
    const old = samples.find((s) => s.at >= from - 60_000);
    const last = samples[samples.length - 1];
    if (!old || !last || last.at - old.at < (windowMin - 2) * 60_000) return null;
    return last.bikes - old.bikes;
};

/** Minutes de vélo entre deux stations. */
export const rideMinutes = (a, b) => Math.max(1, Math.round(((distM(a, b) * DETOUR) / 1000 / BIKE_KMH) * 60));

/**
 * Répartit les vélos : chacun sa station de départ, sans viser le même dernier vélo.
 * @param home   [{ id, name, dist, bikes }] stations favorites (bikes null = fermée)
 * @param extras [{ id, name, dist, bikes }] stations de secours autour, triées par distance
 * @param count  nombre de personnes qui partent
 * @returns [{ id, name, dist, bikes, scarce, fallback }] ou null par personne
 */
export const assignStarts = (home, extras, count) => {
    const left = new Map([...home, ...extras].map((s) => [s.id, s.bikes ?? 0]));
    const out = [];
    for (let i = 0; i < count; i++) {
        const cost = (s) => s.dist + (left.get(s.id) === 1 ? TRIP_SCARCE_PENALTY_M : 0);
        const pick = (list) => list.filter((s) => left.get(s.id) > 0).sort((a, b) => cost(a) - cost(b))[0];
        let s = pick(home);
        let fallback = false;
        if (!s) {
            s = pick(extras);
            fallback = Boolean(s);
        }
        if (!s) {
            out.push(null);
            continue;
        }
        out.push({ ...s, scarce: left.get(s.id) === 1, fallback });
        left.set(s.id, left.get(s.id) - 1);
    }
    return out;
};

/** Station d'arrivée : la première de la liste avec assez de places, sinon celle qui en a le plus. */
export const pickDest = (dests) => {
    const ok = dests.filter((d) => d.docks != null);
    if (!ok.length) return null;
    const good = ok.find((d) => d.docks >= DOCKS_LOW);
    const best = good || [...ok].sort((a, b) => b.docks - a.docks)[0];
    return { ...best, low: best.docks < DOCKS_LOW, alt: best !== ok[0] };
};

// Codes WMO : bruine ou pluie verglaçante 56, 57, 66, 67 ; neige 71-77, 85, 86 ; orage 95+
const FREEZING = [56, 57, 66, 67];
const SNOW = [71, 73, 75, 77, 85, 86];

/**
 * Verdict vélo sur l'heure qui vient, d'après les heures Open-Meteo de weather.js.
 * @returns {{ level: 'ok'|'low'|'no', text: string }}
 */
export const bikeVerdict = (hours = [], now = Date.now()) => {
    const next = hours.filter((h) => h.ts + 3600_000 > now && h.ts <= now + 3600_000);
    if (!next.length) return { level: 'ok', text: 'Météo inconnue' };
    const h = next[0];
    const wet = next.some((x) => x.precip >= 0.2 || x.rainProb >= 70);
    if (next.some((x) => FREEZING.includes(x.code) || (x.precip > 0 && x.temp <= 0.5 && !SNOW.includes(x.code)))) return { level: 'no', text: 'Verglas possible, pas de vélo' };
    if (next.some((x) => x.code >= 95)) return { level: 'no', text: 'Orage, pas de vélo' };
    if (next.some((x) => SNOW.includes(x.code) || x.snow >= 0.3)) return { level: 'no', text: 'Neige, pas de vélo' };
    if (wet) return { level: 'low', text: `${Math.round(h.temp)} °C, pluie · imperméable` };
    if (next.some((x) => x.gust >= 50)) return { level: 'low', text: `${Math.round(h.temp)} °C, gros vent` };
    if (h.feels <= -15) return { level: 'low', text: `${Math.round(h.temp)} °C, très froid · couvre-toi` };
    if (h.temp <= 8) return { level: 'ok', text: `${Math.round(h.temp)} °C, sec · prends des gants` };
    return { level: 'ok', text: `${Math.round(h.temp)} °C, parfait pour le vélo` };
};

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Réponse de Jarvis à « Il y a des BIXI ? » */
export const bixiSpeech = (view) => {
    if (!view?.configured) return 'BIXI n’est pas encore réglé : il me faut tes stations.';
    if (view.season === 'closed') return 'Les stations BIXI autour de la maison sont rangées pour l’hiver.';
    if (!view.updatedAt) return 'Je n’arrive pas à joindre BIXI pour le moment.';
    const parts = view.trips.map((t) => {
        const who = t.who;
        if (!t.from) return `${who} : plus aucun vélo classique autour.`;
        const dest = t.to ? `, ${plural(t.to.docks, 'place')} à ${t.to.name}` : '';
        return `${who} : ${plural(t.from.bikes, 'vélo')} à ${t.from.name}${dest}.`;
    });
    if (!view.trips.length) {
        const best = view.home.filter((s) => s.bikes > 0).sort((a, b) => a.dist - b.dist)[0];
        parts.push(best ? `${plural(best.bikes, 'vélo')} à ${best.name}.` : 'Plus aucun vélo classique autour.');
    }
    return `${parts.join(' ')} ${view.verdict.text.replace(/ · /g, ', ')}.`.replace(/\s+/g, ' ').trim();
};

/** « Il y a des BIXI ? », « Reste-t-il des vélos ? » */
export const isBixiQuestion = (text) => /\bbixi\b/i.test(text) || (/\bv[ée]los?\b/i.test(text) && /\?|reste|y a|combien|dispo/i.test(text));

/**
 * Alertes du matin, dans la fenêtre de départ. Chaque clé n'est envoyée qu'une fois par jour.
 * @param view vue de bixi.getView()
 * @returns [{ key, text, lamp }] lamp = la lampe signal respire en rouge BIXI
 */
export const departureAlerts = (view) => {
    if (!view?.configured || view.season !== 'open' || !view.updatedAt) return [];
    const out = [];
    if (view.verdict?.level === 'no') {
        return [{ key: 'weather', text: `🚲 Pas de BIXI ce matin : ${view.verdict.text.charAt(0).toLowerCase()}${view.verdict.text.slice(1)}.`, lamp: false }];
    }
    const count = view.trips.length || 1;
    const total = view.home.reduce((n, s) => n + (s.bikes || 0), 0);
    const draining = view.home.reduce((n, s) => n + Math.min(0, s.trend ?? 0), 0);
    const backup = (view.extras || []).find((s) => !view.home.some((h) => h.id === s.id) && s.bikes >= 3);
    const tip = backup ? ` Le plus proche bien garni : ${backup.name} (${backup.bikes} vélos, ${backup.dist} m).` : '';
    if (total < count) {
        out.push({ key: 'bikes', text: `🚲 ${total ? `Plus que ${plural(total, 'vélo classique')}` : 'Plus aucun vélo classique'} à vos stations.${tip}`, lamp: true });
    } else if (total === count && draining <= -2) {
        out.push({ key: 'bikes', text: `🚲 Il reste juste ${plural(total, 'vélo classique')} et ça part vite : partez maintenant.${tip}`, lamp: true });
    }
    for (const t of view.trips) {
        if (!t.to || (!t.to.low && !t.to.alt)) continue;
        const text = t.to.low
            ? `🅿️ ${t.who} : presque plus de places à l’arrivée, ${plural(t.to.docks, 'place')} à ${t.to.name}.`
            : `🅿️ ${t.who} : la station d’arrivée habituelle est pleine, ${t.to.name} a ${plural(t.to.docks, 'place')}.`;
        out.push({ key: `docks:${t.who}`, text, lamp: false });
    }
    return out;
};
