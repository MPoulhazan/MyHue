import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import './AppLauncher.css';

interface AppItem {
    id: string;
    name: string;
    icon: string;
    description: string;
    path: string;
    color: string;
}

const APPS: AppItem[] = [
    {
        id: 'lights',
        name: 'Lights',
        icon: '💡',
        description: 'Control your smart lights',
        path: '/lights',
        color: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    },
    {
        id: 'rooms',
        name: 'Rooms',
        icon: '🏠',
        description: 'Organize by rooms',
        path: '/rooms',
        color: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    },
    {
        id: 'scenes',
        name: 'Scenes',
        icon: '🎬',
        description: 'Create light presets',
        path: '/scenes',
        color: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    },
    {
        id: 'stats',
        name: 'Statistics',
        icon: '📊',
        description: 'Energy & usage stats',
        path: '/stats',
        color: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    },
    {
        id: 'agent',
        name: 'Agent',
        icon: '🤖',
        description: 'AI assistant',
        path: '/agent',
        color: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    },
    {
        id: 'music',
        name: 'Music',
        icon: '🎵',
        description: 'YouTube playlists',
        path: '/music',
        color: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
    },
    {
        id: 'google-home',
        name: 'Cast Devices',
        icon: '📺',
        description: 'Google Cast control',
        path: '/google-home',
        color: 'linear-gradient(135deg, #ff9a56 0%, #ff6a88 100%)',
    },
    {
        id: 'rules',
        name: 'Rules',
        icon: '⚙️',
        description: 'Automation rules',
        path: '/rules',
        color: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    },
    {
        id: 'heating',
        name: 'Heating',
        icon: '🔥',
        description: 'Heat pump control',
        path: '/heating',
        color: 'linear-gradient(135deg, #ff6b6b 0%, #ffd93d 100%)',
    },
    {
        id: 'privacy',
        name: 'Privacy',
        icon: '🔒',
        description: 'Data transparency',
        path: '/privacy',
        color: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    },
];

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05,
            delayChildren: 0.1,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, scale: 0.8, y: 20 },
    visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
            type: 'spring' as const,
            stiffness: 300,
            damping: 24,
        },
    },
};

export function AppLauncher() {
    return (
        <motion.div
            className="app-launcher"
            initial="hidden"
            animate="visible"
            variants={containerVariants}
        >
            <div className="launcher-header">
                <h1>MyHue Apps</h1>
                <p>Tap an app to get started</p>
            </div>

            <motion.div className="apps-grid" variants={containerVariants}>
                {APPS.map((app) => (
                    <motion.div key={app.id} variants={itemVariants}>
                        <Link to={app.path} className="app-card">
                            <div
                                className="app-icon-container"
                                style={{ background: app.color }}
                            >
                                <span className="app-icon">{app.icon}</span>
                            </div>
                            <h2 className="app-name">{app.name}</h2>
                            <p className="app-description">{app.description}</p>
                        </Link>
                    </motion.div>
                ))}
            </motion.div>

            <div className="launcher-footer">
                <p>
                    💡 Tip: Press and hold to customize menu items or scroll the
                    menu bar at the top
                </p>
            </div>
        </motion.div>
    );
}
