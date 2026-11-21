/**
 * Rôle d'un thermomètre : sonde de pièce, sonde dehors (balcon) ou sonde sur la hotte (cuisinière).
 * Seules les sondes de pièce comptent pour le chauffage, les courants d'air et l'humidité :
 * le balcon à −10° n'est pas une « panne de chauffage », et la hotte à 35° pas une pièce surchauffée.
 *
 * Le registre peut fixer `role` ; sinon on devine d'après le nom et la pièce.
 */

const OUTDOOR = /ext[ée]rieur|dehors|balcon|jardin|outdoor/i;
const STOVE = /cuisini[èe]re|hotte|fourneau|\bfour\b|stove/i;

/** @returns {'indoor'|'outdoor'|'stove'|null} null = pas un thermomètre */
export const roleOf = (s) => {
    if (!s) return null;
    const isThermo = s.type === 'temperature_humidity' || s.props?.temperature != null;
    if (!isThermo) return null;
    if (['indoor', 'outdoor', 'stove'].includes(s.role)) return s.role;
    if (STOVE.test(s.name || '')) return 'stove';
    if (OUTDOOR.test(s.name || '') || OUTDOOR.test(s.room || '')) return 'outdoor';
    return 'indoor';
};

export const indoorClimate = (sensors) => sensors.filter((s) => s.props?.temperature != null && roleOf(s) === 'indoor');
export const outdoorSensor = (sensors) => sensors.find((s) => roleOf(s) === 'outdoor') || null;
export const stoveSensor = (sensors) => sensors.find((s) => roleOf(s) === 'stove') || null;
