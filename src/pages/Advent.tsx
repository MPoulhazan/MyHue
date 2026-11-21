import { useState } from 'react';
import { adventPoll } from '../components/home/widgets/polls';
import { openAdventCase } from '../components/advent/api';
import { dodos } from '../components/advent/types';
import '../components/advent/Advent.css';

const TAG: Record<string, string> = { song: 'Chanson', mission: 'Mission', fact: 'Anecdote', cooper: 'Cooper', outing: 'Sortie' };

/** Écran du calendrier de l'Avent : les 24 cases, et le contenu de la case touchée. */
export function Advent() {
    const view = adventPoll.use();
    const [picked, setPicked] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    if (!view) return <div className="advent-page" />;
    const season = view.season;
    if (!season?.on) {
        return (
            <div className="advent-page">
                <h1 className="advent-h1">Calendrier de l’Avent</h1>
                <p className="advent-muted">Le calendrier revient la dernière semaine de novembre.</p>
            </div>
        );
    }

    const selN = picked ?? view.today ?? (season.phase === 'before' ? null : 24);
    const sel = selN ? view.days[selN - 1] : null;

    const act = async (n: number) => {
        setBusy(true);
        setNote(null);
        try {
            const r = await openAdventCase(n);
            if (r.played) setNote(`Ça joue sur ${r.played}.`);
            else if (r.error) setNote(`La chanson n’a pas pu jouer : ${r.error}.`);
        } catch {
            setNote('La case n’a pas pu s’ouvrir.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="advent-page">
            <header className="advent-head">
                <h1 className="advent-h1">Calendrier de l’Avent</h1>
                {dodos(season) && <span className="advent-count">{dodos(season)}</span>}
            </header>

            <div className="advent-body">
                <div className="advent-grid">
                    {view.days.map((d) => {
                        const state = d.today ? 'today' : d.openable ? 'past' : 'future';
                        return (
                            <button key={d.n} type="button" className={`advent-box ${state} ${selN === d.n ? 'selected' : ''}`}
                                disabled={!d.openable} onClick={() => { setPicked(d.n); setNote(null); }}
                                aria-label={`Case ${d.n}${d.title ? ` : ${d.title}` : ''}`}>
                                <span className="advent-box-n">{d.n}</span>
                                <span className="advent-box-tag">
                                    {d.today ? (d.openedAt ? 'Aujourd’hui' : 'À ouvrir') : d.kind ? TAG[d.kind] : d.n === 24 ? 'Réveillon' : ''}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <aside className="advent-panel">
                    {season.phase === 'before' || !sel ? (
                        <>
                            <span className="advent-kind">Bientôt</span>
                            <h2>Le calendrier ouvre le 1<sup>er</sup> décembre</h2>
                            <p>Une case par jour jusqu’au réveillon : des chansons, des missions, des anecdotes, Cooper et des sorties à Montréal.</p>
                        </>
                    ) : sel.today && !sel.openedAt ? (
                        <>
                            <span className="advent-kind">Case {sel.n}</span>
                            <h2>La case du jour</h2>
                            <p>Elle t’attend. Touche pour l’ouvrir.</p>
                            <div className="advent-grow" />
                            <button type="button" className="advent-primary big" disabled={busy} onClick={() => act(sel.n)}>
                                {busy ? 'Ouverture…' : 'Ouvrir la case'}
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="advent-panel-top">
                                <span className="advent-kind">{sel.label}</span>
                                <span className="advent-muted">Case {sel.n}</span>
                            </div>
                            <h2>{sel.title}</h2>
                            {sel.photo && <img className="advent-photo" src={sel.photo} alt="Cooper" />}
                            <p>{sel.body}</p>
                            <div className="advent-grow" />
                            {sel.playable && (
                                <button type="button" className="advent-ghost big" disabled={busy} onClick={() => act(sel.n)}>
                                    {busy ? 'Un instant…' : 'Réécouter'}
                                </button>
                            )}
                            {!sel.openedAt && !sel.playable && (
                                <button type="button" className="advent-ghost big" disabled={busy} onClick={() => act(sel.n)}>Marquer comme ouverte</button>
                            )}
                        </>
                    )}
                    {note && <p className="advent-note">{note}</p>}
                    <p className="advent-muted small">Ou dis « Jean-Claude, ouvre la case du jour ».</p>
                </aside>
            </div>
        </div>
    );
}
