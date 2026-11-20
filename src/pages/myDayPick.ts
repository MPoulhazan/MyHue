// Profil choisi sur cet écran pour « Ma journée » : tient 10 minutes, puis retour au profil par défaut

const PICK_KEY = 'myday.pick';
const PICK_MS = 10 * 60_000;

export const readDayPick = (): string | null => {
    try {
        const p = JSON.parse(localStorage.getItem(PICK_KEY) || 'null');
        return p && Date.now() - p.at < PICK_MS ? p.id : null;
    } catch {
        return null;
    }
};

export const saveDayPick = (id: string) => {
    try {
        localStorage.setItem(PICK_KEY, JSON.stringify({ id, at: Date.now() }));
    } catch { /* stockage indisponible : le choix vaut pour cette visite */ }
};
