import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Icon } from '../components/Icon';
import { PhotoButton } from '../components/outing/PhotoButton';
import { KIND_LABEL, RATING_LABEL, money, type HistoryEntry, type HistoryView } from './outingTypes';
import './Dashboard.css';
import './Outings.css';
import '../components/outing/Outing.css';

// « Nos sorties » : les souvenirs (date, lieu, photo, avis) et les dépenses du mois

const RATINGS = ['super', 'correct', 'bof'] as const;
const dayLabel = (ts: number) => new Date(ts).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'long' });
const monthLabel = () => new Date().toLocaleDateString('fr-CA', { month: 'long' });

function SpentField({ entry, onSaved }: { entry: HistoryEntry; onSaved: (e: HistoryEntry) => void }) {
    const [edit, setEdit] = useState(false);
    const [value, setValue] = useState(entry.spent != null ? String(entry.spent).replace('.', ',') : '');
    const [error, setError] = useState(false);
    const save = async () => {
        try {
            const { data } = await axios.put<HistoryEntry>(`/api/day/history/${entry.id}/spent`, { amount: value.trim() === '' ? null : value.trim() });
            onSaved(data);
            setEdit(false);
            setError(false);
        } catch {
            setError(true);
        }
    };
    if (!edit) {
        return (
            <button type="button" className={`hs-spent ${entry.spent == null ? 'unknown' : ''}`} onClick={() => setEdit(true)}
                aria-label={entry.spent == null ? 'Indiquer le montant dépensé' : `Montant : ${money(entry.spent)}, modifier`}>
                {entry.spent == null ? 'Montant ?' : money(entry.spent)}
            </button>
        );
    }
    return (
        <form className="hs-spent-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <label className="sr-only" htmlFor={`sp-${entry.id}`}>Montant dépensé à deux</label>
            <input id={`sp-${entry.id}`} inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" className={error ? 'bad' : ''} />
            <span>$</span>
            <button type="submit" className="hs-mini">OK</button>
        </form>
    );
}

function Entry({ entry, onSaved }: { entry: HistoryEntry; onSaved: (e: HistoryEntry) => void }) {
    const rate = async (rating: (typeof RATINGS)[number]) => {
        const { data } = await axios.post<HistoryEntry>(`/api/day/history/${entry.id}/rate`, { rating }).catch(() => ({ data: null }));
        if (data) onSaved(data);
    };
    return (
        <li className="hs-item">
            <div className={`hs-thumb k-${entry.kind}`}>
                {entry.photo ? <img src={entry.photo} alt={`Souvenir : ${entry.title}`} loading="lazy" /> : <span>{KIND_LABEL[entry.kind]}</span>}
            </div>
            <div className="hs-body">
                <strong>{entry.title}</strong>
                <span className="ot-muted">{dayLabel(entry.start)}{entry.where ? ` · ${entry.where}` : ''}</span>
                <div className="hs-rate" role="group" aria-label="Avis">
                    {RATINGS.map((r) => (
                        <button key={r} type="button" className={`hs-chip r-${r} ${entry.rating === r ? 'on' : ''}`} aria-pressed={entry.rating === r} onClick={() => rate(r)}>{RATING_LABEL[r]}</button>
                    ))}
                </div>
                <div className="hs-row">
                    <SpentField entry={entry} onSaved={onSaved} />
                    <PhotoButton entry={entry} onSaved={onSaved} />
                </div>
            </div>
        </li>
    );
}

export function NosSorties() {
    const navigate = useNavigate();
    const [view, setView] = useState<HistoryView | null>(null);
    const [error, setError] = useState(false);

    const load = useCallback(() => {
        axios.get<HistoryView>('/api/day/history').then(({ data }) => { setView(data); setError(false); }).catch(() => setError(true));
    }, []);
    useEffect(() => { load(); }, [load]);

    const saved = (e: HistoryEntry) => {
        setView((v) => (v ? { ...v, items: v.items.map((x) => (x.id === e.id ? e : x)) } : v));
        load();
    };

    return (
        <div className="home ot hs">
            <header className="ot-top">
                <div className="ot-title">
                    <button className="round-btn ot-back" aria-label="Retour" onClick={() => navigate(-1)}><Icon name="back" size={22} strokeWidth={2} /></button>
                    <div>
                        <span className="ot-eyebrow">Nos sorties</span>
                        <span className="ot-muted">Les souvenirs, et ce que ça a coûté</span>
                    </div>
                </div>
                {view && (
                    <div className="hs-month">
                        <span className="ot-label">En {monthLabel()}</span>
                        <strong>{view.month.count} sortie{view.month.count > 1 ? 's' : ''} · {money(view.month.total)}</strong>
                        {view.month.unknown > 0 && <span className="ot-muted">{view.month.unknown} sans montant</span>}
                    </div>
                )}
            </header>
            {!view ? (
                <p className="ot-muted">{error ? 'Impossible de charger vos sorties.' : 'Chargement…'}</p>
            ) : view.items.length ? (
                <ul className="hs-list">{view.items.map((e) => <Entry key={e.id} entry={e} onSaved={saved} />)}</ul>
            ) : (
                <div className="ot-empty">
                    <p>Pas encore de sortie ici. Après une sortie prévue avec « Ça nous tente », elle s’ajoute toute seule.</p>
                    <button className="ot-btn" onClick={() => navigate('/sorties')}>Voir les idées</button>
                </div>
            )}
        </div>
    );
}
