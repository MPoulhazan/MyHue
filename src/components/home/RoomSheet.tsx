import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import { motion } from 'framer-motion';
import { SWATCHES } from '../../hooks/useHome';
import type { Ambiance, DashLight, Swatch } from '../../hooks/useHome';
import { Icon } from '../Icon';

// Ambiances prêtes : blanc plus ou moins chaud (mireds) à une intensité donnée
const AMBIANCES: (Ambiance & { bg: string; fg: string })[] = [
    { label: 'Lecture', ct: 233, level: 100, bg: '#F7E7C4', fg: '#2A2418' },
    { label: 'Détente', ct: 400, level: 60, bg: '#FFB45C', fg: '#2A2418' },
    { label: 'Concentration', ct: 200, level: 100, bg: '#DCE8FF', fg: '#10213D' },
    { label: 'Bougie', ct: 500, level: 25, bg: '#6E3B1E', fg: '#FFE2C4' },
    { label: 'Veilleuse', ct: 454, level: 5, bg: '#3A2A12', fg: '#F2D9A6' },
];

/** Curseur horizontal : glisser ou flèches du clavier, par pas de 5 %. */
function Slider({ value, label, onChange, className = '' }: { value: number; label: string; onChange: (v: number) => void; className?: string }) {
    const active = useRef(false);
    const valueAt = (e: RPointerEvent<HTMLDivElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 20) * 5;
    };
    return (
        <div className={`slider ${className}`} role="slider" tabIndex={0} aria-label={label}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
            onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                active.current = true;
                onChange(valueAt(e));
            }}
            onPointerMove={(e) => active.current && onChange(valueAt(e))}
            onPointerUp={() => (active.current = false)}
            onPointerCancel={() => (active.current = false)}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'ArrowRight') onChange(Math.min(100, value + 5));
                if (e.key === 'ArrowLeft') onChange(Math.max(0, value - 5));
            }}>
            <motion.span className="slider-fill" animate={{ width: `${value}%` }} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
        </div>
    );
}

export function RoomSheet({ room, lights, onLevel, onAmbiance, onColor, onClose }: {
    room: string;
    lights: DashLight[];
    onLevel: (ids: string[], v: number) => void;
    onAmbiance: (ids: string[], a: Ambiance) => void;
    onColor: (ids: string[], s: Swatch) => void;
    onClose: () => void;
}) {
    const [colors, setColors] = useState(false);
    const live = lights.filter((l) => l.reachable);
    const on = live.filter((l) => l.level > 0);
    const ids = live.map((l) => l.id);
    const level = on.length ? Math.round(on.reduce((a, l) => a + l.level, 0) / on.length) : 0;

    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <motion.div className="sheet room-sheet" role="dialog" aria-modal="true" aria-label={room}
                initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                    <div className="sheet-title">
                        <h2>{room}</h2>
                        <span className="muted">{on.length ? `${on.length} sur ${lights.length} allumée${on.length > 1 ? 's' : ''}` : 'Tout est éteint'}</span>
                    </div>
                    <div className="sheet-actions">
                        <button type="button" className={`pill-btn ${on.length ? 'light' : ''}`}
                            onClick={() => onLevel(ids, on.length ? 0 : 70)}>
                            {on.length ? 'Éteindre la pièce' : 'Allumer la pièce'}
                        </button>
                        <button type="button" className="round-btn" aria-label="Fermer" onClick={onClose}>
                            <Icon name="close" size={22} strokeWidth={2} />
                        </button>
                    </div>
                </div>

                <div>
                    <div className="row-label"><span>Intensité de la pièce</span><span className="light-text mono">{level} %</span></div>
                    <Slider value={level} label={`Intensité ${room}`} onChange={(v) => onLevel(ids, v)} className="big" />
                </div>

                <div>
                    <h3 className="sub-title">Ambiance</h3>
                    <div className="ambiances">
                        {AMBIANCES.map((a) => (
                            <button key={a.label} type="button" style={{ background: a.bg, color: a.fg }}
                                onClick={() => onAmbiance(ids, a)}>{a.label}</button>
                        ))}
                        <button type="button" className={`ambiance-color ${colors ? 'open' : ''}`} aria-expanded={colors}
                            onClick={() => setColors((c) => !c)}>
                            <span className="dots" aria-hidden="true"><i style={{ background: '#FF7A59' }} /><i style={{ background: '#A26BFF' }} /><i style={{ background: '#4F7DFF' }} /></span>
                            Couleur
                        </button>
                    </div>
                    {colors && (
                        <div className="swatches">
                            {SWATCHES.filter((s) => !s.ct).map((s) => (
                                <button key={s.label} type="button" aria-label={s.label} style={{ background: s.hex }}
                                    onClick={() => onColor(ids, s)} />
                            ))}
                        </div>
                    )}
                </div>

                <div className="lamps-block">
                    <h3 className="sub-title">Lampes</h3>
                    <div className="lamps">
                        {lights.map((l) => (
                            <div key={l.id} className={`lamp ${l.reachable ? '' : 'offline'}`}>
                                <span className="lamp-name">{l.name}</span>
                                {!l.reachable ? (
                                    <span className="warn lamp-note">Injoignable : interrupteur coupé ?</span>
                                ) : l.dimmable ? (
                                    <>
                                        <Slider value={l.level} label={`Intensité ${l.name}`} onChange={(v) => onLevel([l.id], v)} />
                                        <span className="lamp-pct mono">{l.level ? `${l.level} %` : ''}</span>
                                    </>
                                ) : (
                                    <span className="muted lamp-note">Prise : marche / arrêt</span>
                                )}
                                {l.reachable && (
                                    <button type="button" className={`lamp-toggle ${l.level ? 'on' : ''}`}
                                        aria-label={`${l.level ? 'Éteindre' : 'Allumer'} ${l.name}`} aria-pressed={l.level > 0}
                                        onClick={() => onLevel([l.id], l.level ? 0 : 70)} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
