// Décisions de l'écran de la cuisine, sans réseau (testées dans kitchenDisplay.test.js)

export const DASHCAST_APP_ID = '84912283';
export const PAUSE_MS = 30 * 60_000;
/** Un envoi raté ne se retente pas plus souvent que ça */
export const RETRY_MS = 2 * 60_000;

const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
};

/** Dans la plage [from, to[ ; une plage qui passe minuit (22:00 → 02:00) marche aussi. */
export const inHours = (min, from, to) => {
    const a = toMin(from);
    const b = toMin(to);
    return a <= b ? min >= a && min < b : min >= a || min < b;
};

/**
 * Un pas de décision, sans réseau.
 * state : { session: id de notre DashCast ou null, pausedUntil, lastTryAt, keepUntil }
 * → { action: 'show' | 'stop' | 'none', state }
 */
export const step = ({ now, min, apps, config: cfg, state }) => {
    const s = { ...state };
    if (!cfg.enabled) return { action: 'none', state: s };
    const dash = apps.find((a) => a.appId === DASHCAST_APP_ID);
    const others = apps.filter((a) => a.appId !== DASHCAST_APP_ID);

    if (!inHours(min, cfg.from, cfg.to)) {
        s.pausedUntil = 0;
        // Affichée à la main le soir : on la laisse une heure
        if (now < (s.keepUntil || 0)) return { action: 'none', state: s };
        if (dash && dash.sessionId === s.session) {
            s.session = null;
            return { action: 'stop', state: s, sessionId: dash.sessionId };
        }
        s.session = null;
        return { action: 'none', state: s };
    }

    // Musique, YouTube… : on ne touche à rien, et notre vue a été remplacée, pas arrêtée
    if (others.length) {
        s.session = null;
        return { action: 'none', state: s };
    }
    if (dash) {
        s.session = dash.sessionId;
        return { action: 'none', state: s };
    }
    // Le Hub est libre alors que notre vue y était : quelqu'un l'a arrêtée
    if (s.session) {
        s.session = null;
        s.pausedUntil = now + PAUSE_MS;
        return { action: 'none', state: s };
    }
    if (now < (s.pausedUntil || 0)) return { action: 'none', state: s };
    if (now - (s.lastTryAt || 0) < RETRY_MS) return { action: 'none', state: s };
    s.lastTryAt = now;
    return { action: 'show', state: s };
};


const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * « Affiche MyHue dans la cuisine », « allume l'écran de la cuisine » → true.
 * Il faut parler d'écran ou d'affichage : « allume la cuisine » reste aux lumières.
 */
export const isKitchenShowCommand = (text) => {
    const t = norm(text);
    if (!/cuisine/.test(t)) return false;
    return /\b(affiche|montre|mets|remets|lance|allume)\b.*\b(ecran|myhue|my hue|tableau|vue)\b/.test(t)
        || /\b(affiche|montre)\b.*\b(sur|dans)\b.*\bcuisine\b/.test(t) && !/\b(lumiere|lampe|meteo|recette)\b/.test(t);
};
