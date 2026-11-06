import ytdl from '@distube/ytdl-core';
import dotenv from 'dotenv';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dataFile } from './dataDir.js';

dotenv.config();

// --- Cache for extracted audio URLs (TTL ~5h) ---
const audioCache = new Map(); // videoId -> { url, contentType, expiresAt }
const CACHE_TTL = 5 * 60 * 60 * 1000;

const getCached = (videoId) => {
    const entry = audioCache.get(videoId);
    if (entry && entry.expiresAt > Date.now()) return entry;
    audioCache.delete(videoId);
    return null;
};

// --- Playlist config ---
const customPlaylists = new Map(); // id -> { id, name, thumbnail }

export const getDefaultPlaylists = () => {
    const config = process.env.YOUTUBE_DEFAULT_PLAYLISTS || '';
    if (!config.trim()) return [];

    return config.split(',').map(entry => {
        const [name, id] = entry.split(':').map(s => s.trim());
        if (!name || !id) return null;
        return { id, name, thumbnail: `https://i.ytimg.com/vi/${id}/default.jpg` };
    }).filter(Boolean);
};

export const getAllPlaylists = () => {
    const defaults = getDefaultPlaylists();
    const customs = Array.from(customPlaylists.values());
    return [...defaults, ...customs];
};

// --- Parse playlist ID from URL ---
export const parsePlaylistId = (url) => {
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    if (/^[A-Z]{2}[a-zA-Z0-9_-]+$/.test(url)) return url;
    return null;
};

// --- OAuth2 (flux « appareil » : un code à saisir sur google.com/device) ---
// Les jetons sont enregistrés sur disque : on reste connecté après un redémarrage.
const TOKEN_FILE = dataFile('youtube-oauth.json');
const PLAYLISTS_FILE = dataFile('youtube-playlists.json');

const readJson = (file, fallback) => {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : fallback; } catch { return fallback; }
};

let oauthTokens = readJson(TOKEN_FILE, null); // { access_token, refresh_token, expiry_date }
for (const pl of readJson(PLAYLISTS_FILE, [])) customPlaylists.set(pl.id, pl);

const saveTokens = () => {
    try {
        if (oauthTokens) writeFileSync(TOKEN_FILE, JSON.stringify(oauthTokens, null, 2));
        else if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
    } catch (err) {
        console.error('YouTube: could not save tokens', err?.message);
    }
};

const OAUTH_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

export const isOAuthConfigured = () => Boolean(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET);
export const isAuthenticated = () => Boolean(oauthTokens?.refresh_token || oauthTokens?.access_token);

const postForm = async (url, body) => {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
    });
    return res.json();
};

/** Connexion en cours : { deviceCode, userCode, verificationUrl, interval, expiresAt, error } */
let pendingLogin = null;

const storeTokens = (data) => {
    oauthTokens = {
        access_token: data.access_token,
        // Google ne renvoie pas toujours un nouveau refresh_token : on garde l'ancien
        refresh_token: data.refresh_token || oauthTokens?.refresh_token,
        expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
    };
    saveTokens();
};

