/**
 * Déclencheurs à l'heure des automatismes (logique pure, testée).
 *
 * trigger : { type: 'time', at: 'HH:MM' | 'sunrise' | 'sunset', offsetMinutes?, days?: [0..6] }
 * (0 = dimanche ; days vide ou absent = tous les jours).
 */

export const DAY_SHORT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
// Rattrapage : un redémarrage du serveur juste après l'heure ne fait pas sauter le rendez-vous
export const CATCH_UP_MIN = 10;
// Heures calmes : avant 11 h et dès 22 h, jamais plus fort que ça au démarrage
export const QUIET_CAP = 30;
const QUIET_FROM = 22 * 60;
const QUIET_UNTIL = 11 * 60;
const DEFAULT_QUIET_VOLUME = 20;

const toMin = (hhmm) => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Minute du jour visée, ou null (heure invalide, soleil inconnu). sun : { sunrise, sunset } en minutes locales. */
export const targetMinutes = (trigger, sun) => {
    const base = trigger.at === 'sunrise' || trigger.at === 'sunset' ? sun?.[trigger.at] ?? null : toMin(trigger.at);
    if (base == null) return null;
    return Math.max(0, Math.min(24 * 60 - 1, base + (Number(trigger.offsetMinutes) || 0)));
};

/**
 * Le rendez-vous est-il à tenir maintenant ?
 * now : { day: 'YYYY-MM-DD', weekday: 0..6, minutes } en heure locale ; lastFiredDay : jour du dernier déclenchement.
 */
export const timeTriggerDue = (trigger, now, sun, lastFiredDay) => {
    if (lastFiredDay === now.day) return false;
    if (Array.isArray(trigger.days) && trigger.days.length && !trigger.days.includes(now.weekday)) return false;
    const target = targetMinutes(trigger, sun);
    if (target == null) return false;
    return now.minutes >= target && now.minutes < target + CATCH_UP_MIN;
};

/** Volume de démarrage (0-100) : demandé, plafonné aux heures calmes ; null = ne pas toucher. */
export const startVolume = (requested, minutes) => {
    const quiet = minutes < QUIET_UNTIL || minutes >= QUIET_FROM;
    const v = requested == null || requested === '' ? null : Math.max(0, Math.min(100, Math.round(Number(requested))));
    if (!quiet) return v;
    return Math.min(v ?? DEFAULT_QUIET_VOLUME, QUIET_CAP);
};

const daysLabel = (days) => {
    if (!Array.isArray(days) || !days.length || days.length === 7) return 'tous les jours';
    const set = [...days].sort((a, b) => a - b).join();
    if (set === '1,2,3,4,5') return 'en semaine';
    if (set === '0,6') return 'la fin de semaine';
    // Lundi d'abord, dimanche à la fin
    return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_SHORT[d]).join(', ');
};

/** « à 10:00 lun, mar, jeu », « 15 min avant le coucher du soleil en semaine ». */
export const describeTimeTrigger = (t) => {
    const off = Number(t.offsetMinutes) || 0;
    let when;
    if (t.at === 'sunrise' || t.at === 'sunset') {
        const sun = t.at === 'sunrise' ? 'lever du soleil' : 'coucher du soleil';
        when = off ? `${Math.abs(off)} min ${off < 0 ? 'avant' : 'après'} le ${sun}` : `au ${sun}`;
    } else {
        when = `à ${t.at}`;
    }
    return `${when} ${daysLabel(t.days)}`;
};

/** Valide et nettoie un déclencheur horaire venu de l'API ; lève une erreur lisible. */
export const cleanTimeTrigger = ({ at, offsetMinutes, days } = {}) => {
    if (at !== 'sunrise' && at !== 'sunset' && toMin(at) == null) throw new Error('Heure invalide (HH:MM, sunrise ou sunset)');
    const d = days == null ? [] : (Array.isArray(days) ? days : [days]).map(Number);
    if (d.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) throw new Error('Jours invalides (0 = dimanche … 6 = samedi)');
    const normAt = toMin(at) == null ? at : `${String(Math.floor(toMin(at) / 60)).padStart(2, '0')}:${String(toMin(at) % 60).padStart(2, '0')}`;
    return { type: 'time', at: normAt, offsetMinutes: Number(offsetMinutes) || 0, days: [...new Set(d)].sort((a, b) => a - b) };
};
