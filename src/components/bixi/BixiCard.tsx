import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import './Bixi.css';

// ── Données de /api/bixi (server/bixi.js) ────────────────────────────────────

interface Start { id: string; name: string; dist: number | null; bikes: number; scarce: boolean; fallback: boolean; trend: number | null }
interface Dest { id: string; name: string; docks: number; low: boolean; alt: boolean }
interface Trip { who: string; from: Start | null; to: Dest | null; rideMin: number | null }
interface Station { id: string; name: string; dist: number | null; bikes: number | null; docks: number | null; trend?: number | null }
interface BixiView {
    enabled: boolean;
    configured: boolean;
    season: 'open' | 'closed';
    window: boolean;
    leaveFrom: string;
    leaveTo: string;
    updatedAt: number | null;
    verdict: { level: 'ok' | 'low' | 'no'; text: string };
    home: Station[];
    trips: Trip[];
    extras: Station[];
}

const hmLabel = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const ago = (ts: number, now: number) => {
    const s = Math.max(0, Math.round((now - ts) / 1000));
    return s < 60 ? `il y a ${s} s` : `il y a ${Math.round(s / 60)} min`;
};
// « du Parc-La Fontaine / Roy » → « Parc-La Fontaine / Roy »
const short = (name: string) => name.replace(/^(du|de la|des|de l’|de)\s+/i, '');
const level = (n: number) => (n <= 0 ? 'no' : n === 1 ? 'low' : 'ok');

function useBixi() {
    const [view, setView] = useState<BixiView | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const load = useCallback(() => axios.get('/api/bixi').then(({ data }) => setView(data)).catch(() => {}), []);
    useEffect(() => {
        load();
        const t = setInterval(() => {
            load();
            setNow(Date.now());
        }, 60_000);
        return () => clearInterval(t);
    }, [load]);
    return { view, now };
}

function TripBlock({ trip }: { trip: Trip }) {
    const { from, to } = trip;
    const fromNote = !from ? '' : from.fallback ? `${from.dist} m · en secours` : from.trend != null && from.trend <= -2 ? `${from.dist} m · se vide vite` : `${from.dist} m de la maison`;
    return (
        <div className="bixi-trip">
            <div className="bixi-who">
                <b>{trip.who}</b>
                {trip.rideMin != null && <span>≈ {trip.rideMin} min<span className="bixi-long"> de vélo</span></span>}
            </div>
            <div className="bixi-route">
                <i className="bixi-pin" />
                {from ? (
                    <>
                        <span className="bixi-st" title={from.name}>{short(from.name)}<small>{fromNote}</small></span>
                        <span className={`bixi-count ${from.scarce ? 'low' : level(from.bikes)}`}><span className="bixi-long">{plural(from.bikes, 'vélo')}</span><span className="bixi-short">{from.bikes} 🚲</span></span>
                    </>
                ) : (
                    <>
                        <span className="bixi-st">Aucun vélo classique<small>dans le coin</small></span>
                        <span className="bixi-count no">0</span>
                    </>
                )}
                <i className="bixi-line" />
                <span className="bixi-ride" />
                <i className="bixi-pin end" />
                {to ? (
                    <>
                        <span className="bixi-st" title={to.name}>{short(to.name)}<small>{to.alt ? 'la préférée est pleine' : 'à l’arrivée'}</small></span>
                        <span className={`bixi-count ${to.low ? 'low' : 'ok'}`}><span className="bixi-long">{plural(to.docks, 'place')}</span><span className="bixi-short">{to.docks} P</span></span>
                    </>
                ) : (
                    <span className="bixi-st muted">Station d’arrivée inconnue</span>
                )}
            </div>
        </div>
    );
}

/** Carte BIXI de l'accueil : un trajet par personne, du vélo au départ à la place libre à l'arrivée. */
export function BixiCard() {
    const { view, now } = useBixi();
    if (!view?.enabled || !view.configured || view.season === 'closed') return null;

    const title = view.window ? `BIXI · départ ${hmLabel(view.leaveFrom)} – ${hmLabel(view.leaveTo)}` : 'BIXI';
    return (
        <section className={`card bixi-card ${view.window ? 'is-window' : ''}`} aria-label="Vélos BIXI">
            <div className="card-head">
                <span className="card-title bixi-title"><i className="bixi-dot" />{title}</span>
                <span className={`bixi-pill ${view.verdict.level}`}>{view.verdict.text}</span>
            </div>
            {view.updatedAt ? (
                <div className="bixi-trips">
                    {view.trips.map((t) => <TripBlock key={t.who} trip={t} />)}
                </div>
            ) : (
                <p className="muted">BIXI ne répond pas pour le moment.</p>
            )}
            {view.updatedAt && (
                <div className="bixi-foot">
                    <span className="bixi-chips">
                        {view.extras.map((s) => (
                            <span key={s.id} className="bixi-chip">{short(s.name)} · {s.bikes ?? '–'}{s.dist != null && s.dist > 350 ? ` (${s.dist} m)` : ''}</span>
                        ))}
                    </span>
                    <span>relevé {ago(view.updatedAt, now)}</span>
                </div>
            )}
        </section>
    );
}
