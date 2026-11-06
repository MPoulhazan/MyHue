/**
 * Instantané de la maison, partagé par l'agent Groq et le serveur MCP.
 * Une panne Hue ne doit pas masquer le reste.
 */
import * as castService from './castService.js';
import * as automations from './automations.js';
import * as broadlinkService from './broadlinkService.js';
import { getHueContext, getHueScenes } from './hue.js';
import * as journal from './journal.js';
import * as presence from './presence.js';
import * as thermostat from './thermostat.js';
import * as circadian from './circadian.js';
import * as cooper from './cooper.js';
import * as mailbox from './mailbox.js';
import * as cube from './cube.js';
import * as bixi from './bixi.js';
import { bixiSpeech } from './bixiLogic.js';
import * as city from './city.js';
import { citySpeech } from './cityLogic.js';
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
        rules: automations.getForAgent(),
        automationTemplates: Object.entries(automations.TEMPLATES).map(([id, t]) => ({ id, label: t.label, description: t.description })),
        circadian: await circadian.getStatus().catch(() => null),
        heating: broadlinkService.getState(),
        thermostat: (({ enabled, target, why, status }) => ({ enabled, target, why, status: status.text }))(thermostat.getStatus()),
        outdoor,
        people: presence.getPeople(),
        // Repas du chien (boîte de croquettes) : status done/upcoming/soon/due/late/missed
        cooper: (({ enabled, meals, line }) => ({ enabled, meals, summary: line }))(cooper.getView()),
        // Boîte aux lettres : waiting = courrier pas encore relevé (since = passage du facteur)
        mailbox: (({ enabled, sensor, waiting, today, usual, mood }) => ({ enabled, hasSensor: Boolean(sensor), waiting, today, usualMinutes: usual, mood, summary: mailbox.mailSpeech(mailbox.getView()) }))(mailbox.getView()),
        // Cube du salon : face du dessus = ambiance, dernier geste
        cube: (({ found, face, faceLabel, last, battery }) => ({ found, face, faceLabel, last, battery }))(cube.getView()),
        // Vélos BIXI classiques au départ de la maison, places libres à l'arrivée de chacun
        bixi: await bixi.getView().then((v) => ({ configured: v.configured, season: v.season, verdict: v.verdict, trips: v.trips, summary: bixiSpeech(v) })).catch(() => null),
        // Alertes de la ville : météo dangereuse, avis du quartier, événements (level danger/heads/info)
        city: (() => {
            const events = city.getEvents();
            return { events: events.slice(0, 8).map(({ id, level, kind, title, detail, start, end }) => ({ id, level, kind, title, detail, start, end })), summary: citySpeech(events) };
        })(),
        recentEvents: recentEvents(),
    };
};
