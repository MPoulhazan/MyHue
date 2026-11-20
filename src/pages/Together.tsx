import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Icon } from '../components/Icon';

// « À deux » sur la page Ma journée : le petit mot pour moi et la liste d'épicerie commune

interface Note { id: string; from: string | null; to: string; text: string; at: number; readAt: number | null }
interface Item { id: string; text: string; by: string | null; at: number; doneAt: number | null }
interface View { notes: Note[]; grocery: Item[] }
interface Person { id: string; name: string }

const ago = (ts: number) => {
    const min = Math.round((Date.now() - ts) / 60_000);
    if (min < 60) return `il y a ${Math.max(1, min)} min`;
    const h = Math.round(min / 60);
    return h < 24 ? `il y a ${h} h` : new Date(ts).toLocaleDateString('fr-CA', { weekday: 'long' });
};

export function Together({ me, people }: { me: Person; people: Person[] }) {
    const [view, setView] = useState<View | null>(null);
    const [draft, setDraft] = useState('');
    const [writing, setWriting] = useState(false);
    const [item, setItem] = useState('');
    const other = people.find((p) => p.id !== me.id) || null;
    const name = (id: string | null) => people.find((p) => p.id === id)?.name || 'Quelqu’un';

    const load = useCallback(() => {
        axios.get<View>('/api/together', { params: { person: me.id } }).then(({ data }) => setView(data)).catch(() => {});
    }, [me.id]);
    useEffect(() => {
        load();
        const t = setInterval(load, 30_000);
        return () => clearInterval(t);
    }, [load]);

    const call = async (fn: () => Promise<unknown>) => {
        await fn().catch(() => {});
        load();
    };
    const send = () => call(async () => {
        if (!other || !draft.trim()) return;
        await axios.post('/api/together/notes', { from: me.id, to: other.id, text: draft.trim() });
        setDraft('');
        setWriting(false);
    });
    const add = () => call(async () => {
        if (!item.trim()) return;
        await axios.post('/api/together/grocery', { text: item.trim(), by: me.id });
        setItem('');
    });

    if (!view) return null;
    const forMe = view.notes.filter((n) => n.to === me.id && !n.readAt);
    const sent = other ? view.notes.filter((n) => n.from === me.id && n.to === other.id && !n.readAt).slice(-1)[0] : null;
    const open = view.grocery.filter((g) => !g.doneAt);
    const done = view.grocery.filter((g) => g.doneAt);

    return (
        <div className="md-duo">
            <section className="md-card md-note">
                <div className="md-head"><h2>Petit mot</h2>{other && !writing && <button className="md-btn quiet" onClick={() => setWriting(true)}>Écrire à {other.name}</button>}</div>
                {forMe.map((n) => (
                    <div key={n.id} className="md-note-item">
                        <span className="md-meta">{name(n.from)} · {ago(n.at)}</span>
                        <p>« {n.text} »</p>
                        <button className="md-btn" onClick={() => call(() => axios.post(`/api/together/notes/${n.id}/read`))}><Icon name="check" size={16} strokeWidth={2.5} />Lu</button>
                    </div>
                ))}
                {!forMe.length && !writing && <p className="md-sub">Pas de mot pour toi.{sent ? ` Ton mot à ${other?.name} n’est pas encore lu.` : ''}</p>}
                {writing && other && (
                    <div className="md-write">
                        <label className="md-field">
                            <span>Pour {other.name}, lu à voix haute à son retour</span>
                            <textarea rows={2} maxLength={300} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Il ne reste plus de café…" />
                        </label>
                        <div className="md-actions">
                            <button className="md-btn primary" disabled={!draft.trim()} onClick={send}>Laisser le mot</button>
                            <button className="md-btn quiet" onClick={() => { setWriting(false); setDraft(''); }}>Annuler</button>
                        </div>
                    </div>
                )}
            </section>

            <section className="md-card md-grocery">
                <div className="md-head"><h2>Épicerie</h2><span className="muted">« Jean-Claude, ajoute du lait à la liste »</span></div>
                {open.length || done.length ? (
                    <ul className="md-items">
                        {open.map((g) => (
                            <li key={g.id}><button className="md-item" onClick={() => call(() => axios.post(`/api/together/grocery/${g.id}/toggle`))}>{g.text}</button></li>
                        ))}
                        {done.map((g) => (
                            <li key={g.id}><button className="md-item done" aria-label={`${g.text}, pris`} onClick={() => call(() => axios.post(`/api/together/grocery/${g.id}/toggle`))}>{g.text}</button></li>
                        ))}
                    </ul>
                ) : <p className="md-sub">La liste est vide.</p>}
                <form className="md-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
                    <label className="md-field md-add-field"><span className="sr-only">Ajouter à la liste</span>
                        <input value={item} maxLength={120} onChange={(e) => setItem(e.target.value)} placeholder="Ajouter…" />
                    </label>
                    <button className="md-btn primary" type="submit" disabled={!item.trim()} aria-label="Ajouter"><Icon name="plus" size={18} strokeWidth={2.5} /></button>
                    {done.length > 0 && <button className="md-btn quiet" type="button" onClick={() => call(() => axios.post('/api/together/grocery/clear-done'))}>Retirer les pris</button>}
                </form>
            </section>
        </div>
    );
}
