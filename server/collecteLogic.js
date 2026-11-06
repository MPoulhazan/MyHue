/**
 * Collecte des bacs : décisions pures, testées dans collecte.test.js.
 * Un bac = { id, label, weekday (0 = dimanche, soir où on le sort), from: 'HH:MM', color: 'teal'|'green'|… }
 */

export const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

/** Le bac à sortir ce soir, entre son heure et l'heure d'arrêt ; null sinon. */
export const activeBin = (bins, { weekday, minutes }, stopAt = '23:30') =>
    bins.find((b) => b.weekday === weekday && minutes >= toMin(b.from) && minutes < toMin(stopAt)) || null;

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Prochain soir de sortie à partir de maintenant : { bin, inDays, label: « ce soir », « demain soir », « lundi soir » }. */
export const nextBin = (bins, { weekday, minutes }, stopAt = '23:30') => {
    let best = null;
    for (const b of bins) {
        let d = (b.weekday - weekday + 7) % 7;
        if (d === 0 && minutes >= toMin(stopAt)) d = 7;
        if (!best || d < best.inDays || (d === best.inDays && toMin(b.from) < toMin(best.bin.from))) best = { bin: b, inDays: d };
    }
    if (!best) return null;
    const label = best.inDays === 0 ? 'ce soir' : best.inDays === 1 ? 'demain soir' : `${DAYS[best.bin.weekday]} soir`;
    return { ...best, label };
};

/** Phrases : rappel de 19 h, relance de 22 h, question à la porte. */
export const reminderText = (bin) => `🗑️ ${bin.label} : sors le bac ce soir, la collecte passe demain matin.`;
export const lateText = (bin) => `🗑️ Le bac n’est toujours pas sorti (${bin.label.toLowerCase()}), la collecte passe demain matin.`;
export const doorText = (bin) => `🚪 Tu sors ? ${bin.label} : le bac est sorti ?`;
