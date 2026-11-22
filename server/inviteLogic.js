/**
 * Invitation Google Agenda pour une sortie à deux (lot 2 de « Sortie à deux v2 ») : décisions pures,
 * testées dans inviteLogic.test.js. MyHue n'écrit pas dans Google Agenda : il fabrique un lien
 * « nouvel événement » prérempli (QR code sur la tablette), puis lit la réponse de l'invité dans
 * les agendas branchés par iCal.
 */
import { localAt, weekdayOf } from './calendarLogic.js';

const DEFAULT_TIMES = ['18:30', '19:00', '19:30', '20:00'];

/** « 19 h et 21 h 15 », « 19h30 », « 20:00 » → ['19:00', '21:15', …] dans l'ordre, sans doublon. */
export const parseTimes = (text) => {
    if (typeof text !== 'string') return [];
    const out = [];
    for (const m of text.matchAll(/\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?/gi)) {
        const t = `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
        if (!out.includes(t)) out.push(t);
    }
    return out.slice(0, 6);
};

/** Les heures proposées : celles des séances, sinon un choix de soirée. */
export const timeChoices = (idea) => {
    // Un spectacle annonce son heure dans « when » ; pour un resto ou un musée ce sont des heures d'ouverture
    const shows = ['event', 'cinema', 'concert'].includes(idea?.kind);
    const t = idea?.times ? parseTimes(idea.times) : shows ? parseTimes(idea?.when || '') : [];
    return t.length ? t : DEFAULT_TIMES;
};

/** « 1 h 52 », « 2 h », « 90 min » → minutes ; sinon une durée raisonnable selon le genre. */
export const durationMin = (text, kind) => {
    const s = typeof text === 'string' ? text : '';
    const hm = s.match(/(\d+)\s*h\s*(\d{1,2})?/i);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
    const min = s.match(/(\d+)\s*min/i);
    if (min) return Number(min[1]);
    return kind === 'resto' ? 120 : kind === 'cinema' ? 130 : 150;
};

/**
 * Les soirs proposés pour une idée sans date : du mercredi au samedi des 7 prochains jours.
 * @param evenings freeEvenings() : [{ date, free, busy }] (peut être vide sans agenda)
 */
export const dayChoices = (idea, evenings = [], now = Date.now(), tz = 'America/Toronto') => {
    if (idea?.date) return [{ date: idea.date, free: evenings.find((e) => e.date === idea.date)?.free ?? null }];
    const out = [];
    for (let d = 0; d < 7; d++) {
        const ts = now + d * 86_400_000;
        if (weekdayOf(ts, tz) < 3) continue;
        const date = new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });
        out.push({ date, free: evenings.find((e) => e.date === date)?.free ?? null });
    }
    return out;
};

/** Instant de « date à hh:mm », heure de Montréal. */
export const startOf = (date, time, tz = 'America/Toronto') => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
    const [h, m] = time.split(':').map(Number);
    return localAt(Date.parse(`${date}T12:00:00Z`), h, m, tz);
};

/** L'adresse Gmail cachée dans une adresse iCal secrète Google (…/calendar/ical/<courriel>/private-…). */
export const emailFromIcal = (url) => {
    const m = typeof url === 'string' ? url.match(/\/calendar\/ical\/([^/]+)\//) : null;
    if (!m) return null;
    const email = decodeURIComponent(m[1]).toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) && !email.endsWith('group.calendar.google.com') ? email : null;
};

const gcalDate = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * Lien Google Agenda « nouvel événement » déjà rempli, avec l'autre en invité.
 * @param e { title, start, end, location, details, guest }
 */
export const gcalUrl = (e, tz = 'America/Toronto') => {
    const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${gcalDate(e.start)}/${gcalDate(e.end)}`, ctz: tz });
    if (e.location) p.set('location', e.location);
    if (e.details) p.set('details', e.details);
    if (e.guest) p.set('add', e.guest);
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
};

/** Le texte de l'événement : pourquoi, billets, et d'où vient l'idée. */
export const eventDetails = (idea) =>
    [idea.why, idea.price ? `Prix : ${idea.price}` : null, idea.bookingUrl ? `Billets : ${idea.bookingUrl}` : idea.url ? `Infos : ${idea.url}` : null, 'Idée de sortie proposée par la tablette de la maison.']
        .filter(Boolean).join('\n');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * L'événement de la sortie dans un agenda branché : même heure (à 10 min près) et un titre qui se ressemble.
 * @param events [{ title, start, attendees? }]
 */
export const findPlanEvent = (plan, events = []) => {
    const want = norm(plan.title).slice(0, 14);
    return events.find((e) => Math.abs(e.start - plan.start) <= 10 * 60_000 && (norm(e.title).includes(want) || want.includes(norm(e.title).slice(0, 14)))) || null;
};

/**
 * Où en est l'invitation.
 * @param plan  { start, end, guestEmail, manual: 'confirmed'|'declined'|null }
 * @param found l'événement retrouvé dans un agenda branché (findPlanEvent), ou null
 * @param tracked true si au moins un agenda branché peut montrer l'événement
 * @returns 'confirmed' | 'declined' | 'pending' (dans l'agenda, pas encore de réponse) | 'sent' (pas encore vu)
 */
export const planStatus = (plan, found, tracked) => {
    if (plan.manual === 'confirmed' || plan.manual === 'declined') return plan.manual;
    if (!found || !tracked) return 'sent';
    const guests = (found.attendees || []).filter((a) => !plan.inviterEmail || a.email !== plan.inviterEmail);
    const guest = (plan.guestEmail && guests.find((a) => a.email === plan.guestEmail)) || guests[0] || null;
    if (!guest) return 'pending';
    if (guest.partstat === 'ACCEPTED') return 'confirmed';
    if (guest.partstat === 'DECLINED') return 'declined';
    return 'pending';
};
