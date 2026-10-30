import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HomeContext, useHome } from '../../hooks/useHome';
import { useIsPhone } from '../../hooks/useIsPhone';
import { useVoice } from '../../hooks/useVoice';
import { AgentBar, AgentFab, AgentSheet } from '../agent/Agent';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { MiniPlayer } from './MiniPlayer';
import { ServiceAlert } from './ServiceAlert';
import './AppShell.css';

// ── Structure commune : rail à gauche (tablette), onglets en bas (téléphone) ──

interface Destination {
    to: string;
    label: string;
    icon: IconName;
}

const MAIN: Destination[] = [
    { to: '/', label: 'Maison', icon: 'home' },
    { to: '/lights', label: 'Lumières', icon: 'lights' },
    { to: '/climate', label: 'Climat', icon: 'thermo' },
    { to: '/music', label: 'Musique', icon: 'music' },
];

const SETTINGS: Destination = { to: '/settings', label: 'Réglages', icon: 'settings' };

/** Écrans rangés sous Réglages. */
const SETTINGS_PAGES = ['/sensors', '/speakers', '/rules', '/remote', '/wakeword'];

// Tablette murale : retour à l'accueil après ce délai sans toucher
const IDLE_MS = 2 * 60_000;

function useIdleReturn(enabled: boolean) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    useEffect(() => {
        if (!enabled || pathname === '/') return;
        let timer = 0;
        const arm = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                // Un panneau ouvert, c'est une saisie en cours : on attend encore
                if (document.querySelector('.sheet-backdrop')) arm();
                else navigate('/');
            }, IDLE_MS);
        };
        const events = ['pointerdown', 'keydown', 'wheel'] as const;
        events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
        arm();
        return () => {
            window.clearTimeout(timer);
            events.forEach((e) => window.removeEventListener(e, arm));
        };
    }, [enabled, pathname, navigate]);
}

function NavItem({ dest, className }: { dest: Destination; className: string }) {
    const { pathname } = useLocation();
    const inSettings = dest === SETTINGS && SETTINGS_PAGES.includes(pathname);
    return (
        <NavLink to={dest.to} end={dest.to === '/'}
            className={({ isActive }) => `${className} ${isActive || inSettings ? 'active' : ''}`}>
            <span className="nav-pill"><Icon name={dest.icon} size={24} strokeWidth={2} /></span>
            {dest.label}
        </NavLink>
    );
}

export function AppShell() {
    const home = useHome();
    const phone = useIsPhone();
    const { pathname } = useLocation();
    const [reply, setReply] = useState<string | null>(null);
    const [agentOpen, setAgentOpen] = useState(false);
    const agentOpenRef = useRef(false);
    useEffect(() => {
        agentOpenRef.current = agentOpen;
    }, [agentOpen]);
    const replyTimer = useRef(0);
    useIdleReturn(!phone);

    // Hors de l'accueil (où le journal l'affiche) et panneau fermé, la réponse passe en bulle
    const ask = async (message: string) => {
        const answer = await home.askAgent(message);
        if (answer && !agentOpenRef.current) {
            setReply(answer.text);
            window.clearTimeout(replyTimer.current);
            replyTimer.current = window.setTimeout(() => setReply(null), 10_000);
        }
        return answer;
    };
    // Une seule écoute (micro + mot d'activation) pour toute l'app
    const voice = useVoice(ask);
    const openAgent = () => {
        setReply(null);
        setAgentOpen(true);
    };

    const backToSettings = SETTINGS_PAGES.includes(pathname);
    // L'écran Musique a son propre lecteur
    const showPlayer = Boolean(home.cast.now) && pathname !== '/music';

    return (
        <HomeContext.Provider value={home}>
            <div className={`shell ${phone ? 'phone' : ''} ${showPlayer ? 'has-player' : ''}`}>
                {!phone && (
                    <nav className="shell-rail" aria-label="Navigation principale">
                        {MAIN.map((d) => <NavItem key={d.to} dest={d} className="rail-item" />)}
                        <div className="rail-bottom"><NavItem dest={SETTINGS} className="rail-item" /></div>
                    </nav>
                )}

                <div className="shell-main">
                    <ServiceAlert services={home.health} />
                    <div className="shell-page">
                        {backToSettings && (
                            <Link to="/settings" className="shell-back">
                                <Icon name="back" size={20} strokeWidth={2.2} /> Réglages
                            </Link>
                        )}
                        <Outlet />
                    </div>

                    {!phone && (
                        <div className="shell-agent">
                            <AnimatePresence>
                                {reply && pathname !== '/' && (
                                    <motion.button key="reply" type="button" className="agent-reply" onClick={openAgent}
                                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
                                        {reply}
                                    </motion.button>
                                )}
                            </AnimatePresence>
                            {showPlayer && <MiniPlayer cast={home.cast} />}
                            <AgentBar voice={voice} onAsk={ask} onOpen={openAgent} />
                        </div>
                    )}
                </div>

                {phone && showPlayer && <div className="shell-player"><MiniPlayer cast={home.cast} /></div>}

                {phone && (
                    <>
                        <AgentFab voice={voice} onOpen={openAgent} />
                        <nav className="shell-tabs" aria-label="Navigation principale">
                            {[...MAIN, SETTINGS].map((d) => <NavItem key={d.to} dest={d} className="tab-item" />)}
                        </nav>
                    </>
                )}

                <AnimatePresence>
                    {agentOpen && (
                        <AgentSheet key="agent" voice={voice} conversation={home.conversation} thinking={home.thinking}
                            onAsk={ask} onClear={home.clearConversation} onClose={() => setAgentOpen(false)} />
                    )}
                </AnimatePresence>
            </div>
        </HomeContext.Provider>
    );
}
