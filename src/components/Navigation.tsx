import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import './Navigation.css';

export const Navigation = () => {
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <nav className="main-nav glass">
            <div className="nav-content">
                <Link to="/" className="nav-logo">
                    <span className="logo-icon">💡</span>
                    <span className="logo-text">MyHue</span>
                </Link>

                <div className="nav-links">
                    <Link
                        to="/"
                        className={`nav-link ${isActive('/') ? 'active' : ''}`}
                    >
                        <span className="nav-icon">💡</span>
                        <span>Lights</span>
                        {isActive('/') && (
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

                    <Link
                        to="/rooms"
                        className={`nav-link ${isActive('/rooms') ? 'active' : ''}`}
                    >
                        <span className="nav-icon">🏠</span>
                        <span>Rooms</span>
                        {isActive('/rooms') && (
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

                    <Link
                        to="/scenes"
                        className={`nav-link ${isActive('/scenes') ? 'active' : ''}`}
                    >
                        <span className="nav-icon">🎬</span>
                        <span>Scenes</span>
                        {isActive('/scenes') && (
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

                    <Link
                        to="/stats"
                        className={`nav-link ${isActive('/stats') ? 'active' : ''}`}
                    >
                        <span className="nav-icon">📊</span>
                        <span>Stats</span>
                        {isActive('/stats') && (
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

                    <Link
                        to="/agent"
                        className={`nav-link ${isActive('/agent') ? 'active' : ''}`}
                    >
                        <span className="nav-icon">🤖</span>
                        <span>Agent</span>
                        {isActive('/agent') && (
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

                    <Link
                        to="/music"
                        className={`nav-link ${isActive('/music') ? 'active' : ''}`}
                    >
                        <span className="nav-icon">🎵</span>
                        <span>Music</span>
                        {isActive('/music') && (
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
                </div>
            </div>
        </nav>
    );
};
