/**
 * Alertes de la ville : décisions pures (sans réseau), testées dans city.test.js.
 *
 * Tout devient un événement commun :
 *   { id, level: 'danger'|'heads'|'info', kind, title, detail, advice, start, end, source, link }
 * danger = son + lampe + écran d'alerte ; heads = Telegram silencieux ; info = carte et briefing.
 */

const TZ = process.env.TZ || 'America/Toronto';
const H = 3600_000;

// --- Heures locales ---

const parts = (ts, tz = TZ) => {
    const f = new Intl.DateTimeFormat('fr-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    const day = `${p.year}-${p.month}-${p.day}`;
    return { day, hour: Number(p.hour), minute: Number(p.minute), weekday: new Date(`${day}T12:00:00Z`).getUTCDay() };
};
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (24 * H));
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const hm = (ts, tz) => {
    const { hour, minute } = parts(ts, tz);
    return `${hour} h${minute ? ` ${String(minute).padStart(2, '0')}` : ''}`;
};

/** « aujourd'hui », « demain », « samedi » ou « le 12 » selon l'écart avec maintenant. */
export const dayWord = (ts, now = Date.now(), tz = TZ) => {
    const d = dayDiff(parts(now, tz).day, parts(ts, tz).day);
    if (d === 0) return 'aujourd’hui';
    if (d === 1) return 'demain';
    if (d > 1 && d < 7) return DAYS[parts(ts, tz).weekday];
    return `le ${Number(parts(ts, tz).day.slice(8))}`;
};

/** Libellé court du moment : « jusqu'à 10 h », « demain 5 h – 10 h », « dimanche ». */
export const whenLabel = (ev, now = Date.now(), tz = TZ) => {
    const { start, end, allDay } = ev;
    if (allDay) return start > now ? dayWord(start, now, tz) : end && dayDiff(parts(now, tz).day, parts(end, tz).day) > 0 ? `jusqu’à ${dayWord(end, now, tz)}` : 'aujourd’hui';
    if (!start || start <= now) {
        if (!end) return 'en cours';
        const w = dayWord(end, now, tz);
        return `jusqu’à ${w === 'aujourd’hui' ? '' : `${w} `}${hm(end, tz)}`;
    }
    const w = dayWord(start, now, tz);
    const from = `${w === 'aujourd’hui' ? '' : `${w} `}${hm(start, tz)}`;
    if (!end) return `dès ${from}`;
    return parts(start, tz).day === parts(end, tz).day ? `${from} – ${hm(end, tz)}` : `${from} – ${dayWord(end, now, tz)} ${hm(end, tz)}`;
};

/** Rangement dans la carte : now, today, tomorrow, weekend, later. */
export const bucket = (ev, now = Date.now(), tz = TZ) => {
    if (!ev.start || ev.start <= now) return 'now';
    const d = dayDiff(parts(now, tz).day, parts(ev.start, tz).day);
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    const wd = parts(ev.start, tz).weekday;
    if (d < 7 && (wd === 0 || wd === 6)) return 'weekend';
    return 'later';
};

// --- Conseils selon le genre ---

export const EMOJI = { ice: '🧊', snow: '❄️', storm: '⛈️', heat: '🥵', cold: '🥶', air: '😷', wind: '💨', rain: '🌧️', water: '🚰', road: '🚧', event: '📅', weather: '⚠️' };
const ADVICE = {
    ice: 'Pas de BIXI : trottoirs et pistes glissants, prévoyez 15 min de plus.',
    snow: 'Pas de BIXI, prévoyez du temps pour vous déplacer.',
    storm: 'Rentrez ce qui traîne sur le balcon, pas de vélo pendant l’orage.',
    heat: 'Stores fermés le jour, de l’eau pour tout le monde, Cooper compris.',
    cold: 'Couvrez bien le visage et les mains, sorties courtes pour Cooper.',
    air: 'Fenêtres fermées et pas d’effort dehors.',
    wind: 'Rentrez ce qui traîne sur le balcon.',
    rain: 'Imperméable, et le métro plutôt que le vélo.',
    water: 'Faites bouillir l’eau 1 minute avant de la boire ou de cuisiner.',
};

/** Couleur de la lampe signal pour un événement grave. */
export const lampKind = (ev) => (['ice', 'snow', 'cold'].includes(ev.kind) ? 'ice' : 'alert');

// --- Environnement Canada (api.weather.gc.ca, collection weather-alerts) ---

