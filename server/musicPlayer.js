/**
 * Lecteur de musique : lance une radio, une playlist, une ambiance, un mix ou une sélection sur une enceinte,
 * tient la file d'attente, la minuterie, le changement de pièce, et nourrit le journal des habitudes.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as cast from './castService.js';
import * as yt from './youtubeService.js';
import { getYtDlpAudioUrl } from './ytdlp.js';
import { dataFile } from './dataDir.js';
import * as habits from './musicHabits.js';

const PORT = Number(process.env.AGENT_PORT || 5174);
const MAX_QUEUE = 100;
const VIDEO_ID = /^[\w-]{11}$/;

export const RADIOS = [
    { id: 'lofi', name: 'Lo-fi', description: 'Pour se concentrer ou décompresser', streamUrl: 'https://streams.ilovemusic.de/iloveradio17.mp3' },
    { id: 'jazz', name: 'Jazz doux', description: 'Saxophone et ambiance feutrée', streamUrl: 'https://streaming.radio.co/s774887f7b/listen' },
    { id: 'electronic', name: 'Électro', description: 'Rythmes et synthés', streamUrl: 'https://streams.ilovemusic.de/iloveradio2.mp3' },
    { id: 'ambient', name: 'Ambient', description: 'Nappes calmes et atmosphériques', streamUrl: 'https://uk2.internet-radio.com/proxy/radioart_ambient?mp=/stream' },
    { id: 'piano', name: 'Piano', description: 'Pièces pour piano seul', streamUrl: 'https://live.musopen.org:8085/streamvbr0' },
    { id: 'rock', name: 'Rock', description: 'Les grands classiques', streamUrl: 'https://streams.ilovemusic.de/iloveradio3.mp3' },
    { id: 'classical', name: 'Classique', description: 'Orchestre et musique de chambre', streamUrl: 'https://stream.srg-ssr.ch/m/rsc_de/mp3_128' },
    { id: 'chillout', name: 'Chill-out', description: 'Ambiance détendue', streamUrl: 'https://streams.ilovemusic.de/iloveradio7.mp3' },
];

// Une ambiance joue la playlist qu'on lui a associée (mélangée), sinon sa radio
export const MOODS = [
    { id: 'zen', name: 'Zen', hint: 'Piano, nappes, réveil doux', radio: 'piano' },
    { id: 'focus', name: 'Focus', hint: 'Lo-fi, électro calme', radio: 'lofi' },
    { id: 'energie', name: 'Énergie', hint: 'Pour le ménage ou le sport', radio: 'electronic' },
    { id: 'diner', name: 'Dîner', hint: 'Jazz, soul, bossa', radio: 'jazz' },
    { id: 'soiree', name: 'Soirée', hint: 'Détente entre amis', radio: 'chillout' },
    { id: 'dodo', name: 'Dodo', hint: 'S’arrête tout seul après 45 min', radio: 'ambient', sleepMinutes: 45 },
];

const readJson = (file, fallback) => {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : fallback; } catch { return fallback; }
};
const writeJson = (file, data) => {
    try { writeFileSync(file, JSON.stringify(data)); } catch (err) { console.error(`music: cannot write ${file}`, err?.message); }
};

// --- Playlists associées aux ambiances ---
const MOODS_FILE = dataFile('music-moods.json');
let moodLinks = readJson(MOODS_FILE, {}); // moodId -> { playlistId, playlistName }

export const getMoods = () => MOODS.map((m) => ({ ...m, playlistId: moodLinks[m.id]?.playlistId || null, playlistName: moodLinks[m.id]?.playlistName || null }));

export function linkMood(moodId, playlist) {
    if (!MOODS.some((m) => m.id === moodId)) throw new Error('Unknown mood');
    if (playlist?.id) moodLinks[moodId] = { playlistId: playlist.id, playlistName: playlist.name || playlist.id };
    else delete moodLinks[moodId];
    writeJson(MOODS_FILE, moodLinks);
    return getMoods();
}

// --- Session en cours (gardée sur disque pour « Reprendre ») ---
const SESSION_FILE = dataFile('music-session.json');
// { deviceId, source: { kind, id, name, thumbnail }, tracks: [{ videoId, title, artist, thumbnail }], lastIndex, at }
let session = readJson(SESSION_FILE, null);
const saveSession = () => writeJson(SESSION_FILE, session);

const deviceHost = (deviceId) => cast.getDevices().find((d) => d.id === deviceId)?.host;

const streamUrl = (deviceId, videoId) => {
    const ip = cast.localAddressFor(deviceHost(deviceId) || '');
    if (!ip) throw new Error('No local address for the speaker');
    return `http://${ip}:${PORT}/api/youtube/stream/${videoId}`;
};

const shuffled = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const cleanTracks = (tracks) => (Array.isArray(tracks) ? tracks : [])
    .filter((t) => VIDEO_ID.test(t?.videoId))
    .map((t) => ({ videoId: t.videoId, title: String(t.title || '').slice(0, 200), artist: String(t.artist || '').slice(0, 120), thumbnail: String(t.thumbnail || '').slice(0, 300) }));

/** Index du titre en cours dans la file, d'après ce que joue l'enceinte. */
export const currentIndex = () => {
    const now = cast.getNowPlaying();
    if (!now?.queue || !session?.tracks?.length || now.deviceId !== session.deviceId || Math.abs((now.since || 0) - (session.startedAt || 0)) > 60_000) return -1;
    return session.tracks.findIndex((t) => now.contentId?.endsWith(`/${t.videoId}`));
};

