import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icon, type IconName } from '../components/Icon';
import './AppLauncher.css';

interface AppItem {
    id: string;
    name: string;
    icon: IconName;
    description: string;
    path: string;
}

const APPS: AppItem[] = [
    { id: 'home', name: 'Accueil', icon: 'home', description: 'Tableau de bord de la maison', path: '/' },
    { id: 'lights', name: 'Lumières', icon: 'lights', description: 'Toutes les lampes Hue', path: '/lights' },
    { id: 'rooms', name: 'Pièces', icon: 'rooms', description: 'Lampes par pièce', path: '/rooms' },
    { id: 'scenes', name: 'Scènes', icon: 'scenes', description: 'Ambiances enregistrées', path: '/scenes' },
    { id: 'stats', name: 'Statistiques', icon: 'stats', description: 'Consommation et usage', path: '/stats' },
    { id: 'agent', name: 'Agent', icon: 'agent', description: 'Assistant IA', path: '/agent' },
    { id: 'music', name: 'Musique', icon: 'music', description: 'Playlists YouTube', path: '/music' },
    { id: 'google-home', name: 'Cast & capteurs', icon: 'cast', description: 'Enceintes Cast et Zigbee', path: '/google-home' },
    { id: 'rules', name: 'Règles', icon: 'rules', description: 'Automatisations', path: '/rules' },
    { id: 'heating', name: 'Chauffage', icon: 'heating', description: 'Pompe à chaleur', path: '/heating' },
    { id: 'privacy', name: 'Confidentialité', icon: 'privacy', description: 'Où vont tes données', path: '/privacy' },
];

const ease = [0.2, 0.8, 0.2, 1] as const;

export function AppLauncher() {
    return (
        <div className="app-launcher">
            <motion.div className="launcher-header"
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>
                <span className="launcher-kicker">SYSTÈME</span>
                <h1>Applications</h1>
                <p>{APPS.length} modules disponibles</p>
            </motion.div>

            <div className="apps-grid">
                {APPS.map((app, i) => (
                    <motion.div key={app.id}
                        initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
                        animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
                        transition={{ duration: 0.55, delay: 0.08 + i * 0.045, ease }}>
                        <Link to={app.path} className="app-card">
                            <span className="app-index">{String(i + 1).padStart(2, '0')}</span>
                            <span className="app-icon"><Icon name={app.icon} size={26} strokeWidth={1.6} /></span>
                            <span className="app-text">
                                <span className="app-name">{app.name}</span>
                                <span className="app-description">{app.description}</span>
                            </span>
                            <span className="app-arrow" aria-hidden="true">→</span>
                        </Link>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
