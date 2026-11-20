import { useEffect, useState } from 'react';
import axios from 'axios';
import { communautoPoll } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import { useIsPhone } from '../../hooks/useIsPhone';
import { readDayPick } from '../../pages/myDayPick';
import './Communauto.css';

// ── Données de /api/communauto (server/communauto.js) ────────────────────────

export interface Car {
    id: string;
    model: string;
    color: string | null;
    electric: boolean;
    battery: number | null;
    dist: number;
    dir: string;
    street?: string | null;
    gone?: boolean;
    walk: string;
    /** Ouvre l'appli sur la fiche de cette auto */
    app?: string;
}
export interface CommunautoView {
    updatedAt: number | null;
    error: string | null;
    radiusM: number;
    durationMin: number;
    radii: number[];
    durations: number[];
    nearby: Car[];
    search: { active: boolean; radiusM: number; startedAt: number; until: number; by: string; autoBook: boolean; nearMe?: boolean; quiet?: boolean; found: Car[] } | null;
    /** La tablette est appairée : MyHue peut bloquer la Flex lui-même */
    canAutoBook: boolean;
    /** La tablette est en train de bloquer une auto */
    booking: boolean;
    booked: { car: Car; at: number; until: number } | null;
    weekCount: number;
    weekWarn: number;
}

/** Ouvre l'appli Communauto sur Android (le site si elle n'est pas installée). */
const APP_LINK = 'intent://#Intent;package=com.communauto.reservauto;S.browser_fallback_url=https%3A%2F%2Fwww.communauto.com;end';

