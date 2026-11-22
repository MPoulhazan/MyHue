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
import { getWeatherDetails, getForecast, getLocation } from './weather.js';
import * as bixi from './bixi.js';
import { normalizeIdea, validIdeas, tripTo, weatherCheck, freeLine, FILTERS, matchesFilter } from './outingLogic.js';
import { dayItems, headline, pickOuting, pickSolo, personalSpeech, isDayQuestion } from './myDayLogic.js';
import * as briefing from './briefing.js';
import * as calendar from './calendar.js';
import { freeEvenings, localMidnight } from './calendarLogic.js';
import QRCode from 'qrcode';
import { isTonight, tonightPlan, briefingLine as tonightBriefing, speech as tonightSpeech } from './tonightLogic.js';
import { timeChoices, durationMin, dayChoices, startOf, emailFromIcal, gcalUrl, eventDetails, findPlanEvent, planStatus } from './inviteLogic.js';

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
// disliked = « pas notre genre » (titre et genre), relu par la tâche Claude du mercredi
let store = { mails: {}, outings: { at: null, ideas: [] }, done: [], liked: null, skipped: [], disliked: [], ...readJson(STORE_FILE, {}) };
const saveStore = () => writeJson(STORE_FILE, store);

const clean = (s, max = 400) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

// --- Profils ---

/** Profils sans l'adresse iCal (un secret) : on dit seulement s'il y a un agenda. */
export const getPeople = () => people.map(({ ical, email, ...p }) => ({ ...p, calendar: Boolean(ical), calendarStatus: ical ? calendar.status(p.id) : null }));

/** Branche (ou débranche avec null) l'agenda Google d'une personne par son adresse iCal secrète. */
export const setCalendar = async (personId, url) => {
    const person = people.find((p) => p.id === personId);
    if (!person) throw new Error(`Profil inconnu : ${personId}`);
    if (url && !calendar.isCalendarUrl(url)) throw new Error('Adresse iCal invalide : elle commence par https:// et finit par .ics');
    person.ical = url ? url.trim() : null;
    writeJson(PEOPLE_FILE, people);
    if (person.ical) await calendar.refresh(person.id);
    else calendar.forget(person.id);
    journal.log({ kind: 'system', title: `Ma journée : agenda ${person.ical ? 'branché' : 'débranché'}`, data: { person: personId } });
    return getPeople().find((p) => p.id === personId);
};

export const start = () => {
    calendar.start(() => people);
    // Briefing du salon : l'agenda de la personne seule à la maison (ou du premier profil), sans les expéditeurs
    briefing.addExtra(() => personalLines(defaultPerson().id, { details: false }));
    // Le jour d'une sortie : l'heure de départ et Cooper, dans le briefing de 8 h 30
    briefing.addExtra(async () => tonightBriefing(await tonightView(), TZ));
};

const todayEvents = (person) => (person.ical ? calendar.eventsBetween(person.id, Date.now(), localMidnight(Date.now()) + 86_400_000) : []);
const freshMails = (person) => {
    const m = person.mails ? store.mails[person.id] : null;
    return m && Date.now() - m.at < MAIL_MAX_AGE_MS ? m : null;
};

/** L'agenda, les mails et la sortie d'une personne, en phrases. */
export const personalLines = (personId, { details = true } = {}) => {
    const person = people.find((p) => p.id === personId) || people[0];
    return personalSpeech({ name: person.name, events: todayEvents(person), mails: freshMails(person), outing: pickOuting(store, Date.now(), TZ), details, tz: TZ });
};

/** Le briefing complet d'une personne : elle, puis la maison (météo, Flex D, ville, ciel, courrier). */
export const briefingFor = async (personId) => {
    const person = people.find((p) => p.id === personId) || people[0];
    const hour = Number(new Date().toLocaleTimeString('fr-CA', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).slice(0, 2));
    const house = await briefing.preview({ personal: false }).catch(() => '');
    const rest = house.replace(/^Bonjour ! /, '').replace(/ Bonne journée !$/, '');
    return `${hour >= 17 ? 'Bonsoir' : 'Bonjour'} ${person.name}. ${personalLines(person.id)} ${rest} ${hour >= 17 ? 'Bonne soirée !' : 'Bonne journée !'}`.replace(/\s+/g, ' ').trim();
};

