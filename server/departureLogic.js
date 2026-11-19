/**
 * Logique pure de l'heure de départ (testée dans departureLogic.test.js) : quels rendez-vous
 * méritent un itinéraire, et lecture d'une réponse Google Routes (computeRoutes, TRANSIT).
 */

/** Arriver quelques minutes avant le rendez-vous. */
export const MARGIN_MIN = 5;

/** Un lieu où l'on se rend vraiment (pas une visio, pas un lien). */
export const isPlace = (location) => {
    const l = String(location || '').trim();
    if (l.length < 4) return false;
    return !/https?:\/\/|zoom|meet\.google|teams|webex|visio|en ligne|online|t[ée]l[ée]phone/i.test(l);
};

/** Rendez-vous d'aujourd'hui pour lesquels on calcule un départ. */
export const needsRoute = (e, now, horizonMs = 14 * 3600_000) =>
    !e.allDay && isPlace(e.location) && e.start > now && e.start - now < horizonMs;

const seconds = (d) => Number(String(d || '0s').replace(/s$/, '')) || 0;

const SUBWAY = /orange|verte|bleue|jaune/i;
/** « bus 24 », « métro orange », « REM », « train exo 1 » */
export const lineLabel = (line) => {
    if (!line) return null;
    const type = line.vehicle?.type || '';
    const short = line.nameShort || '';
    const name = line.name || '';
    if (type === 'SUBWAY' || type === 'METRO_RAIL') {
        const color = (name.match(SUBWAY) || short.match(SUBWAY) || [])[0];
        return color ? `métro ${color.toLowerCase()}` : `métro ${short || name}`.trim();
    }
    if (/REM/i.test(name) || /REM/i.test(short)) return 'REM';
    if (type === 'BUS' || type === 'INTERCITY_BUS' || type === 'TROLLEYBUS') return `bus ${short || name}`.trim();
    if (type.includes('RAIL') || type === 'COMMUTER_TRAIN' || type === 'HEAVY_RAIL') return `train ${short || name}`.trim();
    return (short || name || null);
};

/**
 * Départ d'après la première route Google : heure à laquelle quitter la maison et ligne prise.
 * @param data réponse de computeRoutes (champ routes)
 * @param arriveBy ms epoch : l'heure où il faut être là
 * @returns {{ at, via, minutes, walk } | null}
 */
export const parseRoute = (data, arriveBy) => {
    const route = data?.routes?.[0];
    if (!route) return null;
    const steps = route.legs?.flatMap((l) => l.steps || []) || [];
    const total = seconds(route.duration);
    const firstTransit = steps.findIndex((s) => s.travelMode === 'TRANSIT' && s.transitDetails);
    if (firstTransit < 0) {
        // À pied (ou trop près pour un bus) : on part la durée du trajet avant l'heure voulue
        return { at: arriveBy - total * 1000, via: 'à pied', minutes: Math.round(total / 60), walk: true };
    }
    const t = steps[firstTransit].transitDetails;
    const boardAt = Date.parse(t.stopDetails?.departureTime);
    const walkBefore = steps.slice(0, firstTransit).reduce((sum, s) => sum + seconds(s.staticDuration), 0);
    const at = Number.isFinite(boardAt) ? boardAt - walkBefore * 1000 : arriveBy - total * 1000;
    const lines = steps.filter((s) => s.travelMode === 'TRANSIT' && s.transitDetails).map((s) => lineLabel(s.transitDetails.transitLine)).filter(Boolean);
    const via = [...new Set(lines)].slice(0, 2).join(' puis ');
    const lastArrive = Date.parse(steps.filter((s) => s.transitDetails).at(-1)?.transitDetails?.stopDetails?.arrivalTime);
    const walkAfter = steps.slice(steps.map((s) => Boolean(s.transitDetails)).lastIndexOf(true) + 1).reduce((sum, s) => sum + seconds(s.staticDuration), 0);
    const arrive = Number.isFinite(lastArrive) ? lastArrive + walkAfter * 1000 : at + total * 1000;
    return { at, via: via || null, minutes: Math.round((arrive - at) / 60_000), walk: false };
};
