import { useEffect, useState } from 'react';
import axios from 'axios';
import { Icon } from '../Icon';
import type { Plan } from '../../pages/outingTypes';
import { planWhen } from './planWhen';
import './Outing.css';

// « Ça nous tente » → invitation Google Agenda par QR code (maquette 2 du 2026-11-22)

interface PersonLite { id: string; name: string; initial: string; color: string; guestEmail: boolean }
interface Options {
    idea: { id: string; title: string; kind: string; where: string | null; date: string | null };
    days: { date: string; free: boolean | null }[];
    times: string[];
    people: PersonLite[];
}

const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short' });
const timeLabel = (t: string) => t.replace(':', ' h ').replace(' h 00', ' h');
const err = (e: unknown) => (axios.isAxiosError(e) ? e.response?.data?.error || 'Impossible pour le moment' : 'Impossible pour le moment');

/**
 * @param ideaId l'idée à proposer ; absent = revoir le code de la sortie déjà prévue
 * @param me     le profil devant la tablette (celui qui invite, par défaut)
 */
export function InviteSheet({ ideaId, me, onClose, onDone }: { ideaId?: string; me?: string | null; onClose: () => void; onDone: () => void }) {
    const [opts, setOpts] = useState<Options | null>(null);
    const [day, setDay] = useState<string | null>(null);
    const [time, setTime] = useState<string | null>(null);
    const [by, setBy] = useState<string | null>(me || null);
    const [email, setEmail] = useState('');
    const [qr, setQr] = useState<{ svg: string; plan: Plan } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!ideaId) {
            axios.get<{ plan: Plan | null; qr?: string }>('/api/day/plan', { params: { qr: 1 } })
                .then(({ data }) => (data.plan && data.qr ? setQr({ svg: data.qr, plan: data.plan }) : setError('Aucune sortie prévue')))
                .catch((e) => setError(err(e)));
            return;
        }
        axios.get<Options>(`/api/day/outings/${encodeURIComponent(ideaId)}/invite`)
            .then(({ data }) => {
                setOpts(data);
                setDay((data.days.find((d) => d.free) || data.days[0])?.date ?? null);
                setTime(data.times[0] ?? null);
                setBy((cur) => (cur && data.people.some((p) => p.id === cur) ? cur : data.people[0]?.id ?? null));
            })
            .catch((e) => setError(err(e)));
    }, [ideaId]);

    const inviter = opts?.people.find((p) => p.id === by) || null;
    const guest = opts?.people.find((p) => p.id !== by) || null;

    const create = async () => {
        if (!ideaId || !day || !time || !by) return;
        setBusy(true);
        setError(null);
        try {
            // Pas encore de courriel pour l'invité : on l'enregistre d'abord (il reste sur le serveur de la maison)
            if (guest && inviter && !inviter.guestEmail && email.trim()) await axios.put(`/api/day/people/${guest.id}/email`, { email: email.trim() });
            const { data } = await axios.post<{ plan: Plan; qr: string }>(`/api/day/outings/${encodeURIComponent(ideaId)}/invite`, { date: day, time, by });
            setQr({ svg: data.qr, plan: data.plan });
            onDone();
        } catch (e) {
            setError(err(e));
        } finally {
            setBusy(false);
        }
    };

    const justNote = async () => {
        if (!ideaId) return;
        await axios.post(`/api/day/outings/${encodeURIComponent(ideaId)}/like`).catch(() => {});
        onDone();
        onClose();
    };

    const title = qr ? qr.plan.title : opts?.idea.title;

    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <div className="sheet iv-sheet" role="dialog" aria-modal="true" aria-label="Inviter à la sortie" onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <div className="sheet-title">
                        <span className="iv-eyebrow">{qr ? 'Invitation Google Agenda' : 'Ça vous tente'}</span>
                        <h2>{title || 'Sortie'}</h2>
                    </div>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>

                {error && <p className="iv-error">{error}</p>}

                {qr ? (
                    <div className="iv-qr-step">
                        <div className="iv-qr" role="img" aria-label="Code QR vers Google Agenda" dangerouslySetInnerHTML={{ __html: qr.svg }} />
                        <div className="iv-side">
                            <span className="iv-when">{planWhen(qr.plan.start)}</span>
                            <ol className="iv-steps">
                                <li>{qr.plan.by ? `${qr.plan.by.name}, scanne` : 'Scanne'} le code avec ton téléphone.</li>
                                <li>Google Agenda s’ouvre avec l’événement déjà rempli{qr.plan.to && qr.plan.guestInvited ? `, et ${qr.plan.to.name} en invité` : ''}.</li>
                                <li>Appuie sur « Enregistrer » : {qr.plan.to ? `${qr.plan.to.name} reçoit l’invitation et répond Oui ou Non sur son téléphone.` : 'c’est noté.'}</li>
                            </ol>
                            {!qr.plan.guestInvited && qr.plan.to && <p className="iv-note">Ajoute {qr.plan.to.name} dans « Invités » avant d’enregistrer : MyHue ne connaît pas encore son adresse Gmail.</p>}
                            <p className="iv-note">{qr.plan.tracked ? 'La réponse s’affichera ici toute seule, d’après les agendas branchés.' : 'Aucun agenda branché : vous confirmerez d’un toucher sur la carte.'}</p>
                            <button className="iv-btn primary" onClick={onClose}>C’est fait</button>
                        </div>
                    </div>
                ) : opts ? (
                    <div className="iv-form">
                        {opts.days.length > 1 ? (
                            <fieldset className="iv-group">
                                <legend>Quel soir ?</legend>
                                <div className="iv-choices">
                                    {opts.days.map((d) => (
                                        <button key={d.date} className={`iv-choice ${day === d.date ? 'on' : ''}`} aria-pressed={day === d.date} onClick={() => setDay(d.date)}>
                                            {dayLabel(d.date)}{d.free === false && <small>pris</small>}{d.free === true && <small className="ok">libres</small>}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        ) : opts.days[0] && <p className="iv-fixed">{dayLabel(opts.days[0].date)}</p>}

                        <fieldset className="iv-group">
                            <legend>{opts.idea.kind === 'cinema' ? 'Quelle séance ?' : 'À quelle heure ?'}</legend>
                            <div className="iv-choices">
                                {opts.times.map((t) => (
                                    <button key={t} className={`iv-choice ${time === t ? 'on' : ''}`} aria-pressed={time === t} onClick={() => setTime(t)}>{timeLabel(t)}</button>
                                ))}
                            </div>
                        </fieldset>

                        {opts.people.length > 1 && (
                            <fieldset className="iv-group">
                                <legend>Qui envoie l’invitation ?</legend>
                                <div className="iv-choices">
                                    {opts.people.map((p) => {
                                        const other = opts.people.find((x) => x.id !== p.id);
                                        return (
                                            <button key={p.id} className={`iv-person c-${p.color} ${by === p.id ? 'on' : ''}`} aria-pressed={by === p.id} onClick={() => setBy(p.id)}>
                                                <span className="iv-avatar">{p.initial}</span>{p.name} invite {other?.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>
                        )}

                        {inviter && guest && !inviter.guestEmail && (
                            <label className="iv-field">
                                <span>Adresse Gmail de {guest.name}, pour l’ajouter en invité (gardée sur le serveur de la maison)</span>
                                <input type="email" inputMode="email" autoComplete="off" spellCheck={false} placeholder="prenom@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </label>
                        )}

                        <div className="iv-actions">
                            <button className="iv-btn primary" disabled={busy || !day || !time} onClick={create}>{busy ? 'Préparation…' : 'Afficher le code'}</button>
                            <button className="iv-btn quiet" onClick={justNote}>Juste le noter dans MyHue</button>
                        </div>
                    </div>
                ) : !error && <p className="iv-note">Chargement…</p>}
            </div>
        </div>
    );
}
