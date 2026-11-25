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
import * as myDay from '../myDay.js';
import * as together from '../together.js';
import { isValidToken } from '../auth.js';
import { hueBaseUrl, getHueContext, getHueScenes } from '../hue.js';
import * as journal from '../journal.js';
import { getSensors, getOutdoorWeather } from '../sensors.js';
import { getSky, isSkyQuestion, skySpeech } from '../astro.js';
import * as cooper from '../cooper.js';
import * as advent from '../advent.js';
import { isAdventCommand } from '../adventLogic.js';
import * as veillee from '../veillee.js';
import { veilleeCommand } from '../veilleeLogic.js';
import * as noel from '../noel.js';
import { isSantaQuestion } from '../noelLogic.js';
import { christmasSeason } from '../seasonLogic.js';
import * as mailbox from '../mailbox.js';
import * as guard from '../guard.js';
import * as sensorRegistry from '../sensorRegistry.js';
import * as sensorPause from '../sensorPause.js';
import { parseSensorPauseCommand } from '../sensorPauseLogic.js';
import * as kitchenDisplay from '../kitchenDisplay.js';
import { isKitchenShowCommand } from '../kitchenDisplayLogic.js';
import * as bixi from '../bixi.js';
import * as commute from '../commute.js';
import { isCommuteQuestion } from '../commuteLogic.js';
import { bixiSpeech, isBixiQuestion } from '../bixiLogic.js';
import * as city from '../city.js';
import * as communauto from '../communauto.js';
import { communautoSpeech, parseCommunautoCommand } from '../communautoLogic.js';
import * as collecte from '../collecte.js';
import { citySpeech, isCityQuestion } from '../cityLogic.js';
import * as builtins from '../builtins.js';
import { voiceCommand } from '../builtinsLogic.js';
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
        const { message, history, person, source } = req.body || {};

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required.' });
        }

        // Niveau 0 : « C'est quoi ma journée ? », « Qu'est-ce qu'on fait samedi ? »
        // Niveau 0 : « Ajoute du lait à la liste », « Dis à Camille que… »
        let duo = null;
        try {
            duo = together.voiceAnswer(message, typeof person === 'string' ? person : null);
        } catch (err) {
            duo = `Je n’ai pas pu le faire : ${err.message}.`;
        }
        if (duo) return res.json({ message: duo, actions: [], actionResults: [], tier: 'local', intent: 'together' });

        const day = await myDay.voiceAnswer(message, typeof person === 'string' ? person : null).catch(() => null);
        if (day) return res.json({ message: day, actions: [], actionResults: [], tier: 'local', intent: 'day' });

        // Niveau 0 : question sur le ciel, répondue par le calcul local (sans LLM)
        if (isSkyQuestion(message)) {
            const sky = await getSky().catch(() => null);
            if (sky) {
                return res.json({ message: skySpeech(sky), actions: [], actionResults: [], tier: 'local', intent: 'sky' });
            }
        }

        // Niveau 0 : « Lance la veillée », « fin de la veillée » (décembre)
        const veilleeCmd = veilleeCommand(message);
        if (veilleeCmd) {
            const speech = await veillee.voiceAnswer(veilleeCmd).catch((e) => `La veillée n’a pas pu démarrer : ${e.message}.`);
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'veillee' });
        }

        // Niveau 0 : « Est-ce qu'il est passé ? » (le père Noël)
        if (isSantaQuestion(message, christmasSeason(Date.now(), process.env.TZ || 'America/Toronto').phase)) {
            return res.json({ message: noel.voiceAnswer(), actions: [], actionResults: [], tier: 'local', intent: 'noel' });
        }

        // Niveau 0 : « Ouvre la case du jour » (calendrier de l'Avent, en décembre)
        if (isAdventCommand(message)) {
            const speech = await advent.voiceAnswer();
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'advent' });
        }

        // Niveau 0 : « Est-ce que Cooper a mangé ? », d'après la boîte de croquettes
        if (cooper.isCooperQuestion(message)) {
            const speech = cooper.cooperSpeech(cooper.getView());
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'cooper' });
        }

        // Niveau 0 : « Est-ce que le facteur est passé ? », d'après la boîte aux lettres
        if (mailbox.isMailQuestion(message) && /\?|est-ce|passé|arrivé|du courrier|y a/i.test(message)) {
            const speech = mailbox.mailSpeech(mailbox.getView());
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'mailbox' });
        }

        // Niveau 0 : « Mets l'escalier en pause pour la soirée », « Réactive l'escalier »
        const pauseCmd = parseSensorPauseCommand(message, sensorRegistry.getAll());
        if (pauseCmd) {
            let speech;
            if (pauseCmd.action === 'unknown') speech = 'Je ne sais pas quel capteur mettre en pause.';
            else if (pauseCmd.action === 'resume') {
                speech = sensorPause.resume(pauseCmd.sensor.ieee, 'à la voix')
                    ? `${pauseCmd.sensor.name} est réactivé.`
                    : `${pauseCmd.sensor.name} n’était pas en pause.`;
            } else {
                try {
                    const p = sensorPause.pause(pauseCmd.sensor.ieee, pauseCmd.duration, { source: 'Jarvis' });
                    const d = p.until ? new Date(p.until) : null;
                    speech = `${pauseCmd.sensor.name} en pause ${d ? `jusqu’à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}` : 'jusqu’à ce que tu le réactives'}.`;
                } catch (err) {
                    speech = err.message;
                }
            }
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'sensor-pause' });
        }

        // Niveau 0 : « Active le mode vacances », « On est rentrés », « L'alarme est activée ? »
        const guardCmd = guard.parseGuardCommand(message);
        if (guardCmd) {
            let speech;
            if (guardCmd.action === 'status') speech = guard.guardSpeech(guard.getView());
            else {
                const before = guard.getView().mode;
                const view = await guard.setMode(guardCmd.action === 'on' ? guardCmd.mode : null, 'Jarvis');
                speech = guardCmd.action === 'off'
                    ? (before ? 'Mode coupé. Bon retour !' : 'Aucun mode n’était activé.')
                    : view.mode === 'vacation' ? 'Mode vacances activé. Je préviens au moindre passage, et le salon s’allumera le soir.' : 'Mode alarme activé. Je préviens au moindre passage.';
            }
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'guard' });
        }

        // Niveau 0 : « Affiche MyHue dans la cuisine » → vue /cuisine sur le Nest Hub
        if (isKitchenShowCommand(message)) {
            let speech;
            try {
                await kitchenDisplay.showNow();
                speech = 'C’est affiché dans la cuisine.';
            } catch (err) {
                speech = `Je n’arrive pas à afficher l’écran de la cuisine : ${err.message}.`;
            }
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'kitchen-display' });
        }

        // Niveau 0 : « Comment j'y vais ? » : BIXI, électrique, bus ou à pied pour la personne devant l'écran
        if (isCommuteQuestion(message)) {
            const said = await commute.speech(typeof person === 'string' ? person : null).catch(() => null);
            if (said) return res.json({ message: said, actions: [], actionResults: [], tier: 'local', intent: 'commute' });
        }

        // Niveau 0 : « Il y a des BIXI ? », d'après le flux BIXI relu tout de suite
        if (isBixiQuestion(message)) {
            const view = await bixi.getView({ fresh: true }).catch(() => null);
            if (view) return res.json({ message: bixiSpeech(view), actions: [], actionResults: [], tier: 'local', intent: 'bixi' });
        }

        // Niveau 0 : « Trouve-moi une Communauto à 300 m », « Arrête de chercher la Communauto »
        const autoCmd = parseCommunautoCommand(message);
        if (autoCmd) {
            let speech;
            try {
                if (autoCmd.action === 'start') {
                    const view = await communauto.startSearch({
                        radiusM: autoCmd.radiusM ?? undefined,
                        autoBook: autoCmd.autoBook,
                        nearMe: autoCmd.nearMe,
                        // Demandé depuis le téléphone ou Telegram : rien à annoncer à la maison
                        quiet: source === 'telegram' || source === 'phone',
                        person: typeof person === 'string' ? person : null,
                        by: source === 'telegram' ? 'Telegram' : source === 'phone' ? 'téléphone' : 'Jarvis',
                    });
                    speech = `${autoCmd.autoBook ? 'Je la bloque dès qu’elle apparaît. ' : ''}${communautoSpeech(view)}`;
                } else if (autoCmd.action === 'cancel') {
                    await communauto.cancelBooking('Jarvis');
                    speech = 'C’est fait, le blocage de la Communauto est annulé.';
                } else if (autoCmd.action === 'stop') {
                    const was = (await communauto.getView()).search;
                    communauto.stop('Jarvis');
                    speech = was ? 'D’accord, j’arrête de chercher.' : 'Aucune recherche Communauto en cours.';
                } else {
                    speech = communautoSpeech(await communauto.getView({ fresh: true }));
                }
            } catch (err) {
                speech = `Communauto : ${err.message}.`;
            }
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'communauto' });
        }

        // Niveau 0 : « J'ai sorti la poubelle »
        if (/(j.ai|c.est|on a|bac|poubelle|compost).*sorti/i.test(message) && /poubelle|bac|compost|ordures/i.test(message)) {
            const speech = await collecte.markDone('Jarvis').then((v) => `Noté, ${v.tonight.label.toLowerCase()} sortie.`).catch((err) => err.message);
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'collecte' });
        }

        // Niveau 0 : « Il se passe quoi ce week-end ? », d'après les alertes de la ville
        // Niveau 0 : « C'était quoi ? » / « Coupe-le » sur la dernière annonce d'un automatisme
        const lastCmd = voiceCommand(message);
        if (lastCmd) {
            const last = builtins.lastSpoken();
            const ago = last ? Math.max(1, Math.round((Date.now() - last.at) / 60_000)) : 0;
            let speech;
            if (!last) speech = 'Aucun automatisme n’a parlé depuis une demi-heure.';
            else if (lastCmd === 'what') speech = `C’était « ${last.name} », il y a ${ago} minute${ago > 1 ? 's' : ''}.${last.locked ? '' : ' Dis « coupe-le » pour ne plus l’entendre.'}`;
            else if (last.locked) speech = `« ${last.name} » est une alerte de sécurité, je la garde.`;
            else {
                try {
                    builtins.update(last.id, { channel: 'voice', on: false });
                    speech = `C’est fait, « ${last.name} » ne parlera plus. Tu peux le rallumer dans Automatismes.`;
                } catch (err) {
                    speech = err.message;
                }
            }
            return res.json({ message: speech, actions: [], actionResults: [], tier: 'local', intent: 'builtin' });
        }

        if (isCityQuestion(message)) {
            return res.json({ message: citySpeech(city.getEvents()), actions: [], actionResults: [], tier: 'local', intent: 'city' });
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