// On note régulièrement où on en est, pour reprendre au bon titre
setInterval(() => {
    const i = currentIndex();
    if (i >= 0 && session.lastIndex !== i) {
        session.lastIndex = i;
        session.at = Date.now();
        saveSession();
    }
}, 20_000).unref?.();

// --- Minuterie ---
let sleepTimer = null;
let sleepAt = null;

export function setSleep(minutes) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
    sleepAt = null;
    const min = Number(minutes);
    if (!min || min <= 0) return { sleepAt };
    sleepAt = Date.now() + min * 60_000;
    sleepTimer = setTimeout(async () => {
        sleepAt = null;
        const now = cast.getNowPlaying();
        if (now) await cast.controlPlayback(now.deviceId, 'stop').catch(() => {});
    }, min * 60_000);
    sleepTimer.unref?.();
    return { sleepAt };
}

// --- Lancer une lecture ---

const playTracks = async (deviceId, tracks, startIndex, source) => {
    const list = tracks.slice(0, MAX_QUEUE);
    if (!list.length) throw new Error('Aucun titre lisible');
    let start = Math.max(0, Math.min(list.length - 1, startIndex || 0));
    // On résout le premier titre tout de suite : une vidéo indisponible est sautée (3 essais)
    for (let tries = 0; tries < 3; tries++) {
        try { await getYtDlpAudioUrl(list[start].videoId); break; } catch (err) {
            console.warn(`music: ${list[start].videoId} unavailable (${err?.message?.slice(0, 80)})`);
            if (start + 1 >= list.length) throw new Error('Titre indisponible');
            start++;
        }
    }
    if (list[start + 1]) getYtDlpAudioUrl(list[start + 1].videoId).catch(() => {});
    const items = list.map((t) => ({ ...t, url: streamUrl(deviceId, t.videoId), contentType: 'audio/mp4' }));
    await cast.castQueue(deviceId, items, start, { source });
    session = { deviceId, source, tracks: list, lastIndex: start, at: Date.now(), startedAt: Date.now() };
    saveSession();
    return { count: list.length, index: start };
};

const playRadio = async (deviceId, radio, source = null) => {
    await cast.castMedia(deviceId, radio.streamUrl, 'audio/mpeg', { title: radio.name, subtitle: radio.description });
    session = { deviceId, source: source || { kind: 'radio', id: radio.id, name: radio.name, thumbnail: null }, tracks: [], lastIndex: 0, at: Date.now(), startedAt: Date.now() };
    saveSession();
};

/**
 * Lance une source sur une enceinte.
 * req : { deviceId, kind: 'radio'|'playlist'|'mood'|'mix'|'tracks'|'resume', id?, name?, tracks?, startIndex?, shuffle?, thumbnail? }
 */
