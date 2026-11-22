import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Icon } from '../components/Icon';
import { speak } from '../hooks/useVoice';
import { Together } from './Together';
import { readDayPick as readPick, saveDayPick as savePick } from './myDayPick';
import { Link } from 'react-router-dom';
import { KIND_LABEL, type Idea } from './outingTypes';
import './Dashboard.css';
import './MyDay.css';

// « Ma journée » : le check-up du matin d'une personne (maquette A, 2026-11-17)

interface Person { id: string; name: string; initial: string; color: string; mails: boolean; calendar: boolean; calendarStatus: { at: number | null; error: string | null; count: number } | null }
interface Thing { kind: string; title: string; detail: string }
interface Mail { id: string; from: string; subject: string; summary: string; receivedAt: number | null; draft: string | null; draftUrl: string | null; threadUrl: string | null }
interface DayView {
    person: Person;
    people: Person[];
    default: { id: string; reason: 'home' | 'first' };
    weather: { temp: number; feels: number; rainAt: number | null } | null;
    headline: { greeting: string; text: string };
    things: Thing[];
    mails: { at: number | null; items: Mail[] } | null;
    outing: { idea: Idea; left: number } | null;
    liked: (Idea & { at: number }) | null;
    touch: { who: string; line: string } | null;
}

const deg = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)}°`;
const hm = (ts: number) => new Date(ts).toLocaleTimeString('fr-CA', { hour: 'numeric', minute: '2-digit' }).replace(':', ' h ');
const today = () => new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

const claudeLink = (m: Mail) =>
    `https://claude.ai/new?q=${encodeURIComponent(`Dans mon Gmail, trouve le mail « ${m.subject} » de ${m.from} et prépare une réponse dans mes brouillons (ne l’envoie pas).`)}`;

function MailItem({ mail }: { mail: Mail }) {
    const [open, setOpen] = useState(false);
    const gmail = mail.draftUrl || mail.threadUrl;
    return (
        <li className="md-mail">
            <span className="md-meta">{mail.from}{mail.receivedAt ? ` · ${hm(mail.receivedAt)}` : ''}</span>
            <strong>{mail.subject}</strong>
            {mail.summary && <span className="md-sub">{mail.summary}</span>}
            {open && mail.draft && (
                <div className="md-draft">
                    <span className="md-draft-label">Réponse prête dans tes brouillons</span>
                    <p>{mail.draft}</p>
                </div>
            )}
            <div className="md-actions">
                {mail.draft ? (
                    <button className="md-btn primary" onClick={() => setOpen(!open)}>{open ? 'Masquer la réponse' : 'Voir la réponse'}</button>
                ) : (
                    <a className="md-btn primary" href={claudeLink(mail)} target="_blank" rel="noreferrer">Préparer une réponse</a>
                )}
                {gmail && <a className="md-btn" href={gmail} target="_blank" rel="noreferrer">Ouvrir dans Gmail</a>}
            </div>
        </li>
    );
}

