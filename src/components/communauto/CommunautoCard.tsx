import { useEffect, useState } from 'react';
import axios from 'axios';
import { communautoPoll } from '../home/widgets/polls';
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

/** Carte Communauto : lancer une recherche autour de la maison, voir l'auto trouvée. */
export function CommunautoCard() {
    const view = communautoPoll.use();
    const [busy, setBusy] = useState(false);
    const [radius, setRadius] = useState<number | null>(null);
    const [duration, setDuration] = useState<number | null>(null);
    const [autoBook, setAutoBook] = useState(false);
    // Sur le téléphone : recherche autour de soi par défaut, et rien d'annoncé à la maison
    const phone = useIsPhone();
    const [nearMe, setNearMe] = useState(phone);
    const [error, setError] = useState<string | null>(null);
    // Le « encore 27 min » avance tout seul
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, []);
    if (!view) return null;

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
    const startSearch = () => call(() => axios.post('/api/communauto/search', { radiusM: radius ?? view.radiusM, durationMin: duration ?? view.durationMin, autoBook: autoBook && view.canAutoBook, nearMe: phone && nearMe, quiet: phone, person: readDayPick() }));
    const stopSearch = () => call(() => axios.delete('/api/communauto/search'));
    const cancelBlock = () => call(() => axios.delete('/api/communauto/booking'));
    const week = view.weekCount > 0 && (
        <p className={`ca-week ${view.weekCount >= view.weekWarn ? 'warn' : ''}`}>
            {view.weekCount >= view.weekWarn ? '⚠️ ' : ''}{view.weekCount} Flex bloquée{view.weekCount > 1 ? 's' : ''} par MyHue en 7 jours{view.weekCount >= view.weekWarn ? ', on y va mollo' : ''}
        </p>
    );

    // Une Flex bloquée par MyHue : elle attend 30 min
    const b = view.booked;
    if (b) {
        const left = Math.max(0, Math.round((b.until - now) / 60_000));
        return (
            <section className="card ca-card on found" aria-label="Communauto">
                <div className="card-head">
                    <span className="card-title ca-title"><i className="ca-dot" />Communauto bloquée</span>
                    <span className="ca-pill">encore {left} min</span>
                </div>
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
                {week}
                <div className="ca-actions">
                    <button type="button" className="ca-btn" disabled={busy} onClick={cancelBlock}>{busy ? 'Annulation…' : 'Annuler le blocage'}</button>
                </div>
            </section>
        );
    }

    const s = view.search;
    if (s?.active) {
        const live = s.found.filter((c) => !c.gone);
        const left = Math.max(1, Math.round((s.until - now) / 60_000));
        return (
            <section className={`card ca-card on ${live.length ? 'found' : ''}`} aria-label="Communauto">
                <div className="card-head">
                    <span className="card-title ca-title"><i className="ca-dot live" />{view.booking ? 'Je la bloque…' : live.length ? 'Communauto trouvée' : 'Recherche Communauto'}</span>
                    <span className="ca-pill">{meters(s.radiusM)} · encore {left} min</span>
                </div>
                {s.found.length ? (
                    <ul className="ca-cars">{s.found.slice(0, 3).map((c) => <CarRow key={c.id} car={c} />)}</ul>
                ) : (
                    <p className="ca-line">
                        {s.nearMe ? 'Autour de ton téléphone. ' : ''}
                        {s.autoBook ? 'Je surveille toutes les 5 s et je bloque la première auto qui apparaît.' : `Je surveille toutes les 5 s, ${s.quiet ? 'Telegram' : 'Telegram, cuisine et lampe'} dès qu’une auto apparaît.`}
                    </p>
                )}
                <div className="ca-actions">
                    {live.length > 0 && <button type="button" className="ca-btn primary" disabled={busy} onClick={stopSearch}>J’ai réservé</button>}
                    <button type="button" className="ca-btn" disabled={busy} onClick={stopSearch}>Arrêter</button>
                </div>
            </section>
        );
    }

    const r = radius ?? view.radiusM;
    const d = duration ?? view.durationMin;
    const near = view.nearby[0];
    return (
        <section className="card ca-card" aria-label="Communauto">
            <div className="card-head">
                <span className="card-title ca-title"><i className="ca-dot" />Communauto Flex</span>
                <span className="ca-pill off">{view.updatedAt ? `${view.nearby.length} à ${meters(view.radiusM)}` : 'injoignable'}</span>
            </div>
            <p className="ca-line">
                {!view.updatedAt ? 'Communauto ne répond pas pour le moment.'
                    : near ? <>La plus proche : <b>{label(near)}</b>, {near.dist} m {near.dir}.</>
                        : `Aucune auto libre à moins de ${meters(view.radiusM)}.`}
            </p>
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
            {week}
            {error && <p className="ca-week warn" role="alert">{error}</p>}
            <div className="ca-actions">
                <button type="button" className="ca-btn primary" disabled={busy} onClick={startSearch}>{autoBook && view.canAutoBook ? 'Chercher et bloquer' : 'Lancer la recherche'}</button>
                <a className="ca-btn" href={APP_LINK}>Ouvrir l’appli</a>
            </div>
        </section>
    );
}
