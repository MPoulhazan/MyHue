import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

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
        .filter(([_, group]) => group.type !== 'Room' || group.lights?.length > 0)
        .map(([id, group]) => ({
            id,
            name: group.name,
            type: group.type,
            lights: group.lights ?? [],
            any_on: group.state?.any_on ?? false,
        }));

    return { lights, groups };
};

const buildSystemPrompt =
    () => `You are the MyHue assistant. You can observe the Hue state and propose recommendations or actions.
Return ONLY valid JSON. No markdown, no extra text.

JSON schema:
{
  "message": string,
  "actions": [
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
    }
  ]
}

Rules:
- Use only actions above.
- Use light/group IDs from the context.
- If no action is needed, return an empty actions array.
- Keep numbers within valid Hue ranges: bri 0-254, hue 0-65535, sat 0-254, ct 153-500, rgb 0-255.
- Keep the message in French.
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

    ensureHueConfigured();

    const results = [];

    for (const action of actions) {
        try {
            switch (action.type) {
                case 'toggle_light': {
                    await hueClient.put(`/lights/${action.id}/state`, {
                        on: Boolean(action.on),
                    });
                    results.push({ action, status: 'ok' });
                    break;
                }
                case 'toggle_all': {
                    await hueClient.put('/groups/0/action', {
                        on: Boolean(action.on),
                    });
                    results.push({ action, status: 'ok' });
                    break;
                }
                case 'set_brightness': {
                    const bri = clamp(Number(action.bri), 0, 254);
                    await hueClient.put(`/lights/${action.id}/state`, { bri });
                    results.push({ action: { ...action, bri }, status: 'ok' });
                    break;
                }
                case 'set_color': {
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
                    const ct = clamp(Number(action.ct), 153, 500);
                    await hueClient.put(`/lights/${action.id}/state`, { ct });
                    results.push({ action: { ...action, ct }, status: 'ok' });
                    break;
                }
                case 'set_rgb': {
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
                    await hueClient.put(
                        `/groups/${action.id}/action`,
                        action.state || {},
                    );
                    results.push({ action, status: 'ok' });
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
    res.json({
        ok: true,
        hueConfigured: Boolean(hueBaseUrl),
        groqConfigured,
        model: GROQ_MODEL,
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
        const systemPrompt = buildSystemPrompt();

        const historyMessages = Array.isArray(history)
            ? history.slice(-8).map((item) => ({
                  role: item.role === 'assistant' ? 'assistant' : 'user',
                  content: String(item.content || ''),
              }))
            : [];

        const messages = [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
            {
                role: 'user',
                content: `Demande: ${message}\n\nContexte JSON: ${JSON.stringify(context)}`,
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
        const message = error?.response?.data?.error?.message || error?.message || 'Agent error';
        res.status(500).json({ error: message });
    }
});

app.listen(PORT, () => {
    console.log(`🤖 MyHue agent server running on http://localhost:${PORT}`);
    console.log(`Using Groq with model: ${GROQ_MODEL}`);
});