export async function play(req) {
    const { deviceId, kind } = req;
    if (!deviceId) throw new Error('deviceId is required');
    let source;

    if (kind === 'radio') {
        const radio = RADIOS.find((r) => r.id === req.id);
        if (!radio) throw new Error('Unknown radio');
        await playRadio(deviceId, radio);
        source = session.source;
        setSleep(0);
    } else if (kind === 'mood') {
        const mood = getMoods().find((m) => m.id === req.id);
        if (!mood) throw new Error('Unknown mood');
        source = { kind: 'mood', id: mood.id, name: mood.name, thumbnail: null };
        let played = false;
        if (mood.playlistId) {
            try {
                const data = await yt.fetchPlaylistItems(mood.playlistId, MAX_QUEUE);
                await playTracks(deviceId, shuffled(data.items), 0, source);
                played = true;
            } catch (err) {
                console.warn(`music: mood ${mood.id} playlist failed, using its radio (${err?.message})`);
            }
        }
        if (!played) await playRadio(deviceId, RADIOS.find((r) => r.id === mood.radio), source);
        setSleep(mood.sleepMinutes || 0);
    } else if (kind === 'playlist') {
        const data = await yt.fetchPlaylistItems(req.id, MAX_QUEUE);
        source = { kind: 'playlist', id: req.id, name: req.name || data.playlistName, thumbnail: req.thumbnail || data.playlistThumbnail || data.items[0]?.thumbnail || null };
        const tracks = req.shuffle ? shuffled(data.items) : data.items;
        await playTracks(deviceId, tracks, req.shuffle ? 0 : req.startIndex, source);
    } else if (kind === 'mix') {
        if (!VIDEO_ID.test(req.id)) throw new Error('Invalid video id');
        const tracks = await yt.mixFor(req.id);
        source = { kind: 'mix', id: req.id, name: `Radio · ${req.name || tracks[0]?.title || 'titre'}`, thumbnail: tracks[0]?.thumbnail || null };
        await playTracks(deviceId, tracks, 0, source);
    } else if (kind === 'tracks') {
        const tracks = cleanTracks(req.tracks);
        // Une sélection n'est pas une habitude : pas d'id stable, pas de journal
        source = { kind: 'tracks', id: null, name: req.name || (tracks.length === 1 ? tracks[0].title : 'Sélection'), thumbnail: tracks[0]?.thumbnail || null };
        await playTracks(deviceId, req.shuffle ? shuffled(tracks) : tracks, req.shuffle ? 0 : req.startIndex, source);
    } else if (kind === 'resume') {
        if (!session) throw new Error('Nothing to resume');
        const prev = session;
        if (prev.tracks?.length) await playTracks(deviceId, prev.tracks, prev.lastIndex || 0, prev.source);
        else if (prev.source?.kind === 'mood') return play({ deviceId, kind: 'mood', id: prev.source.id });
        else {
            const radio = RADIOS.find((r) => r.id === prev.source?.id);
            if (!radio) throw new Error('Nothing to resume');
            await playRadio(deviceId, radio, prev.source);
        }
        source = prev.source;
    } else {
        throw new Error('Unknown kind');
    }

    if (kind !== 'resume' && source?.id) habits.record({ ...source, deviceId });
    return { source, state: state() };
}

// --- Commandes pendant la lecture ---

const activeDevice = () => {
    const now = cast.getNowPlaying();
    if (!now) throw new Error('Nothing is playing');
    return now.deviceId;
};

export async function skip(delta) {
    const deviceId = activeDevice();
    if (!cast.getNowPlaying()?.queue) throw new Error('No queue');
    await cast.queueJump(deviceId, delta);
    return state();
}

export async function jumpTo(index) {
    const i = currentIndex();
    if (i < 0) throw new Error('No queue');
    if (index === i) return state();
    await cast.queueJump(activeDevice(), index - i);
    return state();
}

