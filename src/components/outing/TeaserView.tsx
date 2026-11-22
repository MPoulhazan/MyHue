import { useEffect, useState } from 'react';
import axios from 'axios';
import { Icon } from '../Icon';
import type { OutingIdea, Screen } from '../../pages/outingTypes';
import './Outing.css';

// Bande-annonce en plein écran sur la tablette, ou envoyée sur le projecteur / le Hub (maquette 3)

export function TeaserView({ idea, screens, onClose, onLike, onDislike, liked }: {
    idea: OutingIdea;
    screens: Screen[];
    onClose: () => void;
    onLike: () => void;
    onDislike: () => void;
    liked: boolean;
}) {
    const [sent, setSent] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const cast = async (s: Screen) => {
        setBusy(s.id);
        setError(null);
        try {
            const { data } = await axios.post<{ screen: string }>(`/api/day/outings/${encodeURIComponent(idea.id)}/trailer`, { target: s.id });
            setSent(data.screen);
        } catch (e) {
            setError(axios.isAxiosError(e) ? e.response?.data?.error || 'Envoi impossible' : 'Envoi impossible');
        } finally {
            setBusy(null);
        }
    };

    const label = idea.kind === 'cinema' ? 'Bande-annonce' : 'Extrait';

    return (
        <div className="tz" role="dialog" aria-modal="true" aria-label={`${label} : ${idea.title}`}>
            <div className="tz-stage">
                {sent ? (
                    <div className="tz-sent">
                        <Icon name="cast" size={56} strokeWidth={1.5} />
                        <strong>{label} sur {sent}</strong>
                        <span>La vidéo joue là-bas. On peut fermer ici.</span>
                    </div>
                ) : (
                    <iframe
                        className="tz-video"
                        src={`https://www.youtube-nocookie.com/embed/${idea.trailer}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
                        title={`${label} : ${idea.title}`}
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                        // MyHue envoie « no-referrer » partout (jeton dans certaines URL) ; le lecteur YouTube
                        // refuse de jouer sans referer (erreur 153) : seulement l'origine, jamais le chemin
                        referrerPolicy="strict-origin"
                        allowFullScreen
                    />
                )}
                <div className="tz-top">
                    <div className="tz-title"><strong>{idea.title}</strong><span>{label}</span></div>
                    <button className="tz-round" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>
            </div>
            <div className="tz-bar">
                <div className="tz-group">
                    {screens.map((s) => (
                        <button key={s.id} className="tz-btn" disabled={!s.online || busy !== null} onClick={() => cast(s)}>
                            <Icon name={s.id === 'tv' ? 'screen' : 'cast'} size={20} strokeWidth={2} />
                            {busy === s.id ? 'Envoi…' : `Sur ${s.id === 'kitchen' ? 'le Hub ' : 'le '}${s.name}`}
                            {!s.online && <small>injoignable</small>}
                        </button>
                    ))}
                    {error && <span className="tz-error">{error}</span>}
                </div>
                <div className="tz-group">
                    <button className="tz-btn quiet" onClick={() => { onDislike(); onClose(); }}>Pas notre genre</button>
                    {liked
                        ? <span className="tz-liked"><Icon name="check" size={20} strokeWidth={2.5} />Ça vous tente</span>
                        : <button className="tz-btn primary" onClick={() => { onClose(); onLike(); }}>Ça nous tente</button>}
                </div>
            </div>
        </div>
    );
}

// Diaporama : expo, resto, activité. Avance toute seule toutes les 5 s.
export function Slideshow({ title, photos, onClose }: { title: string; photos: string[]; onClose: () => void }) {
    const [i, setI] = useState(0);
    const [broken, setBroken] = useState<Set<string>>(() => new Set());
    const list = photos.filter((p) => !broken.has(p));
    const n = list.length;
    const at = n ? i % n : 0;

    useEffect(() => {
        if (n < 2) return;
        const t = setInterval(() => setI((x) => x + 1), 5000);
        return () => clearInterval(t);
    }, [n]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') setI((x) => x + 1);
            if (e.key === 'ArrowLeft') setI((x) => x - 1 + n);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, n]);

    return (
        <div className="tz" role="dialog" aria-modal="true" aria-label={`Photos : ${title}`}>
            <div className="tz-stage">
                {n ? (
                    <img key={list[at]} className="tz-photo" src={list[at]} alt={`${title}, photo ${at + 1} sur ${n}`} referrerPolicy="no-referrer"
                        onError={() => setBroken((b) => new Set(b).add(list[at]))} />
                ) : <div className="tz-sent"><span>Aucune photo n’a pu s’afficher.</span></div>}
                <div className="tz-top">
                    <div className="tz-title"><strong>{title}</strong>{n > 0 && <span>Photo {at + 1} sur {n}</span>}</div>
                    <button className="tz-round" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>
                {n > 1 && (
                    <>
                        <button className="tz-round tz-prev" aria-label="Photo précédente" onClick={() => setI((x) => x - 1 + n)}><Icon name="prev" size={22} strokeWidth={2} /></button>
                        <button className="tz-round tz-next" aria-label="Photo suivante" onClick={() => setI((x) => x + 1)}><Icon name="next" size={22} strokeWidth={2} /></button>
                    </>
                )}
            </div>
        </div>
    );
}
