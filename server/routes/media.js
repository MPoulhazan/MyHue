/**
 * Google Cast, YouTube (playlists, OAuth, flux audio) et infos Google Home.
 */
import express from 'express';
import axios from 'axios';
import * as castService from '../castService.js';
import * as youtubeService from '../youtubeService.js';
import * as googleHomeService from '../googleHomeService.js';
import { getYtDlpAudioUrl } from '../ytdlp.js';
import * as musicPlayer from '../musicPlayer.js';
import * as musicHabits from '../musicHabits.js';

export const router = express.Router();

// --- Cast direct (sans IA) ---

router.get('/api/cast/devices', (_req, res) => {
    res.json({ devices: castService.getDevices() });
});

// Ce qui joue en ce moment (mini-lecteur), y compris lancé par l'agent
router.get('/api/cast/now', (_req, res) => {
    res.json({ now: castService.getNowPlaying() });
});

router.post('/api/cast/play', async (req, res) => {
    try {
        const { deviceId, mediaUrl, contentType, metadata } = req.body;
        if (!deviceId || !mediaUrl) {
            return res.status(400).json({ error: 'deviceId and mediaUrl are required' });
        }
        const result = await castService.castMedia(
            deviceId,
            mediaUrl,
            contentType || 'audio/mpeg',
            metadata || {},
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Cast failed' });
    }
});

router.post('/api/cast/control', async (req, res) => {
    try {
        const { deviceId, command } = req.body;
        if (!deviceId || !command) {
            return res.status(400).json({ error: 'deviceId and command are required' });
        }
        res.json(await castService.controlPlayback(deviceId, command));
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Control failed' });
    }
});

router.post('/api/cast/volume', async (req, res) => {
    try {
        const { deviceId, level } = req.body;
        if (!deviceId || level === undefined) {
            return res.status(400).json({ error: 'deviceId and level are required' });
        }
        res.json(await castService.setVolume(deviceId, Number(level)));
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Volume failed' });
    }
});

// --- YouTube OAuth2 ---

router.get('/api/youtube/auth/status', (_req, res) => {
    res.json(youtubeService.getLoginStatus());
});

// Connexion par code (google.com/device) : marche depuis la tablette et le téléphone
router.post('/api/youtube/auth/start', async (_req, res) => {
    try {
        res.json(await youtubeService.startDeviceLogin());
    } catch (error) {
        res.status(500).json({ error: error?.message });
    }
});

router.post('/api/youtube/auth/cancel', (_req, res) => {
    youtubeService.cancelDeviceLogin();
    res.json({ ok: true });
});

router.post('/api/youtube/auth/logout', (req, res) => {
    youtubeService.logout(req.body?.accountId);
    res.json({ ok: true });
});

// --- YouTube playlists ---

router.get('/api/youtube/playlists', async (_req, res) => {
    let userPlaylists = [];
    let accountError = null;
    if (youtubeService.isAuthenticated()) {
        try {
            userPlaylists = await youtubeService.fetchMyPlaylists();
        } catch (error) {
            accountError = error?.message || 'YouTube account error';
        }
    }
    res.json({
        playlists: [...userPlaylists, ...youtubeService.getAllPlaylists()],
        authenticated: youtubeService.isAuthenticated(),
        accountError,
    });
});

router.get('/api/youtube/playlist/:id', async (req, res) => {
    try {
        res.json(await youtubeService.fetchPlaylistItems(req.params.id));
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Failed to fetch playlist' });
    }
});

router.post('/api/youtube/playlist/remove', (req, res) => {
    youtubeService.removeCustomPlaylist(String(req.body?.id || ''));
    res.json({ ok: true });
});

router.post('/api/youtube/playlist/add', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'url is required' });
        res.json(await youtubeService.addCustomPlaylist(url));
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Failed to add playlist' });
    }
});

router.post('/api/youtube/extract-audio', async (req, res) => {
    try {
        const { videoId } = req.body;
        if (!videoId) return res.status(400).json({ error: 'videoId is required' });
        const audioUrl = await getYtDlpAudioUrl(videoId);
        res.json({ audioUrl, contentType: 'audio/mp4' });
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Audio extraction failed' });
    }
});

