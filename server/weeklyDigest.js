/**
 * Résumé de la semaine, le dimanche soir sur Telegram.
 * Les faits sont calculés ici (journal + historique HA des capteurs), comparés à la
 * semaine d'avant quand on l'a ; Groq ne fait que rédiger en gardant l'inhabituel.
 * Sans Groq, un texte déterministe part quand même.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';
import { groqClient, GROQ_API_KEY, GROQ_MODEL } from './llm.js';
import { getSensors, getSensorHistory } from './sensors.js';
import * as mailbox from './mailbox.js';

const FILE = dataFile('digest.json');
const TZ = process.env.TZ || 'America/Toronto';
const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;

const DEFAULTS = { enabled: true, day: 0, time: '18:00', lastSentDay: null };

let config = { ...DEFAULTS };
try {
    if (existsSync(FILE)) config = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ digest.json illisible, réglages par défaut:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde du résumé impossible:', err.message);
    }
};

const localParts = (ts) => {
    const f = new Intl.DateTimeFormat('fr-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    return {
        day: `${p.year}-${p.month}-${p.day}`,
        hour: Number(p.hour),
        minutes: Number(p.hour) * 60 + Number(p.minute),
        weekday: new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay(),
    };
};
const round1 = (x) => Math.round(x * 10) / 10;
const fmtWhen = (ts) =>
    new Date(ts).toLocaleString('fr-FR', { timeZone: TZ, weekday: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');

// --- Faits (fonctions pures, testées dans weeklyDigest.test.js) ---

/** Portes : ouvertures, temps ouvert, plus longue ouverture, ouvertures de nuit (23 h – 6 h). */
export const doorStats = (entries, from, to, hourOf = (ts) => localParts(ts).hour) => {
    const doors = new Map();
    const sorted = entries.filter((e) => e.kind === 'door' && e.data?.did).sort((a, b) => a.ts - b.ts);
    for (const e of sorted) {
        const name = e.title.split(' : ')[0];
        const d = doors.get(e.data.did) || { name, openings: 0, openMin: 0, longest: null, night: 0, openSince: null };
        doors.set(e.data.did, d);
        if (e.data.isOpen) {
            if (d.openSince == null) d.openSince = e.ts;
            if (e.ts >= from && e.ts < to) {
                d.openings++;
                const h = hourOf(e.ts);
                if (h >= 23 || h < 6) d.night++;
            }
        } else if (d.openSince != null) {
            const start = Math.max(d.openSince, from);
            const end = Math.min(e.ts, to);
            if (end > start) {
                const min = (end - start) / 60_000;
                d.openMin += min;
                if (!d.longest || min > d.longest.min) d.longest = { min: Math.round(min), at: d.openSince };
            }
            d.openSince = null;
        }
    }
    return [...doors.values()].map(({ openSince, ...d }) => ({ ...d, openMin: Math.round(d.openMin), stillOpen: openSince != null }));
};

/** Chauffage et automatismes d'après le journal. */
export const activityStats = (entries, from, to) => {
    const inWeek = entries.filter((e) => e.ts >= from && e.ts < to);
    const heating = inWeek.filter((e) => e.kind === 'heating');
    const automations = {};
    for (const e of inWeek.filter((x) => x.kind === 'automation')) automations[e.title] = (automations[e.title] || 0) + 1;
    return {
        heatingCommands: heating.length,
        heatingOffs: heating.filter((e) => e.data?.state && e.data.state.power === false).length,
        flexPeaks: heating.filter((e) => /Pointe Flex D :/.test(e.title)).length,
        automations: Object.entries(automations).map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count).slice(0, 5),
        companionAlerts: inWeek.filter((e) => e.kind === 'companion').map((e) => e.title).slice(0, 5),
    };
};

/** Mesures d'un capteur sur une période : moyenne, min, max (avec l'instant), heures au-dessus/au-dessous de seuils. */
export const measureStats = (points, prop, from, to) => {
    const pts = points.filter((p) => p[prop] != null && p.ts >= from && p.ts < to);
    if (pts.length < 2) return null;
    let sum = 0;
    let span = 0;
    let min = pts[0];
    let max = pts[0];
    const hours = { above: 0, below: 0 };
    const [hi, lo] = prop === 'humidity' ? [60, 30] : [24, 18];
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const dt = Math.min((pts[i + 1]?.ts ?? to) - p.ts, 3 * 3600_000); // un trou de mesures ne compte pas plus de 3 h
        sum += p[prop] * dt;
        span += dt;
        if (p[prop] < min[prop]) min = p;
        if (p[prop] > max[prop]) max = p;
        if (p[prop] > hi) hours.above += dt / 3600_000;
        if (p[prop] < lo) hours.below += dt / 3600_000;
    }
    return {
        avg: round1(sum / span),
        min: round1(min[prop]),
        minAt: min.ts,
        max: round1(max[prop]),
        maxAt: max.ts,
        hoursAbove: Math.round(hours.above),
        hoursBelow: Math.round(hours.below),
        thresholds: { above: hi, below: lo },
    };
};

