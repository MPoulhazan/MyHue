import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createSharedPoll } from '../../hooks/sharedPoll';
import { Icon } from '../Icon';
import { CommuteMap } from './CommuteMap';
import type { CommuteMapData } from './CommuteMap';
import './Commute.css';

// ── Données de /api/commute (server/commute.js) ──────────────────────────────

type Mode = 'bike' | 'ebike' | 'bus' | 'walk';
interface Option { mode: Mode; stationId?: string; ok: boolean; minutes: number | null; leaveAt?: number; arriveAt?: number; title: string; detail: string; warn: string | null }
interface Idea { title: string; when?: string | null; where?: string | null; why?: string | null; url?: string | null }
export interface CommuteView {
    enabled: boolean;
    configured: boolean;
    person?: { id: string; who: string };
    plan?: { kind: 'work' | 'rest' | 'off'; from?: string; to?: string };
    phase?: 'before' | 'soon' | 'now' | 'after' | null;
    verdict?: { level: 'ok' | 'low' | 'no'; text: string };
    best?: Option | null;
    options?: Option[];
    text?: string;
    rest?: { idea: Idea | null };
    bus?: { label: string; stopName: string; departures: { at: number; realtime: boolean }[]; realtime: boolean; error: string | null } | null;
    map?: CommuteMapData;
}

export const commutePoll = createSharedPoll<CommuteView>('/api/commute', 60_000);

const hm = (ts: number) => {
    const d = new Date(ts);
    const m = d.getMinutes();
    return `${d.getHours()} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};
const hmLabel = (hhmm?: string) => {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};

const BADGE: Record<Mode, string> = { bike: 'B', ebike: '⚡', bus: '🚌', walk: 'à p.' };

/** La grande phrase du haut : quoi prendre, et quand partir. */
function headline(v: CommuteView): [string, string] {
    const b = v.best;
    if (!b) return ['Aucune option fiable,', 'regarde dehors.'];
    const snow = /neige/i.test(v.verdict?.text || '');
    const bikeOk = (v.options || []).some((o) => (o.mode === 'bike' || o.mode === 'ebike') && o.ok && o.minutes != null);
    if (b.mode === 'bike') return ['BIXI ce matin,', 'pars quand tu veux.'];
    if (b.mode === 'ebike') return ['BIXI électrique,', 'prends un casque.'];
    // Nom de la ligne : réglage sur le Pi (data/commute.json), jamais dans le code public
    const bus = v.bus?.label || 'Bus';
    if (b.mode === 'bus') return [snow ? `Neige : ${bus.toLowerCase()},` : bikeOk ? `${bus}, plus rapide,` : `Pas de BIXI : ${bus.toLowerCase()},`, `pars à ${hm(b.leaveAt!)}.`];
    return [snow ? 'Neige : à pied,' : 'À pied ce matin,', `≈ ${b.minutes} min.`];
}

function OptionRow({ o, best }: { o: Option; best: boolean }) {
    const busSub = o.mode === 'bus' ? o.detail.replace(/^[^à]*à /, '') : o.detail;
    return (
        <div className={`cm-opt ${best ? 'is-best' : ''} ${o.ok ? '' : 'is-off'}`}>
            <b className={`cm-badge ${o.mode}`}>{BADGE[o.mode]}</b>
            <span className="cm-opt-text">
                <b>{o.mode === 'bus' && o.leaveAt ? `${o.title} à ${o.detail.split(' à ')[0]}` : o.title}</b>
                <small>{o.mode === 'bus' ? busSub : o.detail}</small>
            </span>
            {o.warn && <span className={`cm-warn ${o.mode === 'ebike' ? 'info' : ''}`}>{o.warn}</span>}
            <b className="cm-min">{o.minutes != null ? `${o.minutes}′` : '–'}</b>
        </div>
    );
}

/** Carte « Trajet » de l'accueil (maquette B) : le conseil d'abord, les options, la mini-carte à toucher. */
export function CommuteCard() {
    const v = commutePoll.use();
    const [big, setBig] = useState(false);
    if (!v?.enabled || !v.configured || !v.person) return null;

    const who = v.person.who;
    const bestStation = v.best?.stationId ?? null;

    const title = v.plan?.kind === 'work' ? `${who} · ${hmLabel(v.plan.from)} – ${hmLabel(v.plan.to)}` : `Trajet de ${who}`;
    const [l1, l2] = headline(v);

    return (
        <section className="card commute-card" aria-label={`Trajet de ${who}`}>
            <div className="card-head">
                <span className="card-title cm-title"><i className="cm-dot" />{title}</span>
                {v.verdict?.text && <span className={`cm-pill ${v.verdict.level}`}>{v.verdict.text}</span>}
            </div>

            <div className="cm-body">
                <div className="cm-main">
                    {v.plan?.kind === 'rest' ? (
                        <>
                            <p className="cm-head">Jour de repos.<br />Une idée pour ta journée :</p>
                            {v.rest?.idea ? (
                                <div className="cm-idea">
                                    <b>{v.rest.idea.title}</b>
                                    <small>{[v.rest.idea.where, v.rest.idea.when].filter(Boolean).join(' · ')}</small>
                                    {v.rest.idea.why && <small>{v.rest.idea.why}</small>}
                                </div>
                            ) : (
                                <p className="muted">L’idée arrive le mercredi matin.</p>
                            )}
                        </>
                    ) : v.plan?.kind === 'off' ? (
                        <p className="cm-head">Pas de trajet prévu aujourd’hui.</p>
                    ) : (
                        <>
                            <p className="cm-head">{l1}<br />{l2}</p>
                            {(v.options || []).filter((o) => o.minutes != null || o.mode === 'bike').slice(0, 3).map((o) => (
                                <OptionRow key={o.mode} o={o} best={o === v.options![0] && !!v.best} />
                            ))}
                        </>
                    )}
                </div>

                {v.map?.home && (
                    <button type="button" className="cm-mini" aria-label="Agrandir la carte des stations" onClick={() => setBig(true)}>
                        <CommuteMap data={v.map} best={bestStation} />
                        <span className="cm-mini-hint">Toucher pour agrandir</span>
                    </button>
                )}
            </div>

            <AnimatePresence>
                {big && v.map && (
                    <div className="sheet-backdrop" onClick={() => setBig(false)}>
                        <motion.div className="sheet cm-sheet" role="dialog" aria-modal="true" aria-label="Stations BIXI autour de la maison"
                            initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                            onClick={(e) => e.stopPropagation()}>
                            <div className="sheet-head">
                                <h2>Stations autour</h2>
                                <button type="button" className="round-btn" aria-label="Fermer" onClick={() => setBig(false)}><Icon name="close" size={22} strokeWidth={2} /></button>
                            </div>
                            <CommuteMap data={v.map} best={bestStation} large />
                            <p className="muted cm-legend">Chiffre = vélos classiques · ⚡ électriques · vert 3 et plus, orange 1 ou 2, rouge 0{v.bus && !v.bus.realtime ? ' · bus : horaire prévu' : ''}</p>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </section>
    );
}
