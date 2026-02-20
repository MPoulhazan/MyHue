import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import './Navigation.css';

type MenuKey =
    | 'lights'
    | 'rooms'
    | 'scenes'
    | 'stats'
    | 'agent'
    | 'music'
    | 'google-home'
    | 'rules'
    | 'privacy';

interface MenuItem {
    key: MenuKey;
    path: string;
    icon: string;
    label: string;
}

type MenuVisibility = Record<MenuKey, boolean>;

const MENU_ITEMS: MenuItem[] = [
    { key: 'lights', path: '/', icon: '💡', label: 'Lights' },
    { key: 'rooms', path: '/rooms', icon: '🏠', label: 'Rooms' },
    { key: 'scenes', path: '/scenes', icon: '🎬', label: 'Scenes' },
    { key: 'stats', path: '/stats', icon: '📊', label: 'Stats' },
    { key: 'agent', path: '/agent', icon: '🤖', label: 'Agent' },
    { key: 'music', path: '/music', icon: '🎵', label: 'Music' },
    {
        key: 'google-home',
        path: '/google-home',
        icon: '🏠',
        label: 'Google Home',
    },
    { key: 'rules', path: '/rules', icon: '🔔', label: 'Rules' },
    { key: 'privacy', path: '/privacy', icon: '🔒', label: 'Privacy' },
];

const STORAGE_KEY = 'myhue.menu.visibility.v1';
const ORDER_STORAGE_KEY = 'myhue.menu.order.v1';

const menuItemMap: Record<MenuKey, MenuItem> = {
    lights: MENU_ITEMS[0],
    rooms: MENU_ITEMS[1],
    scenes: MENU_ITEMS[2],
    stats: MENU_ITEMS[3],
    agent: MENU_ITEMS[4],
    music: MENU_ITEMS[5],
    'google-home': MENU_ITEMS[6],
    rules: MENU_ITEMS[7],
    privacy: MENU_ITEMS[8],
};

const getDefaultOrder = (): MenuKey[] => [
    'agent',
    'lights',
    'rooms',
    'scenes',
    'stats',
    'music',
    'google-home',
    'rules',
    'privacy',
];

const normalizeOrder = (rawOrder: unknown): MenuKey[] => {
    const defaults = getDefaultOrder();
    if (!Array.isArray(rawOrder)) return defaults;

    const valid = rawOrder.filter((key): key is MenuKey =>
        defaults.includes(key as MenuKey),
    );

    const unique = Array.from(new Set(valid));
    const missing = defaults.filter((key) => !unique.includes(key));

    return [...unique, ...missing];
};

const loadOrder = (): MenuKey[] => {
    try {
        const raw = localStorage.getItem(ORDER_STORAGE_KEY);
        if (!raw) return getDefaultOrder();
        return normalizeOrder(JSON.parse(raw));
    } catch {
        return getDefaultOrder();
    }
};

const getDefaultVisibility = (): MenuVisibility => ({
    lights: true,
    rooms: true,
    scenes: true,
    stats: true,
    agent: true,
    music: true,
    'google-home': true,
    rules: true,
    privacy: true,
});

const loadVisibility = (): MenuVisibility => {
    const defaults = getDefaultVisibility();

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaults;

        const parsed = JSON.parse(raw) as Partial<MenuVisibility>;

        return {
            lights: parsed.lights ?? defaults.lights,
            rooms: parsed.rooms ?? defaults.rooms,
            scenes: parsed.scenes ?? defaults.scenes,
            stats: parsed.stats ?? defaults.stats,
            agent: parsed.agent ?? defaults.agent,
            music: parsed.music ?? defaults.music,
            'google-home': parsed['google-home'] ?? defaults['google-home'],
            rules: parsed.rules ?? defaults.rules,
            privacy: parsed.privacy ?? defaults.privacy,
        };
    } catch {
        return defaults;
    }
};

