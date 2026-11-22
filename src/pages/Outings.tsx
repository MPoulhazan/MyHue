import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Icon } from '../components/Icon';
import { OutingMap } from '../components/outing/OutingMap';
import { KIND_LABEL, distLabel, type OutingIdea, type OutingsView } from './outingTypes';
import { InviteSheet } from '../components/outing/InviteSheet';
import { PlanStatus } from '../components/outing/PlanStatus';
import { TeaserView, Slideshow } from '../components/outing/TeaserView';
import { readDayPick } from './myDayPick';
import './Dashboard.css';
import './Outings.css';

// Fiche sortie (lot 1 de « Sortie à deux v2 », maquette 1 du 2026-11-22)

const FILTERS: { id: string; label: string }[] = [
    { id: 'all', label: 'Tout' },
    { id: 'tonight', label: 'Ce soir' },
    { id: 'weekend', label: 'Ce week-end' },
    { id: 'free', label: 'Gratuit' },
    { id: 'resto', label: 'Resto' },
    { id: 'culture', label: 'Culture' },
];

const weekday = (ts: number) => new Date(ts).toLocaleDateString('fr-CA', { weekday: 'long' });
const shortDay = (ymd: string | null) => (ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric' }) : null);

/** Les photos du diaporama : celles déposées, sinon l'affiche seule. */
const photosOf = (idea: OutingIdea) => (idea.photos?.length ? idea.photos : idea.image ? [idea.image] : []);

function Poster({ idea, onTeaser, onPhotos }: { idea: OutingIdea; onTeaser: () => void; onPhotos: () => void }) {
    // L'image qui n'a pas pu se charger (on retente si l'idée change d'image)
    const [broken, setBroken] = useState<string | null>(null);
    const photos = photosOf(idea);
    const artist = idea.kind === 'concert' ? idea.artist || idea.title : null;
    return (
        <div className={`ot-poster k-${idea.kind}`}>
            {idea.image && broken !== idea.image
                ? <img src={idea.image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(idea.image ?? null)} />
                : <div className="ot-poster-empty" aria-hidden="true"><Icon name={idea.kind === 'resto' ? 'bowl' : idea.kind === 'concert' ? 'music' : idea.kind === 'museum' ? 'city' : 'screen'} size={52} strokeWidth={1.5} /></div>}
            <span className="ot-kind">{KIND_LABEL[idea.kind]}</span>
            {(idea.trailer || artist || photos.length > 1) && (
                <div className="ot-media">
                    {idea.trailer && (
                        <button className="ot-media-btn" onClick={onTeaser}><Icon name="play" size={18} strokeWidth={2} />{idea.kind === 'cinema' ? 'Bande-annonce' : 'Voir un extrait'}</button>
                    )}
                    {artist && (
                        <Link className="ot-media-btn alt" to={`/music?q=${encodeURIComponent(artist)}`}><Icon name="music" size={18} strokeWidth={2} />Écouter l’artiste</Link>
                    )}
                    {!idea.trailer && !artist && photos.length > 1 && (
                        <button className="ot-media-btn" onClick={onPhotos}><Icon name="grid" size={18} strokeWidth={2} />{photos.length} photos</button>
                    )}
                </div>
            )}
        </div>
    );
}

function TripBox({ idea, view }: { idea: OutingIdea; view: OutingsView }) {
    const t = idea.trip;
    if (!t || !view.home || idea.lat == null || idea.lon == null) {
        return (
            <div className="ot-trip">
                <span className="ot-label">Y aller</span>
                <p className="ot-muted">{idea.address || idea.where || 'Lieu à préciser'} : trajet inconnu, le lieu n’a pas de coordonnées.</p>
            </div>
        );
    }
    return (
        <div className="ot-trip">
            <div className="ot-map-box">
                <OutingMap home={view.home} place={{ lat: idea.lat, lon: idea.lon }} start={t.bike ? view.start : null} end={t.bike ? t.end : null} />
            </div>
            <div className="ot-trip-rows">
                <span className="ot-label">Y aller · {distLabel(t.distM)}</span>
                {t.bike != null && <div className="ot-row"><span><Icon name="bike" size={18} strokeWidth={2} />BIXI</span><strong>{t.bike} min</strong></div>}
                {t.transit != null && <div className="ot-row"><span><Icon name="metro" size={18} strokeWidth={2} />Bus ou métro</span><strong>≈ {t.transit} min</strong></div>}
                <div className="ot-row"><span><Icon name="walk" size={18} strokeWidth={2} />À pied</span><strong>{t.walk} min</strong></div>
                {t.bike != null && t.startName && <span className="ot-bikes">{t.bikes} vélo{t.bikes === 1 ? '' : 's'} à {t.startName} en ce moment</span>}
            </div>
        </div>
    );
}

export function Outings() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const [filter, setFilter] = useState('all');
    const [view, setView] = useState<OutingsView | null>(null);
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);
    const [invite, setInvite] = useState<{ ideaId?: string } | null>(null);
    const [viewer, setViewer] = useState<'teaser' | 'photos' | null>(null);

    const load = useCallback(() => {
        axios.get<OutingsView>('/api/day/outings', { params: { filter } })
            .then(({ data }) => { setView(data); setError(false); })
            .catch(() => setError(true));
    }, [filter]);

    useEffect(() => {
        load();
        const t = setInterval(load, 5 * 60_000);
        return () => clearInterval(t);
    }, [load]);

    const select = (id: string) => setParams({ id }, { replace: true });

    if (!view) {
        return <div className="home ot"><p className="muted">{error ? 'Impossible de charger les idées de sortie.' : 'Chargement…'}</p></div>;
    }

    const shown = view.ideas.filter((o) => o.match);
    const idea = shown.find((o) => o.id === params.get('id')) || shown[0] || null;
    const index = idea ? shown.indexOf(idea) : -1;

    const react = async (action: 'like' | 'done' | 'dislike') => {
        if (!idea || busy) return;
        setBusy(true);
        const next = shown[index + 1] || shown[index - 1] || null;
        await axios.post(`/api/day/outings/${idea.id}/${action}`).catch(() => {});
        if (action !== 'like' && next) select(next.id);
        setBusy(false);
        load();
    };

    const link = idea?.bookingUrl || idea?.url || null;
    const linkLabel = idea?.bookingUrl ? (idea.kind === 'resto' ? 'Réserver' : 'Billets') : 'Voir le site';
    const chips = idea
        ? [
            idea.price && { key: 'price', text: idea.price, strong: true },
            idea.duration && { key: 'dur', text: idea.duration, strong: true },
            idea.trip && { key: 'dist', text: `${distLabel(idea.trip.distM)} de la maison`, strong: false },
            idea.indoor === true && { key: 'in', text: 'Intérieur, météo sans importance', info: true },
            idea.indoor === false && { key: 'out', text: 'En plein air', info: true },
        ].filter(Boolean) as { key: string; text: string; strong?: boolean; info?: boolean }[]
        : [];

    return (
        <div className="home ot">
            <header className="ot-top">
                <div className="ot-title">
                    <button className="round-btn ot-back" aria-label="Retour à Ma journée" onClick={() => navigate('/journee')}><Icon name="back" size={22} strokeWidth={2} /></button>
                    <div>
                        <span className="ot-eyebrow">Pour vous deux</span>
                        <span className="ot-muted">
                            {idea ? `Idée ${index + 1} sur ${shown.length}` : 'Aucune idée'}{view.at ? ` · déposées ${weekday(view.at)}` : ''}
                        </span>
                    </div>
                </div>
                <div className="ot-filters" role="group" aria-label="Filtrer les idées">
                    {FILTERS.map((f) => (
                        <button key={f.id} className={`ot-chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
                    ))}
                </div>
            </header>

            {idea ? (
                <div className="ot-main">
                    <Poster idea={idea} onTeaser={() => setViewer('teaser')} onPhotos={() => setViewer('photos')} />

                    <section className="ot-info">
                        <h1>{idea.title}</h1>
                        <span className="ot-when">{[idea.when, idea.times && !idea.when?.includes(idea.times) ? `séances ${idea.times}` : null, idea.where].filter(Boolean).join(' · ')}</span>
                        {chips.length > 0 && (
                            <div className="ot-chips">
                                {chips.map((c) => <span key={c.key} className={`ot-fact ${c.info ? 'info' : ''}`}>{c.strong ? <strong>{c.text}</strong> : c.text}</span>)}
                            </div>
                        )}
                        {idea.why && <p className="ot-why">{idea.why}</p>}
                        {idea.freeLine && <p className="ot-free">{idea.freeLine}</p>}
                        {view.plan?.ideaId === idea.id && (
                            <div className="ot-plan"><PlanStatus plan={view.plan} compact onChange={load} onShowCode={() => setInvite({})} /></div>
                        )}
                        <div className="ot-actions">
                            {view.plan?.ideaId === idea.id
                                ? null
                                : view.liked === idea.id && !view.plan
                                    ? <span className="ot-liked"><Icon name="check" size={20} strokeWidth={2.5} />Ça vous tente</span>
                                    : <button className="ot-btn primary" disabled={busy} onClick={() => setInvite({ ideaId: idea.id })}>Ça nous tente</button>}
                            {link && <a className="ot-btn" href={link} target="_blank" rel="noreferrer">{linkLabel}</a>}
                            {shown.length > 1 && <button className="ot-btn" onClick={() => select((shown[index + 1] || shown[0]).id)}>Autre idée</button>}
                            <button className="ot-btn quiet" disabled={busy} onClick={() => react('dislike')}>Pas notre genre</button>
                            <button className="ot-btn quiet" disabled={busy} onClick={() => react('done')}>Déjà fait</button>
                        </div>
                    </section>

                    <TripBox idea={idea} view={view} />
                </div>
            ) : (
                <div className="ot-empty">
                    <p>{view.ideas.length ? 'Aucune idée pour ce filtre.' : 'Les idées de sortie arrivent chaque mercredi matin.'}</p>
                    {filter !== 'all' && view.ideas.length > 0 && <button className="ot-btn" onClick={() => setFilter('all')}>Voir toutes les idées</button>}
                </div>
            )}

            {shown.length > 1 && (
                <section className="ot-strip" aria-label="Les autres idées de la semaine">
                    <span className="ot-label">Les idées de la semaine</span>
                    <div className="ot-strip-row">
                        {shown.slice(0, 6).map((o) => (
                            <button key={o.id} className={`ot-mini k-${o.kind} ${o.id === idea?.id ? 'on' : ''}`} aria-pressed={o.id === idea?.id} onClick={() => select(o.id)}>
                                <span className="ot-mini-kind">{KIND_LABEL[o.kind]}{o.date ? ` · ${shortDay(o.date)}` : ''}</span>
                                <strong>{o.title}</strong>
                                <span className="ot-muted">{[o.price, o.trip && distLabel(o.trip.distM)].filter(Boolean).join(' · ') || o.where || ''}</span>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {idea && viewer === 'teaser' && idea.trailer && (
                <TeaserView idea={idea} screens={view.screens || []} liked={view.plan?.ideaId === idea.id}
                    onClose={() => setViewer(null)} onLike={() => setInvite({ ideaId: idea.id })} onDislike={() => react('dislike')} />
            )}
            {idea && viewer === 'photos' && <Slideshow title={idea.title} photos={photosOf(idea)} onClose={() => setViewer(null)} />}

            {invite && <InviteSheet ideaId={invite.ideaId} me={readDayPick()} onClose={() => { setInvite(null); load(); }} onDone={load} />}

            {view.hidden.length > 0 && (
                <p className="ot-hidden">
                    Mis de côté pour la météo : {view.hidden.map((h) => `${h.title}, ${h.reason}`).join(' ; ')}.
                </p>
            )}
        </div>
    );
}
