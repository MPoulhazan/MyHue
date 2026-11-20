/**
 * Pilote l'appli Communauto sur la tablette murale par ADB (débogage sans fil).
 *
 * Bloquer une Flex : lien direct vers sa fiche, on attend la fiche, on vérifie que le
 * bouton vert est bien là, un tap, on attend « The vehicle is waiting », puis on
 * remet MyHue (Chrome) au premier plan. Au moindre écran inattendu, on s'arrête
 * sans rien toucher : la recherche retombe sur l'alerte simple.
 *
 * Appairage une fois (POST /api/communauto/tablet/pair) : la clé ADB du Pi reste dans
 * data/adb/ (HOME de adb), l'adresse de la tablette dans data/communauto.json.
 */
import { execFile } from 'child_process';
import { mkdirSync } from 'fs';
import { dataFile } from './dataDir.js';
import { parseNodes, screenState, blockButton, tipOk, cancelButton, confirmCancelButton, isGreen, vehicleLink } from './communautoAppLogic.js';

const PKG = 'com.communauto.reservauto';
const MYHUE_APP = 'com.android.chrome'; // MyHue tourne dans Chrome sur la tablette
const ADB_HOME = dataFile('adb');
try {
    mkdirSync(ADB_HOME, { recursive: true });
} catch {
    // dossier déjà là
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adb = (args, { timeout = 20_000, binary = false } = {}) => new Promise((resolve, reject) => {
    execFile('adb', args, {
        timeout,
        encoding: binary ? 'buffer' : 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, HOME: ADB_HOME, ANDROID_USER_HOME: `${ADB_HOME}/.android` },
    }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').pop() || 'adb a échoué'));
        resolve(stdout);
    });
});

// --- Connexion ---

let target = null; // { host, port } réglé par communauto.js
export const setTarget = (t) => {
    target = t?.host ? { host: t.host, port: t.port || null } : null;
};

const serial = () => (target?.port ? `${target.host}:${target.port}` : null);

/** Port du débogage sans fil annoncé en mDNS (il change à chaque réactivation). */
const discoverPort = async () => {
    const out = await adb(['mdns', 'services']).catch(() => '');
    const re = new RegExp(`_adb-tls-connect\\._tcp\\s+${target.host.replace(/\./g, '\\.')}:(\\d+)`);
    return Number(re.exec(out)?.[1]) || null;
};

/** Connecte la tablette ; retourne le port utilisé (peut avoir changé). */
export const connect = async () => {
    if (!target?.host) throw new Error('tablette pas appairée');
    const tryPort = async (port) => {
        if (!port) return false;
        const out = await adb(['connect', `${target.host}:${port}`], { timeout: 10_000 }).catch(() => '');
        if (!/connected to/i.test(out)) return false;
        const state = await adb(['-s', `${target.host}:${port}`, 'get-state'], { timeout: 5_000 }).catch(() => '');
        return state.trim() === 'device';
    };
    if (await tryPort(target.port)) return target.port;
    const found = await discoverPort();
    if (found && found !== target.port && (await tryPort(found))) {
        target.port = found;
        return found;
    }
    throw new Error('tablette injoignable (débogage sans fil coupé ?)');
};

/** Appaire le Pi avec la tablette (code à 6 chiffres de « Pair device with pairing code »). */
export const pair = async ({ host, pairPort, code }) => {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host || '')) throw new Error('IP de la tablette invalide');
    if (!/^\d{4,5}$/.test(String(pairPort))) throw new Error('port d’appairage invalide');
    if (!/^\d{6}$/.test(String(code))) throw new Error('code d’appairage invalide (6 chiffres)');
    const out = await adb(['pair', `${host}:${pairPort}`, String(code)], { timeout: 30_000 });
    if (!/Successfully paired/i.test(out)) throw new Error(out.trim() || 'appairage refusé');
    return out.trim();
};

// --- Écran ---

const shell = (...args) => adb(['-s', serial(), 'shell', ...args]);

const screenSize = async () => {
    const out = await shell('wm', 'size');
    const m = /(\d+)x(\d+)\s*$/m.exec(out.trim());
    return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1200, h: 1920 };
};

const readScreen = async () => {
    await shell('uiautomator', 'dump', '/sdcard/myhue-ui.xml');
    return parseNodes(await shell('cat', '/sdcard/myhue-ui.xml'));
};

/** Attend un des écrans voulus ; retourne { state, nodes } (state 'other' à l'échéance). */
const waitFor = async (states, timeoutMs) => {
    const until = Date.now() + timeoutMs;
    let last = { state: 'other', nodes: [] };
    while (Date.now() < until) {
        const nodes = await readScreen().catch(() => []);
        last = { state: screenState(nodes), nodes };
        if (states.includes(last.state)) return last;
        await sleep(700);
    }
    return last;
};

const tap = ({ x, y }) => shell('input', 'tap', String(x), String(y));

const backToMyHue = () => shell('monkey', '-p', MYHUE_APP, '-c', 'android.intent.category.LAUNCHER', '1').catch(() => {});

/**
 * Couleur d'un pixel lue sur la tablette même : capture dans un fichier, puis 4 octets
 * extraits par dd (≈ 0,4 s, contre plus de 2 s pour un dump uiautomator ou une capture rapatriée).
 */