export const Navigation = () => {
    const location = useLocation();
    const settingsRef = useRef<HTMLDivElement | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [visibility, setVisibility] = useState<MenuVisibility>(() =>
        loadVisibility(),
    );
    const [menuOrder, setMenuOrder] = useState<MenuKey[]>(() => loadOrder());
    const [draggedKey, setDraggedKey] = useState<MenuKey | null>(null);
    const [dragOverKey, setDragOverKey] = useState<MenuKey | null>(null);

    const isActive = (path: string) => location.pathname === path;

    const orderedMenuItems = useMemo(
        () => menuOrder.map((key) => menuItemMap[key]),
        [menuOrder],
    );

    const visibleMenuItems = useMemo(
        () => orderedMenuItems.filter((item) => visibility[item.key]),
        [orderedMenuItems, visibility],
    );

    const toggleMenuVisibility = (key: MenuKey) => {
        setVisibility((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    };

    const resetDisplaySettings = () => {
        const defaultVisibility = getDefaultVisibility();
        const defaultOrder = getDefaultOrder();

        setVisibility(defaultVisibility);
        setMenuOrder(defaultOrder);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultVisibility));
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(defaultOrder));
    };

    const persistOrder = (nextOrder: MenuKey[]) => {
        setMenuOrder(nextOrder);
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
    };

    const handleDragStart = (key: MenuKey) => {
        setDraggedKey(key);
        setDragOverKey(null);
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>, key: MenuKey) => {
        event.preventDefault();
        if (draggedKey === key) return;
        setDragOverKey(key);
    };

    const handleDrop = (targetKey: MenuKey) => {
        if (!draggedKey || draggedKey === targetKey) {
            setDraggedKey(null);
            setDragOverKey(null);
            return;
        }

        const nextOrder = [...menuOrder];
        const fromIndex = nextOrder.indexOf(draggedKey);
        const targetIndex = nextOrder.indexOf(targetKey);

        if (fromIndex === -1 || targetIndex === -1) {
            setDraggedKey(null);
            setDragOverKey(null);
            return;
        }

        nextOrder.splice(fromIndex, 1);
        nextOrder.splice(targetIndex, 0, draggedKey);

        persistOrder(nextOrder);
        setDraggedKey(null);
        setDragOverKey(null);
    };

    const handleDragEnd = () => {
        setDraggedKey(null);
        setDragOverKey(null);
    };

    useEffect(() => {
        const onOutsideClick = (event: MouseEvent) => {
            if (!settingsRef.current) return;
            if (!settingsRef.current.contains(event.target as Node)) {
                setSettingsOpen(false);
            }
        };

        const onEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSettingsOpen(false);
            }
        };

        document.addEventListener('mousedown', onOutsideClick);
        document.addEventListener('keydown', onEscape);

        return () => {
            document.removeEventListener('mousedown', onOutsideClick);
            document.removeEventListener('keydown', onEscape);
        };
    }, []);

    return (
        <nav className="main-nav glass">
            <div className="nav-content">
                <Link to="/" className="nav-logo">
                    <span className="logo-icon">💡</span>
                    <span className="logo-text">MyHue</span>
                </Link>

                <div className="nav-links">
                    {visibleMenuItems.map((item) => (
                        <Link
                            key={item.key}
                            to={item.path}
                            className={`nav-link ${isActive(item.path) ? 'active' : ''}`}
                        >
                            <span className="nav-icon">{item.icon}</span>
                            <span>{item.label}</span>
                            {isActive(item.path) && (
                                <motion.div
                                    className="nav-indicator"
                                    layoutId="indicator"
                                    transition={{
                                        type: 'spring',
                                        stiffness: 300,
                                        damping: 30,
                                    }}
                                />
                            )}
                        </Link>
                    ))}
                </div>

                <div className="nav-settings" ref={settingsRef}>
                    <button
                        type="button"
                        className={`settings-trigger ${settingsOpen ? 'active' : ''}`}
                        onClick={() => setSettingsOpen((prev) => !prev)}
                        aria-label="Ouvrir les paramètres d'affichage"
                        aria-expanded={settingsOpen}
                        aria-controls="menu-display-settings"
                    >
                        ⚙️
                    </button>

                    {settingsOpen && (
                        <motion.div
                            id="menu-display-settings"
                            className="settings-panel"
                            initial={{ opacity: 0, y: -8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <div className="settings-title">Paramètres</div>
                            <div className="settings-section-title">
                                Affichage
                            </div>
                            <div className="settings-order-hint">
                                Glisse-dépose pour réorganiser les menus
                            </div>
                            <div className="settings-options">
                                {orderedMenuItems.map((item) => (
                                    <div
                                        key={item.key}
                                        className={`settings-option ${draggedKey === item.key ? 'dragging' : ''} ${dragOverKey === item.key ? 'drag-over' : ''}`}
                                        draggable
                                        onDragStart={() =>
                                            handleDragStart(item.key)
                                        }
                                        onDragOver={(event) =>
                                            handleDragOver(event, item.key)
                                        }
                                        onDrop={() => handleDrop(item.key)}
                                        onDragEnd={handleDragEnd}
                                    >
                                        <div className="settings-option-left">
                                            <span className="settings-drag-handle">
                                                ⋮⋮
                                            </span>
                                            <span className="settings-option-icon">
                                                {item.icon}
                                            </span>
                                            <span>{item.label}</span>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={visibility[item.key]}
                                            className={`settings-switch ${visibility[item.key] ? 'on' : ''}`}
                                            onClick={() =>
                                                toggleMenuVisibility(item.key)
                                            }
                                        >
                                            <span className="settings-switch-thumb" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                className="settings-reset-btn"
                                onClick={resetDisplaySettings}
                            >
                                Réinitialiser par défaut
                            </button>
                        </motion.div>
                    )}
                </div>
            </div>
        </nav>
    );
};
