import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useHomeData } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import { ClimateCard } from '../components/home/cards';
import { ScheduleSheet } from '../components/home/ScheduleSheet';
import { TemperatureChart } from '../components/home/TemperatureChart';
import './Dashboard.css';
import './Climate.css';

/** Écran Climat : la carte du thermostat, la courbe du jour et l'accès aux réglages fins. */
export function Climate() {
    const home = useHomeData();
    const [schedule, setSchedule] = useState(false);
    const sensor = home.sensors.find((s) => s.props.temperature != null);

    return (
        <div className="home">
            <header className="home-top">
                <div className="home-hello"><h1>Climat</h1></div>
            </header>

            <div className="climate-layout">
                <ClimateCard home={home} onSchedule={() => setSchedule(true)} />
                <div className="climate-side">
                    {sensor && (
                        <section className="card" aria-label="Dernières 24 heures">
                            <h2 className="card-title">Dernières 24 h · {sensor.name}</h2>
                            <TemperatureChart did={sensor.did} name={sensor.name} />
                        </section>
                    )}
                    <Link to="/heating" className="card climate-more">
                        <span>
                            <strong>Réglages avancés</strong>
                            <span className="muted">Ventilation, volet, apprentissage de la télécommande</span>
                        </span>
                        <Icon name="chevron" size={20} strokeWidth={2.2} />
                    </Link>
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
