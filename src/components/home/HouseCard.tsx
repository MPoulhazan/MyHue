import { useEffect, useState } from 'react';
import { isRoomThermo } from '../../hooks/useHome';
import type { Sensor } from '../../hooks/useHome';
import { Icon } from '../Icon';
import { WidgetCard } from './widgets/WidgetCard';

// Carte « Maison » : l'essentiel des capteurs d'un coup d'œil, tout le détail par sections

interface HouseExtras {
    stove: { found: boolean; on: boolean; since: number | null; stove: number | null; indoor: number | null; offset: number; alerting: 'away' | 'long' | null };
    balcony: { temperature: number | null; humidity: number | null; trend: 'up' | 'down' | null; today: { min: number; max: number } | null } | null;
    guard: { mode: 'alarm' | 'vacation'; since: number } | null;
}

/** Cuisinière, balcon, mode garde : rafraîchis chaque minute. */
function useHouseExtras() {
    const [x, setX] = useState<HouseExtras | null>(null);
    useEffect(() => {
        let alive = true;
        const load = () => fetch('/api/house').then((r) => (r.ok ? r.json() : null)).then((d) => alive && d && setX(d)).catch(() => {});
        load();
        const t = setInterval(load, 60_000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, []);
    return x;
}

/** Relit l'heure toutes les 30 s pour que « depuis 12 min » avance. */
function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, []);
    return now;
}

// ── Formats ──────────────────────────────────────────────────────────────────

