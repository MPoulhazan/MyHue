/**
 * Veillée de Noël, en décembre seulement.
 *
 * Un bouton (ou « Jean-Claude, lance la veillée ») et la maison passe en soirée d'hiver :
 * une bûche qui crépite sur le projecteur, du jazz de Noël doux sur l'enceinte du salon,
 * les lampes du salon en feu de cheminée et un degré de plus sur la consigne
 * (dérogation du thermostat : jamais d'arrêt ni de remise en marche de la thermopompe).
 * Au bout de 3 h, ou sur « fin de la veillée », tout redevient comme avant.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as castService from './castService.js';
import * as musicPlayer from './musicPlayer.js';
import * as youtube from './youtubeService.js';
import * as thermostat from './thermostat.js';
import { hueClient, hueBaseUrl, restoreLight } from './hue.js';
import { getYtDlpVideoUrl } from './ytdlp.js';
import { christmasSeason } from './seasonLogic.js';
import { VEILLEE_MS, FIRE_ROOMS, veilleeAvailable, fireLightPlan, emberState, flameStep, cozyTarget } from './veilleeLogic.js';

const FILE = dataFile('veillee.json');
const TZ = process.env.TZ || 'America/Toronto';
const TV = (process.env.VEILLEE_TV || 'Projecteur').trim();
const SPEAKER = (process.env.MUSIC_DEFAULT_SPEAKER || 'Salon').trim();
const LOG_QUERY = 'yule log fireplace crackling 10 hours 4K';
const JAZZ_QUERY = 'christmas jazz instrumental piano';
const TV_VOLUME = 0.25;
const SPEAKER_VOLUME = 0.3;
const FLAME_EVERY_MS = 4000;

/**
 * active : { startedAt, endsAt, source, lights: { id: étatAvant }, flame: [ids], heat: { target } | null,
 *            tv: deviceId | null, speaker: deviceId | null, log: titre | null }
 */
let current = null;
try {
    if (existsSync(FILE)) current = JSON.parse(readFileSync(FILE, 'utf8')).active || null;
} catch (err) {
    console.error('❌ veillee.json illisible:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify({ active: current }, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde de la veillée impossible:', err.message);
    }
};

let flameTimer = null;
let endTimer = null;

export function getStatus(now = Date.now()) {
    const season = christmasSeason(now, TZ);
    return {
        available: veilleeAvailable(season),
        active: Boolean(current),
        startedAt: current?.startedAt ?? null,
        endsAt: current?.endsAt ?? null,
        log: current?.log ?? null,
        music: Boolean(current?.speaker),
        heat: current?.heat ?? null,
        notes: current?.notes ?? [],
        season,
    };
}

// --- Les morceaux de la veillée ---

