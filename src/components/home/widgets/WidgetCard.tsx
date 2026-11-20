import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Icon } from '../../Icon';
import './WidgetCard.css';

// ── Briques communes des widgets de l'accueil ────────────────────────────────
//
// Une carte de widget a toujours la même forme : un titre, une ou deux pastilles
// d'état, un corps compact (environ 160 px de haut au plus dans la colonne
// « Maintenant ») et, s'il y a plus à dire, un panneau de détail ouvert en
// touchant le titre. Le détail (plan, listes complètes, réglages) ne vit jamais
// dans la carte.

/** ok : tout va bien · warn : à surveiller · bad : à faire tout de suite · info : à savoir · off : éteint ou muet */
export type Level = 'ok' | 'warn' | 'bad' | 'info' | 'off';

export function StatusPill({ level, children, label }: { level: Level; children: ReactNode; label?: string }) {
    return <span className={`status-pill ${level}`} aria-label={label}>{children}</span>;
}

/** Panneau de détail d'un widget (en bas sur le téléphone, au centre sur la tablette). */
export function WidgetSheet({ title, onClose, className = '', children }: {
    title: ReactNode;
    onClose: () => void;
    className?: string;
    children: ReactNode;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <motion.div className={`sheet wsheet ${className}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
                initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <h2>{title}</h2>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>
                {children}
            </motion.div>
        </div>
    );
}

export interface WidgetCardProps {
    title: ReactNode;
    /** Nom lisible de la carte pour les lecteurs d'écran */
    label: string;
    /** Pastilles d'état à droite du titre */
    pills?: ReactNode;
    /** Le détail : touché, le titre ouvre ce panneau */
    detail?: { title: ReactNode; body: ReactNode; className?: string };
    /** Ou bien un écran entier de l'app */
    to?: string;
    className?: string;
    children?: ReactNode;
}

/** Carte compacte d'un widget de l'accueil. */
export function WidgetCard({ title, label, pills, detail, to, className = '', children }: WidgetCardProps) {
    const [open, setOpen] = useState(false);
    const head = detail ? (
        <button type="button" className="wcard-title more" onClick={() => setOpen(true)} aria-haspopup="dialog">
            <span>{title}</span><Icon name="chevron" size={16} strokeWidth={2.4} />
        </button>
    ) : to ? (
        <Link to={to} className="wcard-title more"><span>{title}</span><Icon name="chevron" size={16} strokeWidth={2.4} /></Link>
    ) : (
        <span className="wcard-title"><span>{title}</span></span>
    );
    return (
        <section className={`card wcard ${className}`} aria-label={label}>
            <div className="wcard-head">
                {head}
                {pills && <span className="wcard-pills">{pills}</span>}
            </div>
            {children}
            <AnimatePresence>
                {open && detail && (
                    <WidgetSheet key="detail" title={detail.title} className={detail.className} onClose={() => setOpen(false)}>
                        {detail.body}
                    </WidgetSheet>
                )}
            </AnimatePresence>
        </section>
    );
}
