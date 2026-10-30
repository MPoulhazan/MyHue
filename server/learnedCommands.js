/**
 * Commandes apprises : une phrase que Groq a résolue sans erreur est rejouée
 * ensuite localement, sans appel LLM. Fichier éditable à la main
 * (data/learnedCommands.json) ; une commande qui échoue au rejeu est oubliée.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { normalize, isComplex } from './intentParser.js';

const FILE = dataFile('learnedCommands.json');
const MAX_ENTRIES = 300;

// Actions qui donnent le même résultat à chaque rejeu (pas de création de règle)
const REPLAYABLE = new Set([
    'set_light_state',
    'set_group_state',
    'toggle_all',
    'activate_scene',
    'cast_youtube',
    'cast_control',
    'cast_volume',
    'set_heating',
    'set_circadian',
]);

// « monte un peu le son » donne un volume absolu : faux dès la deuxième fois
const RELATIVE = /\b(plus|moins|monte[rz]?|baisse[rz]?|augmente[rz]?|diminue[rz]?|un peu|encore|remets?|pareil)\b/;

// Politesses et mot d'activation : « Jarvis, allume le salon stp » = « allume le salon »
const FILLER = /\b(jarvis|s il te plait|s il vous plait|stp|svp|merci|peux tu|pourrais tu|tu peux|est ce que tu peux)\b/g;

export const phraseKey = (message) => normalize(message).replace(FILLER, ' ').replace(/\s+/g, ' ').trim();

let commands = {};
try {
    if (existsSync(FILE)) commands = JSON.parse(readFileSync(FILE, 'utf-8'));
} catch {
    commands = {};
}

const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(commands, null, 2));
    } catch {
        // disque plein ou en lecture seule : la mémoire reste valable jusqu'au redémarrage
    }
};

export const isLearnable = (message, actions) => {
    const key = phraseKey(message);
    return Boolean(
        key &&
            key.split(' ').length <= 14 &&
            !isComplex(message) &&
            !RELATIVE.test(key) &&
            actions.length > 0 &&
            actions.every((a) => REPLAYABLE.has(a.type) && !a.alreadyDone),
    );
};

/** { actions, message } déjà appris pour cette phrase, ou null. */
export const lookup = (message) => {
    const entry = commands[phraseKey(message)];
    return entry ? { actions: entry.actions, message: entry.message } : null;
};

export const learn = (message, actions, reply) => {
    if (!isLearnable(message, actions)) return false;
    commands[phraseKey(message)] = { actions, message: reply, learnedAt: new Date().toISOString(), uses: 0 };
    // Trop d'entrées : on oublie les moins utilisées
    const keys = Object.keys(commands);
    if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => (commands[a].uses || 0) - (commands[b].uses || 0))
            .slice(0, keys.length - MAX_ENTRIES)
            .forEach((k) => delete commands[k]);
    }
    save();
    return true;
};

export const markUsed = (message) => {
    const entry = commands[phraseKey(message)];
    if (!entry) return;
    entry.uses = (entry.uses || 0) + 1;
    entry.lastUsedAt = new Date().toISOString();
    save();
};

export const forget = (message) => {
    const key = phraseKey(message);
    if (!commands[key]) return false;
    delete commands[key];
    save();
    return true;
};

export const list = () =>
    Object.entries(commands).map(([phrase, entry]) => ({ phrase, ...entry }));