const publicLogin = () => pendingLogin && {
    userCode: pendingLogin.userCode,
    verificationUrl: pendingLogin.verificationUrl,
    expiresAt: pendingLogin.expiresAt,
    error: pendingLogin.error,
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
                storeTokens(data);
                pendingLogin = null;
                console.log('🔑 YouTube account connected');
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

/** Démarre une connexion : renvoie le code à saisir sur google.com/device. */
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

export const logout = () => {
    oauthTokens = null;
    pendingLogin = null;
    saveTokens();
};

export const getLoginStatus = () => ({
    authenticated: isAuthenticated(),
    oauthConfigured: isOAuthConfigured(),
    pending: isAuthenticated() ? null : publicLogin(),
});

const refreshAccessToken = async () => {
    if (!oauthTokens?.refresh_token) throw new Error('No refresh token');
    const data = await postForm('https://oauth2.googleapis.com/token', {
        refresh_token: oauthTokens.refresh_token,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        grant_type: 'refresh_token',
    });
    if (data.error) {
        // Jeton révoqué ou expiré pour de bon : il faut se reconnecter
        if (data.error === 'invalid_grant') {
            console.warn('YouTube: refresh token rejected, reconnect needed');
            logout();
        }
        throw new Error(data.error_description || data.error);
    }
    storeTokens(data);
    return oauthTokens.access_token;
};

const getAccessToken = async () => {
    if (!oauthTokens) throw new Error('Not authenticated');
    if (!oauthTokens.access_token || Date.now() >= oauthTokens.expiry_date - 60000) {
        return refreshAccessToken();
    }
    return oauthTokens.access_token;
};

// Rafraîchit le jeton en arrière-plan pour garder la session active
setInterval(() => {
    if (oauthTokens?.refresh_token) refreshAccessToken().catch(() => {});
}, 45 * 60 * 1000).unref?.();

// --- Fetch user's playlists via OAuth ---
export const fetchMyPlaylists = async () => {
    const token = await getAccessToken();
    const playlists = [];
    let pageToken = '';

    do {
        const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        for (const item of (data.items || [])) {
            playlists.push({
                id: item.id,
                name: item.snippet.title,
                thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
                itemCount: item.contentDetails?.itemCount || 0,
            });
        }

        pageToken = data.nextPageToken || '';
    } while (pageToken);

    return playlists;
};

// --- Fetch "Liked Music" playlist ---
export const fetchLikedMusic = async () => {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&myRating=like&maxResults=50`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    return (data.items || []).map((item, i) => ({
        videoId: item.id,
        title: item.snippet.title,
        artist: item.snippet.channelTitle?.replace(' - Topic', '') || '',
        thumbnail: item.snippet.thumbnails?.medium?.url || '',
        thumbnailHigh: item.snippet.thumbnails?.high?.url || '',
        position: i,
    }));
};

// --- YouTube Data API v3 (API key or OAuth) ---
export const fetchPlaylistItems = async (playlistId, maxResults = 50) => {
    // Use OAuth token if available, otherwise API key
    const headers = {};
    let authParam = '';

    const token = isAuthenticated() ? await getAccessToken().catch(() => null) : null;
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    } else {
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured and not authenticated');
        authParam = `&key=${apiKey}`;
    }

    const items = [];

    // Fetch playlist info
    const playlistInfoUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}${authParam}`;
    let playlistName = playlistId;
    let playlistThumbnail = '';

    try {
        const infoRes = await fetch(playlistInfoUrl, { headers });
        const infoData = await infoRes.json();
        if (infoData.items?.length > 0) {
            playlistName = infoData.items[0].snippet.title;
            playlistThumbnail = infoData.items[0].snippet.thumbnails?.medium?.url || '';
        }
    } catch {}

    // Fetch playlist items
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=${maxResults}&playlistId=${playlistId}${authParam}`;
    const res = await fetch(url, { headers });
    const data = await res.json();

    if (data.error) throw new Error(data.error.message || 'YouTube API error');

    for (const item of (data.items || [])) {
        const snippet = item.snippet;
        const videoId = item.contentDetails?.videoId || snippet?.resourceId?.videoId;
        if (!videoId) continue;

        items.push({
            videoId,
            title: snippet.title,
            artist: snippet.videoOwnerChannelTitle?.replace(' - Topic', '') || snippet.channelTitle || '',
            thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
            thumbnailHigh: snippet.thumbnails?.high?.url || '',
            position: snippet.position,
        });
    }

    return {
        playlistId,
        playlistName,
        playlistThumbnail,
        items,
        totalResults: data.pageInfo?.totalResults || items.length,
    };
};

// --- Audio extraction via ytdl-core ---
export const extractAudioUrl = async (videoId) => {
    const cached = getCached(videoId);
    if (cached) {
        console.log(`🎵 Cache hit for ${videoId}`);
        return { audioUrl: cached.url, contentType: cached.contentType, cached: true };
    }

    console.log(`🎵 Extracting audio for ${videoId}...`);

    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

    let chosen = audioFormats.find(f => f.audioBitrate && f.audioBitrate >= 128 && f.audioBitrate <= 160)
        || audioFormats.find(f => f.audioBitrate && f.audioBitrate >= 64)
        || audioFormats[0];

    if (!chosen) {
        const withAudio = info.formats.filter(f => f.hasAudio);
        chosen = withAudio[0];
    }

    if (!chosen) throw new Error('No audio format available');

    const result = {
        audioUrl: chosen.url,
        contentType: chosen.mimeType?.split(';')[0] || 'audio/webm',
    };

    audioCache.set(videoId, {
        url: result.audioUrl,
        contentType: result.contentType,
        expiresAt: Date.now() + CACHE_TTL,
    });

    console.log(`🎵 Extracted: ${result.contentType} for ${videoId}`);
    return result;
};

// --- Add custom playlist ---
export const addCustomPlaylist = async (url) => {
    const playlistId = parsePlaylistId(url);
    if (!playlistId) throw new Error('Invalid playlist URL');

    const data = await fetchPlaylistItems(playlistId, 1);

    const playlist = {
        id: playlistId,
        name: data.playlistName,
        thumbnail: data.playlistThumbnail || data.items[0]?.thumbnail || '',
        itemCount: data.totalResults,
    };

    customPlaylists.set(playlistId, playlist);
    try { writeFileSync(PLAYLISTS_FILE, JSON.stringify([...customPlaylists.values()], null, 2)); } catch {}
    return playlist;
};
