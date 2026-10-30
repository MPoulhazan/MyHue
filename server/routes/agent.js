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
import * as learned from '../learnedCommands.js';

export { GROQ_MODEL };

export const router = express.Router();

const MAX_RETRY_WAIT_S = 5;

// Groq renvoie retry-after en secondes ; à défaut, la limite par minute se libère vite
const retryAfterSeconds = (response) => {
    const header = Number(response?.headers?.['retry-after']);
    return Number.isFinite(header) && header > 0 ? Math.ceil(header) : 2;
};

// Ordre exécuté sans erreur : le client joue un son au lieu de lire la réponse
const isSilent = (actions = [], actionResults = []) =>
    actions.length > 0 && actionResults.every((r) => r.status === 'ok');

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

// Commandes apprises de Groq, pour vérifier ou oublier une mauvaise
router.get('/api/agent/learned', (_req, res) => res.json(learned.list()));
router.delete('/api/agent/learned', (req, res) => {
    const phrase = String(req.query.phrase || '');
    res.json({ ok: learned.forget(phrase) });
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
            cast: { devices: castService.getDevices(), nowPlaying: castService.getNowPlaying() },
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
                silent: isSilent(intent.actions, actionResults),
            });
        }

        // Niveau 0 bis : phrase déjà résolue par Groq auparavant
        const known = learned.lookup(message);
        if (known) {
            const actionResults = await executeActions(known.actions);
            const failed = actionResults.find((r) => r.status === 'error');
            // Une scène ou une lampe disparue : on oublie, Groq réapprendra
            if (failed) learned.forget(message);
            else learned.markUsed(message);
            logAgent(message, actionResults);
            return res.json({
                message: failed ? `Échec : ${failed.error}` : known.message,
                actions: known.actions,
                actionResults,
                tier: 'learned',
                silent: isSilent(known.actions, actionResults),
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
            ? history.slice(-4).map((item) => ({
                  role: item.role === 'assistant' ? 'assistant' : 'user',
                  content: String(item.content || '').slice(0, 300),
              }))
            : [];

        const callGroq = async () =>
            runGroqAgent({
                client: groqClient,
                model: GROQ_MODEL,
                message,
                history: historyMessages,
                context: {
                    hue: context,
                    scenes,
                    cast: castService.getDevices(),
                    sensors,
                    rules: automations.getForAgent(),
                    heating: heatingState,
                    circadian: await circadian.getStatus().catch(() => null),
                    outdoor: await getOutdoorWeather(),
                    recentEvents: recentEvents(5),
                },
                executeActions,
            });

        let result;
        try {
            result = await callGroq();
        } catch (error) {
            if (error?.response?.status !== 429) throw error;
            // Limite par minute de Groq : une seule relance si l'attente est courte
            const wait = retryAfterSeconds(error.response);
            if (wait > MAX_RETRY_WAIT_S) {
                return res.json({
                    message: `Trop de demandes d'un coup, réessaie dans ${wait} secondes.`,
                    actions: [],
                    actionResults: [],
                    tier: 'llm',
                });
            }
            await new Promise((r) => setTimeout(r, wait * 1000));
            result = await callGroq().catch((retryError) => {
                if (retryError?.response?.status === 429) return null;
                throw retryError;
            });
            if (!result) {
                return res.json({
                    message: 'Trop de demandes d’un coup, réessaie dans une minute.',
                    actions: [],
                    actionResults: [],
                    tier: 'llm',
                });
            }
        }

        logAgent(message, result.actionResults);
        const silent = isSilent(result.actions, result.actionResults);
        if (silent) learned.learn(message, result.actions, result.message);
        res.json({
            ...result,
            model: GROQ_MODEL,
            tier: result.escalation ? 'claude' : 'llm',
            silent,
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
