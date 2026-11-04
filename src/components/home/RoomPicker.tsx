import { useState } from 'react';

/** Pièce hors Hue pour les capteurs dehors (boîte aux lettres, balcon...) : pas de carte pièce. */
export const OUTSIDE_ROOM = 'Extérieur';

/**
 * Choix de la pièce d'un capteur : les pièces Hue, « Extérieur », et une pièce libre
 * (une chambre sans lampe Hue n'apparaît pas dans les pièces du pont).
 */
export function RoomPicker({ rooms, value, onChange }: { rooms: string[]; value: string | null; onChange: (room: string | null) => void }) {
    const choices = [...new Set([...rooms.filter((r) => r !== OUTSIDE_ROOM), OUTSIDE_ROOM, ...(value ? [value] : [])])];
    const [typing, setTyping] = useState(false);
    const [draft, setDraft] = useState('');

    const commit = () => {
        const r = draft.trim();
        if (r) onChange(r);
        setTyping(false);
        setDraft('');
    };

    return (
        <fieldset className="field">
            <legend>Pièce</legend>
            <div className="chips">
                {choices.map((r) => (
                    <button key={r} type="button" className={value === r ? 'active' : ''} aria-pressed={value === r}
                        onClick={() => onChange(value === r ? null : r)}>{r}</button>
                ))}
                {typing ? (
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} autoFocus
                        placeholder="Nom de la pièce" aria-label="Autre pièce"
                        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setTyping(false); }} />
                ) : (
                    <button type="button" onClick={() => setTyping(true)}>+ Autre</button>
                )}
            </div>
        </fieldset>
    );
}
