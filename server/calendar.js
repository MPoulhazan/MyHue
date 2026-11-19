/**
 * Agendas Google des profils « Ma journée », lus par leur adresse iCal secrète
 * (Google Agenda › Paramètres › Intégrer l'agenda). Relu toutes les 10 minutes.
 * L'adresse est un secret : elle reste dans data/people.json et ne sort jamais de l'API.
 */
import axios from 'axios';
import ical from 'node-ical';
import { calendarEvents, localMidnight } from './calendarLogic.js';

const POLL_MS = 10 * 60_000;
const WINDOW_DAYS = 9;

// personId -> { at, events, error }
const cache = new Map();
let getPeople = () => [];

/** Une adresse iCal acceptable : https et un fichier .ics (Google : …/basic.ics). */
export const isCalendarUrl = (url) => typeof url === 'string' && /^https:\/\/[^\s]+\.ics(\?[^\s]*)?$/.test(url.trim());

const fetchPerson = async (person, now = Date.now()) => {
    try {
        const { data } = await axios.get(person.ical, { timeout: 15_000, responseType: 'text', maxContentLength: 10_000_000 });
        const parsed = ical.sync.parseICS(data);
        const from = localMidnight(now);
        const events = calendarEvents(parsed, from, from + WINDOW_DAYS * 86_400_000, (ev, range) => ical.expandRecurringEvent(ev, range));
        cache.set(person.id, { at: now, events, error: null });
    } catch (err) {
        const prev = cache.get(person.id);
        // On garde les derniers événements connus : un agenda injoignable ne vide pas la page
        cache.set(person.id, { at: prev?.at ?? null, events: prev?.events ?? [], error: err.response?.status ? `HTTP ${err.response.status}` : err.message });
        console.warn(`[Agenda] ${person.id} :`, cache.get(person.id).error);
    }
};

export const refresh = async (personId = null) => {
    const people = getPeople().filter((p) => p.ical && (!personId || p.id === personId));
    await Promise.all(people.map((p) => fetchPerson(p)));
};

export const forget = (personId) => cache.delete(personId);

/** Événements d'une personne qui touchent [from, to[. */
export const eventsBetween = (personId, from, to) =>
    (cache.get(personId)?.events || []).filter((e) => e.start < to && e.end > from);

export const status = (personId) => {
    const c = cache.get(personId);
    return c ? { at: c.at, error: c.error, count: c.events.length } : null;
};

export const start = (peopleGetter) => {
    getPeople = peopleGetter;
    refresh().catch(() => {});
    setInterval(() => refresh().catch(() => {}), POLL_MS).unref?.();
};
