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

const INSTRUCTIONS = `Serveur de la maison MyHue : lampes Philips Hue, appareils Google Cast, thermopompe Mitsubishi, capteurs Zigbee/Aqara et leurs alertes.
Appelle get_home_state avant d'agir pour connaître les IDs exacts (lampes, groupes, scènes, capteurs, règles) et l'état courant.`;

const HOME_STATE_TOOL = {
    name: 'get_home_state',
    description:
        'État complet de la maison : lampes et groupes Hue, scènes, appareils Cast, capteurs (température, humidité, portes, mouvement), thermopompe et règles d’alerte.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
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
        tools: [HOME_STATE_TOOL, ...ACTION_TOOLS],
    }));

    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const { name, arguments: args = {} } = params;
        try {
            if (name === HOME_STATE_TOOL.name) return textResult(await getContext());
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
