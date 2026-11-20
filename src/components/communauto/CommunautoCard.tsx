import { useEffect, useState } from 'react';
import axios from 'axios';
import { communautoPoll } from '../home/widgets/polls';
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
}
export interface CommunautoView {
    updatedAt: number | null;
    error: string | null;
    radiusM: number;
    durationMin: number;
    radii: number[];
    durations: number[];
    nearby: Car[];
    search: { active: boolean; radiusM: number; startedAt: number; until: number; by: string; found: Car[] } | null;
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
                    <a className="ca-btn primary" href={APP_LINK}>Réserver</a>
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
    // Le « encore 27 min » avance tout seul
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, []);
    if (!view) return null;

    const call = async (fn: () => Promise<{ data: CommunautoView }>) => {
        setBusy(true);
        try {
            communautoPoll.publish((await fn()).data);
        } catch {
            communautoPoll.load();
        } finally {
            setBusy(false);
        }
    };
    const startSearch = () => call(() => axios.post('/api/communauto/search', { radiusM: radius ?? view.radiusM, durationMin: duration ?? view.durationMin }));
    const stopSearch = () => call(() => axios.delete('/api/communauto/search'));

    const s = view.search;
    if (s?.active) {
        const live = s.found.filter((c) => !c.gone);
        const left = Math.max(1, Math.round((s.until - now) / 60_000));
        return (
            <section className={`card ca-card on ${live.length ? 'found' : ''}`} aria-label="Communauto">
                <div className="card-head">
                    <span className="card-title ca-title"><i className="ca-dot live" />{live.length ? 'Communauto trouvée' : 'Recherche Communauto'}</span>
                    <span className="ca-pill">{meters(s.radiusM)} · encore {left} min</span>
                </div>
                {s.found.length ? (
                    <ul className="ca-cars">{s.found.slice(0, 3).map((c) => <CarRow key={c.id} car={c} />)}</ul>
                ) : (
                    <p className="ca-line">Je surveille toutes les 20 s. Telegram, cuisine et lampe dès qu’une auto apparaît.</p>
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
            <div className="ca-actions">
                <button type="button" className="ca-btn primary" disabled={busy} onClick={startSearch}>Lancer la recherche</button>
                <a className="ca-btn" href={APP_LINK}>Ouvrir l’appli</a>
            </div>
        </section>
    );
}