const ECCC_KIND = [
    [/vergla/i, 'ice'],
    [/neige|blizzard|hivernale|poudrerie/i, 'snow'],
    [/orage|tornade|ouragan|tempête tropicale/i, 'storm'],
    [/chaleur/i, 'heat'],
    [/froid/i, 'cold'],
    [/qualité de l.air|smog|fumée/i, 'air'],
    [/vent|bourrasque/i, 'wind'],
    [/pluie/i, 'rain'],
];
const ECCC_LEVEL = { warning: 'danger', watch: 'heads', advisory: 'heads', statement: 'info' };
const ECCC_TYPE = { warning: 'Avertissement', watch: 'Veille', advisory: 'Avis', statement: 'Bulletin' };

/** Première phrase utile du texte d'alerte, sans les rubriques « Régions : … ». */
const firstSentence = (text = '') => {
    const line = text.split(/\n+/).map((l) => l.trim()).find((l) => l && !/^(régions?|période|quantité|remarques|endroits?|heure|moment)\s*:/i.test(l)) || '';
    const s = line.match(/^.*?[.!](\s|$)/)?.[0] || line;
    return s.trim().slice(0, 180);
};

/** Alertes GeoJSON en vigueur → événements (une par type, même si plusieurs zones se recoupent). */
export const fromEccc = (features = [], now = Date.now()) => {
    const out = new Map();
    for (const f of features) {
        const p = f.properties || {};
        if (['ended', 'cancelled'].includes(p.status_en)) continue;
        const end = Date.parse(p.event_end_datetime) || Date.parse(p.expiration_datetime) || null;
        if (end && end < now) continue;
        const name = p.alert_short_name_fr || p.alert_name_fr || 'Alerte météo';
        const kind = ECCC_KIND.find(([re]) => re.test(name))?.[1] || 'weather';
        const level = ECCC_LEVEL[p.alert_type] || 'info';
        const id = `eccc:${p.alert_code || name}:${p.alert_type}`;
        if (out.has(id)) continue;
        out.set(id, {
            id,
            level,
            kind,
            title: name.charAt(0).toUpperCase() + name.slice(1),
            detail: firstSentence(p.alert_text_fr) || p.alert_name_fr || '',
            advice: level === 'info' ? '' : ADVICE[kind] || '',
            start: Date.parse(p.validity_datetime) || null,
            end,
            source: `${ECCC_TYPE[p.alert_type] || 'Alerte'} · Environnement Canada`,
            link: 'https://meteo.gc.ca/warnings/index_f.html',
        });
    }
    return [...out.values()];
};

// --- Verglas vu par Open-Meteo, avant qu'Environnement Canada ne le publie ---

const FREEZING = [56, 57, 66, 67];
const SNOW = [71, 73, 75, 77, 85, 86];

/** Heures de verglas possibles dans les `withinH` heures → un événement « à prévoir », ou null. */
export const icePreview = (hours = [], now = Date.now(), withinH = 18) => {
    const icy = hours.filter((h) => h.ts + H > now && h.ts <= now + withinH * H)
        .filter((h) => FREEZING.includes(h.code) || (h.precip >= 0.1 && h.temp <= 0.5 && !SNOW.includes(h.code)));
    if (!icy.length) return null;
    const start = Math.max(icy[0].ts, now);
    return {
        id: `meteo:ice:${parts(icy[0].ts).day}`,
        level: 'heads',
        kind: 'ice',
        title: 'Risque de verglas',
        detail: `Pluie ou bruine autour de 0 °C d’après la prévision, ${icy.length} h en tout.`,
        advice: ADVICE.ice,
        start: icy[0].ts > now ? start : null,
        end: icy[icy.length - 1].ts + H,
        source: 'Prévision Open-Meteo',
        link: null,
    };
};

// --- Avis de la Ville (données ouvertes « Avis et alertes ») ---

const fold = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Le texte nomme-t-il une de ces rues ? (« Clark » ne prend pas « Clarke ») */
export const mentions = (text, names = []) => {
    const t = fold(text);
    return names.some((n) => new RegExp(`(^|[^a-z])${escapeRe(fold(n))}($|[^a-z])`).test(t));
};
const STOP = new Set(['rue', 'rues', 'avenue', 'av', 'boulevard', 'blvd', 'entre', 'et', 'des', 'les', 'la', 'le', 'de', 'du', 'cote', 'au', 'a', 'l', 'd', 'eau', 'avis', 'fin', 'preventif', 'ebullition']);
/** Rues concernées, sans le préfixe ni l'arrondissement, pour relier un avis à sa fin. */
const segment = (title) => new Set(fold(title.replace(/^.*?[–-]\s+/, '').replace(/,?\s*(arrondissement|arr\.).*$/i, '')).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)));
const overlap = (a, b) => {
    const inter = [...a].filter((w) => b.has(w)).length;
    return inter / Math.max(1, Math.min(a.size, b.size));
};