/** Réponse de Jean-Claude à « C'est quoi ma journée ? » (null si ce n'est pas la question). */
export const voiceAnswer = async (text, personId = null) => {
    if (!isDayQuestion(text)) return null;
    const id = personId && people.some((p) => p.id === personId) ? personId : defaultPerson().id;
    if (/sortie|ce soir|week.?end|samedi|vendredi|jeudi|mercredi|on part/i.test(text) && !/journ[ée]e|briefing/i.test(text)) {
        // Une sortie prévue ce soir : son programme plutôt qu'une nouvelle idée
        const tonight = /ce soir|on part|partir/i.test(text) || !/week.?end|samedi|vendredi|jeudi|mercredi/i.test(text) ? await tonightView().catch(() => null) : null;
        if (tonight) return tonightSpeech(tonight, TZ);
        if (/on part|partir/i.test(text)) return 'Aucune sortie n’est prévue ce soir.';
        const o = pickOuting(store, Date.now(), TZ);
        return o ? personalSpeech({ events: [], mails: null, outing: o, tz: TZ }).replace(/^.*?Une idée/, 'Une idée') : 'Je n’ai pas encore d’idée de sortie cette semaine. Elles arrivent le mercredi matin.';
    }
    return briefingFor(id);
};

export const setPeople = (list) => {
    if (!Array.isArray(list) || !list.length || list.length > 4) throw new Error('Entre 1 et 4 profils');
    people = list.map((p, i) => ({
        id: clean(p.id, 24) || `p${i + 1}`,
        name: clean(p.name, 40) || `Personne ${i + 1}`,
        initial: (clean(p.initial, 2) || clean(p.name, 1) || String(i + 1)).toUpperCase(),
        color: COLORS.includes(p.color) ? p.color : COLORS[i % COLORS.length],
        haPerson: clean(p.haPerson, 80) || null,
        mails: Boolean(p.mails),
        ical: people.find((old) => old.id === (clean(p.id, 24) || `p${i + 1}`))?.ical ?? null,
        email: people.find((old) => old.id === (clean(p.id, 24) || `p${i + 1}`))?.email ?? null,
    }));
    writeJson(PEOPLE_FILE, people);
    return getPeople();
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
 * Champs : voir normalizeIdea (outingLogic.js) et le schéma de set_outing_ideas (mcpServer.js).
 */
export const setOutings = (ideas) => {
    if (!Array.isArray(ideas)) throw new Error('ideas doit être une liste');
    const now = Date.now();
    const ids = people.map((p) => p.id);
    store.outings = {
        at: now,
        ideas: ideas.slice(0, 12).map((o, i) => normalizeIdea(o || {}, i, ids, now)).filter((o) => o.title),
    };
    store.skipped = [];
    saveStore();
    journal.log({ kind: 'system', title: `Ma journée : ${store.outings.ideas.length} idées de sortie déposées` });
    return store.outings;
};

/** Réaction sur une idée : like (ça nous tente), next (autre idée), done (déjà fait), dislike (pas notre genre). */
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
    } else if (action === 'dislike') {
        store.disliked = [...(store.disliked || []).filter((d) => d.title !== idea.title), { title: idea.title, kind: idea.kind, why: idea.why }].slice(-50);
        store.skipped.push(id);
        journal.log({ kind: 'system', title: `Sortie écartée (pas notre genre) : ${idea.title}` });
    } else {
        throw new Error(`Action inconnue : ${action}`);
    }
    saveStore();
    return { ok: true };
};

/** L'idée d'activité du jour de repos d'une personne (ou null). */
export const soloIdea = (personId) => pickSolo(store, personId, Date.now(), TZ)?.idea || null;

// Les jours de repos de chacun (réglés dans commute.json), pour que la tâche Claude prévoie une activité
let restDays = () => [];
export const setRestDaysProvider = (fn) => (restDays = fn);

