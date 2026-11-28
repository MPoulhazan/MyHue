/**
 * Chauffage quand la maison se vide : décisions pures (testées dans heatingAwayLogic.test.js).
 *
 * - Départ (déjà filtré : 15 min sans aucun téléphone sur le Wi-Fi, sortir les poubelles ne compte pas) :
 *   consigne −2° seulement. Une sortie courte ne refroidit presque rien, la remontée est rapide.
 * - Toujours personne après 2 h : consigne d'absence (17°). Très froid dehors (< −15°) : jamais sous 18°,
 *   la thermopompe rendrait moins bien et mettrait des heures à remonter.
 * - Retour : la consigne d'avant revient, sauf si quelqu'un l'a changée entre-temps (on lui laisse la main).
 * - Jamais de marche/arrêt : seulement la consigne, et seulement thermopompe allumée en chauffage.
 */
export const MIN = 60_000;

export const DEFAULTS = {
    enabled: true,
    firstDrop: 2, // degrés en moins dès le départ
    deepAfterMin: 120, // puis consigne d'absence après…
    awayTarget: 17,
    coldBelow: -15, // dehors sous ce seuil…
    coldMin: 18, // …jamais sous cette consigne
};

const clamp = (t) => Math.max(16, Math.min(31, Math.round(t)));

/** Plancher selon le froid dehors. */
export const floorFor = (cfg, outdoor) => (outdoor != null && outdoor < cfg.coldBelow ? Math.max(cfg.awayTarget, cfg.coldMin) : cfg.awayTarget);

/** Consigne visée pour une absence qui dure depuis `awayMin` minutes, à partir de la consigne d'avant. */
export const ecoTarget = (base, awayMin, cfg, outdoor = null) => {
    const floor = floorFor(cfg, outdoor);
    const want = awayMin >= cfg.deepAfterMin ? floor : Math.max(floor, base - cfg.firstDrop);
    return clamp(Math.min(base, want));
};

/**
 * Décision d'un tour.
 * @param st       { active, base, sent, leftAt, userTook } (null = rien en cours)
 * @param heating  { power, mode, temperature }
 * @param home     true / false / null (inconnu : on ne fait rien)
 * @param flex     { base, sent, active } état Flex D en cours, ou null
 * @returns { st, patch?, log? } ou null si rien ne change
 */
export const decide = ({ st, heating, home, now, outdoor = null, cfg = DEFAULTS, flex = null }) => {
    if (home === null || home === undefined) return null;
    const heatingOn = heating.power && heating.mode === 'heat';

    if (home === true) {
        if (!st?.active) return null;
        const untouched = !st.userTook && (heating.temperature === st.sent || (flex?.sent != null && heating.temperature === flex.sent));
        if (heatingOn && untouched && st.base !== heating.temperature) {
            return { st: null, patch: { temperature: st.base }, log: `Retour : consigne remise à ${st.base}°` };
        }
        return { st: null };
    }

    // Personne à la maison
    if (!st?.active) {
        if (!cfg.enabled || !heatingOn) return null;
        // Pointe Flex D en cours : la vraie consigne d'avant est celle de Flex D
        const base = flex?.active && flex.base != null ? flex.base : heating.temperature;
        const target = ecoTarget(base, 0, cfg, outdoor);
        const next = { active: true, base, sent: target, leftAt: now, userTook: false };
        if (target >= heating.temperature) return { st: { ...next, sent: heating.temperature } };
        return { st: next, patch: { temperature: target }, log: `Plus personne : consigne ${heating.temperature} → ${target}° (−${base - target}°)` };
    }
    if (st.userTook) return null;
    // Quelqu'un a changé la consigne à distance (Flex D, lui, ne compte pas)
    if (heating.temperature !== st.sent && heating.temperature !== flex?.sent) return { st: { ...st, userTook: true }, log: 'Absence : consigne changée à la main, on n’y touche plus' };
    if (!heatingOn || flex?.active) return null;
    const target = ecoTarget(st.base, (now - st.leftAt) / MIN, cfg, outdoor);
    if (target >= st.sent) return null;
    return { st: { ...st, sent: target }, patch: { temperature: target }, log: `Toujours personne depuis ${Math.round((now - st.leftAt) / 3600_000)} h : consigne ${st.sent} → ${target}°` };
};
