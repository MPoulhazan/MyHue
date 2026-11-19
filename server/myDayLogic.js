/**
 * Logique pure de « Ma journée » (testée dans myDayLogic.test.js) : quelles choses
 * méritent la page, la phrase d'accroche, l'idée de sortie à montrer.
 */

export const MAX_THINGS = 3;

const NUMBERS = ['Rien', 'Une', 'Deux', 'Trois'];
const deg = (n) => `${Math.round(n) < 0 ? '−' : ''}${Math.abs(Math.round(n))}°`;
const hourOf = (ts, tz) => Number(new Date(ts).toLocaleTimeString('fr-CA', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).slice(0, 2));
const hhmm = (ts, tz) => new Date(ts).toLocaleTimeString('fr-CA', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).replace(':', ' h ').replace(' h 00', ' h');

/**
 * Les choses à retenir, par ordre d'importance, coupées à 3.
 * @param f { weather, flex, collecte, mailbox, cityLine, today, dayOf, tz }
 * @returns {{ items: {kind, title, detail}[], rainAt: number|null }}
 */
export const dayItems = (f) => {
    const tz = f.tz || 'America/Toronto';
    const items = [];
    const w = f.weather;

    const s = w?.storm;
    if (s && (s.level === 'likely' || s.level === 'storm')) {
        items.push({ kind: 'storm', title: 'Tempête probable', detail: `Rafales jusqu’à ${s.maxGust} km/h${s.window ? `, à partir de ${hhmm(s.window.from, tz)}` : ''}` });
    }

    // L'agenda d'abord : ce sont les choses à soi
    const now = f.now ?? Date.now();
    for (const e of (f.events || []).filter((x) => x.end > now)) {
        const where = e.location ? ` · ${e.location.split(',')[0]}` : '';
        if (e.allDay) items.push({ kind: 'event', title: e.title, detail: `Toute la journée${where}` });
        else if (e.start <= now) items.push({ kind: 'event', title: e.title, detail: `En cours, jusqu’à ${hhmm(e.end, tz)}${where}` });
        else items.push({ kind: 'event', title: `${e.title} à ${hhmm(e.start, tz)}`, detail: e.location ? e.location.split(',')[0] : `Jusqu’à ${hhmm(e.end, tz)}` });
    }

    const peaks = (f.flex?.enabled ? f.flex.upcoming || [] : []).filter((e) => !e.skipped && f.dayOf(e.start) === f.today && e.end > Date.now());
    for (const e of peaks) {
        items.push({ kind: 'flex', title: `Pointe Flex D ${hhmm(e.start, tz)}–${hhmm(e.end, tz)}`, detail: 'Évite la sécheuse, le lave-vaisselle et le four' });
    }

    const t = f.collecte?.tonight;
    if (t && !t.done && !t.stopped) items.push({ kind: 'bin', title: `${t.label} ce soir`, detail: 'Sors le bac avant de dormir' });

    let rainAt = null;
    const wet = (w?.outfits || []).filter((o) => o.day === 'today' && !o.past && o.rainProb >= 50);
    if (wet.length) {
        rainAt = wet[0].hour;
        items.push({ kind: 'rain', title: 'Prends le parapluie', detail: `Pluie probable vers ${wet[0].hour} h (${wet[0].rainProb} %)` });
    }

    if (f.mailbox?.waiting) items.push({ kind: 'mail', title: 'Du courrier t’attend', detail: 'Le facteur est passé' });

    if (f.cityLine) items.push({ kind: 'city', title: 'En ville', detail: f.cityLine });

    return { items: items.slice(0, MAX_THINGS), rainAt };
};

/** Bonjour selon l'heure, puis le nombre de choses et la température. */
export const headline = (w, items, now = Date.now(), tz = 'America/Toronto') => {
    const h = hourOf(now, tz);
    const greeting = h < 11 ? 'Bon matin' : h < 17 ? 'Bon après-midi' : 'Bonsoir';
    const lead = items.length ? `${NUMBERS[items.length]} chose${items.length > 1 ? 's' : ''} à retenir aujourd’hui.` : 'Journée tranquille, rien à signaler.';
    const temp = w?.current ? ` ${deg(w.current.temp)} dehors, ressenti ${deg(w.current.feels)}.` : '';
    return { greeting, text: `${lead}${temp}` };
};

