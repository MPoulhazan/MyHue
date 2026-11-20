/**
 * Appli Communauto sur la tablette : lecture des écrans (dump uiautomator), sans ADB,
 * testée dans communautoApp.test.js. L'appli est en Flutter : les boutons n'ont pas
 * de nom lisible, on reconnaît les écrans à leurs textes et on tape à des positions
 * déduites des blocs voisins (relevées sur la Tab A9+ en portrait 1200×1920, 2026-11-20).
 */

const decode = (s) => s
    .replace(/&#10;/g, '\n').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Nœuds de l'écran qui portent un texte : [{ label, x1, y1, x2, y2 }] */
export const parseNodes = (xml) => {
    const out = [];
    for (const m of String(xml || '').matchAll(/<node [^>]*>/g)) {
        const attr = (k) => new RegExp(`\\s${k}="([^"]*)"`).exec(m[0])?.[1] ?? '';
        const label = decode([attr('text'), attr('content-desc')].filter(Boolean).join('\n')).trim();
        const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'));
        if (!label || !b || label === 'Map Marker') continue;
        const [x1, y1, x2, y2] = b.slice(1).map(Number);
        out.push({ label, x1, y1, x2, y2 });
    }
    return out;
};

const find = (nodes, re) => nodes.find((n) => re.test(n.label)) || null;

/**
 * Où en est l'appli :
 *  gone     l'auto n'est plus libre
 *  sheet    fiche d'une Flex libre, bouton « Block this vehicle » en bas
 *  blocked  une Flex est bloquée pour nous (« The vehicle is waiting »)
 *  confirm  confirmation d'annulation du blocage
 *  other    autre chose (chargement, carte, popup inconnue)
 */
export const screenState = (nodes) => {
    if (find(nodes, /not available anymore|n.est plus disponible/i)) return 'gone';
    if (find(nodes, /Cancel reservation|Annuler la r[ée]servation/i) && find(nodes, /cancel the block|annuler le blocage/i)) return 'confirm';
    if (find(nodes, /vehicle is waiting|v[ée]hicule vous attend/i)) return 'blocked';
    if (find(nodes, /^(Vehicle location|Emplacement du v[ée]hicule)$/i)) return 'sheet';
    return 'other';
};

/** Le bouton « Block this vehicle » : collé en bas de l'écran, 144 px au-dessus du bord (barre de navigation comprise). */
export const blockButton = (screen) => ({ x: Math.round(screen.w / 2), y: screen.h - 144 });

/** Bulle d'aide « Free Floating Pass » (premier blocage) : son bouton OK, ou null. */
export const tipOk = (nodes) => {
    if (!find(nodes, /Free Floating Pass/i)) return null;
    const ok = nodes.find((n) => /^OK$/i.test(n.label) && n.y2 - n.y1 < 120);
    return ok ? { x: Math.round((ok.x1 + ok.x2) / 2), y: Math.round((ok.y1 + ok.y2) / 2) } : null;
};

/** « Cancel », à gauche sous le bloc « The vehicle is waiting… ». */
export const cancelButton = (nodes, screen) => {
    const sheet = find(nodes, /vehicle is waiting|v[ée]hicule vous attend/i);
    if (!sheet) return null;
    return { x: Math.round(screen.w / 4), y: sheet.y2 + 42 };
};

/** « Yes, cancel block », 189 px sous le haut de la feuille de confirmation. */
export const confirmCancelButton = (nodes, screen) => {
    const sheet = find(nodes, /Cancel reservation|Annuler la r[ée]servation/i);
    if (!sheet) return null;
    return { x: Math.round(screen.w / 2), y: sheet.y1 + 189 };
};

/** Le vert Communauto du bouton (≈ #80BC00) : on ne tape que s'il est bien là. */
export const isGreen = ({ r, g, b }) => g > 150 && r > 80 && r < 180 && b < 90;

/** Pixel (x, y) d'une capture brute `screencap` (en-tête de 16 octets, RGBA). */
export const pixelAt = (raw, x, y) => {
    const w = raw.readUInt32LE(0);
    const header = raw.length - w * raw.readUInt32LE(4) * 4;
    const i = header + (y * w + x) * 4;
    return { r: raw[i], g: raw[i + 1], b: raw[i + 2] };
};

/** Lien direct vers la fiche d'une Flex (CarId du flux public). */
export const vehicleLink = (carId) => `https://client.reservauto.net/quebec/dashboard/map/free-floating-info/${encodeURIComponent(carId)}`;

/** Blocages des 7 derniers jours. */
export const weekCount = (bookings = [], now = Date.now()) => bookings.filter((t) => now - t < 7 * 24 * 3600_000).length;
