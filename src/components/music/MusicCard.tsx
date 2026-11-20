import { useState } from 'react';
import axios from 'axios';
import type { Cast } from '../../hooks/useCast';
import { musicPoll } from '../home/widgets/polls';
import { WidgetCard } from '../home/widgets/WidgetCard';
import { Icon, type IconName } from '../Icon';
import './tones.css';
import './MusicCard.css';

const MOOD_LOOK: Record<string, { icon: IconName; tone: string }> = {
    zen: { icon: 'leaf', tone: 'mint' },
    focus: { icon: 'target', tone: 'sky' },
    energie: { icon: 'bolt', tone: 'amber' },
    diner: { icon: 'bowl', tone: 'peach' },
    soiree: { icon: 'glass', tone: 'lilac' },
    dodo: { icon: 'moon', tone: 'night' },
};

/** Carte « Musique » de l'accueil : la suggestion du moment, à lancer d'une touche. */
export function MusicCard({ cast }: { cast: Cast }) {
    const view = musicPoll.use();
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    if (!view) return null;

    const s = view.suggestion;
    const look = s.kind === 'mood' ? MOOD_LOOK[s.id] : null;
    const tone = look?.tone ?? 'dark';
    const playing = Boolean(cast.now);

    const start = async () => {
        setBusy(true);
        setFailed(false);
        try {
            await axios.post('/api/music/play-suggestion', {});
            cast.refresh();
            musicPoll.load();
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <WidgetCard className={`music-card tone-${tone}`} label="Musique" title={s.habit ? 'Ton habitude' : 'Musique'} to="/music">
            <div className="music-card-body">
                {look
                    ? <span className="music-card-icon" aria-hidden="true"><Icon name={look.icon} size={30} /></span>
                    : s.thumbnail ? <img src={s.thumbnail} alt="" className="music-card-art" /> : <span className="music-card-icon" aria-hidden="true"><Icon name="music" size={28} /></span>}
                <div className="music-card-text">
                    <strong>{s.name}</strong>
                    <span>{failed ? 'Lancement impossible, réessaie.' : s.reason}</span>
                </div>
                <button type="button" className="music-card-play" onClick={start} disabled={busy || !view.device}
                    aria-label={`Lancer ${s.name}${view.device ? ` sur ${view.device.name}` : ''}`}>
                    {busy ? '…' : <Icon name="play" size={24} strokeWidth={2.4} />}
                </button>
            </div>
            <span className="music-card-foot">
                {!view.device ? 'Aucune enceinte joignable' : playing ? `Remplacera la musique sur ${cast.now?.device}` : `Sur ${view.device.name}`}
            </span>
        </WidgetCard>
    );
}
