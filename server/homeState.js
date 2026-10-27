/**
 * Instantané de la maison, partagé par l'agent Groq et le serveur MCP.
 * Une panne Hue ne doit pas masquer le reste.
 */
import * as castService from './castService.js';
import * as rulesEngine from './rulesEngine.js';
import * as broadlinkService from './broadlinkService.js';
import { getHueContext, getHueScenes } from './hue.js';
import * as journal from './journal.js';
import { getSensors, getOutdoorWeather } from './sensors.js';

const TZ = process.env.TZ || 'America/Toronto';

/** Derniers événements, lisibles par un LLM (heure locale). */
export const recentEvents = (limit = 10) =>
    journal.list({ limit }).map((e) => ({
        at: new Date(e.ts).toLocaleString('fr-CA', { timeZone: TZ }),
        what: e.title,
    }));

export const getHomeState = async () => {
    const [hue, scenes, sensors, outdoor] = await Promise.all([
        getHueContext().catch((error) => ({ error: error.message })),
        getHueScenes(),
        getSensors(),
        getOutdoorWeather(),
    ]);
    return {
        hue,
        scenes: scenes.map(({ id, name, group }) => ({ id, name, group })),
        cast: castService.getDevices(),
        sensors,
        rules: rulesEngine.getRules(),
        heating: broadlinkService.getState(),
        outdoor,
        recentEvents: recentEvents(),
    };
};
