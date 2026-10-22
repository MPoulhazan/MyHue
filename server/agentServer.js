import express from 'express';
import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import * as castService from './castService.js';
import * as youtubeService from './youtubeService.js';
import * as googleHomeService from './googleHomeService.js';
import * as xiaomiService from './xiaomiService.js';
import * as rulesEngine from './rulesEngine.js';
import * as broadlinkService from './broadlinkService.js';
import * as zigbeeService from './zigbeeService.js';
import * as sensorRegistry from './sensorRegistry.js';
import * as haService from './haService.js';
import { parseIntent } from './intentParser.js';
import { runGroqAgent, needsClaude, buildEscalation } from './groqAgent.js';

const execFileAsync = promisify(execFile);

// --- Capteurs Zigbee via registre manuel (server/data/sensors.json) ---
export const getZigbeeSensors = async () => {
    const devices = zigbeeService.getDevices();
    const registry = sensorRegistry.getAll();
    return registry.map((entry) => {
        const device = devices.find((d) => d.ieeeAddr === entry.ieee) || null;
        const state = device?.state || {};
        return {
            did: entry.ieee,
            name: entry.name,
            model: device?.model || 'Zigbee',
            type: entry.type,
            icon: entry.icon || '📡',
            isOnline: device ? device.available !== false : false,
            mac: entry.ieee,
            zigbeeName: device?.friendlyName || entry.ieee,
            props: {
                temperature: state.temperature ?? null,
                humidity: state.humidity ?? null,
                pressure: state.pressure ?? null,
                battery: state.battery ?? null,
                isOpen: 'contact' in state ? !state.contact : null,
                lastMotion: state.occupancy ? new Date().toISOString() : null,
                lastOpen: null,
            },
            lastUpdated: device?.lastSeen
                ? new Date(device.lastSeen).toISOString()
                : null,
            source: 'zigbee',
        };
    });
};

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.AGENT_PORT || 5174);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const BRIDGE_IP = process.env.VITE_HUE_BRIDGE_IP;
const USERNAME = process.env.VITE_HUE_USERNAME;

const hueBaseUrl =
    BRIDGE_IP && USERNAME ? `http://${BRIDGE_IP}/api/${USERNAME}` : null;

const hueClient = axios.create({
    baseURL: hueBaseUrl ?? undefined,
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000,
});

