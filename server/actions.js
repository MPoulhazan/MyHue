/**
 * Exécution des actions maison (Hue, Cast, règles, chauffage).
 * Point d'entrée commun : parser local, agent Groq, MCP, automatismes.
 */
import * as castService from './castService.js';
import * as automations from './automations.js';
import * as thermostat from './thermostat.js';
import * as circadian from './circadian.js';
import { hueClient, ensureHueConfigured, clamp, rgbToXy, getHueScenes } from './hue.js';
import { getYtDlpAudioUrl } from './ytdlp.js';

const findCastDevice = (name) => {
    const device = castService.findDevice(name);
    if (!device) throw new Error(`Appareil non trouvé: ${name}`);
    return device;
};

// Chemin Hue touché par une action de couleur/blanc, pour suspendre le circadien sur ces lampes
const colorTarget = (a) => {
    switch (a.type) {
        case 'set_color':
        case 'set_rgb':
        case 'set_color_temperature':
            return [`/lights/${a.id}/state`, { ct: true }];
        case 'set_light_state':
            return [`/lights/${a.id}/state`, { ...a.state, ...(a.rgb ? { xy: true } : {}) }];
        case 'set_group_state':
            return [`/groups/${a.id}/action`, { ...a.state, ...(a.rgb ? { xy: true } : {}) }];
        case 'activate_scene':
            // Le groupe de la scène n'est pas connu ici : on laisse toute la maison à la scène
            return ['/groups/0/action', { scene: a.sceneId }];
        default:
            return null;
    }
};

const runAction = async (action, source) => {
    const touched = colorTarget(action);
    if (touched) circadian.noteHueCommand(...touched);
    switch (action.type) {
        // Hue
        case 'toggle_light':
            ensureHueConfigured();
            await hueClient.put(`/lights/${action.id}/state`, { on: Boolean(action.on) });
            return { action };
        case 'toggle_all':
            ensureHueConfigured();
            await hueClient.put('/groups/0/action', { on: Boolean(action.on) });
            return { action };
        case 'set_brightness': {
            ensureHueConfigured();
            const bri = clamp(Number(action.bri), 0, 254);
            await hueClient.put(`/lights/${action.id}/state`, { bri });
            return { action: { ...action, bri } };
        }
        case 'set_color': {
            ensureHueConfigured();
            const hue = clamp(Number(action.hue), 0, 65535);
            const sat = clamp(Number(action.sat), 0, 254);
            await hueClient.put(`/lights/${action.id}/state`, { hue, sat });
            return { action: { ...action, hue, sat } };
        }
        case 'set_color_temperature': {
            ensureHueConfigured();
            const ct = clamp(Number(action.ct), 153, 500);
            await hueClient.put(`/lights/${action.id}/state`, { ct });
            return { action: { ...action, ct } };
        }
        case 'set_rgb': {
            ensureHueConfigured();
            const r = clamp(Number(action.r), 0, 255);
            const g = clamp(Number(action.g), 0, 255);
            const b = clamp(Number(action.b), 0, 255);
            await hueClient.put(`/lights/${action.id}/state`, { xy: rgbToXy(r, g, b) });
            return { action: { ...action, r, g, b } };
        }
        case 'set_group_state':
        case 'set_light_state': {
            ensureHueConfigured();
            const state = { ...(action.state || {}) };
            if (Array.isArray(action.rgb)) state.xy = rgbToXy(...action.rgb);
            const path =
                action.type === 'set_group_state'
                    ? `/groups/${action.id}/action`
                    : `/lights/${action.id}/state`;
            await hueClient.put(path, state);
            return { action };
        }
        case 'activate_scene': {
            ensureHueConfigured();
            const scene = (await getHueScenes()).find((s) => s.id === action.sceneId);
            if (!scene) throw new Error(`Scène non trouvée: ${action.sceneId}`);
            const groupId = scene.type === 'GroupScene' && scene.group ? scene.group : '0';
            await hueClient.put(`/groups/${groupId}/action`, { scene: scene.id });
            return { action };
        }

        // Google Cast
        case 'cast_media': {
            const device = findCastDevice(action.deviceName);
            const result = await castService.castMedia(
                device.id,
                action.mediaUrl,
                action.contentType || 'video/mp4',
                action.metadata || {},
            );
            return { action, result };
        }
        case 'cast_youtube': {
            const device = findCastDevice(action.deviceName);
            const audioUrl = await getYtDlpAudioUrl(action.videoId);
            const result = await castService.castYouTube(device.id, action.videoId, audioUrl);
            return { action, result };
        }
        case 'cast_control': {
            const device = findCastDevice(action.deviceName);
            const result = await castService.controlPlayback(device.id, action.command);
            return { action, result };
        }
        case 'cast_volume': {
            const device = findCastDevice(action.deviceName);
            const level = clamp(Number(action.level), 0, 1);
            const result = await castService.setVolume(device.id, level);
            return { action: { ...action, level }, result };
        }

        // Automatismes (« règles » côté agent)
        case 'create_rule': {
            const rule = automations.addRule({
                name: action.name,
                sensorDid: action.sensorDid,
                sensorName: action.sensorName,
                property: action.property,
                operator: action.operator,
                value: action.value,
                message: action.message,
                cooldownMinutes: action.cooldownMinutes || 30,
                forMinutes: action.forMinutes || 0,
            });
            return { action, result: { ruleId: rule.id, name: rule.name } };
        }
        case 'create_automation': {
            const automation = automations.createFromTemplate(action.template, action.params || {});
            return { action, result: { id: automation.id, name: automation.name, summary: automations.summarize(automation) } };
        }
        case 'set_circadian':
            return { action, result: await circadian.setEnabled(action.enabled) };
        case 'delete_rule':
            if (!automations.remove(action.ruleId)) {
                throw new Error(`Règle non trouvée: ${action.ruleId}`);
            }
            return { action };

        // Thermopompe
        case 'set_heating': {
            const result = await thermostat.userCommand(action, source);
            return { action, result };
        }

        default:
            return { action, status: 'ignored', error: 'Unknown action type' };
    }
};

/** @param {string} [source] origine (agent, mcp, automatisme...) reportée dans le journal */
export const executeActions = async (actions, source = 'agent') => {
    if (!Array.isArray(actions)) return [];
    const results = [];
    for (const action of actions) {
        try {
            results.push({ status: 'ok', ...(await runAction(action, source)) });
        } catch (error) {
            results.push({ action, status: 'error', error: error?.message || 'Action failed' });
        }
    }
    return results;
};