/**
 * Avis de la Ville qui nous touchent. La date de fin du jeu de données est celle de la
 * publication (4 mois) : un avis d'ébullition est levé par un avis « Fin de l'avis » plus récent.
 * @param records [{ titre, date_debut, type, lien }]
 * @param areas  arrondissements suivis (« Ville-Marie »)
 * @param streets rues du quartier : un avis qui les nomme devient grave
 */
export const fromCityNotices = (records = [], { areas = [], streets = [], now = Date.now(), maxAgeDays = 21 } = {}) => {
    const recent = records.map((r) => ({ ...r, at: Date.parse(r.date_debut) })).filter((r) => r.at && now - r.at < maxAgeDays * 24 * H);
    const inArea = recent.filter((r) => mentions(r.titre, areas));
    const ends = inArea.filter((r) => /^fin de l/i.test(fold(r.titre).trim()));
    const out = [];
    for (const r of inArea) {
        const title = r.titre.replace(/\s+/g, ' ').trim();
        if (/^fin de l/i.test(fold(title))) continue;
        const near = mentions(title, streets);
        const where = title.replace(/^.*?[–-]\s+/, '').replace(/,?\s*(arrondissement|arr\.).*$/i, '').trim();
        const base = { start: null, end: null, source: 'Ville de Montréal', link: r.lien || null };
        if (/bullition/i.test(title)) {
            const seg = segment(title);
            if (ends.some((e) => e.at > r.at && overlap(seg, segment(e.titre)) >= 0.6)) continue;
            out.push({ ...base, id: `ville:${r._id ?? r.at}`, level: near ? 'danger' : 'info', kind: 'water', title: /pr[ée]ventif/i.test(title) ? 'Avis préventif d’ébullition' : 'Avis d’ébullition', detail: where, advice: ADVICE.water });
        } else if (near && /coupure d.eau/i.test(fold(title))) {
            if (now - r.at > 3 * 24 * H) continue;
            out.push({ ...base, id: `ville:${r._id ?? r.at}`, level: 'heads', kind: 'water', title: 'Coupure d’eau', detail: where, advice: 'Remplissez une carafe et la bouilloire à l’avance.' });
        } else if (near && /fermeture|entrave/i.test(fold(title))) {
            if (now - r.at > 7 * 24 * H) continue;
            out.push({ ...base, id: `ville:${r._id ?? r.at}`, level: 'info', kind: 'road', title: 'Rue fermée', detail: where, advice: '' });
        }
    }
    return out;
};

// --- Événements ajoutés à la main (data/city.json) ---

/**
 * { id, title, date: 'AAAA-MM-JJ', endDate?, from?: 'HH:MM', to?: 'HH:MM', level?, detail?, advice? }
 * → événement ; null s'il est terminé.
 */
export const fromManual = (e, now = Date.now(), tz = TZ) => {
    if (!e?.date || !e.title) return null;
    const at = (day, hhmm) => {
        // Heure locale → epoch (deux passes pour suivre l'heure d'été)
        const guess = Date.parse(`${day}T${hhmm}:00Z`);
        const p = parts(guess, tz);
        const shift = (Date.parse(`${p.day}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00Z`) - guess);
        return guess - shift;
    };
    const allDay = !e.from;
    const start = at(e.date, e.from || '00:00');
    const end = e.to ? at(e.endDate || e.date, e.to) : at(e.endDate || e.date, '23:59');
    if (end < now) return null;
    return { id: `perso:${e.id || e.date}`, level: e.level || 'heads', kind: e.kind || 'event', title: e.title, detail: e.detail || '', advice: e.advice || '', start, end, allDay, source: 'Ajouté à la main', link: e.link || null };
};

// --- Assemblage ---

const RANK = { danger: 0, heads: 1, info: 2 };

/** Fusionne, retire les doublons (le verglas d'Open-Meteo s'efface devant celui d'Environnement Canada) et trie. */
export const merge = (lists, now = Date.now()) => {
    const all = lists.flat().filter(Boolean).filter((e) => !e.end || e.end > now);
    const officialIce = all.some((e) => e.kind === 'ice' && e.id.startsWith('eccc:'));
    return all.filter((e) => !(officialIce && e.id.startsWith('meteo:ice')))
        .sort((a, b) => RANK[a.level] - RANK[b.level] || (a.start ?? 0) - (b.start ?? 0));
};

