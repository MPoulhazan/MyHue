// Commande vocale de pause d'un capteur, sans réseau (testée dans sensorPauseLogic.test.js)

const norm = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[’']/g, ' ');

// « Mets la musique en pause » appartient au lecteur, pas aux capteurs
const MUSIC = /\b(musique|chanson|son|radio|video|youtube|lecture|morceau|playlist|chromecast)\b/;
const SENSOR_WORD = /\b(capteur|detecteur|escalier|mouvement)\b/;
const RESUME = /\b(reactive[rsz]?|reveille[rsz]?|relance[rsz]?|remets? en marche|(sors?|enleve[rsz]?|retire[rsz]?|fin de) (de )?(la )?pause)\b/;
const PAUSE = /\b(pause|desactive[rsz]?|coupe[rsz]?|ignore[rsz]?|endors?)\b/;

/** Durée demandée : '1h' | 'morning' | 'forever' | minutes ; par défaut jusqu'à demain matin. */
export const parseDuration = (t) => {
    const n = norm(t);
    const m = n.match(/\b(\d+|une|un|deux|trois)\s*(h|heures?|min|minutes?)\b/);
    if (m) {
        const qty = { une: 1, un: 1, deux: 2, trois: 3 }[m[1]] ?? Number(m[1]);
        return m[2].startsWith('h') ? (qty === 1 ? '1h' : qty * 60) : qty;
    }
    if (/\b(une demi[- ]heure)\b/.test(n)) return 30;
    if (/\b(definitivement|toujours|jusqu a ce que|nouvel ordre|indefiniment)\b/.test(n)) return 'forever';
    return 'morning';
};

/**
 * Le capteur visé : son nom dit dans la phrase, sinon « escalier » / « mouvement »
 * = le détecteur de mouvement de l'entrée (l'escalier, chez nous), sinon le seul détecteur de mouvement.
 * sensors : [{ ieee, name, type, room }]
 */
export const findTarget = (text, sensors) => {
    const n = norm(text);
    const byName = sensors
        .filter((s) => s.name && new RegExp(`\\b${norm(s.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(n))
        .sort((a, b) => (a.type === 'motion' ? -1 : 0) - (b.type === 'motion' ? -1 : 0) || b.name.length - a.name.length);
    if (byName.length) return byName[0];
    const motion = sensors.filter((s) => s.type === 'motion');
    if (/\b(escalier|entree|mouvement)\b/.test(n)) {
        const entrance = motion.find((s) => /entr[ée]e|escalier/i.test(`${s.room || ''} ${s.name}`));
        if (entrance) return entrance;
    }
    return motion.length === 1 ? motion[0] : null;
};

/**
 * « Mets l'escalier en pause pour la soirée », « coupe le capteur de l'entrée 1 h », « réactive l'escalier ».
 * → { action: 'pause', sensor, duration } | { action: 'resume', sensor } | { action: 'unknown' } | null
 */
export const parseSensorPauseCommand = (text, sensors) => {
    const n = norm(text);
    if (MUSIC.test(n)) return null;
    const resume = RESUME.test(n);
    const pause = !resume && PAUSE.test(n);
    if (!resume && !pause) return null;
    // Sans « pause » explicite, il faut parler d'un capteur (« coupe la lumière » n'est pas pour nous)
    if (!/\bpause\b/.test(n) && !SENSOR_WORD.test(n)) return null;
    // « Réactive » seul est trop vague : il faut un capteur ou la pause
    if (resume && !SENSOR_WORD.test(n) && !/\bpause\b/.test(n)) return null;
    const sensor = findTarget(text, sensors);
    if (!sensor) return SENSOR_WORD.test(n) ? { action: 'unknown' } : null;
    return resume ? { action: 'resume', sensor } : { action: 'pause', sensor, duration: parseDuration(text) };
};
