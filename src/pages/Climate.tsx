import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useHomeData } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import { ClimateCard, EXTRA_MODES, fmt } from '../components/home/cards';
import { ScheduleSheet } from '../components/home/ScheduleSheet';
import { TemperatureChart } from '../components/home/TemperatureChart';
import './Dashboard.css';
import './Climate.css';

const FAN_SPEEDS = [
    { id: 'auto', label: 'Auto' },
    { id: 'quiet', label: 'Silence' },
    { id: 'low', label: 'Faible' },
    { id: 'med', label: 'Moyen' },
    { id: 'high', label: 'Fort' },
];

// Des mots plutôt que des flèches : la police n'a pas les glyphes ↗ ↘
const VANE_POSITIONS = [
    { id: 'auto', label: 'Auto' },
    { id: '1', label: 'Haut' },
    { id: '2', label: 'Mi-haut' },
    { id: '3', label: 'Milieu' },
    { id: '4', label: 'Mi-bas' },
    { id: '5', label: 'Bas' },
    { id: 'swing', label: 'Balayage' },
];

function Choices({ label, options, value, disabled, onPick }: {
    label: string;
    options: { id: string; label: string }[];
    value: string | undefined;
    disabled: boolean;
    onPick: (id: string) => void;
}) {
    return (
        <div className="fine-group" role="group" aria-label={label}>
            <span className="fine-label">{label}</span>
            <div className="chips">
                {options.map((o) => (
                    <button key={o.id} type="button" className={!disabled && value === o.id ? 'active' : ''}
                        aria-pressed={!disabled && value === o.id} disabled={disabled} onClick={() => onPick(o.id)}>
                        {o.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Écran Climat : la carte du thermostat, les températures de la maison et les réglages fins. */
export function Climate() {
    const home = useHomeData();
    const [schedule, setSchedule] = useState(false);
    const [fineOpen, setFineOpen] = useState(false);
    const thermometers = home.sensors.filter((s) => s.props.temperature != null);
    const [chartDid, setChartDid] = useState<string | null>(null);
    const chartSensor = thermometers.find((s) => s.did === chartDid) ?? thermometers[0];
    const h = home.heating;
    const off = !h?.power;

    return (
        <div className="home">
            <header className="home-top">
                <div className="home-hello"><h1>Climat</h1></div>
                <Link to="/climate/weather" className="weather-pill">
                    <Icon name="cloud" size={18} />
                    Météo, baromètre et tenue du jour
                    <Icon name="chevron" size={18} strokeWidth={2.2} />
                </Link>
            </header>

            <div className="climate-layout">
                <ClimateCard home={home} onSchedule={() => setSchedule(true)} />
                <div className="climate-side">
                    {chartSensor && (
                        <section className="card" aria-label="Températures">
                            <h2 className="card-title">Dernières 24 h · {chartSensor.name}</h2>
                            <TemperatureChart key={chartSensor.did} did={chartSensor.did} name={chartSensor.name} />
                            {thermometers.length > 1 && (
                                <ul className="thermo-list">
                                    {thermometers.map((s) => (
                                        <li key={s.did}>
                                            <button type="button" className={s.did === chartSensor.did ? 'active' : ''}
                                                aria-pressed={s.did === chartSensor.did} onClick={() => setChartDid(s.did)}>
                                                <span>{s.name}{s.room && s.room !== s.name ? <span className="muted"> · {s.room}</span> : null}</span>
                                                <span>
                                                    <strong className="mono">{fmt(s.props.temperature)}°</strong>
                                                    {s.props.humidity != null && <span className="muted"> · {fmt(s.props.humidity, 0)} %</span>}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}

                    <section className={`card fine ${fineOpen ? 'open' : ''}`} aria-label="Réglages fins">
                        <button type="button" className="fine-head" aria-expanded={fineOpen} onClick={() => setFineOpen((o) => !o)}>
                            <span>
                                <strong>Réglages fins</strong>
                                <span className="muted">Mode sec ou ventilation, vitesse du ventilateur, volet</span>
                            </span>
                            <Icon name="chevron" size={20} strokeWidth={2.2} />
                        </button>
                        {fineOpen && (
                            <>
                                {off && <p className="muted fine-note">La clim est à l'arrêt : allume-la pour régler la ventilation et le volet.</p>}
                                <Choices label="Autres modes" options={EXTRA_MODES} value={off ? undefined : h?.mode} disabled={false}
                                    onPick={(mode) => home.controlHeating({ mode, power: true })} />
                                <Choices label="Ventilateur" options={FAN_SPEEDS} value={h?.fanSpeed} disabled={off}
                                    onPick={(fanSpeed) => home.controlHeating({ fanSpeed })} />
                                <Choices label="Volet" options={VANE_POSITIONS} value={h?.vaneVertical} disabled={off}
                                    onPick={(vaneVertical) => home.controlHeating({ vaneVertical })} />
                            </>
                        )}
                    </section>
                </div>
            </div>

            <AnimatePresence>
                {schedule && home.thermostat && (
                    <ScheduleSheet key="schedule" status={home.thermostat} neverSent={!home.heating?.lastUpdated}
                        onUpdate={home.updateThermostat} onClearOverride={() => home.overrideTarget(null)}
                        onClose={() => setSchedule(false)} />
                )}
            </AnimatePresence>
        </div>
    );
}
