/**
 * Logique pure des agendas (testée dans calendarLogic.test.js) : événements à plat,
 * jours locaux, soirées libres pour les idées de sortie.
 */

export const TZ = process.env.TZ || 'America/Toronto';
const DAY = 86_400_000;

const partsOf = (ts, tz) => {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, Number(x.value)]));
    return p;
};
const offsetAt = (ts, tz) => {
    const p = partsOf(ts, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
};

/** Minuit local (fuseau tz) du jour qui contient ts. */
export const localMidnight = (ts, tz = TZ) => {
    const p = partsOf(ts, tz);
    const guess = Date.UTC(p.year, p.month - 1, p.day);
    // Deux passes : l'écart peut changer au passage à l'heure d'été
    let t = guess - offsetAt(guess, tz);
    t = guess - offsetAt(t, tz);
    return t;
};

/** Instant local « jour de ts, à hh:mm ». */
export const localAt = (ts, hour, minute = 0, tz = TZ) => {
    const p = partsOf(ts, tz);
    const guess = Date.UTC(p.year, p.month - 1, p.day, hour, minute);
    let t = guess - offsetAt(guess, tz);
    t = guess - offsetAt(t, tz);
    return t;
};

export const weekdayOf = (ts, tz = TZ) => {
    const p = partsOf(ts, tz);
    return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
};

const allDayStart = (d) => {
    // Un événement « toute la journée » est une date sans heure : minuit local de cette date
    const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    return localMidnight(day);
};

/**
 * Met à plat les VEVENT d'un agenda analysé par node-ical sur [from, to[.
 * @param expand (event, {from, to}) => occurrences, pour les événements récurrents
 */
export const calendarEvents = (parsed, from, to, expand) => {
    const out = [];
    for (const ev of Object.values(parsed || {})) {
        if (ev?.type !== 'VEVENT' || !ev.start) continue;
        if (String(ev.status || '').toUpperCase() === 'CANCELLED') continue;
        const allDay = ev.datetype === 'date' || ev.start.dateOnly === true;
        const occurrences = ev.rrule
            ? expand(ev, { from: new Date(from - DAY), to: new Date(to + DAY) }).map((o) => ({ start: o.start, end: o.end, summary: o.summary ?? ev.summary, location: o.event?.location ?? ev.location }))
            : [{ start: ev.start, end: ev.end || ev.start, summary: ev.summary, location: ev.location }];
        for (const o of occurrences) {
            const start = allDay ? allDayStart(new Date(o.start)) : new Date(o.start).getTime();
            let end = allDay ? allDayStart(new Date(o.end || o.start)) : new Date(o.end || o.start).getTime();
            if (allDay && end <= start) end = start + DAY;
            if (!Number.isFinite(start) || start >= to || end <= from) continue;
            const text = (v) => (typeof v === 'string' ? v : v?.val ?? '').trim();
            const item = { title: text(o.summary) || 'Sans titre', start, end: Math.max(end, start), allDay, location: text(o.location) || null };
            // Invités et réponses (Oui / Non / pas encore) : sert à suivre une invitation de sortie
            const attendees = attendeesOf(ev);
            if (attendees.length) item.attendees = attendees;
            out.push(item);
        }
    }
    return out.sort((a, b) => a.start - b.start);
};

/** Les invités d'un VEVENT node-ical : [{ email, partstat }] (ACCEPTED, DECLINED, TENTATIVE, NEEDS-ACTION). */
export const attendeesOf = (ev) =>
    [ev?.attendee].flat().filter(Boolean).map((a) => ({
        email: String(typeof a === 'string' ? a : a.val || '').replace(/^mailto:/i, '').trim().toLowerCase(),
        partstat: String(a?.params?.PARTSTAT || 'NEEDS-ACTION').toUpperCase(),
    })).filter((a) => a.email.includes('@'));

/**
 * Soirées (17 h – 23 h) du mercredi au samedi des 7 prochains jours, avec qui est pris.
 * @param people [{ id, name, events }]  (seulement ceux qui ont un agenda)
 */
export const freeEvenings = (people, now = Date.now(), tz = TZ) => {
    const out = [];
    for (let d = 0; d < 7; d++) {
        const day = localMidnight(now, tz) + d * DAY + 12 * 3600_000;
        const wd = weekdayOf(day, tz);
        if (wd < 3) continue; // dimanche, lundi, mardi : on ne sort pas
        const from = localAt(day, 17, 0, tz);
        const to = localAt(day, 23, 0, tz);
        if (to < now) continue;
        const busy = people.filter((p) => p.events.some((e) => !e.allDay && e.start < to && e.end > from)).map((p) => p.name);
        out.push({ date: new Date(day).toLocaleDateString('en-CA', { timeZone: tz }), free: busy.length === 0, busy });
    }
    return out;
};
