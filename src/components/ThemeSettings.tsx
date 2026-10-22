import { useState } from 'react';
import { getLocation, hasSavedLocation, setLocation, setPreference, sunTimes, type ThemePreference } from '../theme/theme';
import { useTheme } from '../theme/useTheme';

const OPTIONS: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: 'Clair' },
    { value: 'auto', label: 'Auto' },
    { value: 'dark', label: 'Sombre' },
];

const hhmm = (d: Date) => d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

export const ThemeSettings = () => {
    const { preference, darkness } = useTheme();
    const [locating, setLocating] = useState(false);
    const [geoError, setGeoError] = useState('');

    const times = sunTimes(new Date(), getLocation());
    // La géolocalisation n'est permise qu'en HTTPS ou sur localhost
    const canLocate = window.isSecureContext && 'geolocation' in navigator;

    const locate = () => {
        setLocating(true);
        setGeoError('');
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                setLocation({ lat: coords.latitude, lon: coords.longitude });
                setLocating(false);
            },
            () => {
                setGeoError('Position refusée ou indisponible');
                setLocating(false);
            },
            { timeout: 10_000, maximumAge: 86_400_000 },
        );
    };

    return (
        <div className="theme-settings">
            <div className="settings-section-title">Thème</div>
            <div className="theme-segment" role="radiogroup" aria-label="Thème">
                {OPTIONS.map((o) => (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={preference === o.value}
                        className={preference === o.value ? 'active' : ''}
                        onClick={() => setPreference(o.value)}
                    >
                        {o.label}
                    </button>
                ))}
            </div>

            {preference === 'auto' && (
                <div className="theme-sun">
                    {times ? (
                        <>
                            Lever <strong>{hhmm(times.sunrise)}</strong> · Coucher <strong>{hhmm(times.sunset)}</strong>
                            <br />
                            Le thème s'assombrit ~1 h avant le coucher, nuit complète ~30 min après.
                        </>
                    ) : (
                        <>Pas de lever/coucher aujourd'hui à cette latitude.</>
                    )}
                    <div className="theme-meter" aria-hidden="true">
                        <span className="theme-meter-thumb" style={{ left: `${darkness * 100}%` }} />
                    </div>
                    {hasSavedLocation() ? 'Position enregistrée.' : 'Position estimée d\'après le fuseau horaire.'}
                    {canLocate && (
                        <>
                            {' '}
                            <button type="button" className="theme-locate" onClick={locate} disabled={locating}>
                                {locating ? 'Localisation…' : 'Utiliser ma position'}
                            </button>
                        </>
                    )}
                    {geoError && <div>{geoError}</div>}
                </div>
            )}
        </div>
    );
};
