import { useRef, useState } from 'react';
import axios from 'axios';
import { isWallScreen, loadCall, publishCall, readWallOverride, startCall, useCallState, writeWallOverride } from '../components/cooper/callStore';
import type { CallSettings } from '../components/cooper/callStore';
import './Dashboard.css';
import './Settings.css';

const MODES: [CallSettings['mode'], string][] = [['never', 'Jamais'], ['sometimes', 'Parfois'], ['always', 'Toujours']];
const VOLUMES: [number | null, string][] = [[null, 'Ne pas toucher'], [6, 'Doux'], [10, 'Moyen'], [14, 'Fort']];

/** Réglages de l'appel vidéo de Cooper, faits pour être touchés sur la tablette murale. */
export function CooperSettings() {
    const call = useCallState();
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; warn?: boolean } | null>(null);
    const [override, setOverride] = useState(readWallOverride);
    const file = useRef<HTMLInputElement>(null);
    const s = call?.settings;

    const patch = async (body: Partial<CallSettings>) => {
        setNote(null);
        try {
            await axios.put('/api/cooper/settings', { call: body });
            await loadCall();
        } catch {
            setNote({ text: 'Le réglage n’a pas été enregistré. Réessaie dans un instant.', warn: true });
        }
    };

    const test = async () => {
        setBusy(true);
        setNote(null);
        try {
            await startCall({ kind: 'test' });
            setNote({ text: isWallScreen(call) ? 'Ça sonne…' : 'Ça sonne sur la tablette murale.' });
        } catch {
            setNote({ text: 'L’essai n’a pas pu partir.', warn: true });
        } finally {
            setBusy(false);
        }
    };

    const upload = async (f: File | undefined) => {
        if (!f) return;
        setBusy(true);
        setNote({ text: 'Envoi de la vidéo…' });
        try {
            await axios.put('/api/cooper/call/video', f, { headers: { 'Content-Type': f.type || 'video/mp4' } });
            setNote({ text: 'Nouvelle vidéo en place.' });
            loadCall();
        } catch {
            setNote({ text: 'Vidéo refusée (60 Mo au plus).', warn: true });
        } finally {
            setBusy(false);
            if (file.current) file.current.value = '';
        }
    };

    const setWall = (v: boolean | null) => {
        writeWallOverride(v);
        setOverride(v);
        if (call) publishCall(call);
    };

    const wall = override ?? Boolean(call?.wall);
    const wallHint = override === null
        ? call?.wall ? 'Reconnu automatiquement (adresse de la tablette appairée)' : 'Pas reconnu comme la tablette murale'
        : override ? 'Choisi à la main sur cet écran' : 'Exclu à la main sur cet écran';

    return (
        <div className="home settings-page">
            <header className="home-top">
                <div className="home-hello"><h1>Cooper appelle</h1></div>
            </header>
            <p className="settings-note muted">
                Repas oublié depuis 30 min, ou pas de promenade à 9 h 30 : la tablette murale sonne et Cooper râle en vidéo.
                En « Parfois », une fois sur trois, jamais deux jours de suite, entre 8 h et 21 h 30, quand quelqu’un est là.
                Raccroché sans le nourrir : il rappelle une fois, et la carte garde l’appel manqué.
            </p>
            {note && <p className={`settings-note ${note.warn ? 'warn' : 'muted'}`} role="status">{note.text}</p>}

            <div className="settings-items">
                <div className="item-row widget-pin-row">
                    <span className="item-text">
                        <strong>Fréquence</strong>
                        <span className="muted">Jamais coupe les appels ; l’alerte habituelle reste (Telegram, bar, enceinte)</span>
                    </span>
                    <div className="widget-seg" role="group" aria-label="Fréquence des appels">
                        {MODES.map(([mode, label]) => (
                            <button key={mode} type="button" className={s?.mode === mode ? 'on' : ''} aria-pressed={s?.mode === mode}
                                disabled={!s} onClick={() => patch({ mode })}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="item-row widget-pin-row">
                    <span className="item-text">
                        <strong>Appel « Ça pousse »</strong>
                        <span className="muted">À 9 h 30, si la porte d’entrée n’a pas bougé depuis 8 h</span>
                    </span>
                    <button type="button" className={`switch ${s?.walk ? 'on' : ''}`} aria-pressed={Boolean(s?.walk)} disabled={!s}
                        aria-label={s?.walk ? 'Couper l’appel de la promenade' : 'Activer l’appel de la promenade'}
                        onClick={() => patch({ walk: !s?.walk })}>
                        <span />
                    </button>
                </div>

                <div className="item-row widget-pin-row">
                    <span className="item-text">
                        <strong>Volume de la tablette pendant l’appel</strong>
                        <span className="muted">Remis comme avant après l’appel (par le débogage sans fil de la tablette)</span>
                    </span>
                    <div className="widget-seg" role="group" aria-label="Volume pendant l’appel">
                        {VOLUMES.map(([v, label]) => (
                            <button key={label} type="button" className={s && s.volume === v ? 'on' : ''} aria-pressed={Boolean(s && s.volume === v)}
                                disabled={!s} onClick={() => patch({ volume: v })}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="item-row widget-pin-row">
                    <span className="item-text">
                        <strong>Cet écran sonne</strong>
                        <span className="muted">{wallHint}</span>
                    </span>
                    <div className="widget-seg" role="group" aria-label="Cet écran sonne">
                        <button type="button" className={override === null ? 'on' : ''} aria-pressed={override === null} onClick={() => setWall(null)}>Auto</button>
                        <button type="button" className={override === true ? 'on' : ''} aria-pressed={override === true} onClick={() => setWall(true)}>Oui</button>
                        <button type="button" className={override === false ? 'on' : ''} aria-pressed={override === false} onClick={() => setWall(false)}>Non</button>
                    </div>
                </div>

                <div className="item-row widget-pin-row">
                    <span className="item-text">
                        <strong>Vidéo de Cooper</strong>
                        <span className="muted">{call?.video ? 'Gardée sur le serveur de la maison, pas dans le dépôt' : 'Pas encore de vidéo : sa photo bouge à la place'}</span>
                    </span>
                    <input ref={file} type="file" accept="video/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
                    <button type="button" className="ghost-btn" disabled={busy} onClick={() => file.current?.click()}>
                        {call?.video ? 'Changer la vidéo' : 'Ajouter une vidéo'}
                    </button>
                </div>

                <div className="item-row widget-pin-row">
                    <span className="item-text">
                        <strong>Essayer</strong>
                        <span className="muted">{wall ? 'Fait sonner cet écran tout de suite' : 'Fait sonner la tablette murale tout de suite'}</span>
                    </span>
                    <button type="button" className="ghost-btn" disabled={busy || Boolean(call?.active)} onClick={test}>
                        {call?.active ? 'Appel en cours…' : 'Faire appeler Cooper'}
                    </button>
                </div>
            </div>
        </div>
    );
}
