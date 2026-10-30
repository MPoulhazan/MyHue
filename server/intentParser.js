// Niveau 0 de l'assistant : commandes simples comprises sans LLM.
// parseIntent() renvoie { intent, actions, message } ou null si la phrase
// n'est pas reconnue avec certitude (elle part alors vers le LLM).

export const normalize = (text) =>
    String(text || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9%]+/g, ' ')
        .trim();

// Tournures qui demandent du raisonnement (délais, conditions, enchaînements)
const COMPLEX =
    /\b(si|quand|lorsque|puis|ensuite|apres|avant|pendant|demain|chaque|sauf|pourquoi|comment|minutes?|heures?|secondes?|\d+ ?h\d*)\b|\bdans (\d|une?|quelques|la nuit)/;

const ON = /\b(allume[rz]?|allumes)\b/;
const OFF = /\b(etein[st]|eteindre|eteignez|coupe[rz]?)\b/;
// Québec : « ouvre la lumière », « ferme les lampes », seulement avec le mot lumière/lampe
const LIGHT_WORD = /\b(lumieres?|lampes?)\b/;
const LIGHTS_PLURAL = /\b(les|toutes les) (lumieres|lampes)\b/;
const QC_ON = /\b(ouvre[rsz]?|ouvrir)\b/;
const QC_OFF = /\b(ferme[rsz]?|fermer)\b/;
const DIM_UP = /\b(monte[rz]?|augmente[rz]?|plus fort)\b/;
const DIM_DOWN = /\b(baisse[rz]?|diminue[rz]?|tamise[rz]?|moins fort)\b/;
const DIM_STEP = 64; // un quart de la plage Hue
const ALL = /\b(tout|toutes?|partout|la maison)\b/;
const MUSIC_WORD = /\b(musique|son|volume|pause|reprends?|reprendre|chanson)\b/;
const VOLUME_STEP = 10;
const SCENE_WORD = /\b(scene|ambiance|lance[rz]?|active[rz]?)\b/;
const HEATING_WORD = /\b(chauffage|clim|climatisation|pompe a chaleur|chauffe)\b/;
const QUESTION = /\b(quelle?|combien|c est quoi)\b/;
// "le salon est allumé ?" : on demande un état, on ne donne pas un ordre
const STATE_QUESTION = /\b(est|sont|c est) (allumee?s?|eteinte?s?|en marche|coupee?s?)\b/;

const COLORS = {
    rouge: [255, 0, 0],
    bleu: [0, 60, 255],
    vert: [0, 255, 0],
    jaune: [255, 220, 0],
    orange: [255, 120, 0],
    violet: [140, 0, 255],
    rose: [255, 60, 160],
    cyan: [0, 255, 255],
    turquoise: [0, 220, 180],
};
const MODE_LABELS = { heat: 'chaud', cool: 'froid', dry: 'déshumidification', fan: 'ventilation', auto: 'auto' };
const WHITES ={ 'blanc chaud': 450, 'blanc froid': 200, blanc: 300 };

const pad = (s) => ` ${s} `;

// Trouve les entités nommées dans le texte, la plus longue d'abord, sans chevauchement
const findEntities = (text, entities) => {
    const padded = pad(text);
    const found = [];
    for (const entity of entities) {
        const n = normalize(entity.name);
        if (n.length < 2) continue;
        const index = padded.indexOf(pad(n));
        if (index !== -1) found.push({ entity, start: index, end: index + n.length + 1 });
    }
    found.sort((a, b) => b.end - b.start - (a.end - a.start));
    const kept = [];
    for (const m of found) {
        // Même span = homonymes (ex. deux lampes "Bar") : on les garde tous
        const sameSpan = (k) => m.start === k.start && m.end === k.end;
        if (kept.every((k) => m.end <= k.start || m.start >= k.end || sameSpan(k))) kept.push(m);
    }
    kept.sort((a, b) => a.start - b.start);
    let residual = padded;
    for (const m of kept) {
        residual = residual.slice(0, m.start) + ' '.repeat(m.end - m.start) + residual.slice(m.end);
    }
    return { matches: kept.map((m) => m.entity), residual: residual.replace(/\s+/g, ' ').trim() };
};

const list = (names) => names.join(', ');

const parseBrightness = (residual) => {
    if (/\b(a fond|au max(imum)?)\b/.test(residual)) return 100;
    if (/\bau min(imum)?\b/.test(residual)) return 1;
    const m = residual.match(/\b(\d{1,3}) ?(%|pour ?cent)/);
    return m ? Math.min(100, Number(m[1])) : null;
};

const parseColor = (residual) => {
    for (const [name, ct] of Object.entries(WHITES)) {
        if (residual.includes(`en ${name}`)) return { name, state: { ct } };
    }
    for (const [name, rgb] of Object.entries(COLORS)) {
        if (residual.includes(`en ${name}`)) return { name, rgb };
    }
    return null;
};