/** Ajoute à la file en cours ; sans file en cours, lance la sélection. */
export async function enqueue(deviceId, rawTracks) {
    const tracks = cleanTracks(rawTracks);
    if (!tracks.length) throw new Error('No tracks');
    const now = cast.getNowPlaying();
    if (now?.queue && session?.deviceId === now.deviceId && session.tracks.length + tracks.length <= MAX_QUEUE) {
        await cast.queueAppend(now.deviceId, tracks.map((t) => ({ ...t, url: streamUrl(now.deviceId, t.videoId), contentType: 'audio/mp4' })));
        session.tracks.push(...tracks);
        saveSession();
        return { queued: tracks.length, state: state() };
    }
    return play({ deviceId, kind: 'tracks', tracks });
}

/** Déplace la musique sur une autre enceinte, au même titre. */
export async function transfer(deviceId) {
    const from = activeDevice();
    if (from === deviceId) return state();
    const i = currentIndex();
    if (session?.tracks?.length && i >= 0) {
        await playTracks(deviceId, session.tracks, i, session.source);
    } else if (session?.source) {
        const radio = RADIOS.find((r) => r.id === (session.source.kind === 'mood' ? MOODS.find((m) => m.id === session.source.id)?.radio : session.source.id));
        if (!radio) throw new Error('Cannot move this');
        await playRadio(deviceId, radio, session.source);
    } else {
        throw new Error('Cannot move this');
    }
    await cast.controlPlayback(from, 'stop').catch(() => {});
    return state();
}

/** État pour l'écran : source, file, position, minuterie, et de quoi reprendre. */
export function state() {
    const now = cast.getNowPlaying();
    // Ce qui joue vient bien de nous (et pas d'une commande vocale lancée après)
    const live = Boolean(now && session && now.deviceId === session.deviceId && Math.abs((now.since || 0) - (session.startedAt || 0)) < 60_000);
    return {
        source: live ? session.source : null,
        tracks: live ? session.tracks : [],
        index: currentIndex(),
        sleepAt,
        resume: !live && session?.source ? { ...session.source, deviceId: session.deviceId, at: session.at, index: session.lastIndex, count: session.tracks?.length || 0 } : null,
    };
}

/** Suggestion du moment : une habitude si elle existe, sinon une ambiance selon l'heure. */
export function suggestion(now = Date.now()) {
    const playing = cast.getNowPlaying() && session?.source?.id ? `${session.source.kind}:${session.source.id}` : null;
    const habit = habits.suggest(habits.getEntries(), now, { exclude: playing });
    const s = habit || habits.defaultMood(now);
    if (s.kind === 'mood') {
        const mood = MOODS.find((m) => m.id === s.id);
        return { ...s, name: mood.name, hint: mood.hint };
    }
    return s;
}

// Enceinte de la maison par défaut (option music_default_speaker de l'add-on)
const DEFAULT_SPEAKER = (process.env.MUSIC_DEFAULT_SPEAKER || 'Salon').trim().toLowerCase();

/**
 * Enceinte par défaut quand on n'en cite pas : celle qui joue, sinon le Salon,
 * sinon la dernière utilisée, la plus utilisée du journal, ou la première joignable.
 */
export function defaultDevice() {
    const online = cast.getDevices().filter((d) => d.online);
    const byId = (id) => online.find((d) => d.id === id);
    const now = cast.getNowPlaying();
    if (now && byId(now.deviceId)) return byId(now.deviceId);
    const home = online.find((d) => d.name.toLowerCase() === DEFAULT_SPEAKER || d.id === DEFAULT_SPEAKER);
    if (home) return home;
    if (session?.deviceId && byId(session.deviceId)) return byId(session.deviceId);
    const counts = new Map();
    for (const e of habits.getEntries().slice(-200)) if (e.deviceId) counts.set(e.deviceId, (counts.get(e.deviceId) || 0) + 1);
    const usual = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => byId(id)).find(Boolean);
    return usual || online[0] || null;
}

/** Lance la suggestion du moment (habitude ou ambiance de l'heure). */
export async function playSuggestion(deviceId) {
    const id = deviceId || defaultDevice()?.id;
    if (!id) throw new Error('Aucune enceinte joignable');
    const s = suggestion();
    const result = await play({ deviceId: id, kind: s.kind, id: s.id, name: s.name, thumbnail: s.thumbnail });
    return { ...result, suggestion: s };
}
