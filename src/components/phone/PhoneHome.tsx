import { useNavigate } from 'react-router-dom';
import type { DashLight, Home } from '../../hooks/useHome';
import { Icon } from '../Icon';
import { MomentButton } from '../MomentButton';
import { HueStatus, RoomCard, fmt } from '../home/cards';
import { HomeWidgets } from '../home/widgets/registry';
import type { WidgetId } from '../home/widgets/meta';
import type { useHomeWidgets } from '../home/widgets/useHomeWidgets';
import './PhoneHome.css';

/**
 * Accueil du téléphone, sur une colonne : d'abord « Maintenant » (3 cartes au plus, le reste
 * derrière « Tout voir »), puis les teintes et les pièces.
 */
export function PhoneHome({ home, roomLights, onAdd, widgets, shown, more, onShowAll }: {
    home: Home;
    roomLights: [string, DashLight[]][];
    onAdd: () => void;
    /** Même liste que la tablette, calculée par le Pi */
    widgets: ReturnType<typeof useHomeWidgets>;
    /** Les cartes montrées (phoneLayout) */
    shown: WidgetId[];
    /** Combien d'autres sont derrière « Tout voir » */
    more: number;
    onShowAll: () => void;
}) {
    const navigate = useNavigate();
    const climate = home.sensors.find((s) => s.props.temperature != null);
    const openDoors = home.sensors.filter((s) => s.type === 'door' && s.props.isOpen);

    return (
        <div className="home phone">
            <header className="phone-head">
                <div>
                    <h1>Maison</h1>
                    <div className="muted">
                        {climate?.name ?? 'Salon'} <strong>{fmt(climate?.props.temperature)}°</strong>
                        {home.weather && <> · dehors {fmt(home.weather.temperature, 0)}°</>}
                    </div>
                </div>
            </header>

            {/* Une porte ouverte se voit tout de suite, sauf si la carte Maison le dit déjà */}
            {openDoors.length > 0 && !shown.includes('house') && (
                <div className="phone-alert" role="status">
                    <Icon name="door" size={20} strokeWidth={2} />
                    <span>{openDoors.map((s) => s.name).join(', ')} ouverte{openDoors.length > 1 ? 's' : ''}</span>
                </div>
            )}

            <section className="phone-now" aria-label="Maintenant">
                <div className="now-head">
                    <h2>Maintenant</h2>
                    {more > 0 && (
                        <button type="button" className="now-all" aria-haspopup="dialog" onClick={onShowAll}>
                            Tout voir <span>({more})</span>
                            <Icon name="chevron" size={16} strokeWidth={2.4} />
                        </button>
                    )}
                </div>
                <HomeWidgets ctx={{ home, onAdd, itemOf: widgets.itemOf }} ids={shown} />
                {!shown.length && <p className="now-empty">Rien d’urgent pour le moment.</p>}
            </section>

            {home.moments.length > 0 && (
                <>
                    <h2 className="phone-section">Teintes</h2>
                    <div className="phone-moments">
                        {home.moments.map((m) => <MomentButton key={m.id} moment={m} onRun={home.runMoment} iconSize={18} />)}
                    </div>
                </>
            )}

            <h2 className="phone-section">Pièces</h2>
            <div className="rooms">
                {roomLights.map(([room, lights]) => (
                    <RoomCard key={room} name={room} lights={lights}
                        sensors={home.sensors.filter((s) => s.room === room)}
                        onLevel={(v) => home.setLevel(lights.map((l) => l.id), v)}
                        onOpen={() => navigate(`/lights?room=${encodeURIComponent(room)}`)} />
                ))}
                <HueStatus />
            </div>
        </div>
    );
}
