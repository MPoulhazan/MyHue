/**
 * YouTube : comptes Google (plusieurs possibles), playlists, titres aimés, recherche et mix.
 * Les jetons restent sur disque (DATA_DIR/youtube-accounts.json) : on reste connecté après un redémarrage.
 */
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dataFile } from './dataDir.js';

dotenv.config();

const execFileAsync = promisify(execFile);
const API = 'https://www.googleapis.com/youtube/v3';

const readJson = (file, fallback) => {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : fallback; } catch { return fallback; }
};

// --- Playlists ajoutées par lien ---
const PLAYLISTS_FILE = dataFile('youtube-playlists.json');
const customPlaylists = new Map(); // id -> { id, name, thumbnail, itemCount }
for (const pl of readJson(PLAYLISTS_FILE, [])) customPlaylists.set(pl.id, pl);

export const getDefaultPlaylists = () => {
    const config = process.env.YOUTUBE_DEFAULT_PLAYLISTS || '';
    if (!config.trim()) return [];
    return config.split(',').map((entry) => {
        const [name, id] = entry.split(':').map((s) => s.trim());
        if (!name || !id) return null;
        return { id, name, thumbnail: '' };
    }).filter(Boolean);
};

export const getAllPlaylists = () => [...getDefaultPlaylists(), ...customPlaylists.values()];

export const parsePlaylistId = (url) => {
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    if (/^[A-Z]{2}[a-zA-Z0-9_-]+$/.test(url)) return url;
    return null;
};

// --- Comptes (OAuth, flux « appareil » : un code à saisir sur google.com/device) ---
const ACCOUNTS_FILE = dataFile('youtube-accounts.json');
const LEGACY_TOKEN_FILE = dataFile('youtube-oauth.json');

/** [{ id, name, channelId, tokens: { access_token, refresh_token, expiry_date } }] */
let accounts = readJson(ACCOUNTS_FILE, []);

// Ancien format (un seul compte) : on le reprend comme premier compte
if (!accounts.length && existsSync(LEGACY_TOKEN_FILE)) {
    const tokens = readJson(LEGACY_TOKEN_FILE, null);
    if (tokens?.refresh_token || tokens?.access_token) accounts = [{ id: 'a1', name: null, channelId: null, tokens }];
}

const saveAccounts = () => {
    try {
        writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
        if (existsSync(LEGACY_TOKEN_FILE)) unlinkSync(LEGACY_TOKEN_FILE);
    } catch (err) {
        console.error('YouTube: could not save accounts', err?.message);
    }
};

const OAUTH_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

export const isOAuthConfigured = () => Boolean(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET);
export const isAuthenticated = () => accounts.length > 0;
export const getAccounts = () => accounts.map((a, i) => ({ id: a.id, name: a.name || `Compte ${i + 1}` }));

const postForm = async (url, body) => {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
    });
    return res.json();
};

const tokensFrom = (data, previous) => ({
    access_token: data.access_token,
    // Google ne renvoie pas toujours un nouveau refresh_token : on garde l'ancien
    refresh_token: data.refresh_token || previous?.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
});

const findAccount = (id) => accounts.find((a) => a.id === id);

const refreshAccessToken = async (account) => {
    if (!account.tokens?.refresh_token) throw new Error('No refresh token');
    const data = await postForm('https://oauth2.googleapis.com/token', {
        refresh_token: account.tokens.refresh_token,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        grant_type: 'refresh_token',
    });
    if (data.error) {
        // Jeton révoqué ou expiré pour de bon : il faut reconnecter ce compte
        if (data.error === 'invalid_grant') {
            console.warn(`YouTube: refresh token rejected for ${account.name || account.id}, reconnect needed`);
            logout(account.id);
        }
        throw new Error(data.error_description || data.error);
    }
    account.tokens = tokensFrom(data, account.tokens);
    saveAccounts();
    return account.tokens.access_token;
};

const getAccessToken = async (accountId) => {
    const account = accountId ? findAccount(accountId) : accounts[0];
    if (!account) throw new Error('Not authenticated');
    if (!account.tokens?.access_token || Date.now() >= account.tokens.expiry_date - 60000) {
        return refreshAccessToken(account);
    }
    return account.tokens.access_token;
};