const parseHeating = (text, heating) => {
    const action = { type: 'set_heating' };
    const temp = text.match(/\b(\d{2})(?: ?(degres?|°|c))?\b/);
    if (temp && Number(temp[1]) >= 16 && Number(temp[1]) <= 31) {
        action.temperature = Number(temp[1]);
        action.power = true;
    }
    if (/\b(mode )?(chaud|chauffer)\b/.test(text)) action.mode = 'heat';
    if (/\b(mode )?(froid|refroidir)\b/.test(text)) action.mode = 'cool';
    if (OFF.test(text)) action.power = false;
    else if (/\b(allume[rz]?|lance[rz]?|demarre[rz]?)\b/.test(text)) action.power = true;

    if (STATE_QUESTION.test(text) || Object.keys(action).length === 1) {
        if (!(QUESTION.test(text) || STATE_QUESTION.test(text)) || !heating) return null;
        const s = heating;
        return {
            intent: 'heating_status',
            actions: [],
            message: s.power
                ? `Le chauffage est allumé en mode ${MODE_LABELS[s.mode] || s.mode}, réglé à ${s.temperature} °C.`
                : 'Le chauffage est éteint.',
        };
    }
    const parts = [];
    if (action.power === false) parts.push('Chauffage éteint');
    else {
        parts.push('Chauffage allumé');
        if (action.temperature) parts.push(`à ${action.temperature} °C`);
        if (action.mode) parts.push(action.mode === 'heat' ? 'en mode chaud' : 'en mode froid');
    }
    return { intent: 'heating', actions: [action], message: `${parts.join(' ')}.` };
};

const parseSensorQuery = (text, sensors) => {
    const wantsTemp = /\b(temperature|il fait combien|fait il chaud|fait il froid|humidite)\b/.test(text);
    const wantsDoor = /\bportes?\b/.test(text) && /\b(ouverte?s?|fermee?s?)\b/.test(text);
    if (!wantsTemp && !wantsDoor) return null;

    if (wantsDoor) {
        const doors = sensors.filter((s) => s.type === 'door' && s.props?.isOpen != null);
        if (!doors.length) return null;
        const { matches } = findEntities(text, doors);
        const pick = matches.length ? matches : doors;
        return {
            intent: 'door_status',
            actions: [],
            message: pick.map((d) => `${d.name} : ${d.props.isOpen ? 'ouverte' : 'fermée'}`).join('. ') + '.',
        };
    }

    const thermo = sensors.filter((s) => s.props?.temperature != null);
    if (!thermo.length) return null;
    const { matches } = findEntities(text, thermo);
    const pick = matches.length ? matches : thermo;
    const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
    return {
        intent: 'temperature',
        actions: [],
        message: pick
            .map((s) => {
                const hum = s.props.humidity != null ? `, humidité ${Math.round(s.props.humidity)} %` : '';
                return `${s.name} : ${fmt(s.props.temperature)} °C${hum}`;
            })
            .join('. ') + '.',
    };
};

const parseScene = (text, scenes, groups) => {
    const { matches } = findEntities(text, scenes);
    if (!matches.length) return null;
    const sceneName = normalize(matches[0].name);
    if (!SCENE_WORD.test(text) && normalize(text) !== sceneName) return null;

    // Même nom de scène dans plusieurs pièces : on prend celle de la pièce citée
    const { matches: roomMatches } = findEntities(text, groups);
    const homonyms = scenes.filter((s) => normalize(s.name) === sceneName);
    const scene =
        homonyms.find((s) => roomMatches.some((g) => g.id === s.group)) || matches[0];
    return {
        intent: 'scene',
        actions: [
            {
                type: 'set_group_state',
                id: scene.type === 'GroupScene' && scene.group ? scene.group : '0',
                state: { scene: scene.id },
            },
        ],
        message: /^sc[eè]n/i.test(scene.name) ? `${scene.name} activée.` : `Scène ${scene.name} activée.`,
    };
};

