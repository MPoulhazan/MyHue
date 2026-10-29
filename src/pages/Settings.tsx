import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import './Dashboard.css';
import './Settings.css';

const ENTRIES: { to: string; icon: IconName; label: string; hint: string }[] = [
    { to: '/rules', icon: 'rules', label: 'Automatismes', hint: 'Alertes et réactions automatiques' },
    { to: '/google-home', icon: 'cast', label: 'Capteurs et enceintes', hint: 'Capteurs Zigbee, appareils Cast' },
    { to: '/remote', icon: 'heating', label: 'Télécommande infrarouge', hint: 'Émetteur Broadlink, vérifier les trames' },
    { to: '/wakeword', icon: 'agent', label: 'Mot d’activation', hint: 'Enregistrer des exemples de voix' },
];

/** Tout ce qui sert rarement : configuration et anciens écrans. */
export function Settings() {
    return (
        <div className="home">
            <header className="home-top">
                <div className="home-hello"><h1>Réglages</h1></div>
            </header>
            <nav className="settings-list" aria-label="Réglages">
                {ENTRIES.map((e) => (
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
