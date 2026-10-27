import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '../Icon';

const IDLE_MS = 2 * 60_000;
const isNight = (d: Date) => d.getHours() >= 23 || d.getHours() < 7;
const fmt = (n: number | null) => (n == null ? '--' : n.toFixed(1).replace('.', ','));

/**
 * Écran de nuit : de 23 h à 7 h, après 2 min sans toucher la tablette,
 * on n'affiche plus que l'heure et l'essentiel, très sombre. Un toucher réveille.
 */
export function NightMode({ temperature, outdoor, allClosed }: { temperature: number | null; outdoor: number | null; allClosed: boolean }) {
    const [now, setNow] = useState(new Date());
    const [lastTouch, setLastTouch] = useState(Date.now());

    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 20_000);
        const wake = () => setLastTouch(Date.now());
        window.addEventListener('pointerdown', wake, true);
        window.addEventListener('keydown', wake, true);
        return () => {
            clearInterval(t);
            window.removeEventListener('pointerdown', wake, true);
            window.removeEventListener('keydown', wake, true);
        };
    }, []);

    const asleep = isNight(now) && now.getTime() - lastTouch > IDLE_MS;

    return (
        <AnimatePresence>
            {asleep && (
                <motion.div className="night" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 1.2 }} aria-label="Mode nuit, touche pour réveiller">
                    <div className="night-time mono">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="night-line">
                        <span>Salon <strong>{fmt(temperature)}°</strong></span>
                        <span>Dehors <strong>{outdoor == null ? '--' : Math.round(outdoor)}°</strong></span>
                    </div>
                    <div className="night-line small">
                        <Icon name={allClosed ? 'check' : 'door'} size={18} strokeWidth={2} />
                        {allClosed ? 'Tout est fermé' : 'Une porte est ouverte'}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