/**
 * Première idée de sortie encore valable : ni écartée, ni déjà faite, ni passée.
 * @returns {{ idea, left: number } | null}
 */
export const pickOuting = (store, now = Date.now(), tz = 'America/Toronto') => {
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: tz });
    const done = new Set(store.done || []);
    const skipped = new Set(store.skipped || []);
    const valid = (store.outings?.ideas || []).filter((o) => !skipped.has(o.id) && !done.has(o.title) && (!o.date || o.date >= today));
    return valid.length ? { idea: valid[0], left: valid.length - 1 } : null;
};

// --- Briefing personnel, lu à voix haute ---

/** « 14 h 30 » → « 14 heures 30 », pour la synthèse vocale. */
export const sayable = (text) => text.replace(/(\d{1,2}) h (\d{2})/g, '$1 heures $2').replace(/(\d{1,2}) h\b/g, '$1 heures');

const sayHour = (ts, tz) => sayable(hhmm(ts, tz));
const joinFr = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}`);

/**
 * Ce que Jean-Claude dit à une personne : son agenda, ses mails, l'idée de sortie.
 * @param d { name, events, mails: {at, items}|null, outing, now, tz, details }
 *   details = false pour l'enceinte du salon : le nombre de mails, sans les expéditeurs
 */
export const personalSpeech = (d) => {
    const tz = d.tz || 'America/Toronto';
    const now = d.now ?? Date.now();
    const parts = [];
    const events = (d.events || []).filter((e) => e.end > now);
    const timed = events.filter((e) => !e.allDay);
    const allDay = events.filter((e) => e.allDay);
    if (!events.length) {
        parts.push(hourOf(now, tz) >= 17 ? 'Plus rien à ton agenda aujourd’hui.' : 'Rien à ton agenda aujourd’hui.');
    } else {
        const said = timed.slice(0, 3).map((e) => (e.start <= now ? `${e.title}, en cours jusqu’à ${sayHour(e.end, tz)}` : `${e.title} à ${sayHour(e.start, tz)}`));
        if (timed.length === 1) parts.push(`À ton agenda : ${said[0]}.`);
        else if (timed.length > 1) parts.push(`Tu as ${timed.length} rendez-vous : ${joinFr(said)}${timed.length > 3 ? ', entre autres' : ''}.`);
        if (allDay.length) parts.push(`Aujourd’hui aussi : ${joinFr(allDay.slice(0, 2).map((e) => e.title))}.`);
    }
    if (d.mails?.at) {
        const items = d.mails.items || [];
        if (!items.length) parts.push('Pas de mail important.');
        else {
            const n = items.length === 1 ? 'Un mail important' : `${NUMBERS[Math.min(items.length, 3)]} mails importants`;
            parts.push(d.details === false ? `${n}.` : `${n} : ${joinFr(items.slice(0, 3).map((m) => `de ${m.from}`))}.`);
            if (items.some((m) => m.draft)) parts.push(items.filter((m) => m.draft).length > 1 ? 'Les réponses sont prêtes dans tes brouillons.' : 'Une réponse est prête dans tes brouillons.');
        }
    }
    if (d.outing?.idea && d.details !== false) {
        const o = d.outing.idea;
        parts.push(`Une idée pour vous deux : ${o.title}${o.when ? `, ${sayable(o.when.toLowerCase())}` : ''}.`);
    }
    return parts.join(' ');
};

/** « C'est quoi ma journée ? », « Mon briefing », « Qu'est-ce qu'on fait samedi ? » */
export const isDayQuestion = (text) =>
    /\b(ma journ[ée]e|mon (briefing|programme|planning|agenda)|mon check.?up|qu.?est.?ce que j.?ai aujourd|on fait quoi (ce soir|ce week.?end|samedi|vendredi)|qu.?est.?ce qu.?on fait (ce soir|ce week.?end|samedi|vendredi|jeudi|mercredi)|une id[ée]e de sortie)\b/i.test(text);
