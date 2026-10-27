import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Period, ThermostatStatus } from '../../hooks/useHome';
import { Icon } from '../Icon';

const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};
const toHHMM = (min: number) => {
    const v = ((min % 1440) + 1440) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
const fmtT = (n: number) => String(n).replace('.', ',');
const fmtH = (hhmm: string) => {
    const [h, m] = hhmm.split(':');
    return `${Number(h)} h${m !== '00' ? m : ''}`;
};
const clampT = (n: number) => Math.max(10, Math.min(30, Math.round(n * 2) / 2));

// Couleur d'une période selon sa consigne : froid = bleu, chaud = ambre
const periodColor = (target: number) =>
    target >= 20 ? { bg: '#3a2a12', fg: '#f2d9a6' } : { bg: '#1e2a40', fg: '#a9c9ff' };

/** Frise des 24 h : chaque période jusqu'à la suivante, avec un repère pour maintenant. */
function Frieze({ periods }: { periods: Period[] }) {
    const sorted = [...periods].sort((a, b) => toMin(a.from) - toMin(b.from));
    const blocks: { start: number; end: number; p: Period }[] = [];
    sorted.forEach((p, i) => {
        const start = toMin(p.from);
        const end = i + 1 < sorted.length ? toMin(sorted[i + 1].from) : 1440;
        blocks.push({ start, end, p });
    });
    // Avant la première période : la dernière de la veille continue
    if (sorted.length && toMin(sorted[0].from) > 0) blocks.unshift({ start: 0, end: toMin(sorted[0].from), p: sorted[sorted.length - 1] });
    const now = new Date();
    const nowPct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;

    return (
        <div>
            <div className="frieze" role="img"
                aria-label={sorted.map((p) => `${p.label} ${fmtT(p.target)}° à partir de ${fmtH(p.from)}`).join(', ')}>
                {blocks.map((b, i) => {
                    const c = periodColor(b.p.target);
                    return (
                        <div key={i} style={{ width: `${((b.end - b.start) / 1440) * 100}%`, background: c.bg, color: c.fg }}>
                            {b.end - b.start >= 150 && <span>{b.p.label} {fmtT(b.p.target)}°</span>}
                        </div>
                    );
                })}
                <span className="frieze-now" style={{ left: `${nowPct}%` }} aria-hidden="true" />
            </div>
            <div className="frieze-scale mono" aria-hidden="true"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span></div>
        </div>
    );
}

function Stepper({ label, value, onChange }: { label: string; value: string; onChange: (dir: -1 | 1) => void }) {
    return (
        <div className="mini-stepper">
            <button type="button" aria-label={`${label} : moins`} onClick={() => onChange(-1)}>−</button>
            <span className="mono">{value}</span>
            <button type="button" aria-label={`${label} : plus`} onClick={() => onChange(1)}>+</button>
        </div>
    );
}

export function ScheduleSheet({ status, neverSent, onUpdate, onClearOverride, onClose }: {
    status: ThermostatStatus;
    neverSent: boolean;
    onUpdate: (patch: Record<string, unknown>) => Promise<ThermostatStatus>;
    onClearOverride: () => void;
    onClose: () => void;
}) {
    const [periods, setPeriods] = useState<Period[]>(status.config.schedule);
    const [awayTarget, setAwayTarget] = useState(status.config.awayTarget);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const dirty = JSON.stringify(periods) !== JSON.stringify(status.config.schedule) || awayTarget !== status.config.awayTarget;

    const edit = (i: number, patch: Partial<Period>) => {
        setSaved(false);
        setPeriods((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    };

    const save = async () => {
        setError(null);
        try {
            await onUpdate({ schedule: periods, awayTarget });
            setSaved(true);
        } catch {
            setError('Programme refusé : vérifie les heures et les températures.');
        }
    };

    const override = status.config.override;

    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <motion.div className="sheet schedule-sheet" role="dialog" aria-modal="true" aria-label="Programme de chauffage"
                initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <h2>Programme</h2>
                    <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} strokeWidth={2} /></button>
                </div>

                <div className="toggle-row">
                    <div>
                        <div className="toggle-title">Thermostat intelligent</div>
                        <div className="muted">MyHue règle la thermopompe d’après la température de la pièce, pas d’après sa propre sonde.</div>
                    </div>
                    <button type="button" className={`switch ${status.enabled ? 'on' : ''}`} aria-pressed={status.enabled}
                        aria-label="Thermostat intelligent" onClick={() => onUpdate({ enabled: !status.enabled })}>
                        <span />
                    </button>
                </div>
                {neverSent && !status.enabled && (
                    <div className="warn-line">La thermopompe n’a encore jamais reçu de commande de MyHue : valide d’abord le bip sur la page Chauffage.</div>
                )}
                {status.enabled && <div className="muted">{status.status.text}</div>}
                {override && (
                    <div className="toggle-row compact">
                        <span>Dérogation : {fmtT(override.target)}° jusqu’à {new Date(override.until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <button type="button" className="ghost-btn" onClick={onClearOverride}>Reprendre le programme</button>
                    </div>
                )}

                <Frieze periods={periods} />

                <div className="periods">
                    {periods.map((p, i) => (
                        <div key={i} className="period">
                            <label className="period-name">
                                <span className="sr-only">Nom de la période</span>
                                <input value={p.label} maxLength={20} onChange={(e) => edit(i, { label: e.target.value })} />
                            </label>
                            <span className="muted">dès</span>
                            <Stepper label={`Début ${p.label}`} value={fmtH(p.from)}
                                onChange={(d) => edit(i, { from: toHHMM(toMin(p.from) + d * 30) })} />
                            <Stepper label={`Consigne ${p.label}`} value={`${fmtT(p.target)}°`}
                                onChange={(d) => edit(i, { target: clampT(p.target + d * 0.5) })} />
                            {periods.length > 1 && (
                                <button type="button" className="round-btn small" aria-label={`Supprimer ${p.label}`}
                                    onClick={() => { setSaved(false); setPeriods((ps) => ps.filter((_, j) => j !== i)); }}>
                                    <Icon name="close" size={18} strokeWidth={2} />
                                </button>
                            )}
                        </div>
                    ))}
                    {periods.length < 8 && (
                        <button type="button" className="ghost-btn" onClick={() => {
                            setSaved(false);
                            setPeriods((ps) => [...ps, { label: 'Soirée', from: '18:00', target: 21 }]);
                        }}><Icon name="plus" size={18} /> Ajouter une période</button>
                    )}
                </div>

                <div className="toggle-row">
                    <div>
                        <div className="toggle-title">Absence</div>
                        <div className="muted">
                            {status.anyoneHome === null
                                ? 'Automatique dès que HA Companion suit ton téléphone.'
                                : status.anyoneHome ? 'Quelqu’un est à la maison.' : 'Personne à la maison : consigne d’absence.'}
                        </div>
                    </div>
                    <Stepper label="Consigne d’absence" value={`${fmtT(awayTarget)}°`}
                        onChange={(d) => { setSaved(false); setAwayTarget((t) => clampT(t + d * 0.5)); }} />
                    <button type="button" className={`switch ${status.away ? 'on' : ''}`} aria-pressed={status.away}
                        aria-label="Je suis absent" onClick={() => onUpdate({ away: !status.away })}>
                        <span />
                    </button>
                </div>

                {error && <div className="warn-line">{error}</div>}
                <div className="step-foot">
                    {saved && !dirty && <span className="muted saved-note">Programme enregistré</span>}
                    <button type="button" className="primary-btn" disabled={!dirty} onClick={save}>Enregistrer</button>
                </div>
            </motion.div>
        </div>
    );
}
