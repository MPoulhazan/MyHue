import { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import { PhotoButton } from './PhotoButton';
import { RATING_LABEL, type HistoryEntry } from '../../pages/outingTypes';
import './Outing.css';

// Le lendemain matin : « C'était bien ? » (maquette 4). La note sert à la recherche suivante.

const RATINGS = ['super', 'correct', 'bof'] as const;

export function ReviewBlock({ entry, onChange }: { entry: HistoryEntry; onChange: () => void }) {
    const [h, setH] = useState(entry);
    const [busy, setBusy] = useState(false);
    const evening = new Date(h.start).toDateString() === new Date().toDateString();

    const rate = async (rating: (typeof RATINGS)[number]) => {
        setBusy(true);
        try {
            const { data } = await axios.post<HistoryEntry>(`/api/day/history/${h.id}/rate`, { rating });
            setH(data);
        } catch { /* on pourra noter depuis « Nos sorties » */ } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rv">
            <span className="rv-when">{evening ? 'Ce soir' : 'Hier soir'}</span>
            <strong className="rv-q">{h.rating ? `${h.title} : ${RATING_LABEL[h.rating].toLowerCase()}, c’est noté.` : `C’était bien, ${h.title} ?`}</strong>
            {!h.rating && (
                <div className="rv-choices" role="group" aria-label="Votre avis">
                    {RATINGS.map((r) => (
                        <button key={r} type="button" className={`rv-choice r-${r}`} disabled={busy} onClick={() => rate(r)}>{RATING_LABEL[r]}</button>
                    ))}
                </div>
            )}
            {h.photo && <img className="rv-photo" src={h.photo} alt={`Souvenir : ${h.title}`} />}
            <div className="rv-actions">
                <PhotoButton entry={h} onSaved={(e) => { setH(e); onChange(); }} />
                <Link className="hs-link" to="/nos-sorties"><Icon name="list" size={16} strokeWidth={2} />Nos sorties</Link>
            </div>
            {!h.rating && <span className="rv-sub">La note aide la recherche du mercredi : plus de ce qui vous a plu.</span>}
        </div>
    );
}
