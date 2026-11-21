// ── Ambiance « Noël » de l'écran Musique, de fin novembre au 31 décembre ────
//
// Fonctions pures, testées dans christmasMusic.test.js. Sans playlist associée, l'ambiance
// cherche des titres sur YouTube, et la recherche change avec le moment de la journée.

import { christmasSeason } from './seasonLogic.js';

/** Moment de la journée (bandes de musicHabits.slotOf) → recherche et sous-titre. */
const BY_BAND = {
    matin: { query: 'chansons de Noël françaises classiques Tino Rossi', hint: 'Les chants de Noël d’autrefois' },
    matinee: { query: 'chansons de Noël françaises classiques Tino Rossi', hint: 'Les chants de Noël d’autrefois' },
    midi: { query: 'Christmas pop hits playlist', hint: 'Les tubes de Noël' },
    aprem: { query: 'Christmas pop hits playlist', hint: 'Les tubes de Noël' },
    soir: { query: 'Christmas jazz Vince Guaraldi Nat King Cole', hint: 'Jazz de Noël au coin du feu' },
    nuit: { query: 'Christmas piano calm instrumental', hint: 'Piano de Noël tout doux' },
};

export const christmasMusicOn = (now, tz) => christmasSeason(now, tz).on;

/** La recherche de l'ambiance pour ce moment de la journée. */
export const christmasQuery = (band) => (BY_BAND[band] || BY_BAND.soir).query;
export const christmasHint = (band) => (BY_BAND[band] || BY_BAND.soir).hint;

/**
 * Suggestion par défaut en saison : Noël le matin, au repas et le soir ;
 * le reste du temps (concentration, nuit) l'ambiance habituelle.
 */
export const christmasDefault = (band) => ['matin', 'midi', 'soir'].includes(band);

// ── Neige sur la tablette ────────────────────────────────────────────────────

/**
 * Intensité de la neige qui tombe (0 à 1) d'après le code météo WMO d'Open-Meteo.
 * 71/77/85 : faible, 73 : modérée, 75/86 : forte. Le reste : pas de neige.
 */
export function snowIntensity(code) {
    if ([71, 77, 85].includes(code)) return 0.4;
    if (code === 73) return 0.7;
    if ([75, 86].includes(code)) return 1;
    return 0;
}
