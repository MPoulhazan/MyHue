import { useState } from 'react';
import { adventPoll } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import { dodos } from './types';
import { openAdventCase } from './api';
import './Advent.css';

/** Carte de l'accueil : la case du jour à ouvrir, puis un rappel calme. */
export function AdventCard() {
    const view = adventPoll.use();
    const [busy, setBusy] = useState(false);
    const season = view?.season;
    if (!view || !season?.on) return null;

    const count = dodos(season);
    const open = async () => {
        setBusy(true);
        try {
            await openAdventCase();
        } catch {
            adventPoll.load();
        } finally {
            setBusy(false);
        }
    };

    return (
        <WidgetCard className={`advent-card ${view.today && !view.todayOpened ? 'is-waiting' : ''}`} label="Calendrier de l’Avent"
            title="Calendrier de l’Avent" to="/avent"
            pills={season.daysToChristmas != null && season.daysToChristmas > 0 ? <StatusPill level="warn">J-{season.daysToChristmas}</StatusPill> : null}>
            {season.phase === 'before' && (
                <p className="wcard-line">Il ouvre le 1<sup>er</sup> décembre{season.daysToAdvent ? `, dans ${season.daysToAdvent} jour${season.daysToAdvent > 1 ? 's' : ''}` : ''}. {count}.</p>
            )}
            {view.today != null && (
                <>
                    <div className="advent-dots" aria-label={`${view.openedCount} cases ouvertes`}>
                        {view.days.slice(0, view.today).map((d) => (
                            <span key={d.n} className={`advent-dot ${d.today ? 'today' : d.openedAt ? 'open' : ''}`} />
                        ))}
                        <span className="advent-dots-label">{view.openedCount} ouverte{view.openedCount > 1 ? 's' : ''}</span>
                    </div>
                    {view.todayOpened ? (
                        <p className="wcard-line">Case {view.today} ouverte : <b>{view.days[view.today - 1].title}</b>. {count}.</p>
                    ) : (
                        <button type="button" className="advent-open-btn" onClick={open} disabled={busy}>
                            <span className="advent-num">{view.today}</span>
                            {busy ? 'Ouverture…' : 'Ouvrir la case du jour'}
                        </button>
                    )}
                </>
            )}
            {season.phase === 'christmas' && <p className="wcard-line"><b>Joyeux Noël !</b> Les 24 cases restent à revoir.</p>}
            {season.phase === 'after' && <p className="wcard-line">{view.openedCount} cases ouvertes cette année. À revoir jusqu’au 31.</p>}
        </WidgetCard>
    );
}
