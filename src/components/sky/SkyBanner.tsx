import { useEffect, useRef } from 'react';
import { MoonCanvas } from './MoonCanvas';
import { hOnly, hm, pct } from './sky';
import type { Sky, SkyEvent } from './sky';
import './Sky.css';

const MONTHS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];

// Étoiles du décor (positions fixes, en % de la carte)
const STARS: [number, number, number][] = [
    [3, 7, 1], [10, 19, 0.8], [18, 5, 1.3], [24, 72, 0.8], [28, 10, 1], [36, 4, 0.7], [45, 8, 1.2], [53, 3, 0.8],
    [60, 10, 1], [68, 5, 1.4], [76, 90, 0.8], [81, 7, 1], [89, 14, 0.8], [96, 5, 1.2], [97, 93, 0.9], [5, 93, 0.8], [15, 60, 0.7],
];

const eventDay = (e: SkyEvent) => {
    const d = new Date(e.ts);
    return { day: d.getDate(), month: MONTHS[d.getMonth()] };
};

function MoonColumn({ moon }: { moon: Sky['moon'] }) {
    const next = moon.up ? `se couche à ${hm(moon.set)}` : `se lève à ${hm(moon.rise)}`;
    return (
        <div className="sky-col sky-moon">
            <span className="sky-head">Lune</span>
            <MoonCanvas size={170} fraction={moon.fraction} waxing={moon.waxing} label={`${moon.name}, ${pct(moon.fraction)} éclairée`} />
            <div className="sky-moon-text">
                <strong>{moon.name}</strong>
                <span className="muted">{pct(moon.fraction)} éclairée · {next}</span>
            </div>
            <p className="muted">Prochaine pleine lune : <b className="sky-fullname">{moon.nextFull.name}</b>, le {new Date(moon.nextFull.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</p>
        </div>
    );
}

function NightColumn({ sky }: { sky: Sky }) {
    const { hours, window, quality } = sky.night;
    const inWindow = (ts: number) => window != null && ts >= window.from && ts < window.to;
    const pill = window ? `Meilleure fenêtre : ${hOnly(window.from)} à ${hOnly(window.to)}` : quality.label;
    const clouds = hours.filter((h) => h.cloud != null).map((h) => h.cloud as number);
    const minCloud = clouds.length ? Math.min(...clouds) : null;
    return (
        <div className="sky-col sky-night">
            <div className="sky-night-head">
                <span className="sky-head">Cette nuit</span>
                <span className={`sky-pill q-${quality.level}`}>{pill}</span>
            </div>
            <div className="sky-track">
                <div className="sky-grid sky-clouds" role="img"
                    aria-label={`Couverture nuageuse de ${hOnly(hours[0].ts)} à ${hOnly(hours[hours.length - 1].ts)}${minCloud != null ? `, au plus bas ${minCloud} %` : ''}`}>
                    {hours.map((h) => (
                        <div key={h.ts} className={`sky-hour ${inWindow(h.ts) ? 'best' : ''}`}>
                            <span className="sky-cloud-val mono">{h.cloud == null ? '–' : `${h.cloud}%`}</span>
                            <span className="sky-cloud-bar" style={{ height: Math.round((h.cloud ?? 0) * 1.05) }} />
                        </div>
                    ))}
                </div>
                <div className="sky-grid" aria-hidden="true">
                    {hours.map((h) => <span key={h.ts} className={`sky-band s-${h.sky}`} />)}
                </div>
                <div className="sky-grid sky-moonline" aria-hidden="true">
                    {hours.map((h) => <span key={h.ts} className={h.moonUp ? 'up' : ''} />)}
                </div>
                <div className="sky-grid sky-labels" aria-hidden="true">
                    {hours.map((h) => <span key={h.ts} className="mono">{new Date(h.ts).getHours()}h</span>)}
                </div>
            </div>
            <div className="sky-legend">
                <span><i className="k-cloud" />Nuages</span>
                <span><i className="k-twilight" />Crépuscule</span>
                <span><i className="k-night" />Nuit noire</span>
                <span><i className="k-moon" />Lune levée</span>
                <span className="sky-sun">Soleil couché {hm(sky.sun.set)} · levé {hm(sky.sun.rise)}</span>
            </div>
            {sky.planets.length > 0 && (
                <p className="sky-planets">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="5" /><ellipse cx="12" cy="12" rx="10" ry="3.5" transform="rotate(-20 12 12)" /></svg>
                    <span>
                        <span className="muted">Planètes : </span>
                        {sky.planets.map((p, i) => (
                            <span key={p.id}>{i > 0 && ' · '}{p.name} {p.dir}{p.from != null && p.from > hours[0].ts ? ` dès ${hOnly(p.from)}` : ''}</span>
                        ))}
                    </span>
                </p>
            )}
        </div>
    );
}

function AheadColumn({ sky }: { sky: Sky }) {
    const a = sky.aurora;
    const series = a?.series.slice(0, 24) ?? [];
    const days = Array.from(new Set(series.map((k) => new Date(k.ts).toLocaleDateString('fr-FR', { weekday: 'short' }))));
    return (
        <div className="sky-col sky-ahead">
            <span className="sky-head">À venir</span>
            <ul className="sky-events">
                {sky.events.slice(0, 3).map((e) => {
                    const d = eventDay(e);
                    return (
                        <li key={`${e.type}-${e.ts}`}>
                            <span className="sky-date"><b>{d.day}</b><span>{d.month}</span></span>
                            <span className="sky-event-text">
                                <strong>{e.title}</strong>
                                <span className={`sky-tag t-${e.level}`}>{e.label}</span>
                            </span>
                        </li>
                    );
                })}
            </ul>
            {a && (
                <div className="sky-kp">
                    <div className="sky-kp-head"><span className="muted">Aurores, Kp sur 3 jours</span><span>max {String(a.max).replace('.', ',')}</span></div>
                    <div className="sky-kp-bars" role="img" aria-label={`Indice Kp prévu sur 3 jours, maximum ${a.max}. ${a.label}`}>
                        {series.map((k) => <span key={k.ts} className={k.kp >= 6 ? 'hi' : k.kp >= 5 ? 'mid' : ''} style={{ height: `${Math.max(8, (k.kp / 9) * 100)}%` }} />)}
                    </div>
                    <div className="sky-kp-days mono" style={{ gridTemplateColumns: `repeat(${days.length || 1}, minmax(0, 1fr))` }}>
                        {days.map((d) => <span key={d}>{d}</span>)}
                    </div>
                </div>
            )}
        </div>
    );
}

export function SkyBanner({ sky }: { sky: Sky }) {
    const ref = useRef<HTMLElement>(null);
    // Arrivée depuis la carte de la home (lien …#ciel)
    useEffect(() => {
        if (window.location.hash === '#ciel') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);
    const alert = sky.aurora?.level === 'alert' ? sky.aurora : null;
    return (
        <section id="ciel" ref={ref} className={`sky-banner ${alert ? 'aurora' : ''}`} aria-label="Le ciel cette nuit">
            <span className="sky-stars" aria-hidden="true">
                {STARS.map(([x, y, r]) => <i key={`${x}-${y}`} style={{ left: `${x}%`, top: `${y}%`, width: r * 2, height: r * 2, opacity: 0.3 + r * 0.35 }} />)}
            </span>
            {alert && (
                <p className="sky-aurora-line" role="status">
                    <strong>{alert.label}</strong>
                    <span>Kp {String(alert.maxTonight).replace('.', ',')}{alert.window ? ` entre ${hOnly(alert.window.from)} et ${hOnly(alert.window.to)}` : ''}. Regarde plein nord, loin des lampadaires.</span>
                </p>
            )}
            <MoonColumn moon={sky.moon} />
            <NightColumn sky={sky} />
            <AheadColumn sky={sky} />
        </section>
    );
}