/** Texte Telegram d'un événement. */
export const telegramText = (ev, now = Date.now(), tz = TZ) => {
    const when = whenLabel(ev, now, tz);
    const head = `${EMOJI[ev.kind] || '⚠️'} ${ev.title}${ev.detail && ev.kind !== 'weather' ? ` : ${ev.detail.replace(/\.$/, '')}` : ''}`;
    return `${head} (${when}).${ev.advice ? ` ${ev.advice}` : ''}`;
};

/** Message du jeudi soir : ce qui est prévu samedi et dimanche, ou null. */
export const weekendText = (events, now = Date.now(), tz = TZ) => {
    const we = events.filter((e) => bucket(e, now, tz) === 'weekend' || (bucket(e, now, tz) === 'tomorrow' && parts(e.start, tz).weekday === 6));
    if (!we.length) return null;
    return `📅 Ce week-end : ${we.map((e) => `${e.title} (${whenLabel(e, now, tz)})`).join(', ')}.`;
};

const sayWhen = (ev, now, tz) => whenLabel(ev, now, tz).replace(/–/g, 'à').replace(/(\d+) h (\d+)/g, '$1 heures $2').replace(/(\d+) h/g, '$1 heures');

/** Phrase du briefing du matin, ou null : les dangers et ce qui arrive aujourd'hui. */
export const briefingLine = (events, now = Date.now(), tz = TZ) => {
    const pick = events.filter((e) => e.level === 'danger' || (e.level === 'heads' && ['now', 'today'].includes(bucket(e, now, tz)))).slice(0, 2);
    if (!pick.length) return null;
    return pick.map((e) => `${e.level === 'danger' ? 'Attention, ' : 'En ville : '}${e.title.toLowerCase()} ${sayWhen(e, now, tz)}.${e.level === 'danger' && e.advice ? ` ${e.advice}` : ''}`).join(' ');
};

/** Réponse de Jarvis à « Il se passe quoi en ville ce week-end ? » */
export const citySpeech = (events, now = Date.now(), tz = TZ) => {
    const list = events.filter((e) => e.level !== 'info' || bucket(e, now, tz) !== 'later').slice(0, 4);
    if (!list.length) return 'Rien de spécial en ville : pas d’alerte météo ni d’avis dans le quartier.';
    return list.map((e) => `${e.title} ${sayWhen(e, now, tz)}.`).join(' ');
};

export const isCityQuestion = (text) =>
    /\b(en ville|ce week-?end|alertes? (m[ée]t[ée]o|de la ville)|verglas|avis d.[ée]bullition|il se passe quoi|quoi de pr[ée]vu)\b/i.test(text);

// --- Métro (STM, API i3 « état du service ») ---

export const METRO = { 1: 'verte', 2: 'orange', 4: 'jaune', 5: 'bleue' };
const text = (list = [], lang = 'fr') => (list.find((t) => t.language === lang) || list[0])?.text?.replace(/\s+/g, ' ').trim() || '';

/**
 * Alertes STM → état de chaque ligne suivie + événements pour les lignes perturbées.
 * @param data  réponse de /pub/od/i3/v2/messages/etatservice ({ alerts: [...] })
 * @param lines ['2'] numéros de ligne de métro
 */
export const fromStm = (data, lines = ['2'], now = Date.now()) => {
    const alerts = (data?.alerts || []).filter((a) => {
        const p = a.active_periods || {};
        const start = Number(p.start) * 1000 || 0;
        const end = Number(p.end) * 1000 || 0;
        return (!start || start <= now) && (!end || end > now);
    });
    const status = lines.map((line) => {
        const mine = alerts.filter((a) => (a.informed_entities || []).some((e) => String(e.route_short_name) === String(line)));
        const msgs = mine.map((a) => text(a.description_texts) || text(a.header_texts)).filter(Boolean);
        const trouble = msgs.filter((m) => !/service normal/i.test(m));
        return { line: String(line), name: METRO[line] || String(line), ok: trouble.length === 0, text: trouble[0] || 'Service normal' };
    });
    const events = status.filter((s) => !s.ok).map((s) => ({
        id: `stm:${s.line}:${fold(s.text).slice(0, 40)}`,
        level: 'heads',
        kind: 'metro',
        title: `Métro ligne ${s.name}`,
        detail: s.text.slice(0, 180),
        advice: '',
        start: null,
        end: null,
        source: 'STM',
        link: 'https://www.stm.info/fr/infos/etat-du-service',
    }));
    return { status, events };
};
