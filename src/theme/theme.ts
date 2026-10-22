// Thème clair / sombre / auto. En mode auto, la palette glisse du clair vers le
// sombre selon la hauteur du soleil : plein jour au-dessus de DAY_ALT, nuit
// sous NIGHT_ALT (crépuscule civil), interpolation continue entre les deux.

export type ThemePreference = 'auto' | 'light' | 'dark';
export type GeoPoint = { lat: number; lon: number };

const PREF_KEY = 'myhue-theme';
const GEO_KEY = 'myhue-theme-location';
const DAY_ALT = 10; // ~1 h avant le coucher
const NIGHT_ALT = -6; // ~30 min après le coucher
const TICK_MS = 60_000;

type Rgb = [number, number, number];
type Palette = Record<string, Rgb>;

const hex = (h: string): Rgb => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const DARK: Palette = {
    'bg-dark': hex('#0a0b0a'),
    'bg-darker': hex('#070807'),
    panel: hex('#111311'),
    'panel-2': hex('#0d0f0d'),
    line: hex('#232723'),
    'line-2': hex('#2e332e'),
    accent: hex('#c8f560'),
    warn: hex('#ffb547'),
    danger: hex('#ff5c6c'),
    'primary-light': hex('#dcff8a'),
    'primary-dark': hex('#a6d13f'),
    'text-primary': hex('#e6eae3'),
    'text-secondary': hex('#8e948c'),
    'on-accent': hex('#0a0b0a'),
    heat: hex('#5a615a'),
    ink: hex('#ffffff'),
};

const LIGHT: Palette = {
    'bg-dark': hex('#f2f3ed'),
    'bg-darker': hex('#e8eae2'),
    panel: hex('#ffffff'),
    'panel-2': hex('#f8f9f4'),
    line: hex('#d8dbd1'),
    'line-2': hex('#c3c7bb'),
    accent: hex('#4f7a00'),
    warn: hex('#b26a00'),
    danger: hex('#cf2a3c'),
    'primary-light': hex('#6c9714'),
    'primary-dark': hex('#3b5c00'),
    'text-primary': hex('#191c17'),
    'text-secondary': hex('#5b6258'),
    'on-accent': hex('#ffffff'),
    heat: hex('#a3a99e'),
    ink: hex('#141812'),
};

// Tokens exposés aussi en triplet « r, g, b » pour les rgba(var(--x-rgb), a)
const RGB_TOKENS = ['ink', 'accent', 'panel', 'bg-dark', 'text-primary'];

// ── Soleil (algorithme de SunCalc, précision ~1 min) ─────────────────────────

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const J0 = 0.0009;
const OBLIQUITY = RAD * 23.4397;

const toDays = (ms: number) => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
const meanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (m: number) =>
    m + RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) + RAD * 102.9372 + Math.PI;
const declination = (l: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));

export function sunAltitude(date: Date, { lat, lon }: GeoPoint): number {
    const d = toDays(date.getTime());
    const l = eclipticLongitude(meanAnomaly(d));
    const dec = declination(l);
    const ra = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));
    const hourAngle = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra;
    const phi = RAD * lat;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
}

/** Lever et coucher du jour de `date` (null en nuit/jour polaire). */
export function sunTimes(date: Date, { lat, lon }: GeoPoint): { sunrise: Date; sunset: Date } | null {
    const lw = -RAD * lon;
    const phi = RAD * lat;
    const d = toDays(date.getTime());
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const m = meanAnomaly(ds);
    const l = eclipticLongitude(m);
    const dec = declination(l);
    const transit = (x: number) => J2000 + x + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
    const cosW = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (Math.abs(cosW) > 1) return null;
    const noon = transit(ds);
    const set = transit(J0 + (Math.acos(cosW) + lw) / (2 * Math.PI) + n);
    return { sunrise: fromJulian(noon - (set - noon)), sunset: fromJulian(set) };
}

// ── Préférences ──────────────────────────────────────────────────────────────

const read = (key: string) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const write = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* stockage indisponible : on garde la valeur en mémoire */
    }
};

export function getPreference(): ThemePreference {
    const v = read(PREF_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
}

/** Position enregistrée, sinon estimée depuis le fuseau horaire. */
export function getLocation(): GeoPoint {
    try {
        const p = JSON.parse(read(GEO_KEY) || 'null');
        if (Number.isFinite(p?.lat) && Number.isFinite(p?.lon)) return p;
    } catch {
        /* valeur corrompue */
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === 'America/Montreal' || tz === 'America/Toronto') return { lat: 45.5, lon: -73.57 };
    if (tz === 'Europe/Paris') return { lat: 48.86, lon: 2.35 };
    return { lat: 45, lon: -new Date().getTimezoneOffset() / 4 };
}

export function hasSavedLocation(): boolean {
    return read(GEO_KEY) !== null;
}

// ── Application ──────────────────────────────────────────────────────────────

/** 0 = plein jour, 1 = nuit. */
export function darknessAt(date: Date, pref: ThemePreference, geo: GeoPoint): number {
    if (pref === 'light') return 0;
    if (pref === 'dark') return 1;
    const x = Math.min(1, Math.max(0, (DAY_ALT - sunAltitude(date, geo)) / (DAY_ALT - NIGHT_ALT)));
    return x * x * (3 - 2 * x);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
    [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;

function paint(t: number) {
    const root = document.documentElement;
    for (const key of Object.keys(DARK)) {
        const [r, g, b] = mix(LIGHT[key], DARK[key], t);
        root.style.setProperty(`--${key}`, `rgb(${r}, ${g}, ${b})`);
        if (RGB_TOKENS.includes(key)) root.style.setProperty(`--${key}-rgb`, `${r}, ${g}, ${b}`);
    }
    root.style.setProperty('--shadow-alpha', String(0.12 + 0.33 * t));
    // Les creux en rgba(0, 0, 0, a) s'atténuent de jour
    root.style.setProperty('--shade', String(0.25 + 0.75 * t));
    root.style.setProperty('--darkness', t.toFixed(3));
    root.style.colorScheme = t >= 0.5 ? 'dark' : 'light';
    root.dataset.theme = t >= 0.5 ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', root.style.getPropertyValue('--bg-dark'));
}

type Listener = () => void;
const listeners = new Set<Listener>();
let timer: number | undefined;

function apply(animate = false) {
    const root = document.documentElement;
    if (animate) {
        root.classList.add('theme-animating');
        window.setTimeout(() => root.classList.remove('theme-animating'), 700);
    }
    paint(darknessAt(new Date(), getPreference(), getLocation()));
    listeners.forEach((fn) => fn());
}

export function initTheme() {
    apply();
    window.clearInterval(timer);
    timer = window.setInterval(() => apply(), TICK_MS);
    // Une tablette qui sort de veille doit se recaler tout de suite
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') apply();
    });
}

export function setPreference(pref: ThemePreference) {
    write(PREF_KEY, pref);
    apply(true);
}

export function setLocation(geo: GeoPoint) {
    write(GEO_KEY, JSON.stringify(geo));
    apply(true);
}

export function subscribeTheme(fn: Listener) {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}
