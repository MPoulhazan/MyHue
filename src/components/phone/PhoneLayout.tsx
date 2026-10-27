import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';
import type { useHome, DashLight } from '../../hooks/useHome';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { ClimateCard, HouseCard, RoomCard, fmt } from '../home/cards';
import Music from '../../pages/Music';
import { Agent } from '../../pages/Agent';
import './PhoneLayout.css';

type Tab = 'home' | 'climate' | 'music' | 'agent';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'home', label: 'Maison', icon: 'home' },
    { id: 'climate', label: 'Climat', icon: 'thermo' },
    { id: 'music', label: 'Musique', icon: 'music' },
    { id: 'agent', label: 'Agent', icon: 'agent' },
];

const TAB_KEY = 'myhue.phone.tab';

const loadTab = (): Tab => {
    try {
        const t = localStorage.getItem(TAB_KEY) as Tab | null;
        return t && TABS.some((x) => x.id === t) ? t : 'home';
    } catch {
        return 'home';
    }
};

/** Courbe de température des dernières 24 h (historique Home Assistant). */
function TemperatureChart({ did, name }: { did: string; name: string }) {
    const [points, setPoints] = useState<{ ts: number; temperature: number }[]>([]);
    useEffect(() => {
        axios.get(`/api/zigbee/history/${encodeURIComponent(did)}`, { params: { hours: 24 } })
            .then(({ data }) => setPoints((data.points || []).filter((p: { temperature: number | null }) => p.temperature != null)))
            .catch(() => {});
    }, [did]);

    if (points.length < 2) return <p className="muted">Pas encore assez de mesures sur 24 h.</p>;

    const W = 350;
    const H = 110;
    const t0 = points[0].ts;
    const t1 = points[points.length - 1].ts;
    const temps = points.map((p) => p.temperature);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(max - min, 1);
    const path = points
        .map((p) => `${(((p.ts - t0) / Math.max(t1 - t0, 1)) * W).toFixed(1)},${(H - 8 - ((p.temperature - min) / span) * (H - 16)).toFixed(1)}`)
        .join(' ');

    return (
        <figure className="phone-chart">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
                aria-label={`Température de ${name} sur 24 heures, entre ${fmt(min)} et ${fmt(max)} degrés`}>
                <polyline points={path} fill="none" stroke="var(--h-cool)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <figcaption className="muted">
                <span>Min {fmt(min)}°</span>
                <span>Max {fmt(max)}°</span>
            </figcaption>
        </figure>
    );
}

export function PhoneLayout({ home, roomLights, onOpenRoom, onAdd, onMenu, onSchedule, children }: {
    home: ReturnType<typeof useHome>;
    roomLights: [string, DashLight[]][];
    onOpenRoom: (room: string) => void;
    onAdd: () => void;
    onMenu: () => void;
    onSchedule: () => void;
    children?: ReactNode;
}) {
    const [tab, setTabState] = useState<Tab>(loadTab);
    const setTab = (t: Tab) => {
        setTabState(t);
        try {
            localStorage.setItem(TAB_KEY, t);
        } catch { /* stockage indisponible : l'onglet ne sera pas retenu */ }
        window.scrollTo({ top: 0 });
    };

    const climate = home.sensors.find((s) => s.props.temperature != null);
    const openDoors = home.sensors.filter((s) => s.type === 'door' && s.props.isOpen);

    return (
        <div className="home phone">
            <main className="phone-main">
                {tab === 'home' && (
                    <>
                        <header className="phone-head">
                            <div>
                                <h1>Maison</h1>
                                <div className="muted">
                                    {climate?.name ?? 'Salon'} <strong>{fmt(climate?.props.temperature)}°</strong>
                                    {home.weather && <> · dehors {fmt(home.weather.temperature, 0)}°</>}
                                </div>
                            </div>
                            <button type="button" className="round-btn" aria-label="Autres écrans" onClick={onMenu}>
                                <Icon name="menu" size={22} />
                            </button>
                        </header>

                        {openDoors.length > 0 && (
                            <div className="phone-alert" role="status">
                                <Icon name="door" size={20} strokeWidth={2} />
                                <span>{openDoors.map((s) => s.name).join(', ')} ouverte{openDoors.length > 1 ? 's' : ''}</span>
                            </div>
                        )}

                        {home.moments.length > 0 && (
                            <div className="phone-moments">
                                {home.moments.map((m) => (
                                    <button key={m.id} type="button" onClick={() => home.runMoment(m.id)}>
                                        <Icon name={m.icon as IconName} size={18} />{m.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        <h2 className="phone-section">Pièces</h2>
                        <div className="rooms">
                            {roomLights.map(([room, lights]) => (
                                <RoomCard key={room} name={room} lights={lights}
                                    sensors={home.sensors.filter((s) => s.room === room)}
                                    onLevel={(v) => home.setLevel(lights.map((l) => l.id), v)}
                                    onOpen={() => onOpenRoom(room)} />
                            ))}
                            {!home.online.hue && !home.lights.length && <div className="muted">Pont Hue injoignable…</div>}
                        </div>

                        <HouseCard sensors={home.sensors} onAdd={onAdd} />
                    </>
                )}

                {tab === 'climate' && (
                    <>
                        <header className="phone-head"><h1>Climat</h1></header>
                        <ClimateCard home={home} onSchedule={onSchedule} />
                        {climate && (
                            <section className="card" aria-label="Dernières 24 heures">
                                <h2 className="card-title">Dernières 24 h · {climate.name}</h2>
                                <TemperatureChart did={climate.did} name={climate.name} />
                            </section>
                        )}
                    </>
                )}

                {tab === 'music' && <div className="phone-embed"><Music /></div>}
                {tab === 'agent' && <div className="phone-embed phone-agent"><Agent /></div>}
            </main>

            <nav className="phone-tabs" aria-label="Navigation principale">
                {TABS.map((t) => (
                    <button key={t.id} type="button" className={tab === t.id ? 'active' : ''}
                        aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                        <Icon name={t.icon} size={24} strokeWidth={2} />
                        {t.label}
                    </button>
                ))}
            </nav>

            {children}
        </div>
    );
}
