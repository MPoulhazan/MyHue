import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import './AutomationTabs.css';

export type Channel = 'voice' | 'lamp' | 'telegram';

export interface Builtin {
    id: string;
    name: string;
    area: string;
    desc: string;
    locked: boolean;
    deleted: boolean;
    channels: { channel: Channel; where: string; on: boolean }[];
    monthCount: number;
    lastAt: number | null;
}

export interface Run {
    type: 'builtin' | 'mine';
    id: string;
    name: string;
    at: number;
    channels: Channel[];
    detail: string | null;
}

/** Une automatisation créée dans l'appli, telle que la page la connaît déjà. */
export interface MineLite {
    id: string;
    name: string;
    summary: string;
    enabled: boolean;
    triggerCount: number;
    lastTriggeredAt: string | null;
}

const CH_LABEL: Record<Channel, string> = { voice: 'Voix', lamp: 'Lampe', telegram: 'Telegram' };
const CH_ICON: Record<Channel, IconName> = { voice: 'volume', lamp: 'lights', telegram: 'chat' };

const AREA_ICON: Record<string, IconName> = {
    Cuisinière: 'flame', Cooper: 'bowl', Courrier: 'mail', Entrée: 'door', 'À deux': 'heart', Cube: 'dice', Matin: 'sun',
    Météo: 'thermo', Ville: 'city', Ciel: 'moon', Déplacements: 'bike', Sorties: 'leave', Chauffage: 'heating',
    Compagnon: 'agent', Maison: 'home', Absence: 'leave', Sécurité: 'shield',
};
const iconFor = (b?: Builtin): IconName => (b?.id.startsWith('communauto') ? 'car' : AREA_ICON[b?.area ?? ''] ?? 'rules');