/** Contexte pour la tâche Claude : profils, sorties déjà faites, jours où on sort. */
export const getContextForClaude = () => ({
    people: people.map(({ id, name, mails, ical }) => ({ id, name, mails, calendar: Boolean(ical) })),
    // Soirées du mercredi au samedi : libres ou prises, d'après les agendas branchés
    evenings: freeEvenings(people.filter((p) => p.ical).map((p) => ({ id: p.id, name: p.name, events: calendar.eventsBetween(p.id, Date.now(), Date.now() + 8 * 86_400_000) }))),
    outings: {
        rules: 'Sorties à deux sur l’île de Montréal seulement (pas Laval ni Longueuil). Jamais dimanche, lundi ni mardi soir : proposer du mercredi au samedi.',
        details: 'Pour chaque idée, remplir autant que possible : price (« 13,50 $/pers. », « Gratuit », « $$ » pour un resto), free, duration, times (séances ou heures du soir), address, lat et lon (coordonnées du lieu, pour le trajet), image (https, affiche ou photo du lieu), bookingUrl (billetterie ou réservation), indoor (false si en plein air), trailer (id YouTube de la bande-annonce officielle d’un film, ou d’un extrait pour un concert), artist (concert : nom de l’artiste), photos (expo, resto, activité : 2 à 5 adresses https directes de photos). Kinds : event, cinema, concert, museum, resto, activity. Ne rien inventer : laisser vide si introuvable.',
        alreadyDone: store.done.slice(-50),
        liked: store.liked?.title || null,
        // « Pas notre genre » : éviter ce style d'idée les semaines suivantes
        notOurThing: (store.disliked || []).slice(-20),
        current: store.outings.ideas.map((o) => o.title),
        // Jours de repos : 1 ou 2 idées d'activité de jour pour la personne seule (champ person, date du jour)
        restDays: restDays(),
        restRules: 'Pour chaque jour de repos de la semaine qui vient, 1 ou 2 idées d’activité de JOUR pour cette personne seule : champ person = son id, date = ce jour-là. Île de Montréal, faisable sans auto (métro, bus, BIXI, à pied), adaptée à la météo de saison.',
    },
    mails: 'Importants = tout sauf le spam, la pub, les infolettres et les promotions. 3 au plus par personne, avec un brouillon de réponse dans Gmail quand une réponse est attendue.',
});

/** Une idée de sortie déposée, par son id (ou null). */
export const findIdea = (id) => store.outings.ideas.find((o) => o.id === id) || null;

// --- L'invitation Google Agenda (une sortie prévue à la fois) ---

// Adresse Gmail d'un profil : réglée à la main, sinon tirée de son adresse iCal secrète. Jamais renvoyée par l'API.
const emailOf = (p) => (p?.email || emailFromIcal(p?.ical) || null);
const otherThan = (id) => people.find((p) => p.id !== id) || null;
const short = (p) => p && { id: p.id, name: p.name, initial: p.initial, color: p.color };

/** Ce qu'il faut pour remplir la feuille d'invitation : soirs, heures, qui invite qui. */
export const inviteOptions = (ideaId) => {
    const idea = store.outings.ideas.find((o) => o.id === ideaId);
    if (!idea) throw new Error('Idée inconnue');
    const now = Date.now();
    const withCal = people.filter((p) => p.ical);
    const evenings = freeEvenings(withCal.map((p) => ({ id: p.id, name: p.name, events: calendar.eventsBetween(p.id, now, now + 8 * 86_400_000) })), now, TZ);
    return {
        idea: { id: idea.id, title: idea.title, kind: idea.kind, where: idea.address || idea.where, date: idea.date },
        days: dayChoices(idea, evenings, now, TZ),
        times: timeChoices(idea),
        people: people.map((p) => ({ ...short(p), guestEmail: Boolean(emailOf(otherThan(p.id))) })),
    };
};

/** Règle l'adresse Gmail d'un profil (pour l'inviter). Gardée seulement dans data/people.json. */
export const setEmail = (personId, email) => {
    const person = people.find((p) => p.id === personId);
    if (!person) throw new Error(`Profil inconnu : ${personId}`);
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (e && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) throw new Error('Adresse courriel invalide');
    person.email = e || null;
    writeJson(PEOPLE_FILE, people);
    return { ok: true };
};

const qrOf = (url) => QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#141513', light: '#ffffff' } });