/** Les lampes du salon et de la salle à manger, avec leur état complet. */
export async function fireLights() {
    const [{ data: lights }, { data: groups }] = await Promise.all([hueClient.get('/lights'), hueClient.get('/groups')]);
    const ids = new Set(Object.values(groups)
        .filter((g) => g.type === 'Room' && FIRE_ROOMS.test(String(g.name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()))
        .flatMap((g) => g.lights || []));
    return [...ids].filter((id) => lights[id]?.state?.reachable !== false).map((id) => ({
        id,
        name: lights[id].name,
        color: Boolean(lights[id].state?.xy),
        state: lights[id].state,
    }));
}

async function startFire() {
    const lights = await fireLights();
    const plan = fireLightPlan(lights);
    const before = {};
    for (const l of lights) if ([...plan.off, ...plan.flame, ...plan.ember].includes(l.id)) before[l.id] = l.state;
    const put = (id, state) => hueClient.put(`/lights/${id}/state`, state).catch((e) => console.warn(`veillée: lampe ${id}: ${e.message}`));
    await Promise.all([
        ...plan.off.map((id) => put(id, { on: false, transitiontime: 30 })),
        ...plan.ember.map((id) => put(id, emberState())),
        ...plan.flame.map((id) => put(id, flameStep())),
    ]);
    return { before, flame: plan.flame };
}

function runFlames() {
    clearInterval(flameTimer);
    if (!current?.flame?.length) return;
    // Une flamme à la fois, toutes les 4 s : le pont Hue reste tranquille
    let i = 0;
    flameTimer = setInterval(() => {
        const id = current?.flame?.[i++ % current.flame.length];
        if (id) hueClient.put(`/lights/${id}/state`, flameStep()).catch(() => {});
    }, FLAME_EVERY_MS);
    flameTimer.unref?.();
}

/** La bûche : la plus longue vidéo de feu trouvée, sans son, sur le projecteur. */
async function startLog() {
    const tv = castService.findDevice(TV);
    if (!tv?.online) throw new Error(`${TV} injoignable`);
    const found = await youtube.searchVideos(LOG_QUERY, 6);
    const pick = [...found].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
    if (!pick) throw new Error('Aucune bûche trouvée');
    const url = await getYtDlpVideoUrl(pick.videoId);
    await castService.castMedia(tv.id, url, 'video/mp4', { title: 'Bûche de Noël', subtitle: pick.title, thumbnail: pick.thumbnail });
    castService.setVolume(tv.id, TV_VOLUME).catch(() => {});
    return { tv: tv.id, log: pick.title };
}

async function startJazz() {
    const speaker = castService.findDevice(SPEAKER) || musicPlayer.defaultDevice();
    if (!speaker) throw new Error('Aucune enceinte joignable');
    const tracks = await youtube.search(JAZZ_QUERY, 25);
    if (!tracks.length) throw new Error('Pas de jazz de Noël trouvé');
    await musicPlayer.play({ deviceId: speaker.id, kind: 'tracks', tracks, shuffle: true, name: 'Veillée · jazz de Noël' });
    castService.setVolume(speaker.id, SPEAKER_VOLUME).catch(() => {});
    return speaker.id;
}

/** Un degré de plus, le temps de la veillée, si le thermostat intelligent pilote la thermopompe. */
function warmUp() {
    if (!thermostat.isEnabled() || thermostat.manualHold()) return null;
    const target = cozyTarget(thermostat.getStatus().target);
    if (target == null) return null;
    thermostat.setOverride(target, VEILLEE_MS / 3600_000);
    return { target };
}

// --- Lancer, arrêter ---

const settle = async (label, fn, notes) => {
    try {
        return await fn();
    } catch (err) {
        console.warn(`veillée: ${label}: ${err.message}`);
        notes.push(`${label} : ${err.message}`);
        return null;
    }
};

export async function start(source = 'écran', now = Date.now()) {
    if (current) return getStatus(now);
    if (!veilleeAvailable(christmasSeason(now, TZ))) throw new Error('La veillée revient en décembre');
    const notes = [];
    const fire = hueBaseUrl ? await settle('Lampes', startFire, notes) : null;
    const log = await settle('Bûche', startLog, notes);
    const speaker = await settle('Musique', startJazz, notes);
    const heat = await settle('Chauffage', async () => warmUp(), notes);

    current = {
        startedAt: now,
        endsAt: now + VEILLEE_MS,
        source,
        lights: fire?.before || {},
        flame: fire?.flame || [],
        tv: log?.tv || null,
        log: log?.log || null,
        speaker,
        heat,
        notes,
    };
    save();
    runFlames();
    scheduleEnd();
    journal.log({ kind: 'veillee', title: 'Veillée lancée', data: { source, log: current.log, heat: heat?.target ?? null, notes } });
    return getStatus(now);
}

export async function stop(source = 'écran') {
    if (!current) return getStatus();
    const was = current;
    current = null;
    save();
    clearInterval(flameTimer);
    clearTimeout(endTimer);

    const notes = [];
    await settle('Lampes', async () => {
        for (const [id, before] of Object.entries(was.lights || {})) await restoreLight(id, before).catch(() => {});
    }, notes);
    if (was.tv) {
        await settle('Bûche', async () => {
            for (const app of await castService.getApps(was.tv)) await castService.stopApp(was.tv, app.sessionId);
        }, notes);
    }
    if (was.speaker) await settle('Musique', () => castService.controlPlayback(was.speaker, 'stop'), notes);
    // La dérogation n'est retirée que si c'est encore la nôtre
    if (was.heat) {
        const ov = thermostat.getStatus().config.override;
        if (ov && ov.target === was.heat.target) thermostat.clearOverride();
    }
    journal.log({ kind: 'veillee', title: 'Fin de la veillée', data: { source, minutes: Math.round((Date.now() - was.startedAt) / 60_000) } });
    return getStatus();
}

function scheduleEnd() {
    clearTimeout(endTimer);
    if (!current) return;
    endTimer = setTimeout(() => stop('fin des 3 h').catch((e) => console.error('veillée: fin', e.message)), Math.max(0, current.endsAt - Date.now()));
    endTimer.unref?.();
}

/** Réponse à la voix. */
export async function voiceAnswer(command) {
    if (command === 'stop') {
        if (!current) return 'Pas de veillée en cours.';
        await stop('voix');
        return 'Fin de la veillée, la maison revient comme avant.';
    }
    const season = christmasSeason(Date.now(), TZ);
    if (!veilleeAvailable(season)) return 'La veillée revient en décembre.';
    if (current) return 'La veillée est déjà lancée.';
    const s = await start('voix');
    const parts = [s.log ? 'la bûche crépite au projecteur' : null, s.music ? 'le jazz joue au salon' : null, s.heat ? `et je monte le chauffage à ${s.heat.target} degrés` : null].filter(Boolean);
    return `Ho ho ho, bonne veillée : ${parts.join(', ')}.`;
}

// Après un redémarrage : la veillée continue (ou finit si l'heure est passée)
if (current) {
    if (current.endsAt <= Date.now()) setTimeout(() => stop('fin des 3 h').catch(() => {}), 10_000);
    else {
        runFlames();
        scheduleEnd();
    }
}