// Nom de la chaîne du compte ; un compte YouTube Music sans chaîne reste « Compte N »
const fetchChannel = async (token) => {
    try {
        const res = await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        const ch = data.items?.[0];
        return ch ? { channelId: ch.id, name: ch.snippet?.title || null } : { channelId: null, name: null };
    } catch {
        return { channelId: null, name: null };
    }
};

// Comptes migrés sans nom : on le récupère une fois
setTimeout(async () => {
    for (const a of accounts.filter((x) => !x.name)) {
        try {
            const { channelId, name } = await fetchChannel(await getAccessToken(a.id));
            if (name) { a.name = name; a.channelId = channelId; saveAccounts(); }
        } catch { /* plus tard */ }
    }
}, 5000).unref?.();

/** Connexion en cours : { deviceCode, userCode, verificationUrl, interval, expiresAt, error } */
let pendingLogin = null;

const publicLogin = () => pendingLogin && {
    userCode: pendingLogin.userCode,
    verificationUrl: pendingLogin.verificationUrl,
    expiresAt: pendingLogin.expiresAt,
    error: pendingLogin.error,
};

const addAccount = async (data) => {
    const tokens = tokensFrom(data, null);
    const { channelId, name } = await fetchChannel(tokens.access_token);
    // Le même compte reconnecté remplace l'ancien
    const same = channelId && accounts.find((a) => a.channelId === channelId);
    if (same) {
        same.tokens = tokensFrom(data, same.tokens);
        same.name = name || same.name;
    } else {
        const n = accounts.reduce((m, a) => Math.max(m, Number(a.id.slice(1)) || 0), 0) + 1;
        accounts.push({ id: `a${n}`, name, channelId, tokens });
    }
    saveAccounts();
    console.log(`🔑 YouTube account connected: ${name || 'sans chaîne'}`);
};

const pollLogin = async (login) => {
    while (pendingLogin === login && Date.now() < login.expiresAt) {
        await new Promise((r) => setTimeout(r, login.interval * 1000));
        if (pendingLogin !== login) return;
        try {
            const data = await postForm('https://oauth2.googleapis.com/token', {
                client_id: OAUTH_CLIENT_ID,
                client_secret: OAUTH_CLIENT_SECRET,
                device_code: login.deviceCode,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            });
            if (data.access_token) {
                await addAccount(data);
                pendingLogin = null;
                return;
            }
            if (data.error === 'slow_down') login.interval += 5;
            else if (data.error !== 'authorization_pending') {
                login.error = data.error === 'access_denied' ? 'Connexion refusée.' : (data.error_description || data.error);
                return;
            }
        } catch {
            // réseau : on réessaie au prochain tour
        }
    }
    if (pendingLogin === login && !login.error) login.error = 'Le code a expiré, recommence.';
};

/** Démarre une connexion (ajoute un compte) : renvoie le code à saisir sur google.com/device. */
export const startDeviceLogin = async () => {
    if (!isOAuthConfigured()) throw new Error('YOUTUBE_CLIENT_ID et YOUTUBE_CLIENT_SECRET ne sont pas configurés');
    if (pendingLogin && !pendingLogin.error && Date.now() < pendingLogin.expiresAt - 30000) return publicLogin();

    const data = await postForm('https://oauth2.googleapis.com/device/code', {
        client_id: OAUTH_CLIENT_ID,
        scope: OAUTH_SCOPES,
    });
    if (data.error) {
        if (/invalid_client|unauthorized_client/.test(data.error)) {
            throw new Error('Le client OAuth Google doit être de type « TV et appareils à saisie limitée ». Crée-le dans Google Cloud et mets son ID et son secret dans la configuration de l’add-on.');
        }
        throw new Error(data.error_description || data.error);
    }
    pendingLogin = {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUrl: data.verification_url || 'https://www.google.com/device',
        interval: data.interval || 5,
        expiresAt: Date.now() + (data.expires_in || 1800) * 1000,
        error: null,
    };
    pollLogin(pendingLogin);
    return publicLogin();
};

export const cancelDeviceLogin = () => { pendingLogin = null; };

