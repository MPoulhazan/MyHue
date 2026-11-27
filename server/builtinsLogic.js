/**
 * Automatismes intégrés : tout ce que MyHue fait tout seul (parler, allumer une lampe,
 * écrire sur Telegram) sans que ce soit une automatisation créée dans l'appli.
 * Chacun a un interrupteur par canal ; « locked » = sécurité, jamais coupable.
 * Logique pure, testée dans builtinsLogic.test.js.
 */

export const CHANNELS = ['voice', 'lamp', 'telegram'];

/** @type {{ id: string, name: string, area: string, desc: string, channels: Partial<Record<'voice'|'lamp'|'telegram', string>>, locked?: boolean }[]} */
export const REGISTRY = [
    // Cuisine
    { id: 'stove.boil', area: 'Cuisinière', name: 'L’eau bout', desc: 'Quand la vapeur monte vite sur la hotte, MyHue dit « L’eau bout ! » dans la cuisine.', channels: { voice: 'Enceinte de la cuisine' } },
    { id: 'stove.cooking', area: 'Cuisinière', name: 'Lumière de cuisson', desc: 'Cuisinière allumée : la cuisine passe en blanc tiède à 100 %, puis revient comme avant.', channels: { lamp: 'Lumières de la cuisine' } },
    { id: 'stove.alert', area: 'Cuisinière', name: 'Cuisinière oubliée', desc: 'Cuisinière allumée depuis longtemps ou maison vide : message Telegram.', channels: { telegram: 'Telegram' }, locked: true },
    // Cooper
    { id: 'cooper.late', area: 'Cooper', name: 'Repas de Cooper oublié', desc: 'La boîte de croquettes n’a pas été ouverte à l’heure du repas : MyHue le dit, fait clignoter le bar et écrit sur Telegram.', channels: { voice: 'Enceinte de la cuisine', lamp: 'Lampe du bar', telegram: 'Telegram' } },
    { id: 'cooper.double', area: 'Cooper', name: 'Cooper déjà nourri', desc: 'La boîte est rouverte alors que Cooper a déjà mangé : avertissement.', channels: { voice: 'Enceinte de la cuisine', telegram: 'Telegram' } },
    { id: 'cooper.fed', area: 'Cooper', name: 'Repas servi après un rappel', desc: 'Après un rappel, confirmation Telegram quand Cooper a mangé.', channels: { telegram: 'Telegram' } },
    { id: 'cooper.bowl', area: 'Cooper', name: 'Lumière sur la gamelle', desc: 'Boîte de croquettes ouverte quand il fait sombre : le bar s’allume en blanc quelques minutes.', channels: { lamp: 'Lampe du bar' } },
    // Entrée, courrier
    { id: 'mailbox.waiting', area: 'Courrier', name: 'Courrier qui attend', desc: 'Du courrier est arrivé : la lampe du bar passe en jaune et MyHue le rappelle en rentrant.', channels: { voice: 'Enceinte de la cuisine', lamp: 'Lampe du bar' } },
    { id: 'mailbox.falseAlarm', area: 'Courrier', name: 'Fausse alerte courrier', desc: 'La boîte s’ouvre puis la porte d’entrée juste après : message « c’était sûrement toi ».', channels: { telegram: 'Telegram' } },
    { id: 'entrance.light', area: 'Entrée', name: 'Lumière d’entrée', desc: 'Porte ou mouvement : l’entrée s’allume, puis s’éteint après 2 minutes.', channels: { lamp: 'Entrée' } },
    { id: 'together.note', area: 'À deux', name: 'Petit mot lu au retour', desc: 'Un petit mot laissé dans l’appli est lu quand l’autre rentre.', channels: { voice: 'Enceinte du briefing' } },
    // Salon
    { id: 'cube.fall', area: 'Cube', name: 'Le cube est tombé', desc: 'Une petite phrase quand le cube tombe par terre (pas la nuit).', channels: { voice: 'Enceinte du salon' } },
    { id: 'briefing.morning', area: 'Matin', name: 'Briefing du matin', desc: 'Météo, agenda et nouvelles de la maison dits le matin.', channels: { voice: 'Enceinte du briefing' } },
    // Dehors, ville
    { id: 'outdoor.records', area: 'Météo', name: 'Records de froid et de chaleur', desc: 'Record de la saison battu sur le balcon : message Telegram.', channels: { telegram: 'Telegram' } },
    { id: 'outdoor.cooling', area: 'Météo', name: 'Aérer gratuitement', desc: 'Il fait plus frais dehors que dedans : conseil d’ouvrir.', channels: { telegram: 'Telegram' } },
    { id: 'city.alerts', area: 'Ville', name: 'Alertes de la ville', desc: 'Alertes météo et avis de la ville : message et couleur sur une lampe.', channels: { lamp: 'Lampe du salon', telegram: 'Telegram' } },
    { id: 'collecte.bins', area: 'Ville', name: 'Soir de collecte', desc: 'La veille de la collecte : rappel de sortir le bac.', channels: { lamp: 'Lampe du bar', telegram: 'Telegram' } },
    { id: 'sky.aurora', area: 'Ciel', name: 'Alerte aurore', desc: 'Aurore boréale probable ce soir : message et lampe verte.', channels: { lamp: 'Lampe du salon', telegram: 'Telegram' } },
    // Déplacements
    { id: 'bixi.alerts', area: 'Déplacements', name: 'Alertes BIXI', desc: 'Plus de vélos ou de bornes autour le matin : message et lampe.', channels: { lamp: 'Lampe du salon', telegram: 'Telegram' } },
    { id: 'commute.advice', area: 'Déplacements', name: 'Conseil de trajet', desc: 'Le matin, BIXI, vélo électrique, bus ou marche selon la météo.', channels: { telegram: 'Telegram' } },
    { id: 'communauto.found', area: 'Déplacements', name: 'Communauto trouvée', desc: 'Pendant une recherche, une auto se libère tout près.', channels: { voice: 'Enceinte de la cuisine', lamp: 'Lampe du salon', telegram: 'Telegram' } },
    { id: 'communauto.blocked', area: 'Déplacements', name: 'Communauto bloquée', desc: 'Une auto a été réservée automatiquement depuis la tablette.', channels: { voice: 'Enceinte de la cuisine', lamp: 'Lampe du salon', telegram: 'Telegram' } },
    { id: 'communauto.searchEnd', area: 'Déplacements', name: 'Recherche Communauto finie', desc: 'Fin de recherche sans auto trouvée.', channels: { telegram: 'Telegram' } },
    { id: 'tonight.reminder', area: 'Sorties', name: 'Rappel de sortie', desc: 'Avant une sortie prévue : rappel de départ et lampe allumée.', channels: { lamp: 'Lampe du bar', telegram: 'Telegram' } },
    // Maison
    { id: 'flexd.peak', area: 'Chauffage', name: 'Pointe Flex D', desc: 'Hydro annonce une pointe : MyHue prévient et ajuste la consigne.', channels: { telegram: 'Telegram' } },
    { id: 'companion.findings', area: 'Compagnon', name: 'Remarques du compagnon', desc: 'Piles faibles, capteurs muets, pièces trop chaudes ou trop humides…', channels: { telegram: 'Telegram' } },
    { id: 'health.zigbee', area: 'Maison', name: 'Zigbee en panne', desc: 'Les capteurs ne remontent plus (ou reviennent).', channels: { telegram: 'Telegram' } },
    { id: 'away.simulation', area: 'Absence', name: 'Maison vide depuis 12 h', desc: 'Message quand la simulation de présence démarre.', channels: { telegram: 'Telegram' } },
    { id: 'digest.weekly', area: 'Maison', name: 'Bilan de la semaine', desc: 'Le dimanche, le résumé de la semaine sur Telegram.', channels: { telegram: 'Telegram' } },
    // Sécurité : toujours actifs
    { id: 'alarm', area: 'Sécurité', name: 'Alarme fumée ou fuite', desc: 'Lampes en rouge et annonce sur toutes les enceintes.', channels: { voice: 'Toutes les enceintes', lamp: 'Lampes de la maison' }, locked: true },
    { id: 'guard', area: 'Sécurité', name: 'Mode garde', desc: 'Porte ou mouvement pendant la garde : message Telegram.', channels: { telegram: 'Telegram' }, locked: true },
];

