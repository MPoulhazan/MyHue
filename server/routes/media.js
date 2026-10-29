/**
 * Google Cast, YouTube (playlists, OAuth, flux audio) et infos Google Home.
 */
import express from 'express';
import axios from 'axios';
import * as castService from '../castService.js';
import * as youtubeService from '../youtubeService.js';
import * as googleHomeService from '../googleHomeService.js';
import { getYtDlpAudioUrl } from '../ytdlp.js';

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
    res.json({
        authenticated: youtubeService.isAuthenticated(),
        oauthConfigured: youtubeService.isOAuthConfigured(),
    });
});

router.get('/api/youtube/auth/url', (_req, res) => {
    try {
        res.json({ url: youtubeService.getAuthUrl() });
    } catch (error) {
        res.status(500).json({ error: error?.message });
    }
});

router.get('/api/youtube/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).send('Missing code');
        await youtubeService.exchangeCode(code);
        res.send(
            '<html><body><script>window.close(); window.opener && window.opener.postMessage("youtube-auth-success","*");</script><p>Connecte ! Tu peux fermer cette fenetre.</p></body></html>',
        );
    } catch (error) {
        res.status(500).send(`Erreur OAuth: ${error?.message}`);
    }
});

// --- YouTube playlists ---

router.get('/api/youtube/playlists', async (_req, res) => {
    try {
        const userPlaylists = youtubeService.isAuthenticated()
            ? await youtubeService.fetchMyPlaylists()
            : [];
        res.json({
            playlists: [...userPlaylists, ...youtubeService.getAllPlaylists()],
            authenticated: youtubeService.isAuthenticated(),
        });
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Failed to get playlists' });
    }
});

router.get('/api/youtube/playlist/:id', async (req, res) => {
    try {
        res.json(await youtubeService.fetchPlaylistItems(req.params.id));
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Failed to fetch playlist' });
    }
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

// --- Google Home ---

router.get('/api/google-home/devices', async (_req, res) => {
    try {
        res.json({ devices: await googleHomeService.getGoogleHomeDevices() });
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Failed to fetch Google Home devices' });
    }
});
