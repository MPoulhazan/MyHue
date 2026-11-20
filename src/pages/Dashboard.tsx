import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { useHomeData } from '../hooks/useHome';
import type { DashLight } from '../hooks/useHome';
import { useIsPhone } from '../hooks/useIsPhone';
import { Icon } from '../components/Icon';
import { MomentButton } from '../components/MomentButton';
import type { IconName } from '../components/Icon';
import { AddSensorSheet } from '../components/home/AddSensorSheet';
import { OUTSIDE_ROOM } from '../components/home/RoomPicker';
import { NightMode } from '../components/home/NightMode';
import { PhoneHome } from '../components/phone/PhoneHome';
import { ClimateCard, HueStatus, RoomCard, fmt, greeting, hhmm, useClock } from '../components/home/cards';
import { AllWidgetsSheet, HomeWidgets } from '../components/home/widgets/registry';
import { useHomeWidgets } from '../components/home/widgets/useHomeWidgets';
import { phoneLayout } from '../components/home/widgets/meta';
import './Dashboard.css';
import '../components/lights/LightsPanel.css';

// Conditions de Home Assistant : « sunny » le jour, « clear-night » la nuit
const weatherIcon = (condition: string): IconName =>
    condition === 'clear-night' ? 'moon' : condition === 'sunny' ? 'sun' : 'cloud';

// ── Page ─────────────────────────────────────────────────────────────────────

export function Dashboard() {
    const home = useHomeData();
    const clock = useClock();
    const navigate = useNavigate();
    const [adding, setAdding] = useState(false);
    const [allOpen, setAllOpen] = useState(false);

    // Échap ferme le panneau ouvert
    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            setAdding(false);
            setAllOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const roomLights = useMemo(() => {
        const map = new Map<string, DashLight[]>();
        // Avant la réponse du pont, une pièce Hue paraîtrait vide
        if (home.lights.length) for (const r of home.rooms) map.set(r, []);
        for (const l of home.lights) {
            if (!map.has(l.room)) map.set(l.room, []);
            map.get(l.room)!.push(l);
        }
        // Pièces sans lampe mais avec un capteur (ex. une chambre)
        // « Extérieur » n'est pas une pièce : ces capteurs-là vivent dans la carte Maison
        for (const s of home.sensors) if (s.room && s.room !== OUTSIDE_ROOM && !map.has(s.room)) map.set(s.room, []);
        return [...map.entries()];
    }, [home.rooms, home.lights, home.sensors]);

    const anyOn = home.lights.some((l) => l.reachable && l.level > 0);
    const allIds = home.lights.map((l) => l.id);
    const onCount = home.lights.filter((l) => l.reachable && l.level > 0).length;
    const phone = useIsPhone();
    const widgets = useHomeWidgets(home);
    const { states, arrangement, peek, peekAll, togglePeek } = widgets;
    const phoneView = phoneLayout(arrangement.cards, arrangement.chips, peekAll);
    const widgetCtx = { home, onAdd: () => setAdding(true), itemOf: widgets.itemOf };
    // Les pastilles touchées s'ouvrent en carte sous les autres
    const nowIds = [...arrangement.cards, ...peek];

    // Panneaux communs aux deux mises en page
    const sheets = (
        <AnimatePresence>
            {adding && <AddSensorSheet key="add" rooms={roomLights.map(([r]) => r)} onClose={() => setAdding(false)} />}
            {allOpen && (
                <AllWidgetsSheet key="all" states={states} ids={phone ? phoneView.rest : arrangement.chips} open={phone ? peekAll : peek} onClose={() => setAllOpen(false)}
                    onPick={(id) => {
                        // Ouverte en carte dans « Maintenant » pendant un moment ; déjà ouverte, elle s'en va
                        togglePeek(id);
                        setAllOpen(false);
                    }} />
            )}
        </AnimatePresence>
    );

    if (phone) {
        return (
            <>
                <PhoneHome home={home} roomLights={roomLights} onAdd={() => setAdding(true)} widgets={widgets}
                    shown={phoneView.shown} more={phoneView.rest.length} onShowAll={() => setAllOpen(true)} />
                {sheets}
            </>
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
                {home.weather && (
                    <Link to="/climate/weather" className="weather-pill">
                        <Icon name={weatherIcon(home.weather.condition)} size={18} />
                        Dehors <strong>{fmt(home.weather.temperature, 0)}°</strong>
                    </Link>
                )}
            </header>

            <div className="home-grid">
                {/* À gauche : le climat en bref, puis les teintes */}
                <div className="home-left">
                    <ClimateCard home={home} compact />
                    {home.moments.length > 0 && (
                        <section className="home-tints" aria-label="Teintes">
                            <h2 className="moments-title">Teintes</h2>
                            <div className="moments">
                                {home.moments.map((m) => <MomentButton key={m.id} moment={m} onRun={home.runMoment} />)}
                            </div>
                        </section>
                    )}
                </div>

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
                        <HueStatus />
                    </div>
                </section>

                {/* Ce qui a quelque chose à dire, du plus pressant au plus calme ; le reste derrière « Tout voir » */}
                <aside className="home-side home-now" aria-label="Maintenant">
                    <div className="now-head">
                        <h2>Maintenant</h2>
                        {arrangement.chips.length > 0 && (
                            <button type="button" className="now-all" aria-haspopup="dialog" onClick={() => setAllOpen(true)}>
                                Tout voir <span>({arrangement.chips.length})</span>
                                <Icon name="chevron" size={16} strokeWidth={2.4} />
                            </button>
                        )}
                    </div>
                    {/* La seule zone de l'accueil qui défile */}
                    <div className="now-list">
                        <HomeWidgets ctx={widgetCtx} ids={nowIds} />
                        {!nowIds.length && <p className="now-empty">Rien d’urgent pour le moment.</p>}
                    </div>
                </aside>
            </div>

            {sheets}


            <NightMode
                temperature={home.sensors.find((s) => s.props.temperature != null)?.props.temperature ?? null}
                outdoor={home.weather?.temperature ?? null}
                allClosed={!home.sensors.some((s) => s.type === 'door' && s.props.isOpen)} />
        </div>
    );
}
