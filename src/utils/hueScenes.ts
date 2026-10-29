// Scènes Hue rangées par pièce, nettoyées pour l'écran Lumières

export interface RoomScene {
    id: string;
    name: string;
}

interface RawScene {
    name?: string;
    type?: string;
    group?: string;
    recycle?: boolean;
}

// Noms par défaut du pont, en anglais selon l'appli qui les a créés
const FRENCH: Record<string, string> = {
    bright: 'Lumineux',
    concentrate: 'Concentration',
    read: 'Lecture',
    relax: 'Détente',
    energize: 'Stimulation',
    dimmed: 'Atténué',
    nightlight: 'Veilleuse',
};

// Déjà proposées par les ambiances de l'écran (Concentration ≈ Focus)
const BUILT_IN = new Set(['lecture', 'détente', 'veilleuse', 'concentration', 'bougie']);

// Emoji avec leurs sélecteurs de variante et liants (« Bougie 🕯️ »)
const noEmoji = (name: string) => name.replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim();
const key = (name: string) => noEmoji(name).toLowerCase();

/** Scènes de chaque pièce : traduites, sans doublon ni scène numérotée sans nom. */
export function scenesByRoom(raw: Record<string, RawScene>, roomOfGroup: Record<string, string>) {
    const byRoom: Record<string, RoomScene[]> = {};
    for (const [id, s] of Object.entries(raw)) {
        const room = s.group ? roomOfGroup[s.group] : undefined;
        if (!room || s.type !== 'GroupScene' || s.recycle || !s.name || s.name.startsWith('HIDDEN')) continue;
        const name = noEmoji(FRENCH[key(s.name)] ?? s.name);
        if (BUILT_IN.has(key(name)) || /^sc[eé]n(e|ario) \d+$/i.test(name)) continue;
        const list = (byRoom[room] ??= []);
        if (!list.some((x) => key(x.name) === key(name))) list.push({ id, name });
    }
    for (const list of Object.values(byRoom)) list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return byRoom;
}