const dec = (n: number | null | undefined, d = 1) => (n == null ? '--' : n.toFixed(d).replace('.', ','));
const hm = (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const dayShort = (ts: number) => new Date(ts).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

/** 25 min, 2 h 10, 3 j */
const dur = (ms: number) => {
    const min = Math.max(0, Math.round(ms / 60_000));
    if (min < 1) return 'moins d’une minute';
    if (min < 60) return `${min} min`;
    if (min < 24 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;
    return `${Math.floor(min / 1440)} j`;
};
/** il y a 5 min, il y a 2 h, le 19 nov. */
const ago = (t: number, now: number) => (now - t < 60_000 ? 'à l’instant' : now - t < 24 * 3600_000 ? `il y a ${dur(now - t)}` : `le ${dayShort(t)}`);
/** depuis 25 min / depuis le 19 nov. */
const sinceText = (t: number, now: number) => (now - t < 24 * 3600_000 ? `depuis ${dur(now - t)}` : `depuis le ${dayShort(t)}`);

const SILENT_MS = 6 * 3600_000; // même seuil que la règle « Capteur muet »
const ROLE_LABEL: Record<string, string> = { indoor: 'pièce', outdoor: 'balcon', stove: 'hotte' };

// ── Mini-courbe 24 h ─────────────────────────────────────────────────────────

function Spark({ did }: { did: string }) {
    const [pts, setPts] = useState<number[] | null>(null);
    useEffect(() => {
        let alive = true;
        fetch(`/api/zigbee/history/${encodeURIComponent(did)}?hours=24`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!alive || !d) return;
                const vals = (d.points || []).map((p: { temperature: number | null }) => p.temperature).filter((v: number | null): v is number => v != null);
                // Une centaine de points suffit pour 120 px
                const step = Math.max(1, Math.floor(vals.length / 100));
                setPts(vals.filter((_: number, i: number) => i % step === 0 || i === vals.length - 1));
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [did]);
    if (!pts || pts.length < 2) return <span className="house-spark" aria-hidden="true" />;
    const min = Math.min(...pts);
    const span = Math.max(Math.max(...pts) - min, 0.5);
    const line = pts.map((v, i) => `${((i / (pts.length - 1)) * 120).toFixed(1)},${(26 - ((v - min) / span) * 22).toFixed(1)}`).join(' ');
    return (
        <svg className="house-spark" viewBox="0 0 120 28" preserveAspectRatio="none" role="img"
            aria-label={`24 h : de ${dec(min)}° à ${dec(Math.max(...pts))}°`}>
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
    );
}

// ── Carte ────────────────────────────────────────────────────────────────────

export function HouseCard({ sensors, onAdd }: { sensors: Sensor[]; onAdd: () => void }) {
    const extras = useHouseExtras();
    const now = useNow();

    const doors = sensors.filter((s) => s.type === 'door');
    const open = doors.filter((s) => s.props.isOpen);
    const boxes = sensors.filter((s) => s.type !== 'door' && s.props.isOpen != null); // courrier, croquettes
    const leaks = sensors.filter((s) => s.type === 'water_leak');
    const wet = leaks.filter((s) => s.props.leak);
    const smokes = sensors.filter((s) => s.type === 'smoke');
    const smoky = smokes.filter((s) => s.props.smoke);
    const thermos = sensors.filter((s) => s.props.temperature != null);
    const room = sensors.find(isRoomThermo);
    const outdoorSensor = sensors.find((s) => s.role === 'outdoor');
    const motions = sensors.filter((s) => s.type === 'motion');
    const entrance = motions.find((s) => /entr[ée]e/i.test(s.room || s.name)) ?? motions[0];
    const batteries = sensors.map((s) => s.props.battery).filter((b): b is number => b != null);
    const lowest = batteries.length ? Math.min(...batteries) : null;
    const offline = sensors.filter((s) => !s.isOnline);
    const stove = extras?.stove;
    const balcony = extras?.balcony;

    // Fumée, puis fuite, puis cuisinière oubliée, puis porte ouverte (la plus ancienne)
    const oldestOpen = open.map((s) => ts(s.stateSince)).filter((t): t is number => t != null).sort((a, b) => a - b)[0];
    const status = smoky.length
        ? { cls: 'leak', icon: 'alert' as const, text: `Fumée : ${smoky.map((s) => s.room || s.name).join(', ')}` }
        : wet.length
        ? { cls: 'leak', icon: 'drop' as const, text: `Fuite d’eau : ${wet.map((s) => s.room || s.name).join(', ')}` }
        : stove?.on && stove.alerting && stove.since
        ? { cls: 'leak', icon: 'flame' as const, text: `Cuisinière ${stove.alerting === 'away' ? 'oubliée ?' : 'allumée'} depuis ${dur(now - stove.since)}` }
        : open.length
        ? { cls: 'alert', icon: 'door' as const, text: `${open.map((s) => s.name).join(', ')} ouverte${open.length > 1 ? 's' : ''}${oldestOpen ? ` depuis ${dur(now - oldestOpen)}` : ''}` }
        : { cls: '', icon: 'check' as const, text: leaks.length ? 'Tout est fermé et au sec' : 'Tout est fermé' };

    const statusLine = (
        <div className={`house-status ${status.cls}`}>
            <span className="house-icon"><Icon name={status.icon} size={18} strokeWidth={2.2} /></span>
            <span>{status.text}</span>
        </div>
    );

    // Trois chiffres : dedans, balcon, cuisinière (seulement quand elle chauffe)
    const outTemp = balcony?.temperature ?? null;
    const arrow = balcony?.trend === 'up' ? ' ↑' : balcony?.trend === 'down' ? ' ↓' : '';
    const chips = (
        <div className="house-chips">
            {room && <span className="house-chip"><span className="muted">Dedans</span> <b className="mono">{dec(room.props.temperature)}°</b>{room.props.humidity != null && <span className="muted mono"> · {dec(room.props.humidity, 0)} %</span>}</span>}
            {outdoorSensor && outTemp != null && <span className="house-chip"><span className="muted">Balcon</span> <b className="mono">{dec(outTemp)}°</b><span className="muted" aria-label={balcony?.trend === 'up' ? 'en hausse' : balcony?.trend === 'down' ? 'en baisse' : undefined}>{arrow}</span></span>}
            {stove?.on && stove.since && <span className="house-chip hot"><Icon name="flame" size={15} strokeWidth={2.2} /> <span>Hotte</span> <b className="mono">{dur(now - stove.since)}</b></span>}
        </div>
    );

    // Dernier passage dans l'entrée
    const lastMotion = ts(entrance?.props.lastMotion);
    const motionLine = !entrance ? null
        : entrance.pausedUntil ? <div className="house-motion muted"><Icon name="walk" size={16} /> {entrance.room || 'Entrée'} : détecteur en pause</div>
        : lastMotion == null ? null
        : <div className="house-motion muted"><Icon name="walk" size={16} /> {entrance.room || 'Entrée'} : {now - lastMotion < 2 * 3600_000 ? `passage à ${hm(lastMotion)}` : `personne depuis ${dur(now - lastMotion)}`}</div>;

    // Dans la carte : seulement ce qui cloche
    const issues = [
        ...offline.map((s) => ({ key: `off-${s.did}`, name: s.name, text: 'hors ligne' })),
        ...(lowest != null && lowest < 20 ? [{ key: 'batt', name: 'Piles', text: `${lowest} % au plus bas` }] : []),
    ].slice(0, 3);

    const seen = (s: Sensor) => ts(s.lastUpdated);

    return (
        <WidgetCard className="house" label="Maison" title="Maison"
            detail={{ title: 'Capteurs de la maison', className: 'house-sheet', body: <>
                {statusLine}

                <section className="house-section" aria-label="Sécurité">
                    <h3><Icon name="shield" size={16} /> Sécurité</h3>
                    <ul className="house-list">
                        {smokes.map((s) => (
                            <li key={s.did}><span>{s.name}</span><span className={s.props.smoke ? 'leak' : 'muted'}>
                                {s.props.smoke ? 'FUMÉE !' : s.props.smoke === false ? 'rien à signaler' : 'en attente du capteur'}</span></li>
                        ))}
                        {leaks.map((s) => (
                            <li key={s.did}><span>{s.name}</span><span className={s.props.leak ? 'leak' : 'muted'}>
                                {s.props.leak ? 'FUITE !' : s.props.leak === false ? 'au sec' : 'en attente du capteur'}</span></li>
                        ))}
                        {stove?.found && (
                            <li><span>Cuisinière</span><span className={stove.alerting ? 'leak' : stove.on ? 'warn' : 'muted'}>
                                {stove.on && stove.since
                                    ? `chauffe depuis ${dur(now - stove.since)} · ${dec(stove.stove)}° sur la hotte`
                                    : 'éteinte'}</span></li>
                        )}
                        {extras?.guard && (
                            <li><span>{extras.guard.mode === 'vacation' ? 'Mode vacances' : 'Mode alarme'}</span><span className="warn">actif {sinceText(extras.guard.since, now)}</span></li>
                        )}
                    </ul>
                </section>

                {(doors.length > 0 || boxes.length > 0) && (
                    <section className="house-section" aria-label="Ouvertures">
                        <h3><Icon name="door" size={16} /> Ouvertures</h3>
                        <ul className="house-list">
                            {doors.map((s) => {
                                const t = ts(s.stateSince);
                                return (
                                    <li key={s.did}><span>{s.name}</span><span className={s.props.isOpen ? 'warn' : 'muted'}>
                                        {s.props.isOpen ? 'ouverte' : 'fermée'}{t ? ` ${sinceText(t, now)}` : ''}</span></li>
                                );
                            })}
                            {boxes.map((s) => {
                                const t = ts(s.props.lastOpen);
                                return (
                                    <li key={s.did}><span>{s.name}</span><span className={s.props.isOpen ? 'warn' : 'muted'}>
                                        {s.props.isOpen ? 'ouverte' : t ? `ouverte ${now - t < 24 * 3600_000 ? `à ${hm(t)}` : `le ${dayShort(t)}`}` : 'fermée'}</span></li>
                                );
                            })}
                            {entrance && lastMotion != null && (
                                <li><span>{entrance.name}</span><span className="muted">mouvement {ago(lastMotion, now)}</span></li>
                            )}
                        </ul>
                    </section>
                )}

                {thermos.length > 0 && (
                    <section className="house-section" aria-label="Climat">
                        <h3><Icon name="thermo" size={16} /> Climat</h3>
                        <ul className="house-climate">
                            {thermos.map((s) => (
                                <li key={s.did}>
                                    <span className="house-climate-name">
                                        <span>{s.name}</span>
                                        <span className="muted">
                                            {ROLE_LABEL[s.role || 'indoor']}
                                            {s.role === 'outdoor' && balcony?.today ? ` · ${dec(balcony.today.min)}° / ${dec(balcony.today.max)}° aujourd’hui` : ''}
                                            {s.role === 'stove' && stove?.indoor != null && s.props.temperature != null ? ` · ${(s.props.temperature - stove.indoor) >= 0 ? '+' : '−'}${dec(Math.abs(s.props.temperature - stove.indoor))}° sur la pièce` : ''}
                                        </span>
                                    </span>
                                    <Spark did={s.did} />
                                    <span className="house-climate-val mono">
                                        {dec(s.props.temperature)}°{s.props.humidity != null && <span className="muted"> · {dec(s.props.humidity, 0)} %</span>}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className="house-section" aria-label="Santé des capteurs">
                    <h3><Icon name="battery" size={16} /> Santé des capteurs</h3>
                    <ul className="house-health">
                        {sensors.map((s) => {
                            const t = seen(s);
                            const silent = !t || now - t > SILENT_MS;
                            const b = s.props.battery;
                            return (
                                <li key={s.did}>
                                    <span>{s.name}</span>
                                    <span className={`house-batt ${b != null && b < 20 ? 'low' : ''}`} aria-label={b != null ? `Pile ${b} %` : 'Pile inconnue'}>
                                        {b != null ? <><i style={{ width: `${Math.max(4, b)}%` }} /><b className="mono">{b} %</b></> : <b className="muted">–</b>}
                                    </span>
                                    <span className={!s.isOnline || silent ? 'warn' : 'muted'}>
                                        {!s.isOnline ? 'hors ligne' : s.pausedUntil ? 'en pause' : t ? `vu ${ago(t, now)}` : 'jamais vu'}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </section>

                <button type="button" className="ghost-btn house-add" onClick={onAdd}><Icon name="plus" size={18} /> Ajouter un capteur</button>
            </> }}>
            {statusLine}
            {chips}
            {motionLine}
            {issues.length > 0 && (
                <ul className="house-list">
                    {issues.map((i) => <li key={i.key}><span>{i.name}</span><span className="warn">{i.text}</span></li>)}
                </ul>
            )}
        </WidgetCard>
    );
}
