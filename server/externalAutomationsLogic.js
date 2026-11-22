/**
 * Automatismes qui tournent hors de MyHue (appli Hue, Google Home), pour les montrer en lecture seule.
 *
 * Google n'offre aucune lecture de ses routines : la liste ci-dessous a été relevée dans l'appli
 * sur la tablette murale (docs/automations-inventory.md). La mettre à jour quand on y touche.
 * `plan` : ce qui a été décidé au lot 2 (keep, remove, replaced = reprise par MyHue).
 */
export const GOOGLE_SEEN_AT = '2026-11-22'; // lot 5 : Mode chill, croquette du midi, J’ai chaud/froid, Leaving home, Classique ×2, Jazz désactivées

export const GOOGLE_ROUTINES = [
    { name: 'Mode chill', on: false, when: '08:30 la fin de semaine (et « Mode chill »)', does: 'Radio sur Salon, volume non réglé', plan: 'remove', auto: true },
    { name: 'Classique lundi mardi jeudi matin', on: false, when: '10:00 lun, mar, jeu', does: 'Salon à 20 %, puis radio', plan: 'replaced', auto: true, by: 'Classique du matin' },
    { name: 'Classique 17h Lundi Mardi', on: false, when: '17:00 lun, mar', does: 'Salon à 20 %, puis radio', plan: 'replaced', auto: true, by: 'Classique de 17 h' },
    { name: 'Jazz 17h Fin de semaine', on: false, when: '17:00 mer, jeu, ven, sam', does: 'Salon à 20 %, puis radio', plan: 'replaced', auto: true, by: 'Jazz de 17 h' },
    { name: 'La croquette du midi', on: false, when: '12:00 tous les jours', does: 'Annonce « Donnez-moi la croquette »', plan: 'remove', auto: true },
    { name: 'Away', on: true, when: 'Tout le monde est parti', does: 'Éteint des lampes du salon', plan: 'replaced', auto: true, by: 'Je pars' },
    { name: 'Home', on: true, when: 'Quelqu’un arrive', does: 'Rien', plan: 'replaced', auto: true, by: 'Je rentre' },
    { name: 'J’ai chaud', on: false, when: '« J’ai chaud »', does: '« Allume la climatisation » (sans effet)', plan: 'remove' },
    { name: 'J’ai froid', on: false, when: '« J’ai froid »', does: '« Éteins la climatisation » (sans effet)', plan: 'remove' },
    { name: 'Leaving home', on: false, when: '« I’m leaving »', does: 'Rien', plan: 'remove' },
    { name: 'Noël 17h20', on: false, when: '—', does: 'Musique de Noël', plan: 'remove' },
    { name: 'La croquette du soir', on: false, when: '—', does: 'Annonce croquette', plan: 'remove' },
    { name: 'Bedtime', on: false, when: '—', does: '—', plan: 'remove' },
    { name: 'Apéro', on: true, when: '« Apéro »', does: 'Scène Apéro au salon, annonce', plan: 'keep' },
    { name: 'Au lit', on: true, when: '« Au lit »', does: 'Éteint les lumières et la musique', plan: 'keep' },
    { name: 'Bonsoir', on: true, when: '« Bonsoir »', does: 'Annonce, puis radio', plan: 'keep' },
    { name: 'C’est pas Versailles ici', on: true, when: 'la phrase', does: 'Éteint toutes les lumières', plan: 'keep' },
    { name: 'éteint tout', on: true, when: '« éteint tout », « je me barre »', does: 'Éteint lampes et musique', plan: 'keep' },
    { name: 'Lumos', on: true, when: '« Lumos »', does: 'Allume les lumières', plan: 'keep' },
    { name: 'On boit un coup…', on: true, when: 'la phrase', does: 'Annonce', plan: 'keep' },
    { name: 'salut c’est le weekend', on: true, when: '« salut c’est le weekend »', does: 'Plante et Bibliothèque, météo', plan: 'keep' },
    { name: 'Je suis rentré', on: true, when: '« Je suis rentré »', does: 'Annonce, puis musique', plan: 'keep' },
    { name: 'I’m home', on: true, when: '« I’m home »', does: 'Musique', plan: 'keep' },
    { name: 'Good morning', on: true, when: '« Good morning »', does: 'Météo, agenda, tâches', plan: 'keep' },
    { name: 'Commuting home', on: true, when: '« Let’s go home »', does: 'Trajet, diffusion « on my way »', plan: 'keep' },
];

const SCRIPT_KIND = {
    'Leaving home': { when: 'Le Pixel 7 quitte la maison', does: 'Éteint toutes les lampes', plan: 'replaced', by: 'Je pars', auto: true },
    'Coming home': { when: 'Le Pixel 7 rentre, la nuit', does: 'Rallume la maison', plan: 'replaced', by: 'Je rentre', auto: true },
    'Hue Accessories': { when: 'Bouton de l’interrupteur', does: 'Scènes, variation, appui long = tout éteindre', plan: 'keep' },
};

/**
 * Routines de l'appli Hue (API v2 behavior_instance + behavior_script) → lignes lisibles.
 * Les interrupteurs restent listés : ce sont eux qui allument quand personne n'a rien demandé à MyHue.
 */
export const hueRows = (instances = [], scripts = []) => {
    const scriptName = new Map(scripts.map((s) => [s.id, s.metadata?.name || s.description || 'Routine']));
    return instances.map((b) => {
        const kind = scriptName.get(b.script_id) || 'Routine';
        const known = SCRIPT_KIND[kind] || { when: kind, does: '—', plan: 'keep' };
        return {
            name: b.metadata?.name || kind,
            on: b.enabled !== false,
            ...known,
        };
    });
};

/** Libellé court de la décision, pour l'étiquette. */
export const planLabel = (r) =>
    r.plan === 'remove' ? 'À retirer' : r.plan === 'replaced' ? `Reprise par MyHue${r.by ? ` (${r.by})` : ''}` : 'Gardée';
