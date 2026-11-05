/**
 * Cube Aqara (MFKZQ01LM, zigbee2mqtt) : un dé à ambiances pour le salon.
 *
 * - Face du dessus = ambiance : on retourne le cube (quart ou demi-tour), la face qui arrive
 *   en haut choisit sa scène. Six faces, six ambiances, réglables.
 * - Tourner à plat = luminosité du salon ; volume de l'enceinte si de la musique joue dessus.
 * - Double tape sur la table = pause / lecture sur l'enceinte du salon.
 * - Secouer = salon éteint, ou rallumé sur l'ambiance de la face du dessus.
 * - Glisser = moment Cinéma.
 * - Chute = petite plainte sur l'enceinte (pas la nuit).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { hueClient, hueBaseUrl, getHueScenes } from './hue.js';
import * as zigbeeService from './zigbeeService.js';
import * as castService from './castService.js';
import * as journal from './journal.js';
import * as moments from './moments.js';
import { executeActions } from './actions.js';
import { announce, getSpeakers } from './briefing.js';
import { localParts } from './cooper.js';
import { isNight } from './mailbox.js';
import { parseGesture, briDelta, volumeDelta, pickScene, fallLine } from './cubeGestures.js';

const FILE = dataFile('cube.json');
const TZ = process.env.TZ || 'America/Toronto';
export const CUBE_MODELS = /MFKZQ01LM|CTP-R01/i;
const FALL_COOLDOWN_MS = 60_000;

const DEFAULTS = {
    enabled: true,
    device: null, // friendly name z2m ; null = premier cube trouvé
    groupId: '1', // pièce Hue pilotée (Salon)
    castName: 'Salon', // enceinte du salon (pause, volume)
    speaker: null, // entité media_player pour la chute ; null = celle dont le nom parle du salon
    rotateVolume: true, // tourner = volume quand la musique joue
    fallVoice: true,
    // Face du dessus → ambiance : { label, scene } (nom de scène Hue) ou { label, moment } (moments.js)
    faces: {
        0: { label: 'Lumineux', scene: 'Lumineux' },
        1: { label: 'Lecture', scene: 'Lecture' },
        2: { label: 'Détente', scene: 'Détente' },
        3: { label: 'Cinéma', moment: 'cinema' },
        4: { label: 'Apéro', moment: 'apero' },
        5: { label: 'Bougie', scene: 'Bougie' },
    },
};

let config = structuredClone(DEFAULTS);
try {
    if (existsSync(FILE)) {
        const saved = JSON.parse(readFileSync(FILE, 'utf8'));
        config = { ...config, ...saved, faces: { ...DEFAULTS.faces, ...(saved.faces || {}) } };
    }
} catch (err) {
    console.error('❌ cube.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du cube impossible:', err.message);
    }
};

// État d'exécution (non sauvegardé)
let face = null; // face du dessus connue
let last = null; // { at, gesture, text }
let lastFallAt = 0;

// --- Exécution ---

const findCube = () => {
    if (config.device) return zigbeeService.getDevice(config.device);
    return zigbeeService.getDevices().find((d) => CUBE_MODELS.test(d.model || '')) || null;
};

const isCube = (name, msg) => {
    if (config.device) return name === config.device;
    const d = zigbeeService.getDevice(name);
    if (d?.model) return CUBE_MODELS.test(d.model);
    return 'action_angle' in msg || 'action_to_side' in msg; // modèle pas encore connu
};

const remember = (gesture, text) => {
    last = { at: Date.now(), gesture, text };
};

const applyFace = async (n) => {
    const def = config.faces[n];
    if (!def) return null;
    if (def.moment) {
        await moments.run(def.moment);
        return def.label;
    }
    const scene = pickScene(await getHueScenes(), def.scene, config.groupId);
    if (!scene) throw new Error(`scène « ${def.scene} » introuvable`);
    await executeActions([{ type: 'activate_scene', sceneId: scene.id }], 'cube');
    return def.label;
};

const salonCast = () => (config.castName ? castService.findDevice(config.castName) : null);

const playingOnSalon = () => {
    const device = salonCast();
    const np = castService.getNowPlaying();
    return device && np && np.deviceId === device.id && !np.paused ? { device, np } : null;
};

const pickSpeaker = async () => {
    if (config.speaker) return config.speaker;
    const speakers = await getSpeakers().catch(() => []);
    return speakers.find((s) => s.available && /salon/i.test(s.name))?.id || null;
};

const handle = async ({ gesture, face: side, angle }) => {
    if (Number.isInteger(side)) face = side;
    switch (gesture) {
        case 'flip': {
            const label = await applyFace(side);
            remember('flip', label ? `Face ${side} : ${label}` : `Face ${side} : rien de réglé`);
            if (label) journal.log({ kind: 'system', title: `Cube : ${label}`, data: { face: side } });
            return;
        }
        case 'rotate': {
            const playing = config.rotateVolume && playingOnSalon();
            if (playing) {
                const current = (playing.np.volume ?? 40) / 100;
                const level = Math.max(0, Math.min(1, current + volumeDelta(angle)));
                await castService.setVolume(playing.device.id, level);
                remember('rotate', `Volume ${Math.round(level * 100)} %`);
                return;
            }
            const bri_inc = briDelta(angle);
            await executeActions([{ type: 'set_group_state', id: config.groupId, state: { on: true, bri_inc, transitiontime: 3 } }], 'cube');
            remember('rotate', `Lumière ${bri_inc > 0 ? '+' : ''}${Math.round((bri_inc / 254) * 100)} %`);
            return;
        }
        case 'tap': {
            const device = salonCast();
            if (!device) return;
            const np = castService.getNowPlaying();
            const command = np?.deviceId === device.id && !np.paused ? 'pause' : 'play';
            await castService.controlPlayback(device.id, command);
            remember('tap', command === 'pause' ? 'Musique en pause' : 'Musique relancée');
            return;
        }
        case 'shake': {
            const { data } = await hueClient.get(`/groups/${config.groupId}`);
            if (data?.state?.any_on) {
                await executeActions([{ type: 'set_group_state', id: config.groupId, state: { on: false } }], 'cube');
                remember('shake', 'Salon éteint');
            } else {
                const label = Number.isInteger(face) ? await applyFace(face).catch(() => null) : null;
                if (!label) await executeActions([{ type: 'set_group_state', id: config.groupId, state: { on: true } }], 'cube');
                remember('shake', `Salon rallumé${label ? ` : ${label}` : ''}`);
            }
            return;
        }
        case 'slide':
            await moments.run('cinema');
            remember('slide', 'Moment Cinéma');
            return;
        case 'fall': {
            remember('fall', 'Le cube est tombé');
            if (!config.fallVoice || Date.now() - lastFallAt < FALL_COOLDOWN_MS) return;
            if (isNight(localParts(Date.now(), TZ).minutes)) return;
            lastFallAt = Date.now();
            const speaker = await pickSpeaker();
            if (speaker) await announce([speaker], fallLine(), { volume: 0.5, holdMs: 8000 });
            return;
        }
        default:
    }
};

const onAction = ({ friendlyName, msg }) => {
    if (!config.enabled || !hueBaseUrl || !isCube(friendlyName, msg)) return;
    const g = parseGesture(msg);
    if (!g || g.gesture === 'wakeup') return;
    handle(g).catch((err) => {
        remember(g.gesture, `Raté : ${err.message}`);
        console.warn(`[Cube] ${g.gesture} : ${err.message}`);
    });
};

export const start = () => {
    zigbeeService.emitter.on('action', onAction);
    console.log(`🎲 Cube ${config.enabled ? 'actif' : 'désactivé'}`);
};

// --- API ---

export const getView = () => {
    const cube = findCube();
    const side = Number.isInteger(face) ? face : Number.isInteger(cube?.state?.side) ? cube.state.side : null;
    return {
        enabled: config.enabled,
        found: Boolean(cube),
        device: cube?.friendlyName || null,
        battery: cube?.state?.battery ?? null,
        face: side,
        faceLabel: side != null ? config.faces[side]?.label || null : null,
        last,
    };
};

export const getSettings = () => structuredClone(config);

export const update = (patch = {}) => {
    for (const key of ['enabled', 'rotateVolume', 'fallVoice']) {
        if (patch[key] !== undefined) config[key] = Boolean(patch[key]);
    }
    for (const key of ['device', 'groupId', 'castName', 'speaker']) {
        if (patch[key] !== undefined) config[key] = patch[key] ? String(patch[key]) : null;
    }
    if (patch.faces && typeof patch.faces === 'object') {
        for (const [k, v] of Object.entries(patch.faces)) {
            const n = Number(k);
            if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error(`face ${k} invalide`);
            if (!v || (!v.scene && !v.moment)) throw new Error(`face ${k} : scène ou moment requis`);
            if (v.moment && !moments.list().some((m) => m.id === v.moment)) throw new Error(`moment ${v.moment} inconnu`);
            config.faces[n] = { label: String(v.label || v.scene || v.moment), ...(v.moment ? { moment: v.moment } : { scene: String(v.scene) }) };
        }
    }
    save();
    return getSettings();
};

/** Essai depuis l'interface ou l'agent : rejoue l'ambiance d'une face. */
export const test = async (n) => {
    const label = await applyFace(Number(n));
    if (!label) throw new Error(`face ${n} sans ambiance`);
    remember('flip', `Essai face ${n} : ${label}`);
    return label;
};
