/**
 * Communauto Flex : décisions pures (autos dans le rayon, phrases, commandes vocales),
 * sans réseau, testées dans communauto.test.js.
 * Auto du flux : { CarId, CarBrand, CarModel, CarColor, CarPlate, Latitude, Longitude,
 * IsElectric, EnergyLevel (batterie % des électriques, null sinon) }.
 */
import { distM } from './bixiLogic.js';

export { distM };

export const RADII = [300, 500, 800, 1000];
export const DURATIONS = [15, 30, 60, 120];

const COLORS = {
    white: 'blanche', black: 'noire', silver: 'grise', grey: 'grise', gray: 'grise', red: 'rouge',
    blue: 'bleue', green: 'verte', yellow: 'jaune', orange: 'orange', brown: 'brune', beige: 'beige',
};

const DIRS = ['au nord', 'au nord-est', 'à l’est', 'au sud-est', 'au sud', 'au sud-ouest', 'à l’ouest', 'au nord-ouest'];

/** Direction depuis `from` vers `to`, en mots (« au sud-est »). */
export const direction = (from, to) => {
    const r = Math.PI / 180;
    const x = (to.lon - from.lon) * Math.cos(((from.lat + to.lat) / 2) * r);
    const y = to.lat - from.lat;
    const deg = (Math.atan2(x, y) / r + 360) % 360;
    return DIRS[Math.round(deg / 45) % 8];
};

/** Une auto du flux, ramenée à ce qui sert, avec sa distance et sa direction depuis la maison. */
export const toCar = (v, home) => {
    const pos = { lat: v.Latitude, lon: v.Longitude };
    return {
        id: String(v.CarId),
        model: [v.CarBrand, v.CarModel].filter(Boolean).join(' ').trim() || 'Auto',
        color: COLORS[String(v.CarColor || '').toLowerCase()] || null,
        plate: v.CarPlate || null,
        electric: Boolean(v.IsElectric),
        battery: v.IsElectric && Number.isFinite(v.EnergyLevel) ? v.EnergyLevel : null,
        lat: pos.lat,
        lon: pos.lon,
        dist: distM(home, pos),
        dir: direction(home, pos),
    };
};

/** Autos à moins de `radiusM`, de la plus proche à la plus loin. */
export const carsWithin = (vehicles, home, radiusM) =>
    (vehicles || [])
        .filter((v) => Number.isFinite(v?.Latitude) && Number.isFinite(v?.Longitude))
        .map((v) => toCar(v, home))
        .filter((c) => c.dist <= radiusM)
        .sort((a, b) => a.dist - b.dist);

/** Autos du rayon qu'on n'a pas encore annoncées. */
export const newArrivals = (cars, announced = []) => {
    const seen = new Set(announced.map(String));
    return cars.filter((c) => !seen.has(c.id));
};

/** « Kia Niro EV blanche (17 %) » */
export const carLabel = (c) => {
    const battery = c.battery != null ? ` (${c.battery} %)` : '';
    return `${c.model}${c.color ? ` ${c.color}` : ''}${battery}`;
};

/** « rue Rachel, à 280 m au sud-est » ; sans rue : « à 280 m au sud-est » */
export const whereLabel = (c) => `${c.street ? `${c.street}, ` : ''}à ${c.dist} m ${c.dir}`;

/** Message de découverte (Telegram et voix). */
export const foundText = (cars) => {
    if (!cars.length) return '';
    const [first, ...rest] = cars;
    const more = rest.length ? ` Et ${rest.length === 1 ? 'une autre' : `${rest.length} autres`} : ${rest.map((c) => `${c.model} à ${c.dist} m`).join(', ')}.` : '';
    return `J’ai trouvé une Communauto : ${carLabel(first)}, ${whereLabel(first)}.${more} Réserve-la dans l’appli.`;
};

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Réponse vocale à « Il y a des Communauto ? » ou après le lancement d'une recherche. */
export const communautoSpeech = (view) => {
    if (!view) return 'Je n’arrive pas à joindre Communauto pour le moment.';
    const s = view.search;
    if (s?.active) {
        const live = s.found.filter((c) => !c.gone);
        const left = Math.max(1, Math.round((s.until - Date.now()) / 60_000));
        if (live.length) return `${foundText(live)} Je continue de chercher encore ${left} min.`;
        return `Je cherche une Communauto à moins de ${s.radiusM} m, encore ${left} min. Je te préviens dès qu’il y en a une.`;
    }
    if (!view.updatedAt) return 'Je n’arrive pas à joindre Communauto pour le moment.';
    const near = view.nearby;
    if (!near.length) return `Aucune Communauto Flex à moins de ${view.radiusM} m. Dis-moi « trouve-moi une Communauto » et je surveille.`;
    const c = near[0];
    return `${plural(near.length, 'Communauto')} à moins de ${view.radiusM} m. La plus proche : ${carLabel(c)}, à ${c.dist} m ${c.dir}.`;
};

/**
 * Commande vocale Communauto, ou null.
 * « Trouve-moi une Communauto à 300 m » → { action: 'start', radiusM: 300 }
 * « Arrête de chercher une Communauto » → { action: 'stop' }
 * « Il y a des Communauto ? » → { action: 'status' }
 */
export const parseCommunautoCommand = (text) => {
    const t = String(text || '').toLowerCase();
    if (!/communauto|auto[- ]?partage/.test(t)) return null;
    if (/annule.*(blocage|r[ée]servation)|d[ée]bloque/.test(t)) return { action: 'cancel' };
    if (/arr[êe]te|stop|annule|laisse tomber|c.est bon|j.ai r[ée]serv/.test(t)) return { action: 'stop' };
    if (/trouve|cherche|surveille|lance|r[ée]serve|bloque|guette|il me faut|j.ai besoin/.test(t)) {
        // « réserve » ou « bloque » : MyHue bloque lui-même la première auto dans l'appli
        const autoBook = /r[ée]serv|bloque/.test(t);
        // « autour de moi » : la recherche suit le téléphone au lieu de la maison
        const nearMe = /autour de moi|pr[èe]s de moi|o[uù] je suis|ma position/.test(t);
        const m = /(\d+(?:[.,]\d+)?)\s*(km|kilom[èe]tres?|m\b|m[èe]tres?)/.exec(t);
        let radiusM = null;
        if (m) {
            const n = Number(m[1].replace(',', '.'));
            radiusM = Math.round(/^k/.test(m[2]) ? n * 1000 : n);
        }
        return { action: 'start', radiusM, autoBook, nearMe };
    }
    return { action: 'status' };
};

/** Lien pour ouvrir l'appli Communauto sur Android (site web si elle n'est pas installée). */
export const APP_LINK = 'intent://#Intent;package=com.communauto.reservauto;S.browser_fallback_url=https%3A%2F%2Fwww.communauto.com;end';

/** Ouvre l'appli directement sur la fiche de cette Flex (lien de l'appli, forcé vers son paquet). */
export const carAppLink = (carId) => `intent://client.reservauto.net/quebec/dashboard/map/free-floating-info/${encodeURIComponent(carId)}#Intent;scheme=https;package=com.communauto.reservauto;S.browser_fallback_url=https%3A%2F%2Fwww.communauto.com;end`;

/** Itinéraire à pied vers l'auto. */
export const walkLink = (c) => `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${c.lat},${c.lon}`;
