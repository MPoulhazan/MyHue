// Niveau 1 de l'assistant : Groq avec tool calling natif.
// Chaque appel d'outil est converti en action MyHue (même format que le
// parser local), exécuté, puis renvoyé au modèle pour la phrase finale.
// Ce qui dépasse la maison (mails, agenda, réorganisation) part vers Claude.

import { normalize } from './intentParser.js';
import { TEMPLATES } from './automations.js';

const AUTOMATION_TEMPLATES = Object.keys(TEMPLATES);

// Le palier gratuit de Groq plafonne à 8 000 tokens/minute : contexte et réponse au plus court
const MAX_TOKENS = 500;

// gpt-oss appelle un outil par tour : un second tour seulement pour « fais ceci et cela ».
// Deux tours (~6 000 tokens) tiennent dans la minute, trois non.
const COMPOUND = /\b(et|puis|ensuite|aussi)\b|,/;
const maxRounds = (message) => (COMPOUND.test(String(message).toLowerCase()) ? 2 : 1);

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
            already_done: { type: 'boolean', description: 'true si l’utilisateur l’a déjà fait à la télécommande (« je l’ai éteinte ») : MyHue met son état à jour sans rien envoyer' },
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
            for_minutes: { type: 'number', description: 'Durée minimale de la condition avant d’alerter (ex. porte ouverte depuis 10 min)' },
        },
        ['sensor_did', 'property', 'operator', 'message', 'name'],
    ),
    tool(
        'create_automation',
        'Crée un automatisme à partir d’un modèle (voir automationTemplates dans le contexte) : porte oubliée, ouverture la nuit, fenêtre ouverte → pause chauffage, je pars, je rentre, pile faible, capteur muet.',
        {
            template: { type: 'string', enum: AUTOMATION_TEMPLATES },
            sensor_did: { type: 'string', description: 'Capteur de porte visé, ou "*" pour toutes les portes (modèles de porte seulement)' },
            minutes: { type: 'number', description: 'Délai avant de réagir (modèles de porte)' },
        },
        ['template'],
    ),
    tool(
        'set_circadian',
        'Active ou coupe la lumière qui suit le soleil (blanc froid le jour, chaud le soir).',
        { enabled: { type: 'boolean' } },
        ['enabled'],
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
                    alreadyDone: args.already_done,
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
                    forMinutes: args.for_minutes || 0,
                },
            ];
        case 'create_automation': {
            const params = {};
            if (args.sensor_did) params.did = args.sensor_did;
            if (args.minutes) params.minutes = Number(args.minutes);
            return [{ type: 'create_automation', template: args.template, params }];
        }
        case 'set_circadian':
            return [{ type: 'set_circadian', enabled: Boolean(args.enabled) }];
        case 'delete_notification_rule':
            return [{ type: 'delete_rule', ruleId: args.rule_id }];
        default:
            return [{ type: name, ...args }];
    }
};

const compact = (obj) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// Contexte réduit à ce qui sert au modèle : chaque token compte contre le quota par minute
export const slimContext = ({ hue, scenes = [], cast = [], sensors = [], ...rest }) => {
    const groupIds = new Set((hue?.groups ?? []).map((g) => g.id));
    return {
        lights: (hue?.lights ?? []).map((l) =>
            compact({ id: l.id, name: l.name, on: l.on, bri: l.on ? l.bri : null, unreachable: l.reachable ? null : true }),
        ),
        // Un groupe vide (zone « Kitchen ») attire le modèle et n'allume rien
        groups: (hue?.groups ?? [])
            .filter((g) => g.lights?.length)
            .map((g) => ({ id: g.id, name: g.name, type: g.type, lights: g.lights, any_on: g.any_on })),
        // [id, nom, groupe] : ~50 scènes, les clés répétées coûtaient cher.
        // Les scènes d'un groupe supprimé ne s'activent plus.
        scenes: scenes
            .filter((s) => s.group === '0' || groupIds.has(String(s.group)))
            .map(({ id, name, group }) => [id, name, group]),
        cast: cast.map((d) => d.name),
        sensors: sensors.map((s) =>
            compact({
                did: s.did,
                name: s.name,
                type: s.type,
                offline: s.isOnline === false ? true : null,
                ...compact(s.props ?? {}),
            }),
        ),
        ...rest,
    };
};

export const buildSystemPrompt = (ctx) => `Tu es l'assistant de la maison MyHue. Tu pilotes les lampes Philips Hue, les appareils Google Cast, la thermopompe Mitsubishi et les alertes de capteurs Zigbee/Aqara, uniquement via les outils fournis.

Règles :
- Réponds toujours en français, en une ou deux phrases courtes (la réponse peut être lue à voix haute).
- Utilise exactement les IDs du contexte (lampes, groupes, scènes, capteurs, règles). Chaque scène est [id, nom, id du groupe].
- Une question sur l'état de la maison (capteurs, lampes allumées, clim, règles) se répond directement depuis le contexte, sans outil.
- Pour une demande hors maison ou qui demande une vraie réflexion, appelle escalate_to_claude et rien d'autre.
- Appelle directement les outils nécessaires ; une fois tout fait, ne réponds rien de plus.

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

// Ce qui a été fait, pour l'historique affiché (la réussite n'est pas lue à voix haute)
const DONE_LABELS = {
    control_lights: 'lumières',
    activate_scene: 'scène',
    cast_youtube: 'musique lancée',
    cast_control: 'lecture',
    cast_volume: 'volume',
    set_heating: 'chauffage',
    create_notification_rule: 'alerte créée',
    create_automation: 'automatisme créé',
    set_circadian: 'lumière du soleil',
    delete_notification_rule: 'alerte supprimée',
};

export const confirmationFor = (toolNames, actionResults) => {
    const failed = actionResults.find((r) => r.status === 'error');
    if (failed) return `Échec : ${failed.error}`;
    const labels = [...new Set(toolNames.map((n) => DONE_LABELS[n] || n))];
    return `C'est fait : ${labels.join(', ')}.`;
};

// Un seul appel LLM : le modèle choisit les outils, la confirmation est construite ici.
// Renvoie { message, actions, actionResults, escalation? }
export const runGroqAgent = async ({
    client,
    model,
    message,
    history,
    context,
    executeActions,
}) => {
    const messages = [
        { role: 'system', content: buildSystemPrompt(slimContext(context)) },
        ...history,
        { role: 'user', content: message },
    ];
    const actions = [];
    const actionResults = [];
    const toolNames = [];

    for (let round = 0; round < maxRounds(message); round++) {
        const { data } = await client.post('/chat/completions', {
            model,
            messages,
            tools: TOOLS,
            tool_choice: 'auto',
            parallel_tool_calls: true,
            temperature: 0.2,
            reasoning_effort: 'low',
            max_tokens: MAX_TOKENS,
        });
        const reply = data?.choices?.[0]?.message ?? {};
        const calls = reply.tool_calls ?? [];

        // Rien de plus à faire : réponse du modèle, ou confirmation de ce qui a été fait
        if (!calls.length) {
            if (actions.length) break;
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
            const callActions = toolCallToActions(call.function.name, parseArgs(call.function.arguments));
            const results = await executeActions(callActions);
            actions.push(...callActions);
            actionResults.push(...results);
            toolNames.push(call.function.name);
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(results.map(({ status, error }) => ({ status, error }))),
            });
        }
    }

    return {
        message: confirmationFor(toolNames, actionResults),
        actions,
        actionResults,
    };
};
