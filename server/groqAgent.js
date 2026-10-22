// Niveau 1 de l'assistant : Groq avec tool calling natif.
// Chaque appel d'outil est converti en action MyHue (même format que le
// parser local), exécuté, puis renvoyé au modèle pour la phrase finale.
// Ce qui dépasse la maison (mails, agenda, réorganisation) part vers Claude.

import { normalize } from './intentParser.js';

const MAX_ROUNDS = 3;

// Demandes hors périmètre MyHue : inutile de dépenser un appel Groq
const CLAUDE_ONLY =
    /\b(e ?mails?|mails?|courriels?|gmail|boite de reception|inbox|agenda|calendrier|rendez vous|reunion|reorganise[rz]?|reorganisation)\b/;

export const claudeUrl = (prompt) =>
    `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

export const buildEscalation = (reason, prompt) => ({
    reason,
    prompt,
    url: claudeUrl(prompt),
});

export const needsClaude = (message) => CLAUDE_ONLY.test(normalize(message));

const tool = (name, description, properties, required = []) => ({
    type: 'function',
    function: {
        name,
        description,
        parameters: { type: 'object', properties, required },
    },
});

export const TOOLS = [
    tool(
        'control_lights',
        'Allume, éteint ou règle des lampes Hue. target_type "all" vise toute la maison (id ignoré).',
        {
            target_type: { type: 'string', enum: ['light', 'group', 'all'] },
            id: { type: 'string', description: 'ID de lampe ou de groupe Hue' },
            on: { type: 'boolean' },
            brightness_pct: { type: 'number', description: '0 à 100' },
            color_rgb: {
                type: 'array',
                items: { type: 'number' },
                description: '[r, g, b] de 0 à 255',
            },
            color_temp_kelvin: { type: 'number', description: '2000 (chaud) à 6500 (froid)' },
        },
        ['target_type'],
    ),
    tool(
        'activate_scene',
        'Active une scène Hue existante.',
        { scene_id: { type: 'string' } },
        ['scene_id'],
    ),
    tool(
        'cast_youtube',
        'Lit une vidéo YouTube sur un appareil Cast.',
        {
            device_name: { type: 'string' },
            video_id: { type: 'string', description: 'ex. dQw4w9WgXcQ' },
        },
        ['device_name', 'video_id'],
    ),
    tool(
        'cast_control',
        'Lecture, pause ou arrêt sur un appareil Cast.',
        {
            device_name: { type: 'string' },
            command: { type: 'string', enum: ['play', 'pause', 'stop'] },
        },
        ['device_name', 'command'],
    ),
    tool(
        'cast_volume',
        'Règle le volume d’un appareil Cast.',
        {
            device_name: { type: 'string' },
            level_pct: { type: 'number', description: '0 à 100' },
        },
        ['device_name', 'level_pct'],
    ),
    tool(
        'set_heating',
        'Pilote la thermopompe Mitsubishi. Ne passer que les champs à changer.',
        {
            power: { type: 'boolean' },
            mode: { type: 'string', enum: ['heat', 'cool', 'dry', 'fan', 'auto'] },
            temperature: { type: 'number', description: '16 à 31 °C' },
            fan_speed: { type: 'string', enum: ['auto', 'quiet', 'low', 'med', 'high'] },
            vane_vertical: { type: 'string', enum: ['auto', '1', '2', '3', '4', '5', 'swing'] },
        },
    ),
    tool(
        'create_notification_rule',
        'Crée une alerte sur un capteur. Booléens (porte, fumée, fuite) : is_true/is_false sans value. Numériques : gt/lt/gte/lte avec value.',
        {
            sensor_did: { type: 'string' },
            sensor_name: { type: 'string' },
            property: { type: 'string' },
            operator: {
                type: 'string',
                enum: ['gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'is_true', 'is_false'],
            },
            value: { type: 'number' },
            message: { type: 'string' },
            name: { type: 'string' },
            cooldown_minutes: { type: 'number' },
        },
        ['sensor_did', 'property', 'operator', 'message', 'name'],
    ),
    tool(
        'delete_notification_rule',
        'Supprime une règle de notification.',
        { rule_id: { type: 'string' } },
        ['rule_id'],
    ),
    tool(
        'escalate_to_claude',
        'Passe la main à Claude quand la demande sort de la maison (mails, agenda, recherche web) ou demande une vraie réflexion (réorganiser les scènes, planifier, analyser un historique). Ne pas utiliser pour une commande de lampe, clim ou musique.',
        {
            reason: { type: 'string', description: 'Pourquoi, en une courte phrase' },
            prompt: {
                type: 'string',
                description: 'La demande reformulée pour Claude, autonome et complète',
            },
        },
        ['reason', 'prompt'],
    ),
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Convertit un appel d'outil en action(s) comprises par executeActions
export const toolCallToActions = (name, args) => {
    switch (name) {
        case 'control_lights': {
            const state = {};
            if (typeof args.on === 'boolean') state.on = args.on;
            if (args.brightness_pct != null) {
                state.bri = Math.round(clamp(Number(args.brightness_pct), 0, 100) * 2.54);
                if (state.on === undefined && state.bri > 0) state.on = true;
            }
            if (args.color_temp_kelvin) {
                state.ct = Math.round(1e6 / clamp(Number(args.color_temp_kelvin), 2000, 6500));
            }
            const action =
                args.target_type === 'light'
                    ? { type: 'set_light_state', id: String(args.id), state }
                    : {
                          type: 'set_group_state',
                          id: args.target_type === 'all' ? '0' : String(args.id),
                          state,
                      };
            if (Array.isArray(args.color_rgb) && args.color_rgb.length === 3) {
                action.rgb = args.color_rgb.map((c) => clamp(Number(c), 0, 255));
            }
            return [action];
        }
        case 'activate_scene':
            return [{ type: 'activate_scene', sceneId: String(args.scene_id) }];
        case 'cast_youtube':
            return [{ type: 'cast_youtube', deviceName: args.device_name, videoId: args.video_id }];
        case 'cast_control':
            return [{ type: 'cast_control', deviceName: args.device_name, command: args.command }];
        case 'cast_volume':
            return [
                {
                    type: 'cast_volume',
                    deviceName: args.device_name,
                    level: clamp(Number(args.level_pct), 0, 100) / 100,
                },
            ];
        case 'set_heating':
            return [
                {
                    type: 'set_heating',
                    power: args.power,
                    mode: args.mode,
                    temperature: args.temperature,
                    fanSpeed: args.fan_speed,
                    vaneVertical: args.vane_vertical,
                },
            ];
        case 'create_notification_rule':
            return [
                {
                    type: 'create_rule',
                    sensorDid: args.sensor_did,
                    sensorName: args.sensor_name,
                    property: args.property,
                    operator: args.operator,
                    value: args.value ?? null,
                    message: args.message,
                    name: args.name,
                    cooldownMinutes: args.cooldown_minutes || 30,
                },
            ];
        case 'delete_notification_rule':
            return [{ type: 'delete_rule', ruleId: args.rule_id }];
        default:
            return [{ type: name, ...args }];
    }
};

export const buildSystemPrompt = (ctx) => `Tu es l'assistant de la maison MyHue. Tu pilotes les lampes Philips Hue, les appareils Google Cast, la thermopompe Mitsubishi et les alertes de capteurs Zigbee/Aqara, uniquement via les outils fournis.