/** Courrier : passages du facteur et levées, d'après les passages de la boîte aux lettres. */
export const mailStats = (events, from, to) => {
    const inWeek = events.filter((e) => e.at >= from && e.at < to);
    return {
        deliveries: inWeek.filter((e) => e.kind === 'delivery').length,
        pickups: inWeek.filter((e) => e.kind === 'pickup').length,
        nights: inWeek.filter((e) => e.kind === 'night').length,
    };
};

/** Brouillon déterministe : la base du message, et le texte envoyé si Groq ne répond pas. */
export const draftText = (facts) => {
    const lines = [];
    for (const s of facts.sensors) {
        if (s.temperature) {
            const t = s.temperature;
            const diff = s.temperaturePrev ? round1(t.avg - s.temperaturePrev.avg) : null;
            lines.push(`🌡️ ${s.name} : ${t.avg}° en moyenne${diff ? ` (${diff > 0 ? '+' : ''}${diff}° vs semaine d’avant)` : ''}, de ${t.min}° à ${t.max}°.`);
            if (t.hoursBelow >= 3) lines.push(`🥶 ${s.name} sous ${t.thresholds.below}° pendant ${t.hoursBelow} h.`);
        }
        if (s.humidity && s.humidity.hoursAbove >= 6) lines.push(`💧 ${s.name} au-dessus de ${s.humidity.thresholds.above} % d’humidité pendant ${s.humidity.hoursAbove} h.`);
        if (s.humidity && s.humidity.hoursBelow >= 12) lines.push(`🏜️ Air sec : ${s.name} sous ${s.humidity.thresholds.below} % pendant ${s.humidity.hoursBelow} h.`);
    }
    for (const d of facts.doors) {
        if (!d.openings && !d.stillOpen) continue;
        let line = `🚪 ${d.name} : ${d.openings} ouverture${d.openings > 1 ? 's' : ''}, ${d.openMin} min ouverte au total`;
        if (d.longest && d.longest.min >= 15) line += `, la plus longue ${d.longest.min} min (${fmtWhen(d.longest.at)})`;
        if (d.night) line += `, dont ${d.night} la nuit`;
        lines.push(`${line}.`);
    }
    if (facts.mail?.deliveries || facts.mail?.nights) {
        const m = facts.mail;
        let line = `📬 Courrier : ${m.deliveries} passage${m.deliveries > 1 ? 's' : ''} du facteur`;
        if (m.nights) line += `, ${m.nights} ouverture${m.nights > 1 ? 's' : ''} de nuit`;
        lines.push(`${line}.`);
    }
    const a = facts.activity;
    if (a.heatingCommands) lines.push(`🔥 Thermopompe : ${a.heatingCommands} commande${a.heatingCommands > 1 ? 's' : ''}${a.heatingOffs ? `, ${a.heatingOffs} arrêt${a.heatingOffs > 1 ? 's' : ''}` : ''}.`);
    if (a.flexPeaks) lines.push(`⚡ ${a.flexPeaks} étape${a.flexPeaks > 1 ? 's' : ''} de pointe Flex D gérée${a.flexPeaks > 1 ? 's' : ''}.`);
    for (const x of a.automations.slice(0, 3)) lines.push(`⚙️ « ${x.title} » × ${x.count}.`);
    for (const b of facts.batteries) lines.push(`🔋 Pile faible : ${b.name} (${b.battery} %).`);
    for (const s of facts.silent) lines.push(`📡 ${s.name} n’a rien envoyé depuis ${s.hours} h.`);
    return `🗓️ Ta semaine à la maison\n${lines.length ? lines.join('\n') : 'Semaine calme, rien à signaler.'}`;
};

// --- Collecte ---

