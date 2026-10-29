import { Link, useNavigate } from 'react-router-dom';
import type { DashLight, Home } from '../../hooks/useHome';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { HouseCard, RoomCard, fmt } from '../home/cards';
import './PhoneHome.css';

/** Accueil du téléphone : moments, pièces et état de la maison sur une colonne. */
export function PhoneHome({ home, roomLights, onAdd }: {
    home: Home;
    roomLights: [string, DashLight[]][];
    onAdd: () => void;
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
                <Link to="/settings" className="round-btn" aria-label="Réglages">
                    <Icon name="settings" size={22} />
                </Link>
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
                        onOpen={() => navigate(`/lights?room=${encodeURIComponent(room)}`)} />
                ))}
                {!home.online.hue && !home.lights.length && <div className="muted">Pont Hue injoignable…</div>}
            </div>

            <HouseCard sensors={home.sensors} onAdd={onAdd} />
        </div>
    );
}
