import { useEffect } from 'react';
import { HomeContext, useHome, useHomeData, isRoomThermo } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import { MomentButton } from '../components/MomentButton';
import type { IconName } from '../components/Icon';
import { RoomCard, fmt, hhmm, useClock } from '../components/home/cards';
import { HomeWidgets } from '../components/home/widgets/registry';
import { useHomeWidgets } from '../components/home/widgets/useHomeWidgets';
import './Dashboard.css';
import '../components/lights/LightsPanel.css';
import './Kitchen.css';

// ── Écran de la cuisine (Nest Hub, 1024×600) ─────────────────────────────────
//
// Affiché par le serveur via DashCast (server/kitchenDisplay.js). Lisible de loin,
// sans navigation : le Hub n'a pas de bouton retour.

/** Nombre de cartes de widgets dans la grille 2×2 */
const MAX_CARDS = 4;
/** Rechargement complet de temps en temps, pour prendre les nouvelles versions de MyHue */
const RELOAD_MS = 6 * 3600_000;

const weatherIcon = (condition: string): IconName =>
    condition === 'clear-night' ? 'moon' : condition === 'sunny' ? 'sun' : 'cloud';

/** La page vit hors de l'AppShell : elle ouvre sa propre connexion à la maison. */
export function KitchenShell() {
    const home = useHome();
    return (
        <HomeContext.Provider value={home}>
            <Kitchen />
        </HomeContext.Provider>
    );
}

function Kitchen() {
    const home = useHomeData();
    const clock = useClock();
    const { arrangement, itemOf } = useHomeWidgets(home);

    useEffect(() => {
        const t = window.setTimeout(() => window.location.reload(), RELOAD_MS);
        return () => window.clearTimeout(t);
    }, []);

    const kitchenRoom = home.rooms.find((r) => /cuisine|kitchen/i.test(r));
    const kitchenLights = kitchenRoom ? home.lights.filter((l) => l.room === kitchenRoom) : [];
    const anyOn = home.lights.some((l) => l.reachable && l.level > 0);
    const indoor = home.sensors.find((s) => s.room && /cuisine|kitchen/i.test(s.room) && isRoomThermo(s))
        ?? home.sensors.find(isRoomThermo);

    return (
        <div className="home kitchen">
            <header className="kitchen-top">
                <div className="kitchen-clock">
                    <span className="kitchen-time mono">{hhmm(clock)}</span>
                    <span className="kitchen-date">
                        {clock.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </span>
                </div>
                <div className="kitchen-weather">
                    {home.weather && (
                        <span className="kitchen-out">
                            <Icon name={weatherIcon(home.weather.condition)} size={44} />
                            <strong>{fmt(home.weather.temperature, 0)}°</strong>
                        </span>
                    )}
                    {indoor && <span className="muted">Dedans {fmt(indoor.props.temperature, 1)}°</span>}
                </div>
            </header>

            <div className="kitchen-body">
                {/* Les liens des cartes mèneraient à des écrans sans retour possible sur le Hub */}
                <section className="kitchen-widgets" aria-label="Maintenant"
                    onClickCapture={(e) => {
                        if ((e.target as HTMLElement).closest('a')) e.preventDefault();
                    }}>
                    <HomeWidgets ctx={{ home, onAdd: () => {}, itemOf }} ids={arrangement.cards.slice(0, MAX_CARDS)} />
                </section>

                <aside className="kitchen-side" aria-label="Lumières">
                    {kitchenRoom && (
                        <RoomCard name={kitchenRoom} lights={kitchenLights}
                            onLevel={(v) => home.setLevel(kitchenLights.map((l) => l.id), v)}
                            onOpen={() => {}} />
                    )}
                    {/* Trois boutons tiennent sur le Hub : le blanc neutre reste sur la tablette */}
                    {home.moments.filter((m) => m.id !== 'neutre').slice(0, 3).map((m) => (
                        <MomentButton key={m.id} moment={m} onRun={home.runMoment} className="kitchen-btn" iconSize={22} />
                    ))}
                    {anyOn && (
                        <button type="button" className="kitchen-btn" onClick={() => home.setLevel(home.lights.map((l) => l.id), 0)}>
                            <Icon name="lights" size={22} />Tout éteindre
                        </button>
                    )}
                </aside>
            </div>
        </div>
    );
}
