// Niveau 2 de l'assistant : MyHue exposé en serveur MCP pour l'app Claude
// (connecteur claude.ai). Mêmes outils que Groq, sans escalate_to_claude,
// plus get_home_state puisque Claude n'a pas le contexte dans son prompt.
// Mode stateless : un serveur + un transport par requête POST.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, toolCallToActions } from './groqAgent.js';
import * as myDay from './myDay.js';

const INSTRUCTIONS = `Serveur de la maison MyHue : lampes Philips Hue, appareils Google Cast, thermopompe Mitsubishi, capteurs Zigbee/Aqara et leurs alertes.
Appelle get_home_state avant d'agir pour connaître les IDs exacts (lampes, groupes, scènes, capteurs, règles) et l'état courant.`;

const HOME_STATE_TOOL = {
    name: 'get_home_state',
    description:
        'État complet de la maison : lampes et groupes Hue, scènes, appareils Cast, capteurs (température, humidité, portes, mouvement), thermopompe et règles d’alerte.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
};

// « Ma journée » : la tâche Claude du matin dépose les mails triés et les idées de sortie
const DAY_TOOLS = [
    {
        name: 'get_day_context',
        description: 'Profils de « Ma journée » (id, prénom, mails suivis ou non), règles du tri des mails et des sorties, sorties déjà faites. À lire avant set_mail_digest et set_outing_ideas.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
    },
    {
        name: 'set_mail_digest',
        description: 'Dépose les mails importants du jour d’une personne sur sa page « Ma journée » (remplace le dépôt précédent). 3 au plus, spam et pub exclus. Liste vide = rien d’important.',
        inputSchema: {
            type: 'object',
            properties: {
                person: { type: 'string', description: 'id du profil (get_day_context)' },
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            from: { type: 'string', description: 'Expéditeur lisible (nom ou organisme), pas l’adresse' },
                            subject: { type: 'string' },
                            summary: { type: 'string', description: 'Une phrase : ce qu’on attend de moi' },
                            receivedAt: { type: 'string', description: 'ISO 8601' },
                            draft: { type: 'string', description: 'Texte du brouillon de réponse créé dans Gmail, si une réponse est attendue' },
                            draftUrl: { type: 'string', description: 'Lien https://mail.google.com/... vers le brouillon' },
                            threadUrl: { type: 'string', description: 'Lien https://mail.google.com/... vers le fil' },
                        },
                        required: ['from', 'subject', 'summary'],
                    },
                },
            },
            required: ['person', 'items'],
        },
    },
    {
        name: 'set_outing_ideas',
        description: 'Dépose 4 à 8 idées de sortie à deux pour les prochains jours (remplace les précédentes) : événements, musées, restos, activités. Île de Montréal seulement, du mercredi au samedi soir. Ajoute aussi les idées de jour de repos (champ person) décrites dans outings.restRules.',
        inputSchema: {
            type: 'object',
            properties: {
                ideas: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            kind: { type: 'string', enum: ['event', 'museum', 'resto', 'activity'] },
                            title: { type: 'string' },
                            date: { type: 'string', description: 'AAAA-MM-JJ si l’idée est datée (événement)' },
                            when: { type: 'string', description: 'Ex. « Samedi 20 h » ou « Jeu–sam jusqu’à 21 h »' },
                            where: { type: 'string', description: 'Lieu et quartier' },
                            why: { type: 'string', description: 'Une phrase concrète, sans superlatif' },
                            url: { type: 'string' },
                            person: { type: 'string', description: 'id du profil si l’idée est une activité de jour pour cette personne seule (son jour de repos, voir outings.restDays) ; absent = sortie à deux' },
                        },
                        required: ['kind', 'title'],
                    },
                },
            },
            required: ['ideas'],
        },
    },
];

const callDayTool = (name, args) => {
    if (name === 'get_day_context') return myDay.getContextForClaude();
    if (name === 'set_mail_digest') return myDay.setMails(args.person, args.items);
    if (name === 'set_outing_ideas') return myDay.setOutings(args.ideas);
    return null;
};

const ACTION_TOOLS = TOOLS.map((t) => t.function)
    .filter((f) => f.name !== 'escalate_to_claude')
    .map((f) => ({ name: f.name, description: f.description, inputSchema: f.parameters }));

const textResult = (data, isError = false) => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
});

const buildServer = ({ getContext, executeActions }) => {
    const server = new Server(
        { name: 'myhue', version: '1.0.0' },
        { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [HOME_STATE_TOOL, ...DAY_TOOLS, ...ACTION_TOOLS],
    }));

    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const { name, arguments: args = {} } = params;
        try {
            if (name === HOME_STATE_TOOL.name) return textResult(await getContext());
            if (DAY_TOOLS.some((t) => t.name === name)) return textResult(callDayTool(name, args));
            if (!ACTION_TOOLS.some((t) => t.name === name)) {
                return textResult({ error: `Outil inconnu : ${name}` }, true);
            }
            const results = await executeActions(toolCallToActions(name, args), 'claude');
            const summary = results.map(({ status, error, result }) => ({ status, error, result }));
            return textResult(summary, summary.some((r) => r.status !== 'ok'));
        } catch (error) {
            return textResult({ error: error?.message || 'Erreur MyHue' }, true);
        }
    });

    return server;
};

export const handleMcpRequest = (deps) => async (req, res) => {
    if (req.method !== 'POST') {
        // Stateless : pas de flux GET ni de session à fermer
        return res.status(405).set('Allow', 'POST').json({ error: 'Method not allowed' });
    }
    const server = buildServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
        transport.close();
        server.close();
    });
    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('[mcp]', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
            });
        }
    }
};