export const byId = new Map(REGISTRY.map((d) => [d.id, d]));

/** Le canal de cet automatisme peut-il tourner ? Inconnu = oui (rien n'est coupé par erreur). */
export const allows = (state, id, channel) => {
    const def = byId.get(id);
    if (!def || def.locked) return true;
    const s = state[id];
    if (!s) return true;
    if (s.deleted) return false;
    return !(s.off || []).includes(channel);
};

/** Option « se taire si de la musique joue » (voix seulement). */
export const quietWithMusic = (state, id) => Boolean(state[id]?.quiet) && Boolean(byId.get(id)?.channels.voice);

/**
 * Applique un changement venu de l'appli.
 * { channel, on } | { deleted: true|false } | { all: false|true } | { quietWithMusic }
 * Renvoie le nouvel état (sans muter l'ancien) ou lance une erreur lisible.
 */
export const patch = (state, id, change = {}) => {
    const def = byId.get(id);
    if (!def) throw new Error('Automatisme inconnu');
    if (def.locked) throw new Error('Automatisme de sécurité : il reste toujours actif');
    const cur = { off: [], ...(state[id] || {}) };
    const own = Object.keys(def.channels);
    if (typeof change.quietWithMusic === 'boolean') {
        if (!own.includes('voice')) throw new Error('Cet automatisme ne parle pas');
        cur.quiet = change.quietWithMusic;
    } else if (typeof change.deleted === 'boolean') {
        cur.deleted = change.deleted;
        if (!change.deleted) cur.off = [];
    } else if (typeof change.all === 'boolean') {
        cur.off = change.all ? [] : [...own];
    } else if (change.channel) {
        if (!own.includes(change.channel)) throw new Error('Canal inconnu pour cet automatisme');
        const off = new Set(cur.off);
        if (change.on) off.delete(change.channel);
        else off.add(change.channel);
        cur.off = own.filter((c) => off.has(c));
    } else {
        throw new Error('Rien à changer');
    }
    const next = { ...state };
    if (!cur.deleted && !cur.quiet && cur.off.length === 0) delete next[id];
    else next[id] = { off: cur.off, ...(cur.deleted ? { deleted: true } : {}), ...(cur.quiet ? { quiet: true } : {}) };
    return next;
};

