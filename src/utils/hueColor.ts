// Conversions couleur Hue <-> hex (gamut sRGB, suffisant pour l'UI)

type HueState = {
    on?: boolean;
    bri?: number;
    hue?: number;
    sat?: number;
    xy?: [number, number];
    ct?: number;
    colormode?: 'hs' | 'xy' | 'ct';
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const toHex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

const gammaOut = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const gammaIn = (c: number) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);

/** xy CIE -> hex à pleine luminosité (l'intensité est gérée à part). */
export function xyToHex(x: number, y: number): string {
    const Y = 1;
    const X = (Y / y) * x;
    const Z = (Y / y) * (1 - x - y);
    let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
    let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
    let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
    const m = Math.max(r, g, b, 1e-6);
    r = gammaOut(Math.max(0, r / m));
    g = gammaOut(Math.max(0, g / m));
    b = gammaOut(Math.max(0, b / m));
    return toHex(r, g, b);
}

export function hexToXy(hex: string): [number, number] {
    const n = parseInt(hex.slice(1), 16);
    const r = gammaIn(((n >> 16) & 255) / 255);
    const g = gammaIn(((n >> 8) & 255) / 255);
    const b = gammaIn((n & 255) / 255);
    const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
    const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
    const Z = r * 0.000088 + g * 0.07231 + b * 0.986039;
    const s = X + Y + Z || 1;
    return [+(X / s).toFixed(4), +(Y / s).toFixed(4)];
}

/** Température (mired) -> hex, approximation de Tanner Helland. */
export function ctToHex(mired: number): string {
    const t = 1e6 / mired / 100;
    const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return toHex(r / 255, g / 255, b / 255);
}

function hsToHex(hue: number, sat: number): string {
    const h = (hue / 65535) * 6;
    const s = sat / 254;
    const f = (k: number) => {
        const kk = (k + h) % 6;
        return 1 - s * Math.max(0, Math.min(kk, 4 - kk, 1));
    };
    return toHex(f(5), f(3), f(1));
}

export function stateToHex(state: HueState): string {
    if (state.colormode === 'xy' && state.xy) return xyToHex(state.xy[0], state.xy[1]);
    if (state.colormode === 'ct' && state.ct) return ctToHex(state.ct);
    if (state.colormode === 'hs' && state.hue !== undefined) return hsToHex(state.hue, state.sat ?? 254);
    return '#FFC27A';
}

/** 0-100 % <-> bri Hue 1-254 */
export const pctToBri = (pct: number) => Math.max(1, Math.round((pct / 100) * 254));
export const briToPct = (bri: number) => Math.round((bri / 254) * 100);
