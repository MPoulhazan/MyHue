/**
 * Agent conversationnel (/api/agent) et serveur MCP (/mcp).
 */
import express from 'express';
import * as castService from '../castService.js';
import * as automations from '../automations.js';
import * as circadian from '../circadian.js';
import * as broadlinkService from '../broadlinkService.js';
import { parseIntent } from '../intentParser.js';
import { runGroqAgent, needsClaude, buildEscalation } from '../groqAgent.js';
import { handleMcpRequest } from '../mcpServer.js';
import { isValidToken } from '../auth.js';
import { hueBaseUrl, getHueContext, getHueScenes } from '../hue.js';
import * as journal from '../journal.js';
import { getSensors, getOutdoorWeather } from '../sensors.js';
import { getHomeState, recentEvents } from '../homeState.js';
import { executeActions } from '../actions.js';
import { groqClient, GROQ_API_KEY, GROQ_MODEL } from '../llm.js';

export { GROQ_MODEL };

export const router = express.Router();

// Seules les demandes qui ont agi sur la maison vont au journal
const logAgent = (message, actionResults = []) => {
    const done = actionResults.filter((r) => r.status === 'ok').length;
    if (done === 0) return;
    journal.log({ kind: 'agent', title: `Agent : « ${message.trim().slice(0, 80)} »`, data: { actions: done } });
};

router.get('/api/agent/status', async (_req, res) => {
    const castDevices = castService.getDevices();
    res.json({
        ok: true,
        hueConfigured: Boolean(hueBaseUrl),
        groqConfigured: Boolean(GROQ_API_KEY),
        model: GROQ_MODEL,
        castDevices: castDevices.length,
        devices: castDevices,
    });
});

router.post('/api/agent', async (req, res) => {
    try {
        const { message, history } = req.body || {};

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required.' });
        }

        const context = await getHueContext();
        const sensors = await getSensors();
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
            logAgent(message, actionResults);
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
                    rules: automations.getForAgent(),
                    heating: heatingState,
                    circadian: await circadian.getStatus().catch(() => null),
                    outdoor: await getOutdoorWeather(),
                    recentEvents: recentEvents(),
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

        logAgent(message, result.actionResults);
        res.json({
            ...result,
            model: GROQ_MODEL,
            tier: result.escalation ? 'claude' : 'llm',
        });
    } catch (error) {
        const message =
            error?.response?.data?.error?.message || error?.message || 'Agent error';
        res.status(500).json({ error: message });
    }
});

// --- Serveur MCP (connecteur Claude) ---

const mcpHandler = handleMcpRequest({ getContext: getHomeState, executeActions });
// /mcp : LAN ou Bearer ; /mcp/<token> : claude.ai, qui n'envoie pas d'en-tête
router.all('/mcp', mcpHandler);
router.all('/mcp/:token', (req, res, next) =>
    isValidToken(req.params.token) ? mcpHandler(req, res, next) : res.status(404).end(),
);