const groqClient = axios.create({
    baseURL: 'https://api.groq.com/openai/v1',
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    timeout: 30000,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const rgbToXy = (r, g, b) => {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;

    const r2 =
        red > 0.04045 ? Math.pow((red + 0.055) / 1.055, 2.4) : red / 12.92;
    const g2 =
        green > 0.04045
            ? Math.pow((green + 0.055) / 1.055, 2.4)
            : green / 12.92;
    const b2 =
        blue > 0.04045 ? Math.pow((blue + 0.055) / 1.055, 2.4) : blue / 12.92;

    const X = r2 * 0.649926 + g2 * 0.103455 + b2 * 0.197109;
    const Y = r2 * 0.234327 + g2 * 0.743075 + b2 * 0.022598;
    const Z = g2 * 0.053077 + b2 * 1.035763;

    const sum = X + Y + Z;
    if (sum === 0) {
        return [0, 0];
    }

    const x = X / sum;
    const y = Y / sum;

    return [x, y];
};

const ensureHueConfigured = () => {
    if (!hueBaseUrl) {
        const error = new Error(
            'Hue Bridge not configured. Check VITE_HUE_BRIDGE_IP and VITE_HUE_USERNAME.',
        );
        error.code = 'HUE_NOT_CONFIGURED';
        throw error;
    }
};

const getHueContext = async () => {
    ensureHueConfigured();
    const [lightsResponse, groupsResponse] = await Promise.all([
        hueClient.get('/lights'),
        hueClient.get('/groups'),
    ]);

    const lights = Object.entries(lightsResponse.data).map(([id, light]) => ({
        id,
        name: light.name,
        on: light.state?.on ?? false,
        bri: light.state?.bri ?? 0,
        reachable: light.state?.reachable ?? false,
    }));

    const groups = Object.entries(groupsResponse.data)
        .filter(
            ([_, group]) => group.type !== 'Room' || group.lights?.length > 0,
        )
        .map(([id, group]) => ({
            id,
            name: group.name,
            type: group.type,
            lights: group.lights ?? [],
            any_on: group.state?.any_on ?? false,
        }));

    return { lights, groups };
};

// Scènes Hue, en cache 5 min (elles changent rarement)
let scenesCache = { at: 0, scenes: [] };
const getHueScenes = async () => {
    if (!hueBaseUrl) return [];
    if (Date.now() - scenesCache.at < 5 * 60 * 1000) return scenesCache.scenes;
    try {
        const { data } = await hueClient.get('/scenes');
        const scenes = Object.entries(data)
            .filter(([_, scene]) => !scene.name?.startsWith('HIDDEN'))
            .map(([id, scene]) => ({
                id,
                name: scene.name,
                type: scene.type,
                group: scene.group,
            }));
        scenesCache = { at: Date.now(), scenes };
        return scenes;
    } catch {
        return scenesCache.scenes;
    }
};

const executeActions = async (actions) => {
    if (!Array.isArray(actions) || actions.length === 0) {
        return [];
    }

    const results = [];

    for (const action of actions) {
        try {
            switch (action.type) {
                // Hue actions
                case 'toggle_light': {
                    ensureHueConfigured();
                    await hueClient.put(`/lights/${action.id}/state`, {
                        on: Boolean(action.on),
                    });
                    results.push({ action, status: 'ok' });
                    break;
                }
                case 'toggle_all': {
                    ensureHueConfigured();
                    await hueClient.put('/groups/0/action', {
                        on: Boolean(action.on),
                    });
                    results.push({ action, status: 'ok' });
                    break;
                }
                case 'set_brightness': {
                    ensureHueConfigured();
                    const bri = clamp(Number(action.bri), 0, 254);
                    await hueClient.put(`/lights/${action.id}/state`, { bri });
                    results.push({ action: { ...action, bri }, status: 'ok' });
                    break;
                }
                case 'set_color': {
                    ensureHueConfigured();
                    const hue = clamp(Number(action.hue), 0, 65535);
                    const sat = clamp(Number(action.sat), 0, 254);
                    await hueClient.put(`/lights/${action.id}/state`, {
                        hue,
                        sat,
                    });
                    results.push({
                        action: { ...action, hue, sat },
                        status: 'ok',
                    });
                    break;
                }
                case 'set_color_temperature': {
                    ensureHueConfigured();
                    const ct = clamp(Number(action.ct), 153, 500);
                    await hueClient.put(`/lights/${action.id}/state`, { ct });
                    results.push({ action: { ...action, ct }, status: 'ok' });
                    break;
                }
                case 'set_rgb': {
                    ensureHueConfigured();
                    const r = clamp(Number(action.r), 0, 255);
                    const g = clamp(Number(action.g), 0, 255);
                    const b = clamp(Number(action.b), 0, 255);
                    const [x, y] = rgbToXy(r, g, b);
                    await hueClient.put(`/lights/${action.id}/state`, {
                        xy: [x, y],
                    });
                    results.push({
                        action: { ...action, r, g, b },
                        status: 'ok',
                    });
                    break;
                }
                case 'set_group_state':
                case 'set_light_state': {
                    ensureHueConfigured();
                    const state = { ...(action.state || {}) };
                    if (Array.isArray(action.rgb)) {
                        state.xy = rgbToXy(...action.rgb);
                    }
                    const path =
                        action.type === 'set_group_state'
                            ? `/groups/${action.id}/action`
                            : `/lights/${action.id}/state`;
                    await hueClient.put(path, state);
                    results.push({ action, status: 'ok' });
                    break;
                }
                case 'activate_scene': {
                    ensureHueConfigured();
                    const scene = (await getHueScenes()).find(
                        (s) => s.id === action.sceneId,
                    );
                    if (!scene) {
                        throw new Error(`Scène non trouvée: ${action.sceneId}`);
                    }
                    const groupId =
                        scene.type === 'GroupScene' && scene.group ? scene.group : '0';
                    await hueClient.put(`/groups/${groupId}/action`, {
                        scene: scene.id,
                    });
                    results.push({ action, status: 'ok' });
                    break;
                }
                // Google Cast actions
                case 'cast_media': {
                    const device = castService.findDevice(action.deviceName);
                    if (!device) {
                        throw new Error(
                            `Appareil non trouvé: ${action.deviceName}`,
                        );
                    }
                    const result = await castService.castMedia(
                        device.id,
                        action.mediaUrl,
                        action.contentType || 'video/mp4',
                        action.metadata || {},
                    );
                    results.push({ action, status: 'ok', result });
                    break;
                }
                case 'cast_youtube': {
                    const device = castService.findDevice(action.deviceName);
                    if (!device) {
                        throw new Error(
                            `Appareil non trouvé: ${action.deviceName}`,
                        );
                    }
                    const ytAudioUrl = await getYtDlpAudioUrl(action.videoId);
                    const result = await castService.castYouTube(
                        device.id,
                        action.videoId,
                        ytAudioUrl,
                    );
                    results.push({ action, status: 'ok', result });
                    break;
                }
                case 'cast_control': {
                    const device = castService.findDevice(action.deviceName);
                    if (!device) {
                        throw new Error(
                            `Appareil non trouvé: ${action.deviceName}`,
                        );
                    }
                    const result = await castService.controlPlayback(
                        device.id,
                        action.command,
                    );
                    results.push({ action, status: 'ok', result });
                    break;
                }
                case 'cast_volume': {
                    const device = castService.findDevice(action.deviceName);
                    if (!device) {
                        throw new Error(
                            `Appareil non trouvé: ${action.deviceName}`,
                        );
                    }
                    const level = clamp(Number(action.level), 0, 1);
                    const result = await castService.setVolume(
                        device.id,
                        level,
                    );
                    results.push({
                        action: { ...action, level },
                        status: 'ok',
                        result,
                    });
                    break;
                }
                case 'create_rule': {
                    const rule = rulesEngine.addRule({
                        name: action.name,
                        sensorDid: action.sensorDid,
                        sensorName: action.sensorName,
                        property: action.property,
                        operator: action.operator,
                        value: action.value,
                        message: action.message,
                        cooldownMinutes: action.cooldownMinutes || 30,
                    });
                    results.push({
                        action,
                        status: 'ok',
                        result: { ruleId: rule.id, name: rule.name },
                    });
                    break;
                }
                case 'delete_rule': {
                    const deleted = rulesEngine.deleteRule(action.ruleId);
                    if (!deleted)
                        throw new Error(`Règle non trouvée: ${action.ruleId}`);
                    results.push({ action, status: 'ok' });
                    break;
                }
                case 'set_heating': {
                    const curState = broadlinkService.getState();
                    const newState = {
                        power:
                            action.power !== undefined
                                ? action.power
                                : curState.power,
                        mode: action.mode || curState.mode,
                        temperature: action.temperature
                            ? clamp(action.temperature, 16, 31)
                            : curState.temperature,
                        fanSpeed: action.fanSpeed || curState.fanSpeed,
                        vaneVertical:
                            action.vaneVertical || curState.vaneVertical,
                    };
                    if (broadlinkService.isConnected()) {
                        await broadlinkService.sendCommand(newState);
                    } else {
                        broadlinkService.sendCommandDryRun(newState);
                    }
                    results.push({ action, status: 'ok', result: newState });
                    break;
                }
                default: {
                    results.push({
                        action,
                        status: 'ignored',
                        error: 'Unknown action type',
                    });
                }
            }
        } catch (error) {
            results.push({
                action,
                status: 'error',
                error: error?.message || 'Action failed',
            });
        }
    }

    return results;
};

app.get('/api/agent/status', async (_req, res) => {
    const groqConfigured = Boolean(GROQ_API_KEY);
    const castDevices = castService.getDevices();
    res.json({
        ok: true,
        hueConfigured: Boolean(hueBaseUrl),
        groqConfigured,
        model: GROQ_MODEL,
        castDevices: castDevices.length,
        devices: castDevices,
    });
});

app.post('/api/agent', async (req, res) => {
    try {
        const { message, history } = req.body || {};

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required.' });
        }

        const context = await getHueContext();
        const sensors = await getZigbeeSensors();
        const heatingState = broadlinkService.getState();

        // Niveau 0 : commande simple comprise sans LLM
        const scenes = await getHueScenes();
        const intent = parseIntent(message, {
            ...context,
            scenes,
            sensors,
            heating: heatingState,
        });
        if (intent) {
            const actionResults = await executeActions(intent.actions);
            const failed = actionResults.find((r) => r.status === 'error');
            return res.json({
                message: failed ? `Échec : ${failed.error}` : intent.message,
                actions: intent.actions,
                actionResults,
                tier: 'local',
                intent: intent.intent,
            });
        }

        // Hors périmètre maison : direct vers Claude, sans appel Groq
        if (needsClaude(message)) {
            return res.json({
                message: 'Ça, c’est pour Claude : je te prépare la demande.',
                actions: [],
                actionResults: [],
                tier: 'claude',
                escalation: buildEscalation('hors périmètre maison', message),
            });
        }

        if (!GROQ_API_KEY) {
            return res.status(503).json({
                error: 'Groq API key not configured. Add GROQ_API_KEY to .env',
            });
        }

        const historyMessages = Array.isArray(history)
            ? history.slice(-8).map((item) => ({
                  role: item.role === 'assistant' ? 'assistant' : 'user',
                  content: String(item.content || ''),
              }))
            : [];

        let result;
        try {
            result = await runGroqAgent({
                client: groqClient,
                model: GROQ_MODEL,
                message,
                history: historyMessages,
                context: {
                    hue: context,
                    scenes: scenes.map(({ id, name, group }) => ({ id, name, group })),
                    cast: castService.getDevices(),
                    sensors,
                    rules: rulesEngine.getRules(),
                    heating: heatingState,
                },
                executeActions,
            });
        } catch (error) {
            // Quota gratuit Groq épuisé : on propose Claude plutôt qu'une erreur
            if (error?.response?.status === 429) {
                return res.json({
                    message: 'Quota Groq atteint pour le moment, je passe la main à Claude.',
                    actions: [],
                    actionResults: [],
                    tier: 'claude',
                    escalation: buildEscalation('quota Groq atteint', message),
                });
            }
            throw error;
        }

        res.json({
            ...result,
            model: GROQ_MODEL,
            tier: result.escalation ? 'claude' : 'llm',
        });
    } catch (error) {
        const message =
            error?.response?.data?.error?.message ||
            error?.message ||
            'Agent error';
        res.status(500).json({ error: message });
    }
});

// --- Direct Cast API endpoints (no AI needed) ---

app.post('/api/cast/play', async (req, res) => {
    try {
        const { deviceId, mediaUrl, contentType, metadata } = req.body;
        if (!deviceId || !mediaUrl) {
            return res
                .status(400)
                .json({ error: 'deviceId and mediaUrl are required' });
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

app.post('/api/cast/control', async (req, res) => {
    try {
        const { deviceId, command } = req.body;
        if (!deviceId || !command) {
            return res
                .status(400)
                .json({ error: 'deviceId and command are required' });
        }
        const result = await castService.controlPlayback(deviceId, command);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Control failed' });
    }
});

app.post('/api/cast/volume', async (req, res) => {
    try {
        const { deviceId, level } = req.body;
        if (!deviceId || level === undefined) {
            return res
                .status(400)
                .json({ error: 'deviceId and level are required' });
        }
        const result = await castService.setVolume(deviceId, Number(level));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Volume failed' });
    }
});

// --- YouTube OAuth2 endpoints ---

app.get('/api/youtube/auth/status', (_req, res) => {
    res.json({
        authenticated: youtubeService.isAuthenticated(),
        oauthConfigured: youtubeService.isOAuthConfigured(),
    });
});

app.get('/api/youtube/auth/url', (_req, res) => {
    try {
        const url = youtubeService.getAuthUrl();
        res.json({ url });
    } catch (error) {
        res.status(500).json({ error: error?.message });
    }
});

app.get('/api/youtube/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).send('Missing code');
        await youtubeService.exchangeCode(code);
        // Redirect back to the Music page
        res.send(
            '<html><body><script>window.close(); window.opener && window.opener.postMessage("youtube-auth-success","*");</script><p>Connecte ! Tu peux fermer cette fenetre.</p></body></html>',
        );
    } catch (error) {
        res.status(500).send(`Erreur OAuth: ${error?.message}`);
    }
});

// --- YouTube Playlist API endpoints ---

app.get('/api/youtube/playlists', async (_req, res) => {
    try {
        // If authenticated, fetch user's playlists + defaults + customs
        let userPlaylists = [];
        if (youtubeService.isAuthenticated()) {
            userPlaylists = await youtubeService.fetchMyPlaylists();
        }
        const configured = youtubeService.getAllPlaylists();
        res.json({
            playlists: [...userPlaylists, ...configured],
            authenticated: youtubeService.isAuthenticated(),
        });
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Failed to get playlists',
        });
    }
});

app.get('/api/youtube/playlist/:id', async (req, res) => {
    try {
        const data = await youtubeService.fetchPlaylistItems(req.params.id);
        res.json(data);
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Failed to fetch playlist',
        });
    }
});

