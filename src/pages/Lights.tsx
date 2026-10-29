import { useSearchParams } from 'react-router-dom';
import { useHomeData } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import { LightsPanel } from '../components/lights/LightsPanel';
import './Dashboard.css';

/** Écran Lumières ; ?room=<pièce> l'ouvre sur cette pièce. */
export function Lights() {
    const home = useHomeData();
    const [params, setParams] = useSearchParams();
    const live = home.lights.filter((l) => l.reachable);
    const offline = home.lights.filter((l) => !l.reachable);
    const onCount = live.filter((l) => l.level > 0).length;
    const ids = live.map((l) => l.id);

    return (
        <div className="home">
            <header className="home-top">
                <div className="home-hello">
                    <h1>Lumières</h1>
                    <span className="muted">{onCount ? `${onCount} allumée${onCount > 1 ? 's' : ''} sur ${home.lights.length}` : 'Tout est éteint'}</span>
                </div>
                <div className="home-top-right">
                    {offline.length > 0 && (
                        <span className="weather-pill warn-pill">
                            <Icon name="alert" size={18} strokeWidth={2} />
                            {offline.map((l) => l.name).join(', ')} injoignable{offline.length > 1 ? 's' : ''} : interrupteur coupé ?
                        </span>
                    )}
                    {ids.length > 0 && (
                        <button type="button" className="ghost-btn" onClick={() => home.setLevel(ids, onCount ? 0 : 70)}>
                            {onCount ? 'Tout éteindre' : 'Tout allumer'}
                        </button>
                    )}
                </div>
            </header>
            <LightsPanel home={home} room={params.get('room')}
                onRoom={(room) => setParams({ room }, { replace: true })} />
        </div>
    );
}
