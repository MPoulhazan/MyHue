import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { useHome } from '../hooks/useHome';
import type { DashLight } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { AgentBar } from '../components/AgentBar';
import { AddSensorSheet } from '../components/home/AddSensorSheet';
import { NightMode } from '../components/home/NightMode';
import { PhoneLayout } from '../components/phone/PhoneLayout';
import { ScheduleSheet } from '../components/home/ScheduleSheet';
import { ClimateCard, HouseCard, Journal, MenuSheet, RoomCard, fmt, greeting, hhmm, useClock } from '../components/home/cards';
import './Dashboard.css';
import '../components/lights/LightsPanel.css';

// ── Page ─────────────────────────────────────────────────────────────────────

const PHONE_QUERY = '(max-width: 760px)';

/** Téléphone : mise en page dédiée à onglets ; sinon le poste de pilotage tablette. */
function useIsPhone() {
    const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
    useEffect(() => {
        const mq = window.matchMedia(PHONE_QUERY);
        const onChange = () => setPhone(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return phone;
}

export function Dashboard() {
    const home = useHome();
    const clock = useClock();
    const navigate = useNavigate();
    const [adding, setAdding] = useState(false);
    const [menu, setMenu] = useState(false);
    const [schedule, setSchedule] = useState(false);

    // Échap ferme le panneau ouvert
    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            setAdding(false);
            setMenu(false);
            setSchedule(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const roomLights = useMemo(() => {
        const map = new Map<string, DashLight[]>();
        for (const r of home.rooms) map.set(r, []);
        for (const l of home.lights) {
            if (!map.has(l.room)) map.set(l.room, []);
            map.get(l.room)!.push(l);
        }
        // Pièces sans lampe mais avec un capteur (ex. une chambre)
        for (const s of home.sensors) if (s.room && !map.has(s.room)) map.set(s.room, []);
        return [...map.entries()];
    }, [home.rooms, home.lights, home.sensors]);

    const anyOn = home.lights.some((l) => l.reachable && l.level > 0);
    const allIds = home.lights.map((l) => l.id);
    const onCount = home.lights.filter((l) => l.reachable && l.level > 0).length;
    const phone = useIsPhone();

    // Panneaux communs aux deux mises en page
    const sheets = (
        <AnimatePresence>
            {adding && <AddSensorSheet key="add" rooms={roomLights.map(([r]) => r)} onClose={() => setAdding(false)} />}
            {menu && <MenuSheet key="menu" onClose={() => setMenu(false)} />}
            {schedule && home.thermostat && (
                <ScheduleSheet key="schedule" status={home.thermostat} neverSent={!home.heating?.lastUpdated}
                    onUpdate={home.updateThermostat} onClearOverride={() => home.overrideTarget(null)}
                    onClose={() => setSchedule(false)} />
            )}
        </AnimatePresence>
    );

    if (phone) {
        return (
            <PhoneLayout home={home} roomLights={roomLights}
                onAdd={() => setAdding(true)} onMenu={() => setMenu(true)}
                onSchedule={() => setSchedule(true)}>
                {sheets}
            </PhoneLayout>
        );
    }

    return (
        <div className="home">
            <header className="home-top">
                <div className="home-hello">
                    <h1>{greeting(clock)}</h1>
                    <span className="muted">
                        {clock.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · <span className="mono">{hhmm(clock)}</span>
                    </span>
                </div>
                <div className="home-top-right">
                    {home.weather && (
                        <span className="weather-pill">
                            <Icon name={/sun|clear/i.test(home.weather.condition) ? 'sun' : 'cloud'} size={18} />
                            Dehors <strong>{fmt(home.weather.temperature, 0)}°</strong>
                        </span>
                    )}
                    <button type="button" className="round-btn" aria-label="Autres écrans" onClick={() => setMenu(true)}>
                        <Icon name="menu" size={22} />
                    </button>
                </div>
            </header>

            <div className="home-grid">
                <ClimateCard home={home} onSchedule={() => setSchedule(true)} />

                <section className="home-center" aria-label="Lumières">
                    <div className="section-head">
                        <Link to="/lights" className="section-link">
                            <span className="section-link-icon"><Icon name="lights" size={18} strokeWidth={2.2} /></span>
                            <strong>Lumières</strong>
                            <span>{onCount ? `${onCount} allumée${onCount > 1 ? 's' : ''}` : 'tout est éteint'}</span>
                            <Icon name="chevron" size={18} strokeWidth={2.2} />
                        </Link>
                        {anyOn && <button type="button" className="ghost-btn" onClick={() => home.setLevel(allIds, 0)}>Tout éteindre</button>}
                    </div>
                    <div className="rooms">
                        {roomLights.map(([room, lights]) => (
                            <RoomCard key={room} name={room} lights={lights}
                                sensors={home.sensors.filter((s) => s.room === room)}
                                onLevel={(v) => home.setLevel(lights.map((l) => l.id), v)}
                                onOpen={() => navigate(`/lights?room=${encodeURIComponent(room)}`)} />
                        ))}
                        {!home.online.hue && !home.lights.length && <div className="muted">Pont Hue injoignable…</div>}
                    </div>
                    <div className="hint">Toucher : allumer ou éteindre · Glisser : intensité · Flèche : ses lampes</div>

                    {home.moments.length > 0 && (
                        <>
                            <h2 className="moments-title">Moments</h2>
                            <div className="moments">
                                {home.moments.map((m) => (
                                    <button key={m.id} type="button" onClick={() => home.runMoment(m.id)}>
                                        <Icon name={m.icon as IconName} size={20} />{m.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </section>

                <aside className="home-side">
                    <HouseCard sensors={home.sensors} onAdd={() => setAdding(true)} />
                    <Journal log={home.log} />
                </aside>
            </div>

            <div className="home-agent">
                <AgentBar onAsk={home.askAgent} chips={[]} />
            </div>

            {sheets}

            <NightMode
                temperature={home.sensors.find((s) => s.props.temperature != null)?.props.temperature ?? null}
                outdoor={home.weather?.temperature ?? null}
                allClosed={!home.sensors.some((s) => s.type === 'door' && s.props.isOpen)} />
        </div>
    );
}