/** Vue pour l'appli : chaque automatisme avec ses canaux, son état et ses passages. */
export const view = (state, entries, now = Date.now()) => {
    const monthAgo = now - 30 * 24 * 3600_000;
    const stats = new Map();
    for (const e of entries) {
        const id = e.data?.builtin;
        if (!id) continue;
        const s = stats.get(id) || { runs: new Set(), lastAt: 0 };
        if (e.data.run && e.ts >= monthAgo) s.runs.add(e.data.run);
        s.lastAt = Math.max(s.lastAt, e.ts);
        stats.set(id, s);
    }
    return REGISTRY.map((d) => {
        const s = state[d.id] || {};
        const st = stats.get(d.id);
        return {
            id: d.id,
            name: d.name,
            area: d.area,
            desc: d.desc,
            locked: Boolean(d.locked),
            deleted: Boolean(s.deleted),
            quietWithMusic: quietWithMusic(state, d.id),
            channels: Object.entries(d.channels).map(([channel, where]) => ({ channel, where, on: allows(state, d.id, channel) })),
            monthCount: st ? st.runs.size : 0,
            lastAt: st?.lastAt || null,
        };
    });
};

const norm = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Commande vocale sur la dernière annonce : « C'était quoi ? » → 'what',
 * « Coupe-le », « Ne dis plus ça » → 'cut'. Phrases courtes et exactes seulement,
 * pour ne pas avaler « coupe la lumière ».
 */
export const voiceCommand = (text) => {
    const t = norm(text).replace(/^(jean claude|jarvis|ok) /, '');
    if (/^(c etait|c est|ca etait) quoi( (ca|ce bruit|ce son|cette annonce|ce message))?( la)?$/.test(t)) return 'what';
    if (/^(qui|qu est ce qui) (vient de parler|a parle|a sonne)$/.test(t) || /^pourquoi (tu as|t as|tu viens de) parle$/.test(t)) return 'what';
    if (/^(coupe|desactive|arrete|tais)( (le|la|ca|toi))?( (pour de bon|aussi))?$/.test(t)) return 'cut';
    if (/^(ne|n) (le |la )?(dis|annonce) plus (ca|jamais ca|ce message|cette annonce)$/.test(t)) return 'cut';
    if (/^(coupe|desactive) (cette annonce|cet automatisme|cette alerte|ce message)$/.test(t)) return 'cut';
    return null;
};

/** Voix + lampe + Telegram d'un même automatisme à moins de 2 min d'écart = un seul passage. */
export const RUN_GAP_MS = 2 * 60_000;
