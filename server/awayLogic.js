/**
 * Décisions de la maison vide (testées dans awayLogic.test.js) : à quelle phase on est,
 * quelle radio pour Cooper, et le plan de la simulation de présence du soir.
 */
export const HOUR = 3600_000;
export const LONG_AFTER_MS = 12 * HOUR; // porte d'entrée fermée 12 h et personne : week-end, Cooper est avec nous
export const GUARD_AFTER_MS = 24 * HOUR; // 24 h : on est vraiment partis, l'alarme s'arme
export const RETURN_HOLD_MS = 30 * 60_000; // porte ouverte sans téléphone revu : « quelqu'un est là » pendant 30 min
export const ARRIVAL_DEDUP_MS = 10 * 60_000;

// Radios douces pour un chien seul, dans l'ordre de rotation
export const CALM_RADIOS = ['classical', 'piano', 'jazz', 'ambient'];
export const RADIO_FROM = 7 * 60; // pas de radio la nuit : Cooper fait dodo à 21 h
export const RADIO_TO = 21 * 60;
export const RADIO_SWITCH_MIN = 90;

/**
 * 'home' : quelqu'un est là (ou vient de rentrer par la porte) ;
 * 'out' : sortie courte, Cooper est seul (veilleuse, radio) ;
 * 'long' : porte fermée depuis 12 h ou mode vacances : simulation de présence ;
 * 'guard' : porte fermée depuis 24 h : simulation et alarme.
 */
export const phaseOf = ({ anyoneHome, lastDoorAt, returnedAt, guardMode, now }) => {
    if (returnedAt && now - returnedAt < RETURN_HOLD_MS) return 'home';
    if (anyoneHome !== false) return 'home';
    const quiet = lastDoorAt ? now - lastDoorAt : 0;
    if (quiet >= GUARD_AFTER_MS) return 'guard';
    if (quiet >= LONG_AFTER_MS || guardMode === 'vacation') return 'long';
    return 'out';
};

/** Radio du moment : elle change toutes les 90 min, et chaque départ commence ailleurs. */
export const radioAt = (leftAt, now, seed = 0) =>
    CALM_RADIOS[(seed + Math.floor(Math.max(0, now - (leftAt ?? now)) / (RADIO_SWITCH_MIN * 60_000))) % CALM_RADIOS.length];

export const radioHours = (min) => min >= RADIO_FROM && min < RADIO_TO;

/** Il fait noir dans la maison : soleil sous 3° (l'intérieur s'assombrit avant le coucher). Sans soleil connu : 18 h – 7 h. */
export const isDark = (elevation, min) => (elevation != null ? elevation < 3 : min >= 18 * 60 || min < 7 * 60);

// Coucher du soleil approximatif à Montréal, par mois, si la météo est injoignable
const SUNSET_BY_MONTH = [16 * 60 + 40, 17 * 60 + 20, 18 * 60, 19 * 60 + 35, 20 * 60 + 10, 20 * 60 + 40, 20 * 60 + 35, 20 * 60, 19 * 60 + 5, 18 * 60 + 10, 16 * 60 + 30, 16 * 60 + 15];
export const fallbackSunset = (month) => SUNSET_BY_MONTH[month] ?? 18 * 60;

/**
 * Plan d'une soirée simulée (minutes depuis minuit) : le salon dès la nuit tombée jusqu'au coucher,
 * la cuisine pour le souper, la salle à manger un moment. Les heures changent chaque soir.
 * Rien ne s'allume en plein jour : en été, souper et salle à manger glissent après le coucher du soleil.
 */
export const planSimDay = (sunset, rand = Math.random) => {
    const r = (a, b) => a + Math.floor(rand() * Math.max(1, b - a));
    const dusk = Math.max(sunset, 16 * 60);
    const offAt = r(22 * 60 + 30, 23 * 60 + 30);
    const onAt = Math.min(dusk + r(0, 20), offAt - 60);
    const rooms = [{ room: 'salon', on: onAt, off: offAt }];
    const kitchen = Math.max(r(18 * 60, 19 * 60 + 15), dusk + 5);
    const kitchenEnd = kitchen + (kitchen > 21 * 60 + 30 ? r(10, 16) : r(30, 46));
    if (kitchenEnd < offAt - 10) rooms.push({ room: 'cuisine', on: kitchen, off: kitchenEnd });
    const dining = Math.max(r(19 * 60 + 30, 20 * 60 + 30), dusk + 10);
    const diningEnd = Math.min(dining + r(40, 71), offAt - 15);
    if (diningEnd - dining >= 20) rooms.push({ room: 'salle', on: dining, off: diningEnd });
    return { onAt, offAt, rooms };
};

/** Pièces allumées à cette minute selon le plan. */
export const roomsOnAt = (plan, min) => (plan?.rooms || []).filter((x) => min >= x.on && min < x.off).map((x) => x.room);
