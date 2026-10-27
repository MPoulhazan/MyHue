/**
 * Protocole infrarouge Mitsubishi Electric 144 bits (télécommandes des MSZ-GL, FH, GE...)
 * et format brut Broadlink. Module pur : aucune entrée/sortie, testable.
 *
 * Trame de 18 octets, d'après IRremoteESP8266 (ir_Mitsubishi.h) :
 *   0-4  en-tête fixe 23 CB 26 01 00
 *   5    0x20 = marche
 *   6    mode (bits 3-5) : chauffage 0x08, déshu 0x10, clim 0x18, auto 0x20, ventilation 0x38
 *   7    température - 16 (bits 0-3)
 *   8    dépend du mode (volet horizontal au milieu + bits de mode)
 *   9    ventilation (bits 0-2), volet vertical (bits 3-5), bit volet 0x40, ventilation auto 0x80
 *   10   horloge de la télécommande, en dizaines de minutes depuis minuit
 *   11-16 minuteries (inutilisées)
 *   17   somme des octets 0-16 modulo 256
 * Chaque octet part bit de poids faible en premier ; la trame est envoyée deux fois.
 */

const MODE_BITS = { heat: 0x08, dry: 0x10, cool: 0x18, auto: 0x20, fan: 0x38 };
const MODE_BYTE8 = { heat: 0x30, dry: 0x32, cool: 0x36, auto: 0x30, fan: 0x37 };
const FAN_SPEED = { quiet: 5, low: 1, med: 2, high: 3, max: 4 };
const VANE_POS = { auto: 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, swing: 7 };

/**
 * @param {{ power: boolean, mode: string, temperature: number, fanSpeed?: string, vaneVertical?: string }} state
 * @param {number} clockMinutes  heure locale en minutes depuis minuit (la télécommande l'envoie)
 */
export const encodeState = (state, clockMinutes = 0) => {
    const mode = MODE_BITS[state.mode] ? state.mode : 'heat';
    const b = new Uint8Array(18);
    b.set([0x23, 0xcb, 0x26, 0x01, 0x00]);
    b[5] = state.power ? 0x20 : 0x00;
    b[6] = MODE_BITS[mode];
    b[7] = Math.max(16, Math.min(31, Math.round(state.temperature))) - 16;
    b[8] = MODE_BYTE8[mode];
    const fan = state.fanSpeed && state.fanSpeed !== 'auto' ? FAN_SPEED[state.fanSpeed] ?? 0 : 0;
    const fanAuto = fan === 0 ? 0x80 : 0;
    b[9] = fanAuto | 0x40 | ((VANE_POS[state.vaneVertical] ?? 0) << 3) | fan;
    b[10] = Math.floor(clockMinutes / 10) % 144;
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += b[i];
    b[17] = sum & 0xff;
    return b;
};

/** Lecture inverse d'une trame (pour vérifier une trame apprise depuis la vraie télécommande). */
export const decodeState = (b) => {
    if (b.length < 18 || b[0] !== 0x23 || b[1] !== 0xcb) return null;
    const mode = Object.keys(MODE_BITS).find((k) => MODE_BITS[k] === (b[6] & 0x38)) || `0x${b[6].toString(16)}`;
    const fanBits = b[9] & 0x07;
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += b[i];
    return {
        power: Boolean(b[5] & 0x20),
        mode,
        temperature: (b[7] & 0x0f) + 16,
        fanSpeed: b[9] & 0x80 ? 'auto' : Object.keys(FAN_SPEED).find((k) => FAN_SPEED[k] === fanBits) || String(fanBits),
        vaneVertical: Object.keys(VANE_POS).find((k) => VANE_POS[k] === ((b[9] >> 3) & 0x07)) || 'auto',
        clockMinutes: b[10] * 10,
        checksumOk: (sum & 0xff) === b[17],
    };
};

// --- Format Broadlink : durées en unités de 269/8192 ms (≈ 32,84 µs) ---

export const BROADLINK_TICK_US = (269 / 8192) * 1000;

const HDR_MARK = 3400;
const HDR_SPACE = 1750;
const BIT_MARK = 450;
const ONE_SPACE = 1300;
const ZERO_SPACE = 420;
const FRAME_GAP = 17100;
const END_GAP = 100_000; // silence final

/** Trame → impulsions (µs), alternance marque/espace, deux répétitions. */
export const toPulses = (bytes) => {
    const pulses = [];
    for (let frame = 0; frame < 2; frame++) {
        pulses.push(HDR_MARK, HDR_SPACE);
        for (const byte of bytes) {
            for (let bit = 0; bit < 8; bit++) pulses.push(BIT_MARK, (byte >> bit) & 1 ? ONE_SPACE : ZERO_SPACE);
        }
        pulses.push(BIT_MARK, frame === 0 ? FRAME_GAP : END_GAP);
    }
    return pulses;
};

/** Impulsions (µs) → paquet IR Broadlink : 26 00 <longueur LE> <durées> . */
export const pulsesToBroadlink = (pulses) => {
    const data = [];
    for (const us of pulses) {
        const ticks = Math.round(us / BROADLINK_TICK_US);
        if (ticks > 255) data.push(0x00, (ticks >> 8) & 0xff, ticks & 0xff);
        else data.push(ticks);
    }
    return Buffer.from([0x26, 0x00, data.length & 0xff, data.length >> 8, ...data]);
};

/** Paquet IR Broadlink → impulsions (µs). */
export const broadlinkToPulses = (packet) => {
    const start = packet.indexOf(0x26); // les paquets appris peuvent avoir un préfixe
    if (start < 0) return [];
    const len = packet[start + 2] | (packet[start + 3] << 8);
    const data = packet.subarray(start + 4, start + 4 + len);
    const pulses = [];
    for (let i = 0; i < data.length; i++) {
        let ticks = data[i];
        if (ticks === 0 && i + 2 < data.length) {
            ticks = (data[i + 1] << 8) | data[i + 2];
            i += 2;
        }
        pulses.push(ticks * BROADLINK_TICK_US);
    }
    return pulses;
};

/** Impulsions → trames d'octets (décodage tolérant des marques/espaces). */
export const pulsesToFrames = (pulses) => {
    const frames = [];
    let i = 0;
    while (i + 1 < pulses.length) {
        // En-tête : longue marque puis espace moyen
        if (!(pulses[i] > 2500 && pulses[i + 1] > 1200 && pulses[i + 1] < 2500)) {
            i++;
            continue;
        }
        i += 2;
        const bytes = [];
        let cur = 0;
        let n = 0;
        while (i + 1 < pulses.length && pulses[i] < 1000 && pulses[i + 1] < 3000) {
            if (pulses[i + 1] > 800) cur |= 1 << n;
            if (++n === 8) {
                bytes.push(cur);
                cur = 0;
                n = 0;
            }
            i += 2;
        }
        if (bytes.length) frames.push(Uint8Array.from(bytes));
        i += 2;
    }
    return frames;
};

export const toHex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** Paquet Broadlink prêt à envoyer pour un état de la thermopompe. */
export const buildPacket = (state, clockMinutes) => pulsesToBroadlink(toPulses(encodeState(state, clockMinutes)));