export const collectFacts = async (now = Date.now()) => {
    const from = now - WEEK;
    const prevFrom = from - WEEK;
    const entries = journal.list({ limit: 5000, since: prevFrom }).reverse();
    const sensors = await getSensors().catch(() => []);
    const measured = [];
    for (const s of sensors.filter((x) => x.props.temperature != null || x.props.humidity != null)) {
        const hist = await getSensorHistory(s.did, 24 * 14).catch(() => ({ points: [] }));
        measured.push({
            name: s.name,
            temperature: measureStats(hist.points, 'temperature', from, now),
            temperaturePrev: measureStats(hist.points, 'temperature', prevFrom, from),
            humidity: measureStats(hist.points, 'humidity', from, now),
            humidityPrev: measureStats(hist.points, 'humidity', prevFrom, from),
        });
    }
    // Seuls les vrais capteurs de porte : la boîte aux lettres a sa propre ligne
    const notDoor = new Set(sensors.filter((s) => s.type && s.type !== 'door').map((s) => s.did));
    const doorEntries = entries.filter((e) => e.kind !== 'door' || !notDoor.has(e.data?.did));
    let mailEvents = [];
    try {
        mailEvents = mailbox.getHistory().events || [];
    } catch {
        mailEvents = [];
    }
    return {
        period: { from, to: now },
        sensors: measured,
        doors: doorStats(doorEntries, from, now),
        doorsPrev: doorStats(doorEntries, prevFrom, from).map(({ name, openings, openMin }) => ({ name, openings, openMin })),
        activity: activityStats(entries, from, now),
        mail: mailStats(mailEvents, from, now),
        mailPrev: mailStats(mailEvents, prevFrom, from),
        batteries: sensors.filter((s) => s.props.battery != null && s.props.battery < 25).map((s) => ({ name: s.name, battery: s.props.battery })),
        silent: sensors
            .filter((s) => s.lastUpdated && now - Date.parse(s.lastUpdated) > 12 * 3600_000)
            .map((s) => ({ name: s.name, hours: Math.round((now - Date.parse(s.lastUpdated)) / 3600_000) })),
    };
};

// --- Rédaction ---

const PROMPT = `Tu écris le résumé hebdomadaire de la maison MyHue, envoyé sur Telegram à l'habitant.
Règles :
- Français naturel, tutoiement. Première ligne : « 🗓️ Ta semaine à la maison ».
- Puis 3 à 6 puces courtes (une ligne chacune, un emoji au début), en gardant UNIQUEMENT ce qui sort de l'ordinaire ou mérite une action : écarts nets avec la semaine d'avant, porte restée longtemps ouverte, ouvertures la nuit, passages du facteur (toujours une puce s'il est passé, avec le nombre), pièce trop froide ou trop humide, air très sec, pile faible, capteur muet, beaucoup d'arrêts de la thermopompe.
- Si rien n'est inhabituel, dis en une phrase que la semaine a été calme et donne la température moyenne.
- Garde exactement les chiffres fournis. N'invente aucun fait, aucune cause, aucun conseil qui ne découle pas des faits.
- Pas de formule de politesse, pas de signature, pas de markdown (pas d'astérisques).`;

export const writeDigest = async (facts) => {
    const draft = draftText(facts);
    if (!GROQ_API_KEY) return { text: draft, by: 'brouillon' };
    try {
        const { data } = await groqClient.post(
            '/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: PROMPT },
                    { role: 'user', content: `Faits de la semaine (JSON) : ${JSON.stringify(facts)}\n\nBrouillon complet : ${draft}\n\nÉcris le résumé.` },
                ],
                temperature: 0.3,
                max_tokens: 1200,
                reasoning_effort: 'low',
                reasoning_format: 'hidden',
            },
            { timeout: 20000 },
        );
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 20 && text.length < 1500) return { text: text.replace(/\*\*/g, ''), by: 'groq' };
    } catch (err) {
        console.warn('[Résumé] Groq indisponible:', err.response?.status || err.message);
    }
    return { text: draft, by: 'brouillon' };
};

export const preview = async () => {
    const facts = await collectFacts();
    return { ...(await writeDigest(facts)), facts };
};

export const send = async (source = 'interface') => {
    const { text, by } = await preview();
    const sent = await notifier.notify({ text, silent: true });
    if (!sent) throw new Error('Telegram non configuré');
    journal.log({ kind: 'system', title: 'Résumé de la semaine envoyé sur Telegram', data: { source, by } });
    return { text, by };
};

// --- Planification ---

const tick = async () => {
    if (!config.enabled) return;
    const local = localParts(Date.now());
    const [h, m] = config.time.split(':').map(Number);
    const at = h * 60 + m;
    if (local.weekday !== config.day || local.minutes < at || local.minutes > at + 60) return;
    if (config.lastSentDay === local.day) return;
    config.lastSentDay = local.day;
    save();
    try {
        await send('planifié');
    } catch (err) {
        console.error('❌ Résumé de la semaine:', err.message);
    }
};

export const getStatus = () => ({ ...config });

export const update = (patch = {}) => {
    if (patch.enabled !== undefined) config.enabled = Boolean(patch.enabled);
    if (patch.day !== undefined) {
        if (!Number.isInteger(patch.day) || patch.day < 0 || patch.day > 6) throw new Error('Jour invalide');
        config.day = patch.day;
    }
    if (patch.time !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.time)) throw new Error('Heure invalide (HH:MM)');
        config.time = patch.time;
    }
    save();
    return getStatus();
};

export const start = () => {
    setInterval(() => tick().catch(() => {}), 5 * 60_000);
    console.log(`🗓️  Résumé de la semaine ${config.enabled ? `actif (jour ${config.day}, ${config.time})` : 'désactivé'}`);
};