/**
 * « Ça nous tente » : prévoit la sortie et fabrique le lien Google Agenda (et son QR code)
 * que la personne qui invite scanne avec son téléphone.
 * @param opts { date: 'AAAA-MM-JJ', time: 'HH:MM', by: id du profil qui invite }
 */
export const createInvite = async (ideaId, { date, time, by } = {}) => {
    const idea = store.outings.ideas.find((o) => o.id === ideaId);
    if (!idea) throw new Error('Idée inconnue');
    const inviter = people.find((p) => p.id === by) || people[0];
    const guest = otherThan(inviter.id);
    const start = startOf(idea.date || date, time, TZ);
    if (!start) throw new Error('Choisis un soir et une heure');
    const end = start + durationMin(idea.duration, idea.kind) * 60_000;
    const location = idea.address || idea.where || null;
    const url = gcalUrl({ title: idea.title, start, end, location, details: eventDetails(idea), guest: emailOf(guest) }, TZ);
    // Le lieu est recopié : les idées du mercredi suivant remplacent celles-ci, la sortie prévue reste
    const place = idea.lat != null ? { lat: idea.lat, lon: idea.lon } : null;
    store.plan = { ideaId: idea.id, title: idea.title, kind: idea.kind, where: idea.where, place, start, end, url, by: inviter.id, to: guest?.id ?? null, inviterEmail: emailOf(inviter), guestEmail: emailOf(guest), manual: null, at: Date.now() };
    store.liked = { ...idea, at: Date.now() };
    saveStore();
    journal.log({ kind: 'system', title: `Sortie prévue : ${idea.title}`, data: { start } });
    // L'invité verra l'événement dans quelques minutes : on relit les agendas un peu plus tôt que prévu
    setTimeout(() => calendar.refresh().catch(() => {}), 3 * 60_000).unref?.();
    return { plan: planView(), qr: await qrOf(url) };
};

let lastPlanRefresh = 0;

/** La sortie prévue et où en est l'invitation, ou null (rien de prévu, ou fini depuis plus de 12 h). */
export function planView() {
    const p = store.plan;
    if (!p || p.end < Date.now() - 12 * 3600_000) return null;
    const cals = people.filter((x) => x.ical && (x.id === p.by || x.id === p.to));
    let found = null;
    for (const x of cals) {
        found = findPlanEvent(p, calendar.eventsBetween(x.id, p.start - 3600_000, p.start + 3600_000));
        if (found) break;
    }
    const status = planStatus(p, found, cals.length > 0);
    // En attente d'une réponse : on relit les agendas plus souvent (toutes les 3 min au plus)
    if ((status === 'sent' || status === 'pending') && cals.length && p.start > Date.now() && Date.now() - lastPlanRefresh > 3 * 60_000) {
        lastPlanRefresh = Date.now();
        calendar.refresh().catch(() => {});
    }
    return {
        ideaId: p.ideaId,
        title: p.title,
        kind: p.kind,
        where: p.where,
        start: p.start,
        end: p.end,
        by: short(people.find((x) => x.id === p.by)),
        to: short(people.find((x) => x.id === p.to)),
        status,
        tracked: cals.length > 0,
        guestInvited: Boolean(p.guestEmail),
    };
}

// --- Ce soir à deux (jour J) ---

/**
 * Le programme du soir quand une sortie est prévue aujourd'hui : départ, retour, Cooper, météo.
 * @returns tonightPlan() ou null
 */
export const tonightView = async () => {
    const plan = planView();
    const now = Date.now();
    if (!plan || !isTonight(plan, now, TZ)) return null;
    const place = store.plan.place || (() => {
        const idea = findIdea(store.plan.ideaId);
        return idea?.lat != null ? { lat: idea.lat, lon: idea.lon } : null;
    })();
    const [home, forecast] = await Promise.all([getLocation().catch(() => null), getForecast().catch(() => null)]);
    let trip = null;
    if (home && place) {
        const near = await bixi.stationsAround(home, 500).catch(() => []);
        const ends = await bixi.stationsAround(place, 400).catch(() => []);
        trip = tripTo(home, place, near.find((s) => s.bikes > 0) || null, ends.find((s) => s.docks > 0) || null);
    }
    return { ...tonightPlan({ plan, trip, hours: forecast?.hours || [], now, tz: TZ }), reminded: Boolean(store.plan.remindedAt) };
};

