import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useHomeData } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import { LightsPanel } from '../components/lights/LightsPanel';
import './Dashboard.css';

interface Circadian {
    enabled: boolean;
    kelvin: number | null;
}

/** Interrupteur « suit le soleil » : le blanc des lampes allumées glisse du froid (jour) au chaud (soir). */
function SunToggle() {
    const [state, setState] = useState<Circadian | null>(null);
    useEffect(() => {
        axios.get('/api/circadian').then(({ data }) => setState(data)).catch(() => {});
    }, []);
    if (!state) return null;
    const toggle = () => {
        const enabled = !state.enabled;
        setState({ ...state, enabled });
        axios.put('/api/circadian', { enabled }).then(({ data }) => setState(data)).catch(() => setState(state));
    };
    return (
        <button type="button" className="weather-pill sun-toggle" role="switch" aria-checked={state.enabled} onClick={toggle}
            title="Blanc froid le jour, chaud le soir, sur les lampes allumées en blanc">
            <Icon name="sun" size={18} strokeWidth={2} />
            Suit le soleil{state.enabled && state.kelvin ? <span className="muted mono">{state.kelvin} K</span> : null}
            <span className={`switch small ${state.enabled ? 'on' : ''}`} aria-hidden="true"><span /></span>
        </button>
    );
}

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
                    <SunToggle />
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