app.post('/api/youtube/extract-audio', async (req, res) => {
    try {
        const { videoId } = req.body;
        if (!videoId)
            return res.status(400).json({ error: 'videoId is required' });
        const audioUrl = await getYtDlpAudioUrl(videoId);
        res.json({ audioUrl, contentType: 'audio/mp4' });
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Audio extraction failed',
        });
    }
});

// YouTube audio streaming proxy using yt-dlp
// Gets direct audio URL via yt-dlp, then proxies with Range support for Cast devices
const ytDlpUrlCache = new Map(); // videoId -> { url, expiresAt }

const getYtDlpAudioUrl = async (videoId) => {
    const cached = ytDlpUrlCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const { stdout } = await execFileAsync(
        'yt-dlp',
        [
            '-f',
            'bestaudio[ext=m4a]/bestaudio',
            '--get-url',
            '--no-warnings',
            '--no-playlist',
            `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { timeout: 15000 },
    );

    const url = stdout.trim();
    if (!url) throw new Error('yt-dlp returned empty URL');

    // Cache for 4 hours (YouTube URLs expire after ~6h)
    ytDlpUrlCache.set(videoId, {
        url,
        expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    });
    return url;
};

app.get('/api/youtube/stream/:videoId', async (req, res) => {
    const { videoId } = req.params;
    try {
        console.log(
            `🎵 Stream proxy for ${videoId} (Range: ${req.headers.range || 'none'})`,
        );
        const audioUrl = await getYtDlpAudioUrl(videoId);

        // Proxy the request to YouTube's audio URL, forwarding Range headers
        const headers = {};
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const upstream = await axios.get(audioUrl, {
            headers,
            responseType: 'stream',
            timeout: 30000,
            validateStatus: (s) => s >= 200 && s < 400,
        });

        // Forward relevant headers from YouTube
        const fwd = [
            'content-type',
            'content-length',
            'content-range',
            'accept-ranges',
        ];
        for (const h of fwd) {
            if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
        }
        // Ensure content-type is audio
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

app.post('/api/youtube/playlist/add', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'url is required' });
        const playlist = await youtubeService.addCustomPlaylist(url);
        res.json(playlist);
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Failed to add playlist',
        });
    }
});

// --- Google Home device info endpoints ---

app.get('/api/google-home/devices', async (_req, res) => {
    try {
        const devices = await googleHomeService.getGoogleHomeDevices();
        res.json({ devices });
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Failed to fetch Google Home devices',
        });
    }
});

// --- Xiaomi gateway LAN endpoints ---

app.get('/api/xiaomi/status', (_req, res) => {
    res.json(xiaomiService.getAuthStatus());
});

app.post('/api/xiaomi/login', async (_req, res) => {
    try {
        const result = await xiaomiService.startLogin();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Discovery failed' });
    }
});

app.post('/api/xiaomi/logout', (_req, res) => {
    xiaomiService.logout();
    res.json({ status: 'ok' });
});

app.get('/api/xiaomi/devices', async (_req, res) => {
    try {
        const devices = await xiaomiService.getDevices();
        res.json({ devices });
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Failed to fetch Xiaomi devices',
        });
    }
});

app.get('/api/xiaomi/sensors', async (_req, res) => {
    try {
        const sensors = await getZigbeeSensors();
        res.json({ sensors });
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Failed to fetch sensors',
        });
    }
});

// --- Rules API endpoints ---

app.get('/api/rules', (_req, res) => {
    res.json(rulesEngine.getRules());
});

app.delete('/api/rules/:id', (req, res) => {
    const deleted = rulesEngine.deleteRule(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    res.json({ ok: true });
});

app.patch('/api/rules/:id/toggle', (req, res) => {
    const rule = rulesEngine.toggleRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
});

// --- Heating API endpoints ---

app.get('/api/heating/status', (_req, res) => {
    res.json(broadlinkService.getStatus());
});

app.post('/api/heating/control', async (req, res) => {
    try {
        const curState = broadlinkService.getState();
        const body = req.body || {};
        const newState = {
            power: body.power !== undefined ? body.power : curState.power,
            mode: body.mode || curState.mode,
            temperature: body.temperature
                ? clamp(body.temperature, 16, 31)
                : curState.temperature,
            fanSpeed: body.fanSpeed || curState.fanSpeed,
            vaneVertical: body.vaneVertical || curState.vaneVertical,
        };

        let result;
        if (broadlinkService.isConnected()) {
            result = await broadlinkService.sendCommand(newState);
        } else {
            result = broadlinkService.sendCommandDryRun(newState);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Heating control failed',
        });
    }
});

app.post('/api/heating/discover', async (_req, res) => {
    try {
        await broadlinkService.discover();
        res.json({ ok: true, ...broadlinkService.getStatus() });
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Discovery failed' });
    }
});

// --- Zigbee routes ---

app.get('/zigbee/devices', (_req, res) => {
    res.json(zigbeeService.getDevices());
});

app.get('/zigbee/temperature', (_req, res) => {
    res.json(zigbeeService.getTemperatureSensors());
});

app.get('/zigbee/device/:ieee', (req, res) => {
    const device = zigbeeService.getDevice(req.params.ieee);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
});

app.post('/zigbee/permit-join', async (req, res) => {
    try {
        const seconds = req.body.seconds ?? 60;
        await zigbeeService.permitJoin(seconds);
        res.json({ ok: true, seconds });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/zigbee/permit-join', async (req, res) => {
    try {
        const seconds = req.body.seconds ?? 120;
        await zigbeeService.permitJoin(seconds);
        res.json({ ok: true, seconds });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/zigbee/stop-join', async (_req, res) => {
    try {
        await zigbeeService.disallowJoin();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- Home Assistant ---

app.get('/api/ha/status', async (_req, res) => {
    res.json({
        ...(await haService.getStatus()),
        zigbeeMode: process.env.ZIGBEE_MQTT_URL ? 'remote' : 'local',
    });
});

app.get('/api/ha/states', async (req, res) => {
    try {
        res.json(await haService.getStates(req.query.domain));
    } catch (err) {
        res.status(503).json({ error: err.message });
    }
});

app.post('/api/zigbee/stop-join', async (_req, res) => {
    try {
        await zigbeeService.disallowJoin();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/zigbee/rename', async (req, res) => {
    try {
        const { from: fromName, to: toName } = req.body || {};
        if (!fromName || !toName) {
            return res
                .status(400)
                .json({ error: '"from" et "to" sont requis' });
        }
        await zigbeeService.setFriendlyName(fromName, toName);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/zigbee/status', (_req, res) => {
    res.json({ running: zigbeeService.isRunning() });
});

app.get('/api/zigbee/history/:deviceId', (req, res) => {
    const points = zigbeeService.getHistory(
        decodeURIComponent(req.params.deviceId),
    );
    res.json({ deviceId: req.params.deviceId, points });
});

// Tous les appareils Zigbee bruts (peu importe s'ils sont dans le registre)
app.get('/api/zigbee/devices', (_req, res) => {
    res.json(zigbeeService.getDevices());
});

// Statut pairing temps réel (polling par l'UI pendant le mode appairage)
app.get('/api/zigbee/pairing-status', (_req, res) => {
    const registry = sensorRegistry.getAll();
    const registeredIeee = new Set(registry.map((e) => e.ieee));
    const unregistered = zigbeeService
        .getDevices()
        .filter((d) => !registeredIeee.has(d.ieeeAddr))
        .map((d) => ({
            ieeeAddr: d.ieeeAddr,
            friendlyName: d.friendlyName,
            model: d.model || null,
            vendor: d.vendor || null,
            description: d.description || null,
        }));
    res.json({
        permitJoinActive: zigbeeService.isPermitJoinActive(),
        lastJoin: zigbeeService.getLastJoinEvent(),
        newDevices: unregistered,
    });
});

// Appareils Zigbee non encore enregistrés dans le registre capteurs
app.get('/api/zigbee/unregistered', (_req, res) => {
    const registry = sensorRegistry.getAll();
    const registeredIeee = new Set(registry.map((e) => e.ieee));
    const unregistered = zigbeeService
        .getDevices()
        .filter(
            (d) => d.type !== 'Coordinator' && !registeredIeee.has(d.ieeeAddr),
        )
        .map((d) => ({
            ieeeAddr: d.ieeeAddr,
            friendlyName: d.friendlyName,
            model: d.model || null,
            vendor: d.vendor || null,
            description: d.description || null,
            lastSeen: d.lastSeen ? new Date(d.lastSeen).toISOString() : null,
        }));
    res.json({ devices: unregistered });
});

// --- Registre capteurs (sensors.json) CRUD ---

app.get('/api/sensors/registry', (_req, res) => {
    res.json({ sensors: sensorRegistry.getAll() });
});

app.post('/api/sensors/registry', (req, res) => {
    const { ieee, name, type } = req.body || {};
    if (!ieee || !name || !type) {
        return res
            .status(400)
            .json({ error: '"ieee", "name" et "type" sont requis' });
    }
    const entry = sensorRegistry.upsert({ ieee, name, type });
    res.json(entry);
});

app.delete('/api/sensors/registry/:ieee', (req, res) => {
    const ieee = decodeURIComponent(req.params.ieee);
    const deleted = sensorRegistry.remove(ieee);
    if (!deleted)
        return res
            .status(404)
            .json({ error: 'Capteur introuvable dans le registre' });
    res.json({ ok: true });
});

app.post('/api/zigbee/install-code', async (req, res) => {
    const { code } = req.body;
    if (!code?.trim())
        return res.status(400).json({ error: 'code requis' });
    try {
        await zigbeeService.addInstallCode(code.trim());
        res.json({ ok: true });
    } catch (err) {
        res.status(503).json({ error: err.message });
    }
});

// --- SSE: real-time sensor push ---

const sseClients = new Set();

app.get('/api/sensors/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Push current state immediately on connect
    try {
        const sensors = await getZigbeeSensors();
        res.write(`data: ${JSON.stringify(sensors)}\n\n`);
    } catch { /* ignore */ }

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

let sseBroadcastTimer = null;
zigbeeService.emitter.on('update', () => {
    // Debounce: wait 200ms to batch rapid successive updates
    if (sseBroadcastTimer) return;
    sseBroadcastTimer = setTimeout(async () => {
        sseBroadcastTimer = null;
        if (sseClients.size === 0) return;
        try {
            const sensors = await getZigbeeSensors();
            const data = `data: ${JSON.stringify(sensors)}\n\n`;
            for (const res of sseClients) res.write(data);
        } catch { /* ignore */ }
    }, 200);
});

// --- Hue bridge proxy (le front ne connaît plus l'IP ni le username) ---

app.use('/api/hue', async (req, res) => {
    try {
        const response = await axios({
            method: req.method,
            url: `http://${BRIDGE_IP}/api/${USERNAME}${req.url}`,
            data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
            timeout: 5000,
        });
        res.status(response.status).json(response.data);
    } catch (err) {
        res.status(err.response?.status || 502).json({ error: err.message });
    }
});

// --- Front buildé (add-on / prod) ---

const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '../dist');
if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(DIST_DIR, 'index.html')));
}

// --- Start server & rules engine ---

app.listen(PORT, () => {
    console.log(`🤖 MyHue agent server running on http://localhost:${PORT}`);
    console.log(`Using Groq with model: ${GROQ_MODEL}`);
    rulesEngine.startEngine(getZigbeeSensors);
    broadlinkService
        .discover()
        .catch((err) => console.warn('⚠️  Broadlink:', err.message));
    zigbeeService
        .start()
        .catch((err) => console.warn('⚠️  Zigbee:', err.message));
});