/** Le rappel de départ (Telegram et lampe) est parti : une fois par sortie. */
export const markReminded = () => {
    if (!store.plan) return;
    store.plan.remindedAt = Date.now();
    saveStore();
};

/** Le QR code de l'invitation en cours, pour le revoir. */
export const planQr = async () => (store.plan ? { plan: planView(), qr: await qrOf(store.plan.url) } : null);

/** confirm / decline (réponse donnée de vive voix) ou cancel (on ne sort plus). */
export const updatePlan = (action) => {
    if (!store.plan) throw new Error('Aucune sortie prévue');
    if (action === 'cancel') {
        journal.log({ kind: 'system', title: `Sortie annulée : ${store.plan.title}` });
        store.plan = null;
        store.liked = null;
    } else if (action === 'confirm' || action === 'decline') {
        store.plan.manual = action === 'confirm' ? 'confirmed' : 'declined';
    } else {
        throw new Error(`Action inconnue : ${action}`);
    }
    saveStore();
    return { plan: planView() };
};

// --- La fiche sortie ---

/**
 * Les idées à deux avec ce que la maison sait seule : trajet, vélos, météo du soir, agendas.
 * Les sorties en plein air prévues sous la pluie ou le grand froid sont mises de côté (hidden).
 * @param filter all | tonight | weekend | free | resto | culture (chaque idée porte match)
 */
export const getOutings = async (filter = 'all') => {
    const now = Date.now();
    const f = FILTERS.includes(filter) ? filter : 'all';
    const [home, forecast] = await Promise.all([getLocation().catch(() => null), getForecast().catch(() => null)]);
    const hours = forecast?.hours || [];
    const withCal = people.filter((p) => p.ical);
    const evenings = freeEvenings(withCal.map((p) => ({ id: p.id, name: p.name, events: calendar.eventsBetween(p.id, now, now + 8 * 86_400_000) })), now, TZ);
    // Station de départ : la plus proche de la maison qui a un vélo classique
    const near = home ? await bixi.stationsAround(home, 500).catch(() => []) : [];
    const start = near.find((s) => s.bikes > 0) || null;

    const ideas = [];
    const hidden = [];
    for (const idea of validIdeas(store, now, TZ)) {
        const w = weatherCheck(idea, hours, now, TZ);
        if (w?.hide) {
            hidden.push({ id: idea.id, title: idea.title, reason: w.reason });
            continue;
        }
        let trip = null;
        if (home && idea.lat != null) {
            const ends = await bixi.stationsAround({ lat: idea.lat, lon: idea.lon }, 400).catch(() => []);
            const end = ends.find((s) => s.docks > 0) || null;
            trip = tripTo(home, idea, start, end);
            if (trip) trip.end = end && { lat: end.lat, lon: end.lon, name: end.name, docks: end.docks };
        }
        ideas.push({ ...idea, free: idea.free === true, trip, freeLine: freeLine(idea, evenings, withCal.length), match: matchesFilter(idea, f, now, TZ) });
    }
    return {
        at: store.outings.at,
        filter: f,
        home: home && { lat: home.lat, lon: home.lon },
        start: start && { lat: start.lat, lon: start.lon, name: start.name, bikes: start.bikes },
        liked: store.liked?.id || null,
        plan: planView(),
        ideas,
        hidden,
    };
};

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
        events: todayEvents(person),
    };
    const things = dayItems(facts);
    const mailEntry = person.mails ? store.mails[person.id] : null;
    const mails = mailEntry && Date.now() - mailEntry.at < MAIL_MAX_AGE_MS ? mailEntry : null;
    const cooperView = cooper.getView();
    return {
        person: getPeople().find((p) => p.id === person.id),
        people: getPeople(),
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
        outing: pickSolo(store, person.id, Date.now(), TZ) || pickOuting(store, Date.now(), TZ),
        plan: planView(),
        tonight: await tonightView().catch(() => null),
        liked: store.liked,
        touch: cooperView?.line ? { who: 'Cooper', line: cooperView.line } : null,
    };
};
