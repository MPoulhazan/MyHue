import { Link } from 'react-router-dom';
import { useHomeData } from '../hooks/useHome';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import './Dashboard.css';
import './Settings.css';

/** Tout ce qui sert rarement : configuration de la maison. */
export function Settings() {
    const home = useHomeData();
    const offline = home.sensors.filter((s) => !s.isOnline).length;
    const speakersOn = home.cast.speakers.filter((s) => s.online).length;

    const entries: { to: string; icon: IconName; label: string; hint: string }[] = [
        {
            to: '/sensors', icon: 'door', label: 'Capteurs',
            hint: home.sensors.length ? `${home.sensors.length} capteur${home.sensors.length > 1 ? 's' : ''}${offline ? `, ${offline} hors ligne` : ''} · ajouter, renommer, ranger` : 'Ajouter un capteur Zigbee',
        },
        {
            to: '/speakers', icon: 'cast', label: 'Enceintes',
            hint: home.cast.speakers.length ? `${speakersOn} sur ${home.cast.speakers.length} en ligne` : 'Enceintes Google Cast',
        },
        { to: '/rules', icon: 'rules', label: 'Automatismes', hint: 'Alertes et réactions automatiques' },
        { to: '/remote', icon: 'heating', label: 'Télécommande infrarouge', hint: 'Émetteur Broadlink, vérifier les trames' },
        { to: '/wakeword', icon: 'agent', label: 'Mot d’activation', hint: 'Enregistrer des exemples de voix' },
    ];

    return (
        <div className="home">
            <header className="home-top">
                <div className="home-hello"><h1>Réglages</h1></div>
            </header>
            <nav className="settings-list" aria-label="Réglages">
                {entries.map((e) => (
                    <Link key={e.to} to={e.to} className="settings-row">
                        <span className="settings-icon"><Icon name={e.icon} size={22} strokeWidth={2} /></span>
                        <span className="settings-text">
                            <strong>{e.label}</strong>
                            <span className="muted">{e.hint}</span>
                        </span>
                        <Icon name="chevron" size={20} strokeWidth={2.2} />
                    </Link>
                ))}
            </nav>
        </div>
    );
}
