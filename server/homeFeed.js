// ── Liste « Maintenant » de l'accueil, calculée par le Pi ────────────────────
//
// Rassemble ce que le Pi sait déjà (alarme, ville, Cooper, courrier, musique, capteurs,
// trajet, BIXI, Communauto, ciel, journal), en déduit la pertinence de chaque widget
// (homeFeedLogic.js) et la sert sur /api/home-feed. La tablette, le téléphone, l'écran
// de la cuisine et le briefing lisent la même liste : ils disent la même chose.

import * as guard from './guard.js';
import * as city from './city.js';
import * as cooper from './cooper.js';
import * as advent from './advent.js';
import * as mailbox from './mailbox.js';
import * as musicPlayer from './musicPlayer.js';
import * as castService from './castService.js';
import * as bixi from './bixi.js';
import * as commute from './commute.js';
import * as communauto from './communauto.js';
import * as journal from './journal.js';
import * as homeWidgets from './homeWidgets.js';
import * as briefing from './briefing.js';
import { getSensors } from './sensors.js';
import { getSky } from './astro.js';
import { buildFeed, feedBriefingLine } from './homeFeedLogic.js';

const TZ = process.env.TZ || 'America/Toronto';
/** Trois écrans relisent la liste : on ne recalcule pas le trajet plus souvent que ça */
const CACHE_MS = 15_000;

// Une source en panne ne doit pas faire tomber toute la liste : son widget est caché
const safe = async (fn) => {
    try {
        return await fn();
    } catch (err) {
        console.warn('[Maintenant] Source indisponible:', err.message);
        return null;
    }
};

/** Les données brutes, lues en parallèle. */
async function gather() {
    const [sensors, commuteView, bixiView, communautoView, sky] = await Promise.all([
        safe(() => getSensors()),
        safe(() => commute.getView()),
        safe(() => bixi.getView()),
        safe(() => communauto.getView()),
        safe(() => getSky()),
    ]);
    return {
        guard: await safe(() => guard.getView()),
        city: await safe(() => city.getView()),
        cooper: await safe(() => cooper.getView()),
        advent: await safe(() => advent.getView()),
        mail: await safe(() => mailbox.getView()),
        music: await safe(() => ({ suggestion: musicPlayer.suggestion() })),
        playing: Boolean(castService.getNowPlaying()),
        sensors: sensors || [],
        commute: commuteView,
        bixi: bixiView,
        communauto: communautoView,
        sky,
        // Ce que montre la carte Journal : les derniers évènements, sans les échanges avec l'assistant
        journalCount: (journal.list({ limit: 40 }) || []).filter((e) => e.kind !== 'agent').length,
    };
}

let cache = null;
let pending = null;

/**
 * La liste « Maintenant ».
 * @param fresh true : recalculée tout de suite (une pastille touchée, un capteur qui change)
 */
export async function getFeed({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && cache && now - cache.generatedAt < CACHE_MS) return cache;
    if (!pending) {
        pending = gather()
            .then((d) => (cache = buildFeed(d, homeWidgets.getPins().pins, Date.now(), TZ)))
            .finally(() => { pending = null; });
    }
    return pending;
}

/** Un réglage Auto / Toujours / Masqué a changé : la prochaine lecture recalcule. */
export const invalidate = () => { cache = null; };

// Le briefing du matin dit aussi ce que l'écran montre d'urgent
briefing.addExtra(async () => feedBriefingLine(await getFeed()));
