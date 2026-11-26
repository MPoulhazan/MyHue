// ── Ambiance « Noël » de l'écran Musique, de fin novembre au 31 décembre ────
//
// Fonctions pures, testées dans christmasMusic.test.js. Sans playlist associée, l'ambiance
// joue la radio « Noël crooners » (181.FM Christmas Standards) en direct.

import { christmasSeason } from './seasonLogic.js';

export const christmasMusicOn = (now, tz) => christmasSeason(now, tz).on;

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
