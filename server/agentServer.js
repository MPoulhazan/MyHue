import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import * as castService from './castService.js';
import * as youtubeService from './youtubeService.js';
import * as googleHomeService from './googleHomeService.js';
import * as xiaomiService from './xiaomiService.js';

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.AGENT_PORT || 5174);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';
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

const buildSystemPrompt = (
    castDevices,
    sensors,
) => `You are the MyHue assistant. You can control Philips Hue lights and Google Cast devices (Google Home, Chromecast, Nest).
You also have access to Xiaomi/Aqara sensor data (temperature, humidity, door sensors, smoke detector, water leak sensor).
Return ONLY valid JSON. No markdown, no extra text.

JSON schema:
{
  "message": string,
  "actions": [
    // Hue actions
    {
      "type": "toggle_light",
      "id": string,
      "on": boolean
    },
    {
      "type": "toggle_all",
      "on": boolean
    },
    {
      "type": "set_brightness",
      "id": string,
      "bri": number
    },
    {
      "type": "set_color",
      "id": string,
      "hue": number,
      "sat": number
    },
    {
      "type": "set_color_temperature",
      "id": string,
      "ct": number
    },
    {
      "type": "set_rgb",
      "id": string,
      "r": number,
      "g": number,
      "b": number
    },
    {
      "type": "set_group_state",
      "id": string,
      "state": object
    },
    // Google Cast actions
    {
      "type": "cast_media",
      "deviceName": string,
      "mediaUrl": string,
      "contentType": string,
      "metadata": object
    },
    {
      "type": "cast_youtube",
      "deviceName": string,
      "videoId": string
    },
    {
      "type": "cast_control",
      "deviceName": string,
      "command": "play" | "pause" | "stop"
    },
    {
      "type": "cast_volume",
      "deviceName": string,
      "level": number
    }
  ]
}

Rules:
- Use only actions above.
- Use light/group IDs from the Hue context.
- For Cast actions, use deviceName to match against available Cast devices.
- For cast_youtube, extract video ID from YouTube URLs (e.g., "dQw4w9WgXcQ" from "youtube.com/watch?v=dQw4w9WgXcQ").
- For cast_volume, level is between 0 and 1 (0 = mute, 1 = max).
- If no action is needed, return an empty actions array.
- Keep numbers within valid Hue ranges: bri 0-254, hue 0-65535, sat 0-254, ct 153-500, rgb 0-255.
- When the user asks about sensors (temperature, humidity, doors, smoke, water leak), read the sensor data from the context and answer in your message. No action is needed for sensor queries.
- For door sensors: props.isOpen indicates if the door is currently open. props.lastOpen is the last time it was opened.
- Keep the message in French.

Available Cast devices: ${JSON.stringify(castDevices)}
Available sensors: ${JSON.stringify(sensors)}
`;

const extractJson = (text) => {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
        throw new Error('No JSON object found in model response.');
    }
    return JSON.parse(text.slice(first, last + 1));
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
                case 'set_group_state': {
                    ensureHueConfigured();
                    await hueClient.put(
                        `/groups/${action.id}/action`,
                        action.state || {},
                    );
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
                    const result = await castService.castYouTube(
                        device.id,
                        action.videoId,
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

        if (!GROQ_API_KEY) {
            return res.status(503).json({
                error: 'Groq API key not configured. Add GROQ_API_KEY to .env',
            });
        }

        const context = await getHueContext();
        const castDevices = castService.getDevices();
        const sensors = await xiaomiService.getSensorsWithData();
        const systemPrompt = buildSystemPrompt(castDevices, sensors);

        const historyMessages = Array.isArray(history)
            ? history.slice(-8).map((item) => ({
                  role: item.role === 'assistant' ? 'assistant' : 'user',
                  content: String(item.content || ''),
              }))
            : [];

        const fullContext = {
            hue: context,
            cast: castDevices,
            sensors,
        };

        const messages = [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
            {
                role: 'user',
                content: `Demande: ${message}\n\nContexte JSON: ${JSON.stringify(fullContext)}`,
            },
        ];

        const response = await groqClient.post('/chat/completions', {
            model: GROQ_MODEL,
            messages,
            temperature: 0.7,
            max_tokens: 1000,
        });

        const modelText = response.data?.choices?.[0]?.message?.content ?? '';
        const parsed = extractJson(modelText);

        const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
        const actionResults = await executeActions(actions);

        res.json({
            message: parsed.message || 'Ok.',
            actions,
            actionResults,
            model: GROQ_MODEL,
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
        const result = await youtubeService.extractAudioUrl(videoId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Audio extraction failed',
        });
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
        const sensors = await xiaomiService.getSensorsWithData();
        res.json({ sensors });
    } catch (error) {
        res.status(500).json({
            error: error?.message || 'Failed to fetch Xiaomi sensors',
        });
    }
});

app.listen(PORT, () => {
    console.log(`🤖 MyHue agent server running on http://localhost:${PORT}`);
    console.log(`Using Groq with model: ${GROQ_MODEL}`);
});