Règles :
- Réponds toujours en français, en une ou deux phrases courtes (la réponse peut être lue à voix haute).
- Utilise exactement les IDs du contexte (lampes, groupes, scènes, capteurs, règles).
- Une question sur l'état de la maison (capteurs, lampes allumées, clim, règles) se répond directement depuis le contexte, sans outil.
- Pour une demande hors maison ou qui demande une vraie réflexion, appelle escalate_to_claude et rien d'autre.
- Après exécution des outils, confirme ce qui a été fait ; signale clairement un échec.

Contexte maison (JSON) :
${JSON.stringify(ctx)}
`;

const parseArgs = (raw) => {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
};

// Boucle d'outils. Renvoie { message, actions, actionResults, escalation? }
export const runGroqAgent = async ({
    client,
    model,
    message,
    history,
    context,
    executeActions,
}) => {
    const messages = [
        { role: 'system', content: buildSystemPrompt(context) },
        ...history,
        { role: 'user', content: message },
    ];
    const actions = [];
    const actionResults = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const { data } = await client.post('/chat/completions', {
            model,
            messages,
            tools: TOOLS,
            // Dernier tour : on force une réponse texte
            tool_choice: round === MAX_ROUNDS - 1 ? 'none' : 'auto',
            temperature: 0.2,
            max_tokens: 800,
        });
        const reply = data?.choices?.[0]?.message ?? {};
        const calls = reply.tool_calls ?? [];

        if (!calls.length) {
            return { message: reply.content?.trim() || 'Ok.', actions, actionResults };
        }

        const escalateCall = calls.find((c) => c.function?.name === 'escalate_to_claude');
        if (escalateCall) {
            const args = parseArgs(escalateCall.function.arguments);
            const prompt = args.prompt || message;
            const reason = args.reason || 'demande trop complexe pour moi';
            return {
                message: `Je passe la main à Claude : ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`,
                actions,
                actionResults,
                escalation: buildEscalation(args.reason || null, prompt),
            };
        }

        messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: calls });
        for (const call of calls) {
            const callActions = toolCallToActions(
                call.function.name,
                parseArgs(call.function.arguments),
            );
            const results = await executeActions(callActions);
            actions.push(...callActions);
            actionResults.push(...results);
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(
                    results.map(({ status, error, result }) => ({ status, error, result })),
                ),
            });
        }
    }

    return { message: 'Ok.', actions, actionResults };
};
