/**
 * Cube Aqara : décisions pures (gestes, réglages), sans réseau, testées dans cube.test.js.
 */

/** Comparaison de noms sans accents ni casse. */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Traduit un message z2m du cube en geste.
 * @returns {{ gesture: string, face?: number, angle?: number } | null}
 */
export const parseGesture = (msg) => {
    const action = msg?.action;
    if (!action || typeof action !== 'string') return null;
    const side = Number.isInteger(msg.action_to_side) ? msg.action_to_side : Number.isInteger(msg.side) ? msg.side : undefined;
    if (action === 'flip90' || action === 'flip180') return { gesture: 'flip', face: side };
    if (action === 'rotate_right' || action === 'rotate_left') {
        const angle = Math.abs(Number(msg.action_angle) || 0) * (action === 'rotate_left' ? -1 : 1);
        return { gesture: 'rotate', angle };
    }
    if (['tap', 'slide', 'shake', 'fall', 'wakeup'].includes(action)) return { gesture: action, face: side };
    return null;
};

/** Angle de rotation → variation de luminosité Hue (90° ≈ un quart de la plage). */
export const briDelta = (angle) => Math.max(-254, Math.min(254, Math.round(angle * 0.7)));

/** Angle de rotation → variation de volume (90° ≈ 15 %). */
export const volumeDelta = (angle) => Math.max(-0.5, Math.min(0.5, Math.round(angle / 6) / 100));

/** Scène Hue d'une face : de préférence celle de la pièce pilotée. */
export const pickScene = (scenes, name, groupId) => {
    const target = fold(name);
    if (!target) return null;
    const matches = scenes.filter((s) => fold(s.name) === target || fold(s.name).includes(target));
    return matches.find((s) => String(s.group) === String(groupId)) || matches.find((s) => s.type === 'GroupScene') || matches[0] || null;
};

const FALL_LINES = [
    'Aïe ! Doucement avec moi.',
    'Ouille. Je suis tombé, mais je n’ai rien.',
    'Le dé est à terre. Quelqu’un peut me ramasser ?',
];
export const fallLine = (n = Math.random()) => FALL_LINES[Math.floor(n * FALL_LINES.length) % FALL_LINES.length];
