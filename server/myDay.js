/**
 * « Ma journée » : le check-up du matin, une page par personne sur la tablette.
 *
 * Trois choses au plus (le reste se tait), une phrase d'accroche, les mails importants
 * et une idée de sortie à deux. Les faits de la maison viennent des modules existants ;
 * les mails et les idées de sortie sont déposés chaque matin par une tâche Claude
 * (connecteurs Gmail + MyHue MCP), puisque MyHue ne peut pas appeler Claude lui-même.
 *
 * Les prénoms ne sont jamais dans le code (dépôt public) : seulement dans data/people.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as presence from './presence.js';
import * as flexd from './flexd.js';
import * as collecte from './collecte.js';
import * as cooper from './cooper.js';
import * as mailbox from './mailbox.js';
import * as city from './city.js';
import { getWeatherDetails } from './weather.js';
import { dayItems, headline, pickOuting } from './myDayLogic.js';

const PEOPLE_FILE = dataFile('people.json');
const STORE_FILE = dataFile('myday.json');
const TZ = process.env.TZ || 'America/Toronto';
// Au-delà, un tri de mails est périmé (celui d'hier)
const MAIL_MAX_AGE_MS = 20 * 3600_000;

const DEFAULT_PEOPLE = [
    { id: 'p1', name: 'Personne 1', initial: '1', color: 'blue', haPerson: null, mails: true },
    { id: 'p2', name: 'Personne 2', initial: '2', color: 'amber', haPerson: null, mails: false },
];
const COLORS = ['blue', 'amber', 'green', 'pink'];

const readJson = (file, fallback) => {
    try {
        return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
    } catch (err) {
        console.error(`❌ ${file} illisible:`, err.message);
        return fallback;
    }
};
const writeJson = (file, value) => {
    try {
        writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    } catch (err) {
        console.error(`❌ Sauvegarde impossible (${file}):`, err.message);
    }
};

let people = readJson(PEOPLE_FILE, DEFAULT_PEOPLE);
// mails[personId] = { at, items }, outings = { at, ideas }, done = titres déjà faits, liked = idée retenue
let store = { mails: {}, outings: { at: null, ideas: [] }, done: [], liked: null, skipped: [], ...readJson(STORE_FILE, {}) };
const saveStore = () => writeJson(STORE_FILE, store);

const clean = (s, max = 400) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

// --- Profils ---

export const getPeople = () => people;

export const setPeople = (list) => {
    if (!Array.isArray(list) || !list.length || list.length > 4) throw new Error('Entre 1 et 4 profils');
    people = list.map((p, i) => ({
        id: clean(p.id, 24) || `p${i + 1}`,
        name: clean(p.name, 40) || `Personne ${i + 1}`,
        initial: (clean(p.initial, 2) || clean(p.name, 1) || String(i + 1)).toUpperCase(),
        color: COLORS.includes(p.color) ? p.color : COLORS[i % COLORS.length],
        haPerson: clean(p.haPerson, 80) || null,
        mails: Boolean(p.mails),
    }));
    writeJson(PEOPLE_FILE, people);
    return people;
};

/** Profil proposé par défaut : la seule personne suivie qui est à la maison, sinon le premier. */
export const defaultPerson = () => {
    const tracked = presence.getPeople();
    const home = people.filter((p) => p.haPerson && tracked.find((t) => t.entity === p.haPerson)?.home);
    return { id: (home.length === 1 ? home[0] : people[0]).id, reason: home.length === 1 ? 'home' : 'first' };
};

// --- Ce que dépose la tâche Claude ---

/**
 * Mails importants d'une personne, triés par Claude (spam et pub exclus).
 * @param items [{ from, subject, summary, receivedAt?, draft?, draftUrl?, threadUrl? }]
 */
export const setMails = (personId, items) => {
    if (!people.some((p) => p.id === personId)) throw new Error(`Profil inconnu : ${personId}`);
    if (!Array.isArray(items)) throw new Error('items doit être une liste');
    store.mails[personId] = {
        at: Date.now(),
        total: null,
        items: items.slice(0, 5).map((m, i) => ({
            id: `m${Date.now()}-${i}`,
            from: clean(m.from, 80),
            subject: clean(m.subject, 160),
            summary: clean(m.summary, 300),
            receivedAt: Number.isFinite(Date.parse(m.receivedAt)) ? Date.parse(m.receivedAt) : null,
            draft: clean(m.draft, 1200) || null,
            draftUrl: /^https:\/\/mail\.google\.com\//.test(m.draftUrl || '') ? m.draftUrl : null,
            threadUrl: /^https:\/\/mail\.google\.com\//.test(m.threadUrl || '') ? m.threadUrl : null,
        })),
    };
    saveStore();
    journal.log({ kind: 'system', title: `Ma journée : ${items.length} mail(s) importants déposés`, data: { person: personId } });
    return store.mails[personId];
};