const parseLights = (text, lights, groups) => {
    const qc = LIGHT_WORD.test(text);
    const isOff = OFF.test(text) || (qc && QC_OFF.test(text));
    // « ferme les lumières » sans pièce = toute la maison
    const isAll = ALL.test(text) || LIGHTS_PLURAL.test(text);
    const found = findEntities(text, [...groups, ...lights]);
    const { residual } = found;
    // Une pièce l'emporte sur une lampe du même nom (pièce "Cuisine" vs lampe "Cuisine")
    const groupNames = new Set(found.matches.filter((m) => groups.includes(m)).map((m) => normalize(m.name)));
    const matches = found.matches.filter((m) => groups.includes(m) || !groupNames.has(normalize(m.name)));
    const bri = parseBrightness(residual);
    const color = parseColor(residual);
    const isOn = ON.test(text) || (qc && QC_ON.test(text)) || bri !== null || color !== null;
    // « baisse la lumière du salon » : pas relatif, appliqué par le pont Hue
    const step = isOff || isOn ? 0 : DIM_UP.test(text) ? 1 : DIM_DOWN.test(text) ? -1 : 0;
    if (!isOff && !isOn && !step) return null;

    if (!matches.length) {
        if (!isAll) return null;
        if (isOff) return { intent: 'lights', actions: [{ type: 'toggle_all', on: false }], message: 'Tout est éteint.' };
        if (bri === null && !color && !step) return { intent: 'lights', actions: [{ type: 'toggle_all', on: true }], message: 'Tout est allumé.' };
        matches.push({ id: '0', name: 'Toute la maison', lights: [] });
    }

    if (step) {
        const actions = matches.map((m) => ({
            type: m.id === '0' || groups.includes(m) ? 'set_group_state' : 'set_light_state',
            id: m.id,
            state: { bri_inc: step * DIM_STEP },
        }));
        const names = list([...new Set(matches.map((m) => m.name))]);
        return { intent: 'lights', actions, message: `${names} : ${step > 0 ? 'plus fort' : 'moins fort'}.` };
    }

    const state = { on: !isOff };
    if (!isOff && bri !== null) state.bri = Math.max(1, Math.round((bri / 100) * 254));
    if (!isOff && color?.state) Object.assign(state, color.state);

    const actions = matches.map((m) => {
        const isGroup = m.id === '0' || groups.includes(m);
        const action = isGroup
            ? { type: 'set_group_state', id: m.id, state: { ...state } }
            : { type: 'set_light_state', id: m.id, state: { ...state } };
        if (!isOff && color?.rgb) action.rgb = color.rgb;
        return action;
    });

    const names = list([...new Set(matches.map((m) => m.name))]);
    let message;
    if (isOff) message = `Éteint : ${names}.`;
    else if (color) message = `${names} en ${color.name}.`;
    else if (bri !== null) message = `${names} à ${bri} %.`;
    else message = `Allumé : ${names}.`;
    return { intent: 'lights', actions, message };
};

// Pause, reprise, arrêt et volume. Enceinte citée, sinon celle qui joue.
const parseMusic = (text, { devices = [], nowPlaying = null } = {}) => {
    const { matches } = findEntities(text, devices);
    const playing = nowPlaying && devices.find((d) => d.id === nowPlaying.deviceId);
    const device = matches[0] || playing;
    if (!device) return null;
    const name = device.name;
    const control = (command, message) => ({
        intent: 'music',
        actions: [{ type: 'cast_control', deviceName: name, command }],
        message,
    });
    const volume = (pct) => ({
        intent: 'music',
        actions: [{ type: 'cast_volume', deviceName: name, level: Math.max(0, Math.min(100, pct)) / 100 }],
        message: `Volume ${name} à ${Math.max(0, Math.min(100, pct))} %.`,
    });

    if (/\b(son|volume)\b/.test(text)) {
        const pct = text.match(/\b(\d{1,3}) ?(%|pour ?cent)?\b/);
        if (pct) return volume(Number(pct[1]));
        // Relatif : seulement si on connaît le volume actuel de cette enceinte
        const current = device === playing ? nowPlaying.volume : null;
        if (current == null) return null;
        if (DIM_UP.test(text)) return volume(current + VOLUME_STEP);
        if (DIM_DOWN.test(text)) return volume(current - VOLUME_STEP);
        return null;
    }
    if (/\bpause\b/.test(text)) return control('pause', `Pause sur ${name}.`);
    if (/\b(reprends?|reprendre|relance[rz]?)\b/.test(text)) return control('play', `Lecture sur ${name}.`);
    if (/\b(arrete[rz]?|stop|coupe[rz]?)\b/.test(text) && /\b(musique|chanson)\b/.test(text)) {
        return control('stop', `Musique arrêtée sur ${name}.`);
    }
    return null;
};

/** Tournure à délai, condition ou enchaînement : jamais traitée ni apprise localement. */
export const isComplex = (rawText) => COMPLEX.test(normalize(rawText));

export const parseIntent = (rawText, context = {}) => {
    const text = normalize(rawText);
    if (!text || text.split(' ').length > 14 || COMPLEX.test(text)) return null;

    const { lights = [], groups = [], scenes = [], sensors = [], heating = null, cast } = context;
    const roomGroups = groups.filter((g) => ['Room', 'Zone', 'LightGroup'].includes(g.type));

    if (HEATING_WORD.test(text)) return parseHeating(text, heating);
    if (STATE_QUESTION.test(text)) return null;
    if (MUSIC_WORD.test(text)) return parseMusic(text, cast);
    return (
        parseSensorQuery(text, sensors) ||
        parseScene(text, scenes, roomGroups) ||
        parseLights(text, lights, roomGroups)
    );
};