/** Déconnecte un compte (tous si aucun n'est précisé). */
export function logout(accountId) {
    accounts = accountId ? accounts.filter((a) => a.id !== accountId) : [];
    pendingLogin = null;
    saveAccounts();
}

export const getLoginStatus = () => ({
    authenticated: isAuthenticated(),
    oauthConfigured: isOAuthConfigured(),
    accounts: getAccounts(),
    pending: publicLogin(),
});

// Rafraîchit les jetons en arrière-plan pour garder les sessions actives
setInterval(() => {
    for (const a of accounts) if (a.tokens?.refresh_token) refreshAccessToken(a).catch(() => {});
}, 45 * 60 * 1000).unref?.();

// --- Lecture de l'API ---

const thumb = (s) => s?.thumbnails?.medium?.url || s?.thumbnails?.high?.url || s?.thumbnails?.default?.url || '';
const cleanArtist = (name) => (name || '').replace(/ - Topic$/, '');

// Propriétaire de chaque playlist privée, pour la lire avec le bon compte
const playlistOwner = new Map();

const LIKED_PREFIX = 'liked:';

/** Playlists de tous les comptes (et leurs « J'aime »), avec le nom du compte. */
export const fetchMyPlaylists = async () => {
    const all = [];
    const errors = [];
    for (const account of getAccounts()) {
        try {
            const token = await getAccessToken(account.id);
            all.push({ id: `${LIKED_PREFIX}${account.id}`, name: 'J’aime', thumbnail: '', liked: true, accountId: account.id, accountName: account.name });
            let pageToken = '';
            do {
                const res = await fetch(`${API}/playlists?part=snippet,contentDetails&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                for (const item of data.items || []) {
                    playlistOwner.set(item.id, account.id);
                    all.push({
                        id: item.id,
                        name: item.snippet.title,
                        thumbnail: thumb(item.snippet),
                        itemCount: item.contentDetails?.itemCount || 0,
                        accountId: account.id,
                        accountName: account.name,
                    });
                }
                pageToken = data.nextPageToken || '';
            } while (pageToken);
        } catch (err) {
            errors.push(`${account.name}: ${err?.message}`);
        }
    }
    if (errors.length && !all.length) throw new Error(errors.join(' · '));
    return all;
};

const fetchLiked = async (accountId, maxResults) => {
    const token = await getAccessToken(accountId);
    const items = [];
    let pageToken = '';
    do {
        const res = await fetch(`${API}/videos?part=snippet&myRating=like&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        for (const item of data.items || []) {
            items.push({ videoId: item.id, title: item.snippet.title, artist: cleanArtist(item.snippet.channelTitle), thumbnail: thumb(item.snippet), position: items.length });
        }
        pageToken = data.nextPageToken || '';
    } while (pageToken && items.length < maxResults);
    const account = getAccounts().find((a) => a.id === accountId);
    return { playlistId: `${LIKED_PREFIX}${accountId}`, playlistName: `J’aime · ${account?.name || ''}`.replace(/ · $/, ''), playlistThumbnail: items[0]?.thumbnail || '', items, totalResults: items.length };
};

// Jeton du propriétaire si on le connaît, sinon le premier compte, sinon la clé d'API
const authFor = async (playlistId) => {
    const owner = playlistOwner.get(playlistId);
    const token = isAuthenticated() ? await getAccessToken(owner).catch(() => null) : null;
    if (token) return { headers: { Authorization: `Bearer ${token}` }, param: '' };
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured and not authenticated');
    return { headers: {}, param: `&key=${apiKey}` };
};

/** Titres d'une playlist (jusqu'à maxResults, en plusieurs pages). */
export const fetchPlaylistItems = async (playlistId, maxResults = 200) => {
    if (playlistId.startsWith(LIKED_PREFIX)) return fetchLiked(playlistId.slice(LIKED_PREFIX.length), maxResults);

    const { headers, param } = await authFor(playlistId);
    let playlistName = playlistId;
    let playlistThumbnail = '';
    try {
        const info = await (await fetch(`${API}/playlists?part=snippet&id=${playlistId}${param}`, { headers })).json();
        if (info.items?.length) {
            playlistName = info.items[0].snippet.title;
            playlistThumbnail = thumb(info.items[0].snippet);
        }
    } catch { /* nom par défaut */ }

    const items = [];
    let total = 0;
    let pageToken = '';
    do {
        const per = Math.min(50, maxResults - items.length);
        const data = await (await fetch(`${API}/playlistItems?part=snippet,contentDetails&maxResults=${per}&playlistId=${playlistId}${param}${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers })).json();
        if (data.error) throw new Error(data.error.message || 'YouTube API error');
        total = data.pageInfo?.totalResults || total;
        for (const item of data.items || []) {
            const s = item.snippet;
            const videoId = item.contentDetails?.videoId || s?.resourceId?.videoId;
            // Vidéos supprimées ou privées : pas lisibles
            if (!videoId || s.title === 'Deleted video' || s.title === 'Private video') continue;
            items.push({ videoId, title: s.title, artist: cleanArtist(s.videoOwnerChannelTitle) || s.channelTitle || '', thumbnail: thumb(s), position: s.position });
        }
        pageToken = data.nextPageToken || '';
    } while (pageToken && items.length < maxResults);

    return { playlistId, playlistName, playlistThumbnail, items, totalResults: total || items.length };
};

// --- Recherche et mix (yt-dlp en secours : gratuit, sans quota) ---

const ytdlpList = async (target, limit) => {
    const { stdout } = await execFileAsync('yt-dlp', ['--flat-playlist', '-J', '--no-warnings', '--playlist-end', String(limit), target], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    return (data.entries || []).filter((e) => e?.id && e.id.length === 11).map((e) => ({
        videoId: e.id,
        title: e.title || '',
        artist: cleanArtist(e.channel || e.uploader || ''),
        thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
        duration: e.duration || null,
    }));
};

/** Recherche de titres : API YouTube (catégorie Musique) puis yt-dlp si le quota est épuisé. */
export const search = async (query, limit = 20) => {
    const q = String(query || '').trim().slice(0, 100);
    if (!q) return [];
    try {
        const token = isAuthenticated() ? await getAccessToken().catch(() => null) : null;
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (!token && !apiKey) throw new Error('no credentials');
        const url = `${API}/search?part=snippet&type=video&videoCategoryId=10&maxResults=${limit}&q=${encodeURIComponent(q)}${token ? '' : `&key=${apiKey}`}`;
        const data = await (await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).json();
        if (data.error) throw new Error(data.error.message);
        // L'API glisse parfois une chaîne parmi les vidéos : on ne garde que les titres lisibles
        return (data.items || []).filter((item) => item.id?.videoId).map((item) => ({
            videoId: item.id.videoId,
            title: decodeEntities(item.snippet.title),
            artist: cleanArtist(decodeEntities(item.snippet.channelTitle)),
            thumbnail: thumb(item.snippet),
        }));
    } catch (err) {
        console.warn(`YouTube search via API failed (${err?.message}), falling back to yt-dlp`);
        return ytdlpList(`ytsearch${limit}:${q}`, limit);
    }
};

/** « Radio » à partir d'un titre : le mix automatique de YouTube (~25 titres proches). */
export const mixFor = async (videoId) => {
    if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid video id');
    return ytdlpList(`https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`, 40);
};

const decodeEntities = (s) => String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// --- Playlist ajoutée par lien ---
export const addCustomPlaylist = async (url) => {
    const playlistId = parsePlaylistId(url);
    if (!playlistId) throw new Error('Invalid playlist URL');
    const data = await fetchPlaylistItems(playlistId, 1);
    const playlist = { id: playlistId, name: data.playlistName, thumbnail: data.playlistThumbnail || data.items[0]?.thumbnail || '', itemCount: data.totalResults };
    customPlaylists.set(playlistId, playlist);
    try { writeFileSync(PLAYLISTS_FILE, JSON.stringify([...customPlaylists.values()], null, 2)); } catch { /* disque plein */ }
    return playlist;
};

export const removeCustomPlaylist = (playlistId) => {
    customPlaylists.delete(playlistId);
    try { writeFileSync(PLAYLISTS_FILE, JSON.stringify([...customPlaylists.values()], null, 2)); } catch { /* disque plein */ }
};