/**
 * Idées de sortie à deux (la tâche Claude les cherche sur le Web chaque semaine).
 * @param ideas [{ kind: event|museum|resto|activity, title, when?, where?, why?, url?, date? }]
 */
export const setOutings = (ideas) => {
    if (!Array.isArray(ideas)) throw new Error('ideas doit être une liste');
    const kinds = ['event', 'museum', 'resto', 'activity'];
    store.outings = {
        at: Date.now(),
        ideas: ideas.slice(0, 12).map((o, i) => ({
            id: `o${Date.now()}-${i}`,
            kind: kinds.includes(o.kind) ? o.kind : 'activity',
            title: clean(o.title, 140),
            when: clean(o.when, 80) || null,
            where: clean(o.where, 120) || null,
            why: clean(o.why, 300) || null,
            url: /^https?:\/\//.test(o.url || '') ? o.url : null,
            date: /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : null,
        })).filter((o) => o.title),
    };
    store.skipped = [];
    saveStore();
    journal.log({ kind: 'system', title: `Ma journée : ${store.outings.ideas.length} idées de sortie déposées` });
    return store.outings;
};

/** Réaction sur une idée : like (ça nous tente), next (autre idée), done (déjà fait). */
export const reactOuting = (id, action) => {
    const idea = store.outings.ideas.find((o) => o.id === id);
    if (!idea) throw new Error('Idée inconnue');
    if (action === 'like') {
        store.liked = { ...idea, at: Date.now() };
        journal.log({ kind: 'system', title: `Sortie retenue : ${idea.title}` });
    } else if (action === 'done') {
        store.done = [...store.done.filter((t) => t !== idea.title), idea.title].slice(-200);
        store.skipped.push(id);
    } else if (action === 'next') {
        store.skipped.push(id);
    } else {
        throw new Error(`Action inconnue : ${action}`);
    }
    saveStore();
    return { ok: true };
};

/** Contexte pour la tâche Claude : profils, sorties déjà faites, jours où on sort. */
export const getContextForClaude = () => ({
    people: people.map(({ id, name, mails }) => ({ id, name, mails })),
    outings: {
        rules: 'Sorties à deux sur l’île de Montréal seulement (pas Laval ni Longueuil). Jamais dimanche, lundi ni mardi soir : proposer du mercredi au samedi.',
        alreadyDone: store.done.slice(-50),
        liked: store.liked?.title || null,
        current: store.outings.ideas.map((o) => o.title),
    },
    mails: 'Importants = tout sauf le spam, la pub, les infolettres et les promotions. 3 au plus par personne, avec un brouillon de réponse dans Gmail quand une réponse est attendue.',
});

// --- La page ---

const localDay = (ts = Date.now()) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });

export const getDay = async (personId) => {
    const person = people.find((p) => p.id === personId) || people[0];
    const weather = await getWeatherDetails().catch(() => null);
    const facts = {
        weather,
        flex: flexd.getStatus(),
        collecte: collecte.getView(),
        mailbox: mailbox.getView(),
        cityLine: city.briefingLine(),
        today: localDay(),
        dayOf: localDay,
    };
    const things = dayItems(facts);
    const mailEntry = person.mails ? store.mails[person.id] : null;
    const mails = mailEntry && Date.now() - mailEntry.at < MAIL_MAX_AGE_MS ? mailEntry : null;
    const cooperView = cooper.getView();
    return {
        person,
        people,
        default: defaultPerson(),
        date: Date.now(),
        weather: weather && {
            temp: Math.round(weather.current.temp),
            feels: Math.round(weather.current.feels),
            rainAt: things.rainAt ?? null,
        },
        headline: headline(weather, things.items, Date.now(), TZ),
        things: things.items,
        mails: person.mails ? (mails ? { at: mails.at, items: mails.items } : { at: null, items: [] }) : null,
        outing: pickOuting(store, Date.now(), TZ),
        liked: store.liked,
        touch: cooperView?.line ? { who: 'Cooper', line: cooperView.line } : null,
    };
};