function CalendarSheet({ person, onClose, onSaved }: { person: Person; onClose: () => void; onSaved: () => void }) {
    const [url, setUrl] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const save = async (value: string | null) => {
        setBusy(true);
        setError(null);
        try {
            await axios.put('/api/day/calendar', { person: person.id, url: value });
            onSaved();
            onClose();
        } catch (err) {
            setError(axios.isAxiosError(err) ? err.response?.data?.error || 'Enregistrement impossible' : 'Enregistrement impossible');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <div className="sheet md-sheet" role="dialog" aria-modal="true" aria-label="Agenda" onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <div className="sheet-title"><h2>Agenda de {person.name}</h2></div>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>
                <ol className="md-steps">
                    <li>Sur un ordinateur, ouvre <strong>calendar.google.com</strong>, puis la roue dentée › <strong>Paramètres</strong>.</li>
                    <li>À gauche, clique sur ton agenda sous « Paramètres de mes agendas ».</li>
                    <li>Descends jusqu’à <strong>Intégrer l’agenda</strong> et copie l’<strong>adresse secrète au format iCal</strong>.</li>
                    <li>Colle-la ici. Elle reste sur le serveur de la maison et n’est jamais réaffichée.</li>
                </ol>
                <label className="md-field">
                    <span>Adresse secrète iCal</span>
                    <input type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                        value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
                {error && <p className="md-error">{error}</p>}
                <div className="md-actions">
                    <button className="md-btn primary" disabled={busy || !url.trim()} onClick={() => save(url.trim())}>{busy ? 'Lecture de l’agenda…' : 'Brancher'}</button>
                    {person.calendar && <button className="md-btn quiet" disabled={busy} onClick={() => save(null)}>Débrancher</button>}
                </div>
            </div>
        </div>
    );
}

export function MyDay() {
    const [personId, setPersonId] = useState<string | null>(readPick);
    const [data, setData] = useState<DayView | null>(null);
    const [error, setError] = useState(false);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [speaking, setSpeaking] = useState(false);

    const load = useCallback(() => {
        axios.get<DayView>('/api/day', { params: { person: personId || '' } })
            .then(({ data }) => { setData(data); setError(false); })
            .catch(() => setError(true));
    }, [personId]);

    useEffect(() => {
        load();
        const t = setInterval(() => {
            // Choix expiré : retour au profil par défaut
            if (personId && !readPick()) setPersonId(null);
            else load();
        }, 60_000);
        return () => clearInterval(t);
    }, [load, personId]);

    const pick = (id: string) => {
        savePick(id);
        setPersonId(id);
    };

    const playBriefing = async () => {
        if (speaking || !data) return;
        setSpeaking(true);
        try {
            const { data: b } = await axios.get<{ text: string }>('/api/day/briefing', { params: { person: data.person.id } });
            await speak(b.text);
        } catch { /* briefing indisponible : le bouton redevient actif */ } finally {
            setSpeaking(false);
        }
    };

    const react = async (id: string, action: 'like' | 'next' | 'done') => {
        await axios.post(`/api/day/outings/${id}/${action}`).catch(() => {});
        load();
    };

    if (!data) {
        return <div className="home md"><p className="muted">{error ? 'Impossible de charger ta journée.' : 'Chargement…'}</p></div>;
    }

    const { person, people, things, mails, outing, liked, touch, weather } = data;
    const auto = !personId && data.default.reason === 'home';

    return (
        <div className={`home md tone-${person.color}`}>
            <header className="md-top">
                <div className="md-people" role="group" aria-label="Qui regarde ?">
                    {people.map((p) => (
                        <button key={p.id} className={`md-avatar c-${p.color} ${p.id === person.id ? 'on' : ''}`}
                            aria-pressed={p.id === person.id} aria-label={p.name} onClick={() => pick(p.id)}>
                            {p.initial}
                        </button>
                    ))}
                    <span className="muted md-who">{person.name}{auto ? ' · seul à la maison' : ''}</span>
                </div>
                <div className="md-when">
                    <button className="md-btn md-brief" onClick={playBriefing} disabled={speaking} aria-live="polite">
                        <Icon name={speaking ? 'volume' : 'play'} size={18} strokeWidth={2} />{speaking ? 'Jean-Claude parle…' : 'Mon briefing'}
                    </button>
                    <span className="muted md-date">{today()}</span>
                    {weather && <span className="md-pill">{deg(weather.temp)}{weather.rainAt != null ? ` · pluie vers ${weather.rainAt} h` : ''}</span>}
                </div>
            </header>

            <section className="md-hero">
                <span className="md-greet">{data.headline.greeting}</span>
                <h1>{data.headline.text}</h1>
            </section>

            <div className={`md-grid ${mails ? '' : 'two'}`}>
                <section className="md-card">
                    <h2>À retenir</h2>
                    {things.length ? (
                        <ol className="md-things">
                            {things.map((t, i) => (
                                <li key={t.kind + i}>
                                    <span className="md-num">{i + 1}</span>
                                    <div><strong>{t.title}</strong><span className="md-sub">{t.detail}</span></div>
                                </li>
                            ))}
                        </ol>
                    ) : <p className="md-sub">Rien à retenir aujourd’hui.</p>}
                    {things.length > 0 && <span className="md-sub">Rien d’autre aujourd’hui.</span>}
                    <div className="md-end md-cal">
                        {person.calendarStatus?.error
                            ? <button className="md-btn quiet warn" onClick={() => setCalendarOpen(true)}>Agenda injoignable · vérifier</button>
                            : <button className="md-btn quiet" onClick={() => setCalendarOpen(true)}>{person.calendar ? 'Agenda branché' : 'Brancher mon agenda'}</button>}
                    </div>
                </section>

                {mails && (
                    <section className="md-card">
                        <div className="md-head"><h2>Mails importants</h2>{mails.at && <span className="muted">triés à {hm(mails.at)}</span>}</div>
                        {mails.items.length ? (
                            <ul className="md-mails">{mails.items.slice(0, 3).map((m) => <MailItem key={m.id} mail={m} />)}</ul>
                        ) : (
                            <p className="md-sub">{mails.at ? 'Rien d’important, seulement de la pub.' : 'Le tri arrive chaque matin vers 6 h 30.'}</p>
                        )}
                    </section>
                )}

                <section className="md-card md-outing">
                    <div className="md-head"><h2>Pour vous deux</h2>{outing && <span className="md-kind">{KIND_LABEL[outing.idea.kind]}</span>}</div>
                    {outing ? (
                        <>
                            <Link className="md-idea md-idea-link" to={`/sorties?id=${encodeURIComponent(outing.idea.id)}`}>{outing.idea.title}</Link>
                            {(outing.idea.when || outing.idea.where) && <span className="md-sub">{[outing.idea.when, outing.idea.where].filter(Boolean).join(' · ')}</span>}
                            {outing.idea.why && <p className="md-why">{outing.idea.why}</p>}
                            <div className="md-actions md-end">
                                {liked?.id === outing.idea.id ? (
                                    <span className="md-liked"><Icon name="check" size={18} strokeWidth={2.5} />Ça vous tente</span>
                                ) : (
                                    <button className="md-btn primary" onClick={() => react(outing.idea.id, 'like')}>Ça nous tente</button>
                                )}
                                <Link className="md-btn" to={`/sorties?id=${encodeURIComponent(outing.idea.id)}`}>Détails{outing.left > 0 ? ` et ${outing.left} autre${outing.left > 1 ? 's' : ''}` : ''}</Link>
                                {outing.left > 0 && <button className="md-btn quiet" onClick={() => react(outing.idea.id, 'next')}>Autre idée</button>}
                                <button className="md-btn quiet" onClick={() => react(outing.idea.id, 'done')}>Déjà fait</button>
                            </div>
                        </>
                    ) : (
                        <p className="md-sub">Les idées de sortie arrivent chaque mercredi matin.</p>
                    )}
                </section>
            </div>

            <Together me={person} people={people} />

            {calendarOpen &&<CalendarSheet person={person} onClose={() => setCalendarOpen(false)} onSaved={load} />}

            {touch && (
                <footer className="md-touch">
                    <img src="/cooper.jpg" alt="" className="md-touch-photo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    <span>« {touch.line} »</span>
                </footer>
            )}
        </div>
    );
}
