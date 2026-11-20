import type { ReactNode } from 'react';
import { commutePoll } from '../home/widgets/polls';
import { StatusPill, WidgetCard } from '../home/widgets/WidgetCard';
import type { Level } from '../home/widgets/WidgetCard';
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
const PILL: Record<'ok' | 'low' | 'no', Level> = { ok: 'ok', low: 'warn', no: 'bad' };

/** La grande phrase du haut : quoi prendre, et quand partir. */
function headline(v: CommuteView): [string, string] {
    const b = v.best;
    if (!b) return ['Aucune option fiable,', 'regarde dehors.'];
    const snow = /neige/i.test(v.verdict?.text || '');
    const bikeOk = (v.options || []).some((o) => (o.mode === 'bike' || o.mode === 'ebike') && o.ok && o.minutes != null);
    // « ce matin » seulement le matin : l'après-midi la carte sert à ressortir
    const when = new Date().getHours() < 12 ? 'ce matin' : 'maintenant';
    if (b.mode === 'bike') return [`BIXI ${when},`, 'pars quand tu veux.'];
    if (b.mode === 'ebike') return ['BIXI électrique,', 'prends un casque.'];
    // Nom de la ligne : réglage sur le Pi (data/commute.json), jamais dans le code public
    const bus = v.bus?.label || 'Bus';
    if (b.mode === 'bus') return [snow ? `Neige : ${bus.toLowerCase()},` : bikeOk ? `${bus}, plus rapide,` : `Pas de BIXI : ${bus.toLowerCase()},`, `pars à ${hm(b.leaveAt!)}.`];
    return [snow ? 'Neige : à pied,' : `À pied ${when},`, `≈ ${b.minutes} min.`];
}

function OptionRow({ o, best }: { o: Option; best: boolean }) {
    const busSub = o.mode === 'bus' ? o.detail.replace(/^[^à]*à /, '') : o.detail;
    return (
        <div className={`cm-opt ${best ? 'is-best' : ''} ${o.ok ? '' : 'is-off'}`}>
            <b className={`cm-badge ${o.mode}`}>{BADGE[o.mode]}</b>
            <span className="cm-opt-text">
                <b>{o.mode === 'bus' && o.leaveAt ? `${o.title} à ${o.detail.split(' à ')[0]}` : o.title}</b>
                {/* L'avertissement remplace le détail : à côté du titre, il l'écrasait dans la colonne étroite */}
                {o.warn
                    ? <small className={`cm-warn ${o.mode === 'ebike' ? 'info' : ''}`}>{o.warn}</small>
                    : <small>{o.mode === 'bus' ? busSub : o.detail}</small>}
            </span>
            <b className="cm-min">{o.minutes != null ? `${o.minutes}′` : '–'}</b>
        </div>
    );
}

/** Ce que dit la carte en jour de repos : l'idée de sortie. */
function RestIdea({ v, full }: { v: CommuteView; full: boolean }) {
    const idea = v.rest?.idea;
    if (!idea) return <p className="wcard-line">L’idée arrive le mercredi matin.</p>;
    return (
        <div className="cm-idea">
            <b>{idea.title}</b>
            <small>{[idea.where, idea.when].filter(Boolean).join(' · ')}</small>
            {full && idea.why && <small>{idea.why}</small>}
        </div>
    );
}

/** Carte « Trajet » de l'accueil : le conseil et la meilleure option ; le reste et le plan dans le détail. */
export function CommuteCard({ more }: { more?: ReactNode }) {
    const v = commutePoll.use();
    if (!v?.enabled || !v.configured || !v.person) return null;

    const who = v.person.who;
    const bestStation = v.best?.stationId ?? null;
    const title = v.plan?.kind === 'work' ? `${who} · ${hmLabel(v.plan.from)} – ${hmLabel(v.plan.to)}` : `Trajet de ${who}`;
    const [l1, l2] = headline(v);
    const options = (v.options || []).filter((o) => o.minutes != null || o.mode === 'bike');
    const kind = v.plan?.kind;

    const body = (full: boolean) => kind === 'rest' ? (
        <>
            <p className="cm-head">Jour de repos.{full ? <><br />Une idée pour ta journée :</> : ''}</p>
            <RestIdea v={v} full={full} />
        </>
    ) : kind === 'off' ? (
        <p className="cm-head">Pas de trajet prévu aujourd’hui.</p>
    ) : (
        <>
            {full && <p className="cm-head">{l1}<br />{l2}</p>}
            {(full ? options : options.slice(0, 1)).map((o) => <OptionRow key={o.mode} o={o} best={o === v.options![0] && !!v.best} />)}
        </>
    );

    return (
        <WidgetCard className="commute-card" label={`Trajet de ${who}`}
            title={<><i className="cm-dot" />{title}</>}
            pills={v.verdict?.text && <StatusPill level={PILL[v.verdict.level]}>{v.verdict.text}</StatusPill>}
            detail={{
                title: `Trajet de ${who}`,
                className: 'cm-sheet',
                body: (
                    <>
                        <div className="cm-detail">{body(true)}</div>
                        {v.map?.home && (
                            <>
                                <CommuteMap data={v.map} best={bestStation} large />
                                <p className="muted cm-legend">Chiffre = vélos classiques · ⚡ électriques · vert 3 et plus, orange 1 ou 2, rouge 0{v.bus && !v.bus.realtime ? ' · bus : horaire prévu' : ''}</p>
                            </>
                        )}
                        {more}
                    </>
                ),
            }}>
            {body(false)}
        </WidgetCard>
    );
}
