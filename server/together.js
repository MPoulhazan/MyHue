/**
 * « À deux » : petits mots entre les deux profils et liste d'épicerie commune.
 * Un mot non lu est dit sur l'enceinte du briefing quand la porte d'entrée s'ouvre
 * (le retour de l'autre), une seule fois et de jour.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import * as journal from './journal.js';
import { bus } from './events.js';
import { isEntrance } from './sensorRegistry.js';
import * as briefing from './briefing.js';
import * as myDay from './myDay.js';
import { parseTogether, sayList, noteToAnnounce } from './togetherLogic.js';

const FILE = dataFile('together.json');
const TZ = process.env.TZ || 'America/Toronto';
const MAX_NOTES = 50;
const MAX_ITEMS = 80;
// Un article coché disparaît de la liste au bout de 12 h
const DONE_KEEP_MS = 12 * 3600_000;

let state = { notes: [], grocery: [] };
try {
    if (existsSync(FILE)) state = { ...state, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
    console.error('❌ together.json illisible:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde « À deux » impossible:', err.message);
    }
};

const clean = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const id = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const personName = (pid) => myDay.getPeople().find((p) => p.id === pid)?.name || 'quelqu’un';
const known = (pid) => myDay.getPeople().some((p) => p.id === pid);
const localHour = (ts = Date.now()) => Number(new Date(ts).toLocaleTimeString('fr-CA', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).slice(0, 2));

const prune = () => {
    const now = Date.now();
    state.grocery = state.grocery.filter((g) => !g.doneAt || now - g.doneAt < DONE_KEEP_MS);
};

// --- Vue ---

export const getView = (personId = null) => {
    prune();
    return {
        grocery: state.grocery,
        notes: personId ? state.notes.filter((n) => n.to === personId || n.from === personId) : state.notes,
    };
};

// --- Petits mots ---

export const addNote = ({ from, to, text }) => {
    const body = clean(text, 300);
    if (!body) throw new Error('Le mot est vide');
    if (!known(to)) throw new Error('Destinataire inconnu');
    const note = { id: id('n'), from: known(from) ? from : null, to, text: body, at: Date.now(), readAt: null, announcedAt: null };
    state.notes = [...state.notes, note].slice(-MAX_NOTES);
    save();
    journal.log({ kind: 'system', title: `Petit mot pour ${personName(to)}`, data: { from, to } });
    return note;
};

export const markRead = (noteId) => {
    const n = state.notes.find((x) => x.id === noteId);
    if (!n) throw new Error('Mot inconnu');
    n.readAt = n.readAt || Date.now();
    save();
    return n;
};

export const deleteNote = (noteId) => {
    state.notes = state.notes.filter((x) => x.id !== noteId);
    save();
    return { ok: true };
};

// --- Liste d'épicerie ---

export const addItems = (texts, by = null) => {
    const added = [];
    for (const t of texts) {
        const text = clean(t, 60);
        if (!text) continue;
        // Déjà sur la liste (pas cochée) : on ne le met pas deux fois
        const same = state.grocery.find((g) => !g.doneAt && g.text.toLowerCase() === text.toLowerCase());
        if (same) continue;
        const item = { id: id('g'), text, by: known(by) ? by : null, at: Date.now(), doneAt: null };
        state.grocery.push(item);
        added.push(item);
    }
    state.grocery = state.grocery.slice(-MAX_ITEMS);
    save();
    return added;
};

export const toggleItem = (itemId) => {
    const g = state.grocery.find((x) => x.id === itemId);
    if (!g) throw new Error('Article inconnu');
    g.doneAt = g.doneAt ? null : Date.now();
    save();
    return g;
};

export const removeItem = (itemId) => {
    state.grocery = state.grocery.filter((x) => x.id !== itemId);
    save();
    return { ok: true };
};

export const clearDone = () => {
    state.grocery = state.grocery.filter((g) => !g.doneAt);
    save();
    return { ok: true };
};

// --- Voix ---

/** Réponse de Jean-Claude, ou null si la phrase ne concerne ni la liste ni les mots. */
export const voiceAnswer = (text, personId = null) => {
    const people = myDay.getPeople();
    const cmd = parseTogether(text, people);
    if (!cmd) return null;
    const me = personId && known(personId) ? personId : myDay.defaultPerson().id;
    prune();
    const open = state.grocery.filter((g) => !g.doneAt);
    switch (cmd.action) {
        case 'add': {
            const added = addItems(cmd.items, me);
            return added.length ? `C’est noté : ${sayList(added.map((g) => g.text))}.` : 'C’est déjà sur la liste.';
        }
        case 'list':
            return open.length ? `Sur la liste : ${sayList(open.map((g) => g.text))}.` : 'La liste est vide.';
        case 'remove': {
            const g = open.find((x) => x.text.toLowerCase().includes(String(cmd.item).toLowerCase()));
            if (!g) return `Je ne trouve pas ${cmd.item} sur la liste.`;
            toggleItem(g.id);
            return `J’ai barré ${g.text}.`;
        }
        case 'clear':
            state.grocery = [];
            save();
            return 'La liste est vide.';
        case 'note':
            if (cmd.to === me) return 'Tu veux te laisser un mot à toi-même ? Dis-moi plutôt à qui.';
            addNote({ from: me, to: cmd.to, text: cmd.text });
            return `D’accord, je le dirai à ${personName(cmd.to)}.`;
        case 'read': {
            const mine = state.notes.filter((n) => n.to === me && !n.readAt);
            if (!mine.length) return 'Pas de mot pour toi.';
            mine.forEach((n) => (n.readAt = Date.now()));
            save();
            return mine.map((n) => `${n.from ? `${personName(n.from)} te dit` : 'Un mot'} : ${n.text}.`).join(' ');
        }
        default:
            return null;
    }
};

// --- Lecture au retour ---

const onEntrance = async () => {
    const note = noteToAnnounce(state.notes, Date.now(), localHour());
    if (!note) return;
    note.announcedAt = Date.now();
    save();
    const text = `${note.from ? `Un mot de ${personName(note.from)}` : 'Un petit mot'} pour ${personName(note.to)} : ${note.text}.`;
    try {
        // On laisse le temps d'entrer avant de parler
        await new Promise((r) => setTimeout(r, 8000));
        await briefing.announce([briefing.getStatus().speaker], text, { volume: 0.5, holdMs: 15_000 });
        journal.log({ kind: 'system', title: `Petit mot lu pour ${personName(note.to)}` });
    } catch (err) {
        console.warn('[À deux] lecture du mot impossible:', err.message);
    }
};

export const start = () => {
    bus.on('sensor', ({ sensor, prop, value }) => {
        if (prop === 'isOpen' && value === true && sensor?.type === 'door' && isEntrance(sensor.name)) onEntrance().catch(() => {});
    });
};