const meters = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString('fr-CA')} km` : `${m} m`);
const label = (c: Car) => `${c.model}${c.color ? ` ${c.color}` : ''}`;

function CarRow({ car }: { car: Car }) {
    return (
        <li className={`ca-car ${car.gone ? 'gone' : ''}`}>
            <div className="ca-car-text">
                <b>{label(car)}{car.battery != null && <span className="ca-batt"> · {car.battery} %</span>}</b>
                <span>{car.gone ? 'Prise par quelqu’un d’autre' : `${car.street ? `${car.street} · ` : ''}${car.dist} m ${car.dir}`}</span>
            </div>
            {!car.gone && (
                <div className="ca-car-actions">
                    <a className="ca-btn primary" href={car.app ?? APP_LINK}>Réserver</a>
                    <a className="ca-btn" href={car.walk} target="_blank" rel="noreferrer">Y aller</a>
                </div>
            )}
        </li>
    );
}

/** Appels à /api/communauto : la réponse remplace la vue partagée, l'erreur s'affiche en clair. */
function useCommunautoCall() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const call = async (fn: () => Promise<{ data: CommunautoView }>) => {
        setBusy(true);
        setError(null);
        try {
            communautoPoll.publish((await fn()).data);
        } catch (err) {
            setError(axios.isAxiosError(err) ? err.response?.data?.error ?? err.message : String(err));
            communautoPoll.load();
        } finally {
            setBusy(false);
        }
    };
    return { busy, error, call };
}

/** Lance une recherche ; sans réglages, avec ceux par défaut du Pi. */
const searchBody = (view: CommunautoView, phone: boolean, o: { radiusM?: number; durationMin?: number; autoBook?: boolean; nearMe?: boolean } = {}) => ({
    radiusM: o.radiusM ?? view.radiusM,
    durationMin: o.durationMin ?? view.durationMin,
    autoBook: Boolean(o.autoBook && view.canAutoBook),
    // Sur le téléphone : recherche autour de soi par défaut, et rien d'annoncé à la maison
    nearMe: phone && (o.nearMe ?? true),
    quiet: phone,
    person: readDayPick(),
});

const nearestLine = (view: CommunautoView) => {
    const near = view.nearby[0];
    return !view.updatedAt ? 'Communauto ne répond pas pour le moment.'
        : near ? <>La plus proche : <b>{label(near)}</b>, {near.dist} m {near.dir}.</>
            : `Aucune auto libre à moins de ${meters(view.radiusM)}.`;
};

const WeekNote = ({ view }: { view: CommunautoView }) => view.weekCount > 0 ? (
    <p className={`ca-week ${view.weekCount >= view.weekWarn ? 'warn' : ''}`}>
        {view.weekCount} Flex bloquée{view.weekCount > 1 ? 's' : ''} par MyHue en 7 jours{view.weekCount >= view.weekWarn ? ', on y va mollo' : ''}
    </p>
) : null;

/**
 * Chercher une Communauto, avec le rayon, la durée et les options. Vit dans un panneau :
 * le détail de la carte Communauto, ou celui des autres formes de la carte Déplacements.
 */
export function CommunautoLauncher() {
    const view = communautoPoll.use();
    const phone = useIsPhone();
    const [radius, setRadius] = useState<number | null>(null);
    const [duration, setDuration] = useState<number | null>(null);
    const [autoBook, setAutoBook] = useState(false);
    const [nearMe, setNearMe] = useState(phone);
    const { busy, error, call } = useCommunautoCall();
    if (!view) return <p className="muted">Communauto pas encore lu.</p>;

    const r = radius ?? view.radiusM;
    const d = duration ?? view.durationMin;
    const start = () => call(() => axios.post('/api/communauto/search', searchBody(view, phone, { radiusM: r, durationMin: d, autoBook, nearMe })));
    return (
        <div className="ca-launcher">
            <p className="ca-line">{nearestLine(view)}</p>
            <div className="ca-pick" role="group" aria-label="Rayon">
                <span>Rayon</span>
                {view.radii.map((m) => (
                    <button key={m} type="button" className={`ca-chip ${m === r ? 'on' : ''}`} aria-pressed={m === r} onClick={() => setRadius(m)}>{meters(m)}</button>
                ))}
            </div>
            <div className="ca-pick" role="group" aria-label="Durée">
                <span>Pendant</span>
                {view.durations.map((m) => (
                    <button key={m} type="button" className={`ca-chip ${m === d ? 'on' : ''}`} aria-pressed={m === d} onClick={() => setDuration(m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>
                ))}
            </div>
            {phone && (
                <label className="ca-auto">
                    <input type="checkbox" checked={nearMe} onChange={(e) => setNearMe(e.target.checked)} />
                    <span>Autour de moi<small>la recherche suit la position de ton téléphone</small></span>
                </label>
            )}
            {view.canAutoBook && (
                <label className="ca-auto">
                    <input type="checkbox" checked={autoBook} onChange={(e) => setAutoBook(e.target.checked)} />
                    <span>Bloquer automatiquement la première<small>la tablette ouvre l’appli et la bloque pour toi</small></span>
                </label>
            )}
            <WeekNote view={view} />
            {error && <p className="ca-week warn" role="alert">{error}</p>}
            <div className="ca-actions">
                <button type="button" className="ca-btn primary" disabled={busy} onClick={start}>{autoBook && view.canAutoBook ? 'Chercher et bloquer' : 'Lancer la recherche'}</button>
                <a className="ca-btn" href={APP_LINK}>Ouvrir l’appli</a>
            </div>
        </div>
    );
}

/** Carte Communauto : lancer une recherche autour de la maison, voir l'auto trouvée. */
export function CommunautoCard() {
    const view = communautoPoll.use();
    const phone = useIsPhone();
    const { busy, error, call } = useCommunautoCall();
    // Le « encore 27 min » avance tout seul
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, []);
    if (!view) return null;

    const stopSearch = () => call(() => axios.delete('/api/communauto/search'));
    const cancelBlock = () => call(() => axios.delete('/api/communauto/booking'));

    // Une Flex bloquée par MyHue : elle attend 30 min
    const b = view.booked;
    if (b) {
        const left = Math.max(0, Math.round((b.until - now) / 60_000));
        return (
            <WidgetCard key="booked" className="ca-card on is-found" label="Communauto" title={<><i className="ca-dot" />Communauto bloquée</>}
                pills={<StatusPill level="ok">encore {left} min</StatusPill>}>
                <ul className="ca-cars">
                    <li className="ca-car">
                        <div className="ca-car-text">
                            <b>{label(b.car)}{b.car.battery != null && <span className="ca-batt"> · {b.car.battery} %</span>}</b>
                            <span>{b.car.street ? `${b.car.street} · ` : ''}{b.car.dist} m {b.car.dir}</span>
                        </div>
                        <div className="ca-car-actions">
                            <a className="ca-btn primary" href={b.car.app ?? APP_LINK}>Ouvrir l’appli</a>
                            <a className="ca-btn" href={b.car.walk} target="_blank" rel="noreferrer">Y aller</a>
                        </div>
                    </li>
                </ul>
                <WeekNote view={view} />
                {error && <p className="ca-week warn" role="alert">{error}</p>}
                <div className="ca-actions">
                    <button type="button" className="ca-btn" disabled={busy} onClick={cancelBlock}>{busy ? 'Annulation…' : 'Annuler le blocage'}</button>
                </div>
            </WidgetCard>
        );
    }

    const s = view.search;
    if (s?.active) {
        const live = s.found.filter((c) => !c.gone);
        const left = Math.max(1, Math.round((s.until - now) / 60_000));
        return (
            <WidgetCard key="search" className={`ca-card on ${live.length ? 'is-found' : ''}`} label="Communauto"
                title={<><i className="ca-dot live" />{view.booking ? 'Je la bloque…' : live.length ? 'Communauto trouvée' : 'Recherche Communauto'}</>}
                pills={<StatusPill level="ok">{meters(s.radiusM)} · encore {left} min</StatusPill>}
                detail={s.found.length > 1 ? { title: 'Autos trouvées', body: <ul className="ca-cars">{s.found.slice(0, 6).map((c) => <CarRow key={c.id} car={c} />)}</ul> } : undefined}>
                {s.found.length ? (
                    <ul className="ca-cars"><CarRow car={live[0] ?? s.found[0]} /></ul>
                ) : (
                    <p className="ca-line">
                        {s.nearMe ? 'Autour de ton téléphone. ' : ''}
                        {s.autoBook ? 'Je surveille toutes les 5 s et je bloque la première auto qui apparaît.' : `Je surveille toutes les 5 s, ${s.quiet ? 'Telegram' : 'Telegram, cuisine et lampe'} dès qu’une auto apparaît.`}
                    </p>
                )}
                {error && <p className="ca-week warn" role="alert">{error}</p>}
                <div className="ca-actions">
                    {live.length > 0 && <button type="button" className="ca-btn primary" disabled={busy} onClick={stopSearch}>J’ai réservé</button>}
                    <button type="button" className="ca-btn" disabled={busy} onClick={stopSearch}>Arrêter</button>
                </div>
            </WidgetCard>
        );
    }

    // Au repos : la plus proche et un bouton ; rayon, durée et options dans le détail
    return (
        <WidgetCard key="idle" className="ca-card" label="Communauto" title={<><i className="ca-dot" />Communauto Flex</>}
            pills={<StatusPill level="off">{view.updatedAt ? `${view.nearby.length} à ${meters(view.radiusM)}` : 'injoignable'}</StatusPill>}
            detail={{ title: 'Chercher une Communauto', className: 'ca-sheet', body: <CommunautoLauncher /> }}>
            <p className="ca-line">{nearestLine(view)}</p>
            {error && <p className="ca-week warn" role="alert">{error}</p>}
            <div className="ca-actions">
                <button type="button" className="ca-btn primary" disabled={busy} onClick={() => call(() => axios.post('/api/communauto/search', searchBody(view, phone)))}>Lancer la recherche</button>
            </div>
        </WidgetCard>
    );
}