const pixelOnDevice = async (p, size) => {
    const skip = 4 + p.y * size.w + p.x; // en-tête de 16 octets = 4 blocs de 4
    const out = await shell(`screencap /data/local/tmp/myhue.raw && dd if=/data/local/tmp/myhue.raw bs=4 skip=${skip} count=1 2>/dev/null | od -An -tu1`);
    const [r, g, b] = out.trim().split(/\s+/).map(Number);
    return { r, g, b };
};

// Une manipulation de la tablette à la fois : les suivantes attendent leur tour
let queue = Promise.resolve();
const exclusive = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
};

let size = null; // taille d'écran, lue une fois

/** Connexion gardée ouverte : on ne refait « adb connect » que si la tablette ne répond plus. */
const ensureOnline = async () => {
    const state = serial() ? await adb(['-s', serial(), 'get-state'], { timeout: 3_000 }).catch(() => '') : '';
    if (state.trim() !== 'device') await connect();
    size ??= await screenSize();
};

/**
 * Prépare la course : appli relancée à froid (carte propre, aucune fiche d'une autre auto
 * restée ouverte), puis retour à MyHue. Appelé au lancement d'une recherche avec blocage.
 */
export const prewarm = () => exclusive(async () => {
    await ensureOnline();
    await shell(`input keyevent KEYCODE_WAKEUP; am force-stop ${PKG}; monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
    await waitFor(['other', 'blocked'], 12_000); // l'appli a fini de démarrer
    await sleep(3000); // la carte charge les autos
    await backToMyHue();
});

/**
 * Bloque une Flex dans l'appli, au plus vite : lien direct vers sa fiche, on guette le
 * vert du bouton sur la tablette même, un tap, puis on vérifie le blocage à l'écran.
 * @returns {{ ok: true, ms: number } | { ok: false, reason: 'gone'|'already'|'screen'|'offline', detail: string }}
 */
export const block = (carId) => exclusive(async () => {
    const t0 = Date.now();
    // L'id vient du flux public et finit dans une commande shell de la tablette : chiffres seulement
    if (!/^\d{1,10}$/.test(String(carId))) return { ok: false, reason: 'screen', detail: `identifiant d’auto inattendu (${String(carId).slice(0, 20)})` };
    try {
        await ensureOnline();
    } catch (err) {
        return { ok: false, reason: 'offline', detail: err.message };
    }
    let blocked = false;
    try {
        await shell(`input keyevent KEYCODE_WAKEUP; am start -a android.intent.action.VIEW -d '${vehicleLink(carId)}' ${PKG}`);
        // Le bouton vert, vu deux fois de suite (pas une image de transition)
        const button = blockButton(size);
        let seen = 0;
        const until = Date.now() + 12_000;
        while (Date.now() < until && seen < 2) {
            seen = isGreen(await pixelOnDevice(button, size).catch(() => ({}))) ? seen + 1 : 0;
        }
        if (seen < 2) {
            const state = screenState(await readScreen().catch(() => []));
            if (state === 'blocked') return { ok: false, reason: 'already', detail: 'une Flex est déjà bloquée' };
            return { ok: false, reason: 'screen', detail: 'fiche de l’auto pas affichée' };
        }
        await tap(button);
        const tapMs = Date.now() - t0;

        // « The vehicle is waiting » : bloquée. Le même vert sert aussi au « Ok » de « plus disponible ».
        const after = await waitFor(['blocked', 'gone'], 8_000);
        if (after.state === 'blocked') {
            blocked = true;
            console.log(`[Communauto] Flex ${carId} bloquée, tap à ${tapMs} ms`);
            return { ok: true, ms: tapMs };
        }
        if (after.state === 'gone') return { ok: false, reason: 'gone', detail: 'prise juste avant' };
        return { ok: false, reason: 'screen', detail: 'blocage pas confirmé à l’écran' };
    } finally {
        // Ne pas laisser une fiche ouverte : la prochaine course partirait d'une carte propre
        if (!blocked) await shell('input', 'keyevent', 'KEYCODE_BACK').catch(() => {});
        await sleep(blocked ? 1500 : 300);
        await backToMyHue();
    }
});

/** Annule le blocage en cours dans l'appli. */
export const cancelBlock = () => exclusive(async () => {
    await connect();
    try {
        await shell('input', 'keyevent', 'KEYCODE_WAKEUP');
        await shell('monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
        let screen = await waitFor(['blocked'], 15_000);
        if (screen.state !== 'blocked') throw new Error('aucun blocage affiché dans l’appli');
        const ok = tipOk(screen.nodes);
        if (ok) {
            await tap(ok);
            await sleep(800);
            screen = await waitFor(['blocked'], 5_000);
        }
        await tap(cancelButton(screen.nodes, await screenSize()));
        const confirm = await waitFor(['confirm'], 6_000);
        if (confirm.state !== 'confirm') throw new Error('confirmation d’annulation pas affichée');
        await tap(confirmCancelButton(confirm.nodes, await screenSize()));
        const after = await waitFor(['other', 'sheet'], 8_000);
        if (after.state === 'blocked' || after.state === 'confirm') throw new Error('annulation pas confirmée');
        return true;
    } finally {
        await sleep(1000);
        await backToMyHue();
    }
});

/** État pour l'écran de réglages : appairée, joignable. */
export const status = async () => {
    if (!target?.host) return { paired: false, online: false, host: null, port: null };
    const online = await connect().then(() => true).catch(() => false);
    return { paired: true, online, host: target.host, port: target.port };
};

export const currentTarget = () => target && { ...target };
