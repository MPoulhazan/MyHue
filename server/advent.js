/**
 * Calendrier de l'Avent de la tablette.
 *
 * Du 1er au 24 décembre, une case par jour : une chanson jouée sur l'enceinte du salon,
 * une mission, une anecdote, une photo de Cooper ou une sortie. On l'ouvre en touchant
 * la carte de l'accueil ou en disant « Jean-Claude, ouvre la case du jour » ; la tablette
 * affiche alors la case en plein écran. Les cases ouvertes sont gardées par année.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as musicPlayer from './musicPlayer.js';
import * as youtube from './youtubeService.js';
import { ADVENT_DAYS } from './adventDays.js';
import { christmasSeason } from './seasonLogic.js';
import { adventView, adventBriefingLine } from './adventLogic.js';
import * as briefing from './briefing.js';

const FILE = dataFile('advent.json');
const TZ = process.env.TZ || 'America/Toronto';

let store = { years: {} }; // { years: { '2026': { opened: { '12': ts } } } }
try {
    if (existsSync(FILE)) store = { years: {}, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ advent.json illisible:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du calendrier de l’Avent impossible:', err.message);
    }
};

const openedOf = (year) => store.years[year]?.opened || {};

export function getView(now = Date.now()) {
    const season = christmasSeason(now, TZ);
    return adventView(openedOf(season.year), season);
}

/** Joue la chanson d'une case sur l'enceinte par défaut (le salon). */
async function playSong(day) {
    const device = musicPlayer.defaultDevice();
    if (!device) throw new Error('Aucune enceinte joignable');
    const [track] = await youtube.search(day.query, 1);
    if (!track) throw new Error('Chanson introuvable');
    await musicPlayer.play({ deviceId: device.id, kind: 'tracks', tracks: [track], name: `Avent · ${day.title}` });
    return device.name;
}

/**
 * Ouvre une case (celle du jour par défaut). Une case déjà ouverte se rouvre : sa chanson rejoue.
 * @returns { view, day, played, error? }
 */
export async function open(n, source = 'écran', now = Date.now()) {
    const season = christmasSeason(now, TZ);
    if (season.phase !== 'advent' && season.phase !== 'christmas' && season.phase !== 'after') {
        throw new Error(season.phase === 'before' ? 'Le calendrier ouvre le 1er décembre' : 'Le calendrier de l’Avent est rangé');
    }
    const num = Number(n) || season.adventDay;
    if (!num) throw new Error('Pas de case aujourd’hui');
    const max = season.adventDay ?? 24;
    if (num < 1 || num > max) throw new Error('Cette case n’est pas encore ouvrable');

    const year = String(season.year);
    store.years[year] = store.years[year] || { opened: {} };
    const first = !store.years[year].opened[num];
    if (first) {
        store.years[year].opened[num] = now;
        save();
    }
    const day = ADVENT_DAYS[num - 1];
    if (first) journal.log({ kind: 'advent', title: `Case ${num} du calendrier : ${day.title}`, data: { n: num, source } });

    let played = null;
    let error = null;
    if (day.query) {
        try {
            played = await playSong(day);
        } catch (err) {
            error = err.message;
            console.warn('[Avent] Chanson non jouée:', err.message);
        }
    }
    const view = getView(now);
    return { view, day: view.days[num - 1], played, error };
}

/** Réponse de Jean-Claude à « ouvre la case du jour ». */
export async function voiceAnswer() {
    try {
        const { day, played } = await open(null, 'à la voix');
        const speech = {
            song: `Case ${day.n} : ${day.title}.${played ? ' Ho ho ho, ça joue au salon !' : ''}`,
            mission: `Case ${day.n}, ta mission : ${day.title}. ${day.body}`,
            fact: `Case ${day.n}, le saviez-vous ? ${day.body}`,
            cooper: `Case ${day.n} : ${day.title}. Regarde la tablette !`,
            outing: `Case ${day.n}, une idée de sortie : ${day.title}. ${day.body}`,
        };
        return speech[day.kind] || `Case ${day.n} : ${day.title}.`;
    } catch (err) {
        return `${err.message}.`;
    }
}

briefing.addExtra(async () => adventBriefingLine(getView()));
