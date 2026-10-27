/**
 * Instantané de la maison, partagé par l'agent Groq et le serveur MCP.
 * Une panne Hue ne doit pas masquer le reste.
 */
import * as castService from './castService.js';
import * as rulesEngine from './rulesEngine.js';
import * as broadlinkService from './broadlinkService.js';
import { getHueContext, getHueScenes } from './hue.js';
import { getSensors } from './sensors.js';

export const getHomeState = async () => {
    const [hue, scenes, sensors] = await Promise.all([
        getHueContext().catch((error) => ({ error: error.message })),
        getHueScenes(),
        getSensors(),
    ]);
    return {
        hue,
        scenes: scenes.map(({ id, name, group }) => ({ id, name, group })),
        cast: castService.getDevices(),
        sensors,
        rules: rulesEngine.getRules(),
        heating: broadlinkService.getState(),
    };
};