// Proxy audio avec support Range, pour les appareils Cast
router.get('/api/youtube/stream/:videoId', async (req, res) => {
    const { videoId } = req.params;
    try {
        console.log(`🎵 Stream proxy for ${videoId} (Range: ${req.headers.range || 'none'})`);
        const audioUrl = await getYtDlpAudioUrl(videoId);

        const headers = {};
        if (req.headers.range) headers['Range'] = req.headers.range;

        const upstream = await axios.get(audioUrl, {
            headers,
            responseType: 'stream',
            timeout: 30000,
            validateStatus: (s) => s >= 200 && s < 400,
        });

        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
            if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
        }
        if (!res.getHeader('content-type')?.toString().startsWith('audio/')) {
            res.setHeader('Content-Type', 'audio/mp4');
        }
        res.setHeader('Accept-Ranges', 'bytes');

        res.status(upstream.status);
        upstream.data.pipe(res);
        upstream.data.on('error', (err) => {
            console.error(`❌ Stream error for ${videoId}:`, err.message);
            res.end();
        });
        req.on('close', () => upstream.data.destroy());
    } catch (error) {
        console.error(`❌ Stream proxy error for ${videoId}:`, error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error?.message || 'Stream failed' });
        }
    }
});

// --- Lecteur de musique (file d'attente, ambiances, habitudes) ---

const fail = (res, error, status = 500) => res.status(status).json({ error: error?.message || String(error) });

// Tout ce qu'il faut pour afficher l'écran Musique en un appel
router.get('/api/music/home', (_req, res) => {
    res.json({
        radios: musicPlayer.RADIOS.map(({ id, name, description }) => ({ id, name, description })),
        moods: musicPlayer.getMoods(),
        suggestion: musicPlayer.suggestion(),
        state: musicPlayer.state(),
        recent: musicHabits.recent(8),
        device: (({ id, name } = {}) => (id ? { id, name } : null))(musicPlayer.defaultDevice() || undefined),
    });
});

router.get('/api/music/state', (_req, res) => res.json(musicPlayer.state()));

// Carte de l'accueil : lance la suggestion du moment sur l'enceinte par défaut
router.post('/api/music/play-suggestion', async (req, res) => {
    try { res.json(await musicPlayer.playSuggestion(req.body?.deviceId)); } catch (e) { fail(res, e); }
});

router.post('/api/music/play', async (req, res) => {
    try { res.json(await musicPlayer.play(req.body || {})); } catch (e) { fail(res, e); }
});
router.post('/api/music/next', async (_req, res) => {
    try { res.json(await musicPlayer.skip(1)); } catch (e) { fail(res, e); }
});
router.post('/api/music/prev', async (_req, res) => {
    try { res.json(await musicPlayer.skip(-1)); } catch (e) { fail(res, e); }
});
router.post('/api/music/jump', async (req, res) => {
    try { res.json(await musicPlayer.jumpTo(Number(req.body?.index))); } catch (e) { fail(res, e); }
});
router.post('/api/music/enqueue', async (req, res) => {
    try { res.json(await musicPlayer.enqueue(req.body?.deviceId, req.body?.tracks)); } catch (e) { fail(res, e); }
});
router.post('/api/music/transfer', async (req, res) => {
    try { res.json(await musicPlayer.transfer(req.body?.deviceId)); } catch (e) { fail(res, e); }
});
router.post('/api/music/sleep', (req, res) => {
    res.json(musicPlayer.setSleep(req.body?.minutes));
});
router.post('/api/music/mood-link', (req, res) => {
    try { res.json({ moods: musicPlayer.linkMood(req.body?.moodId, req.body?.playlist) }); } catch (e) { fail(res, e, 400); }
});
router.get('/api/music/search', async (req, res) => {
    try { res.json({ results: await youtubeService.search(req.query.q) }); } catch (e) { fail(res, e); }
});

// Volume et activité de chaque enceinte
router.get('/api/cast/rooms', async (_req, res) => {
    try { res.json({ rooms: await castService.getRoomStates() }); } catch (e) { fail(res, e); }
});

// --- Google Home ---

router.get('/api/google-home/devices', async (_req, res) => {
    try {
        res.json({ devices: await googleHomeService.getGoogleHomeDevices() });
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Failed to fetch Google Home devices' });
    }
});