const TZ = 'America/Toronto';
const hm = (ts: number) => new Date(ts).toLocaleTimeString('fr-CA', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(':', ' h ');
const dayKey = (ts: number) => new Date(ts).toLocaleDateString('fr-CA', { timeZone: TZ });
const dayLabel = (ts: number) => {
    const today = dayKey(Date.now());
    const yesterday = dayKey(Date.now() - 86400_000);
    const k = dayKey(ts);
    if (k === today) return 'Aujourd’hui';
    if (k === yesterday) return 'Hier';
    return new Date(ts).toLocaleDateString('fr-CA', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
};
const lastLabel = (ts: number | null) => (ts ? `${dayLabel(ts).replace('Aujourd’hui', 'Aujourd’hui,')} ${hm(ts)}` : 'Pas ce mois-ci');

type Filter = 'all' | Channel;

interface Props {
    tab: 'recent' | 'builtin';
    mine: MineLite[];
    onToggleMine: (id: string) => void;
    onRemoveMine: (id: string) => Promise<void> | void;
    onCounts: (c: { builtin: number }) => void;
}

/** Onglets « Récemment » et « Intégrés » : liste à gauche, fiche de l'automatisme choisi à droite. */
export function AutomationTabs({ tab, mine, onToggleMine, onRemoveMine, onCounts }: Props) {
    const [builtins, setBuiltins] = useState<Builtin[]>([]);
    const [runs, setRuns] = useState<Run[] | null>(null);
    const [filter, setFilter] = useState<Filter>('all');
    // Choix fait dans l'onglet en cours ; sinon le passage le plus récent (ou le premier intégré)
    const [picked, setPicked] = useState<{ tab: string; type: 'builtin' | 'mine'; id: string } | null>(null);
    const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const toastTimer = useRef<number | undefined>(undefined);

    const load = useCallback(async () => {
        try {
            const [b, r] = await Promise.all([axios.get('/api/automations/builtin'), axios.get('/api/automations/recent')]);
            setBuiltins(b.data.builtins);
            setRuns(r.data.runs);
            setError(null);
        } catch {
            setError('Impossible de charger les automatismes intégrés.');
            setRuns((x) => x ?? []);
        }
    }, []);
    useEffect(() => {
        load();
        const id = window.setInterval(load, 30_000);
        return () => window.clearInterval(id);
    }, [load]);

    const visible = useMemo(() => builtins.filter((b) => !b.deleted), [builtins]);
    useEffect(() => onCounts({ builtin: visible.length }), [visible.length, onCounts]);
    const byId = useMemo(() => new Map(builtins.map((b) => [b.id, b])), [builtins]);

    const sel: { type: 'builtin' | 'mine'; id: string } | null =
        picked?.tab === tab ? picked
            : tab === 'recent' && runs?.length ? { type: runs[0].type, id: runs[0].id }
                : tab === 'builtin' && visible.length ? { type: 'builtin', id: visible[0].id } : null;
    const setSel = (s: { type: 'builtin' | 'mine'; id: string } | null) => setPicked(s ? { ...s, tab } : null);

    const showToast = (text: string, undo?: () => void) => {
        setToast({ text, undo });
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 6000);
    };

    const send = async (id: string, change: object) => {
        const { data } = await axios.patch(`/api/automations/builtin/${id}`, change);
        setBuiltins((list) => list.map((b) => (b.id === id ? data : b)));
        return data as Builtin;
    };

    /** Remet un automatisme exactement comme dans la photo prise avant le changement. */
    const restore = async (snap: Builtin) => {
        try {
            let cur = byIdRef.current.get(snap.id) ?? snap;
            if (cur.deleted !== snap.deleted) cur = await send(snap.id, { deleted: snap.deleted });
            for (const c of snap.channels) {
                const now = cur.channels.find((x) => x.channel === c.channel);
                if (now && now.on !== c.on) cur = await send(snap.id, { channel: c.channel, on: c.on });
            }
            setToast(null);
        } catch {
            setError('Annulation impossible.');
        }
    };
    const byIdRef = useRef(byId);
    useEffect(() => { byIdRef.current = byId; }, [byId]);

    const change = async (b: Builtin, ch: object, text: string) => {
        const snap = structuredClone(b);
        try {
            await send(b.id, ch);
            showToast(text, () => restore(snap));
        } catch (err) {
            setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Modification refusée.' : 'Modification refusée.');
        }
    };

    const selBuiltin = sel?.type === 'builtin' ? byId.get(sel.id) : undefined;
    const selMine = sel?.type === 'mine' ? mine.find((m) => m.id === sel.id) : undefined;

    const panel = selBuiltin ? (
        <BuiltinPanel key={selBuiltin.id} b={selBuiltin}
            onChannel={(c, on) => change(selBuiltin, { channel: c, on }, `${CH_LABEL[c]} ${on ? 'rallumée' : 'coupée'} pour « ${selBuiltin.name} »`)}
            onAll={(on) => change(selBuiltin, { all: on }, `« ${selBuiltin.name} » ${on ? 'réactivé' : 'désactivé'}`)}
            onDelete={() => change(selBuiltin, { deleted: true }, `« ${selBuiltin.name} » supprimé`)}
            onRestore={() => change(selBuiltin, { deleted: false }, `« ${selBuiltin.name} » restauré`)} />
    ) : selMine ? (
        <MinePanel key={selMine.id} a={selMine} onToggle={() => onToggleMine(selMine.id)}
            onRemove={async () => { await onRemoveMine(selMine.id); setSel(null); showToast(`« ${selMine.name} » supprimée`); }} />
    ) : (
        <aside className="au-panel"><p className="au-desc">Touche une ligne pour voir ce qu’elle fait et la couper.</p></aside>
    );

    return (
        <>
            {error && <div className="warn-line">{error}</div>}
            {tab === 'recent' && (
                <div className="au-filters" aria-label="Filtrer par canal">
                    {(['all', 'voice', 'lamp', 'telegram'] as Filter[]).map((f) => (
                        <button key={f} type="button" className="au-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                            {f === 'all' ? 'Tout' : <><Icon name={CH_ICON[f]} size={16} strokeWidth={2.2} /> {f === 'voice' ? 'Avec voix' : f === 'lamp' ? 'Lampes' : 'Telegram'}</>}
                        </button>
                    ))}
                </div>
            )}
            <div className="au-cols">
                <section>
                    {tab === 'recent'
                        ? <RecentList runs={runs} filter={filter} byId={byId} sel={sel} onSelect={setSel} />
                        : <BuiltinList builtins={builtins} sel={sel} onSelect={setSel} />}
                </section>
                {panel}
            </div>
            {toast && (
                <div className="au-toast" role="status">
                    <span>{toast.text}</span>
                    {toast.undo && <button type="button" onClick={toast.undo}>Annuler</button>}
                </div>
            )}
        </>
    );
}

function Chans({ channels, b }: { channels: Channel[]; b?: Builtin }) {
    return (
        <span className="au-chans">
            {channels.map((c) => {
                const on = b?.channels.find((x) => x.channel === c)?.on ?? true;
                return <span key={c} className={`au-ch ${c} ${on ? '' : 'cut'}`} title={on ? undefined : 'Coupé depuis'}>{CH_LABEL[c]}</span>;
            })}
        </span>
    );
}

function RecentList({ runs, filter, byId, sel, onSelect }: {
    runs: Run[] | null; filter: Filter; byId: Map<string, Builtin>;
    sel: { type: string; id: string } | null; onSelect: (s: { type: 'builtin' | 'mine'; id: string }) => void;
}) {
    if (!runs) return <p className="au-empty">Chargement…</p>;
    const shown = runs.filter((r) => filter === 'all' || r.channels.includes(filter));
    if (!shown.length) return <p className="au-empty">{runs.length ? 'Rien pour ce filtre ces 7 derniers jours.' : 'Rien n’a tourné ces 7 derniers jours.'}</p>;
    const days: { label: string; items: Run[] }[] = [];
    for (const r of shown) {
        const label = dayLabel(r.at);
        if (days.at(-1)?.label !== label) days.push({ label, items: [] });
        days.at(-1)!.items.push(r);
    }
    return (
        <>
            {days.map((d) => (
                <div key={d.label}>
                    <div className="au-day">{d.label}</div>
                    <div className="au-list">
                        {d.items.map((r) => {
                            const b = r.type === 'builtin' ? byId.get(r.id) : undefined;
                            const isSel = sel?.type === r.type && sel.id === r.id;
                            return (
                                <button key={`${r.type}${r.id}${r.at}`} type="button" className={`au-row ${isSel ? 'sel' : ''} ${b?.deleted ? 'off' : ''}`}
                                    onClick={() => onSelect({ type: r.type, id: r.id })}>
                                    <span className="au-time">{hm(r.at)}</span>
                                    <span className="au-ico"><Icon name={r.type === 'mine' ? 'rules' : iconFor(b)} size={20} strokeWidth={2} /></span>
                                    <span className="au-what"><b>{b?.name ?? r.name}</b>{r.detail && <span>{r.detail}</span>}</span>
                                    {r.type === 'mine' ? <span className="au-chans"><span className="au-ch mine">Mes automatisations</span></span> : <Chans channels={r.channels} b={b} />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
            <p className="muted settings-note">Les 7 derniers jours.</p>
        </>
    );
}

function BuiltinList({ builtins, sel, onSelect }: {
    builtins: Builtin[]; sel: { type: string; id: string } | null; onSelect: (s: { type: 'builtin'; id: string }) => void;
}) {
    const live = builtins.filter((b) => !b.deleted);
    const gone = builtins.filter((b) => b.deleted);
    const areas = [...new Set(live.map((b) => b.area))];
    const row = (b: Builtin) => {
        const allOff = b.channels.every((c) => !c.on);
        return (
            <button key={b.id} type="button" className={`au-row simple ${sel?.id === b.id ? 'sel' : ''} ${allOff ? 'off' : ''}`} onClick={() => onSelect({ type: 'builtin', id: b.id })}>
                <span className="au-ico"><Icon name={iconFor(b)} size={20} strokeWidth={2} /></span>
                <span className="au-what"><b>{b.name}</b><span>{b.monthCount ? `${b.monthCount} fois ce mois-ci` : 'Pas ce mois-ci'}</span></span>
                <Chans channels={b.channels.map((c) => c.channel)} b={b} />
            </button>
        );
    };
    return (
        <>
            {areas.map((a) => (
                <div key={a}>
                    <div className="au-area">{a}</div>
                    <div className="au-list">{live.filter((b) => b.area === a).map(row)}</div>
                </div>
            ))}
            {gone.length > 0 && (
                <div className="au-deleted">
                    <div className="au-area">Supprimés</div>
                    <div className="au-list">{gone.map(row)}</div>
                </div>
            )}
        </>
    );
}

function BuiltinPanel({ b, onChannel, onAll, onDelete, onRestore }: {
    b: Builtin; onChannel: (c: Channel, on: boolean) => void; onAll: (on: boolean) => void; onDelete: () => void; onRestore: () => void;
}) {
    const [armed, setArmed] = useState(false);
    const anyOn = b.channels.some((c) => c.on);
    return (
        <aside className="au-panel" aria-live="polite">
            <div>
                <div className="au-kind">Intégré · {b.area}</div>
                <h2>{b.name}</h2>
            </div>
            <p className="au-desc">{b.desc}</p>
            <div className="au-stats">
                <div><b>{b.monthCount}</b>fois ce mois-ci</div>
                <div><b>{lastLabel(b.lastAt)}</b>dernière fois</div>
            </div>
            {b.locked ? (
                <div className="au-lock"><Icon name="shield" size={20} strokeWidth={2} /> Sécurité : il reste toujours actif.</div>
            ) : b.deleted ? (
                <div className="au-actions">
                    <button type="button" className="au-btn main" onClick={onRestore}>Restaurer</button>
                </div>
            ) : (
                <>
                    <div className="au-toggles">
                        {b.channels.map((c) => (
                            <div key={c.channel} className="au-toggle">
                                <span className="ic"><Icon name={CH_ICON[c.channel]} size={20} strokeWidth={2} /></span>
                                <span className="lbl"><b>{CH_LABEL[c.channel]}</b><span>{c.where}</span></span>
                                <button type="button" className={`switch ${c.on ? 'on' : ''}`} aria-pressed={c.on}
                                    aria-label={`${c.on ? 'Couper' : 'Rallumer'} ${CH_LABEL[c.channel].toLowerCase()} de ${b.name}`}
                                    onClick={() => onChannel(c.channel, !c.on)}>
                                    <span />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="au-actions">
                        {b.channels.length > 1 && (
                            <button type="button" className="au-btn main" onClick={() => onAll(!anyOn)}>{anyOn ? 'Tout couper' : 'Tout rallumer'}</button>
                        )}
                        <button type="button" className={`au-btn danger ${armed ? 'armed' : ''}`} onBlur={() => setArmed(false)}
                            onClick={() => (armed ? (setArmed(false), onDelete()) : setArmed(true))}>
                            {armed ? 'Supprimer pour de bon ?' : 'Supprimer'}
                        </button>
                    </div>
                </>
            )}
        </aside>
    );
}

function MinePanel({ a, onToggle, onRemove }: { a: MineLite; onToggle: () => void; onRemove: () => void }) {
    const [armed, setArmed] = useState(false);
    return (
        <aside className="au-panel" aria-live="polite">
            <div>
                <div className="au-kind">Mes automatisations</div>
                <h2>{a.name}</h2>
            </div>
            <p className="au-desc">{a.summary}</p>
            <div className="au-stats">
                <div><b>{a.triggerCount}</b>déclenchements</div>
                <div><b>{a.lastTriggeredAt ? lastLabel(new Date(a.lastTriggeredAt).getTime()) : 'Jamais'}</b>dernière fois</div>
            </div>
            <div className="au-toggle">
                <span className="ic"><Icon name="rules" size={20} strokeWidth={2} /></span>
                <span className="lbl"><b>Active</b><span>{a.enabled ? 'Elle tourne' : 'En pause'}</span></span>
                <button type="button" className={`switch ${a.enabled ? 'on' : ''}`} aria-pressed={a.enabled}
                    aria-label={`${a.enabled ? 'Désactiver' : 'Activer'} ${a.name}`} onClick={onToggle}><span /></button>
            </div>
            <div className="au-actions">
                <button type="button" className={`au-btn danger ${armed ? 'armed' : ''}`} onBlur={() => setArmed(false)}
                    onClick={() => (armed ? (setArmed(false), onRemove()) : setArmed(true))}>
                    {armed ? 'Supprimer pour de bon ?' : 'Supprimer'}
                </button>
            </div>
        </aside>
    );
}
