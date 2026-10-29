import { Link } from 'react-router-dom';
import type { Cast } from '../../hooks/useCast';
import { Icon } from '../Icon';

const VOLUME_STEP = 10;

/** Barres animées « en lecture ». */
export function Equalizer({ paused = false }: { paused?: boolean }) {
    return (
        <span className={`eq ${paused ? 'paused' : ''}`} aria-hidden="true">
            <span /><span /><span />
        </span>
    );
}

/** Lecture en cours, présente sur tous les écrans tant qu'une enceinte joue. */
export function MiniPlayer({ cast }: { cast: Cast }) {
    const n = cast.now;
    if (!n) return null;
    return (
        <div className="mini-player" role="region" aria-label="Lecture en cours">
            <Link to="/music" className="mini-info">
                {n.thumbnail
                    ? <img src={n.thumbnail} alt="" className="mini-thumb" />
                    : <span className="mini-thumb"><Equalizer paused={n.paused} /></span>}
                <span className="mini-text">
                    <strong>{n.title}</strong>
                    <span>{n.paused ? 'En pause' : 'En lecture'} · {n.device}</span>
                </span>
            </Link>
            <div className="mini-controls">
                <button type="button" className="mini-btn main" aria-label={n.paused ? 'Reprendre' : 'Pause'}
                    onClick={() => cast.control(n.paused ? 'play' : 'pause')}>
                    <Icon name={n.paused ? 'play' : 'pause'} size={20} strokeWidth={2.4} />
                </button>
                <button type="button" className="mini-btn" aria-label="Arrêter" onClick={() => cast.control('stop')}>
                    <Icon name="stop" size={18} strokeWidth={2.4} />
                </button>
                <span className="mini-volume">
                    <button type="button" className="mini-btn" aria-label="Baisser le volume"
                        onClick={() => cast.volume((n.volume ?? 50) - VOLUME_STEP)}>
                        <Icon name="minus" size={18} strokeWidth={2.4} />
                    </button>
                    <span className="mini-vol-value" aria-live="polite">{n.volume != null ? `${n.volume} %` : <Icon name="volume" size={18} />}</span>
                    <button type="button" className="mini-btn" aria-label="Monter le volume"
                        onClick={() => cast.volume((n.volume ?? 50) + VOLUME_STEP)}>
                        <Icon name="plus" size={18} strokeWidth={2.4} />
                    </button>
                </span>
            </div>
        </div>
    );
}
