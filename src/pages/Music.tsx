import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { useHomeData } from '../hooks/useHome';
import { youtubeApi, type DeviceLogin, type YouTubeAccount, type YouTubePlaylist, type YouTubeVideo } from '../services/youtubeApi';
import { musicApi, type Mood, type MusicHome, type PlayRequest, type Room, type Suggestion } from '../services/musicApi';
import { Icon, type IconName } from '../components/Icon';
import { Equalizer } from '../components/shell/MiniPlayer';
import './Dashboard.css';
import '../components/music/tones.css';
import './Music.css';

const VOLUME_STEP = 10;
const SLEEP_STEPS = [0, 15, 30, 60];

const MOOD_LOOK: Record<string, { icon: IconName; tone: string }> = {
    zen: { icon: 'leaf', tone: 'mint' },
    focus: { icon: 'target', tone: 'sky' },
    energie: { icon: 'bolt', tone: 'amber' },
    diner: { icon: 'bowl', tone: 'peach' },
    soiree: { icon: 'glass', tone: 'lilac' },
    dodo: { icon: 'moon', tone: 'night' },
    noel: { icon: 'gift', tone: 'noel' },
};

const RADIO_TONES = ['amber', 'sky', 'lime', 'peach', 'lilac', 'mint', 'night', 'amber'];

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const greeting = (d: Date) => {
    const h = d.getHours();
    if (h < 5) return 'Bonne nuit';
    if (h < 12) return 'Bon matin';
    if (h < 18) return 'Bon après-midi';
    return 'Bonsoir';
};
const sinceText = (t: number) => {
    const min = Math.round((Date.now() - t) / 60_000);
    if (min < 60) return `il y a ${Math.max(1, min)} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'hier' : `il y a ${d} jours`;
};

// Les erreurs du serveur sont en anglais et techniques : on garde un message clair, le détail va dans la console
const errorText = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err)) console.warn(fallback, err.response?.data?.error ?? err.message);
    return fallback;
};

/** Écran Musique : suggestion du moment, ambiances, pièces, playlists de chaque compte, recherche et file d'attente. */
export function Music() {
    const { cast } = useHomeData();
    const now = cast.now;
    const live = cast.speakers.filter((s) => s.online);

    const [picked, setPicked] = useState<string | null>(null);

    const [home, setHome] = useState<MusicHome | null>(null);
    // Choisie à la main, sinon celle qui joue, sinon l'enceinte par défaut de la maison (le Salon)
    const target = live.find((s) => s.id === picked) ?? live.find((s) => s.id === now?.deviceId) ?? live.find((s) => s.id === home?.device?.id) ?? live[0] ?? null;
    const [rooms, setRooms] = useState<Room[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [queueOpen, setQueueOpen] = useState(false);
    const [sheet, setSheet] = useState<YouTubePlaylist | null>(null);
    // /music?q=… (« Écouter l'artiste » depuis une idée de sortie) : la recherche est déjà lancée
    const [params] = useSearchParams();
    const linkedQuery = (params.get('q') || '').trim().slice(0, 120);
    const [query, setQuery] = useState(linkedQuery);
    const [draft, setDraft] = useState(linkedQuery);
    const [results, setResults] = useState<YouTubeVideo[] | null>(null);
    const [searchError, setSearchError] = useState(false);

    useEffect(() => {
        if (!linkedQuery) return;
        musicApi.search(linkedQuery).then(setResults).catch(() => { setResults([]); setSearchError(true); });
    }, [linkedQuery]);

    const search = (q: string) => {
        setQuery(q);
        setResults(null);
        setSearchError(false);
        if (!q) { setDraft(''); return; }
        musicApi.search(q).then(setResults).catch(() => { setResults([]); setSearchError(true); });
    };

    // --- Chargements ---
    const loadHome = useCallback(() => {
        musicApi.home().then(setHome).catch(() => {});
    }, []);
    const loadRooms = useCallback(() => {
        musicApi.rooms().then(setRooms).catch(() => {});
    }, []);

    useEffect(() => {
        loadHome();
        loadRooms();
        const h = window.setInterval(loadHome, 15_000);
        const r = window.setInterval(loadRooms, 30_000);
        return () => { window.clearInterval(h); window.clearInterval(r); };
    }, [loadHome, loadRooms]);

    // Le titre change sur l'enceinte : on recale la file affichée
    useEffect(() => { loadHome(); }, [now?.title, now?.deviceId, loadHome]);

    const run = useCallback(async (key: string, fn: () => Promise<unknown>, fallback: string) => {
        setNotice(null);
        setBusy(key);
        try {
            await fn();
        } catch (err) {
            setNotice(errorText(err, fallback));
        } finally {
            setBusy(null);
            cast.refresh();
            loadHome();
            window.setTimeout(loadRooms, 1500);
        }
    }, [cast, loadHome, loadRooms]);

    const play = useCallback((key: string, req: Omit<PlayRequest, 'deviceId'>, label: string) => {
        if (!target) return;
        run(key, () => musicApi.play({ ...req, deviceId: target.id }), `Impossible de lancer « ${label} ».`);
    }, [target, run]);

    const enqueue = useCallback((tracks: YouTubeVideo[]) => {
        if (!target) return;
        run('enqueue', () => musicApi.enqueue(target.id, tracks), 'Impossible d’ajouter à la file.');
    }, [target, run]);

    const state = home?.state;
    const playingVideo = state && state.index >= 0 ? state.tracks[state.index]?.videoId : null;
    const blocked = !target;

    return (
        <div className="home music">
            <Header now={new Date()} draft={draft} onDraft={setDraft} onSearch={search} />

            {!live.length && (
                <div className="warn-line">
                    {cast.speakers.length
                        ? 'Aucune enceinte joignable. Vérifie qu’elles sont allumées : MyHue les recherche toutes les 2 minutes.'
                        : 'Aucune enceinte connue. Ajoute-les dans les options de l’add-on (cast_devices).'}
                </div>
            )}
            {notice && <div className="warn-line" role="status">{notice}</div>}

            <SearchResults query={query} results={results} error={searchError} onClose={() => search('')} busy={busy} blocked={blocked} playingVideo={playingVideo}
                onPlay={(tracks, i) => play(`t:${tracks[i].videoId}`, { kind: 'tracks', tracks, startIndex: i, name: `Recherche « ${query} »` }, tracks[i].title)}
                onPlaySelection={(tracks) => play('selection', { kind: 'tracks', tracks, name: 'Sélection' }, 'la sélection')}
                onAdd={enqueue}
                onMix={(t) => play(`mix:${t.videoId}`, { kind: 'mix', id: t.videoId, name: t.title }, `Radio de ${t.title}`)} />

            {home && (
                <div className="mz-hero">
                    <SuggestionCard s={home.suggestion} moods={home.moods} busy={busy === 'suggestion'} disabled={blocked} target={target?.name}
                        onPlay={() => play('suggestion', { kind: home.suggestion.kind, id: home.suggestion.id, name: home.suggestion.name, thumbnail: home.suggestion.thumbnail }, home.suggestion.name)} />
                    <ResumeCard home={home} disabled={blocked} busy={busy}
                        onResume={() => play('resume', { kind: 'resume' }, home.state.resume?.name || 'la dernière écoute')}
                        onRecent={(e) => play(`recent:${e.id}`, { kind: e.kind, id: e.id, name: e.name, thumbnail: e.thumbnail }, e.name)} />
                </div>
            )}

            {home && (
                <section className="mz-section" aria-label="Ambiances">
                    <div className="mz-head"><h2>Ambiances</h2></div>
                    <div className="mz-moods">
                        {home.moods.map((m) => {
                            const look = MOOD_LOOK[m.id] ?? { icon: 'music' as IconName, tone: 'mint' };
                            const playing = state?.source?.kind === 'mood' && state.source.id === m.id;
                            const suggested = home.suggestion.kind === 'mood' && home.suggestion.id === m.id;
                            return (
                                <button key={m.id} type="button" className={`mz-mood tone-${look.tone} ${playing ? 'playing' : ''} ${suggested ? 'suggested' : ''}`}
                                    disabled={blocked || busy === `mood:${m.id}`} onClick={() => play(`mood:${m.id}`, { kind: 'mood', id: m.id, name: m.name }, m.name)}>
                                    <span className="mz-mood-top">
                                        <Icon name={look.icon} size={28} />
                                        {playing ? <Equalizer paused={now?.paused} /> : busy === `mood:${m.id}` ? <span className="mz-dots">…</span> : null}
                                    </span>
                                    <span>
                                        <strong>{m.name}</strong>
                                        <span className="mz-mood-hint">{m.playlistName ? `Playlist « ${m.playlistName} »` : m.hint}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            {rooms.length > 0 && (
                <Rooms rooms={rooms} target={target?.id ?? null} nowDevice={now?.deviceId ?? null} busy={busy}
                    onPick={setPicked}
                    onVolume={async (room, level) => {
                        setRooms((list) => list.map((r) => (r.id === room.id ? { ...r, volume: level } : r)));
                        if (room.id === now?.deviceId) cast.volume(level);
                        else await axios.post('/api/cast/volume', { deviceId: room.id, level: level / 100 }).catch(() => setNotice('Volume refusé.'));
                    }}
                    onMove={(room) => run(`move:${room.id}`, () => musicApi.transfer(room.id).then(() => setPicked(room.id)), `Impossible de passer la musique sur ${room.name}.`)} />
            )}

            <Playlists onOpen={setSheet} />

            {home && (
                <section className="mz-section" aria-label="Radios">
                    <div className="mz-head"><h2>Radios</h2></div>
                    <div className="mz-radios">
                        {home.radios.map((r, i) => {
                            const playing = state?.source?.kind === 'radio' && state.source.id === r.id;
                            return (
                                <button key={r.id} type="button" className={`mz-radio ${playing ? 'playing' : ''}`} title={r.description}
                                    disabled={blocked || busy === `radio:${r.id}`} onClick={() => play(`radio:${r.id}`, { kind: 'radio', id: r.id, name: r.name }, r.name)}>
                                    <span className={`mz-radio-disc tone-${RADIO_TONES[i % RADIO_TONES.length]}`}>
                                        {playing ? <Equalizer paused={now?.paused} /> : <Icon name="radio" size={24} />}
                                    </span>
                                    <span>{busy === `radio:${r.id}` ? 'Lancement…' : r.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            <Accounts onChange={() => window.dispatchEvent(new Event('myhue-playlists'))} />

            {now && (
                <PlayerBar home={home} onQueue={() => setQueueOpen(true)}
                    onSleep={(minutes) => run('sleep', () => musicApi.sleep(minutes), 'Minuterie refusée.')} />
            )}

            {queueOpen && state && (
                <QueuePanel tracks={state.tracks} index={state.index} title={state.source?.name}
                    onClose={() => setQueueOpen(false)}
                    onJump={(i) => run(`jump:${i}`, () => musicApi.jump(i), 'Impossible d’aller à ce titre.')} />
            )}

            {sheet && home && (
                <PlaylistSheet key={sheet.id} playlist={sheet} moods={home.moods} busy={busy} blocked={blocked} playingVideo={playingVideo}
                    onClose={() => setSheet(null)}
                    onPlayAll={(shuffle) => play(shuffle ? 'pl:shuffle' : 'pl:all', { kind: 'playlist', id: sheet.id, name: sheet.name, thumbnail: sheet.thumbnail, shuffle }, sheet.name)}
                    onPlayAt={(i, t) => play(`t:${t.videoId}`, { kind: 'playlist', id: sheet.id, name: sheet.name, thumbnail: sheet.thumbnail, startIndex: i }, t.title)}
                    onPlaySelection={(tracks) => play('selection', { kind: 'tracks', tracks, name: `Sélection · ${sheet.name}` }, 'la sélection')}
                    onAdd={enqueue}
                    onMix={(t) => play(`mix:${t.videoId}`, { kind: 'mix', id: t.videoId, name: t.title }, `Radio de ${t.title}`)}
                    onLinkMood={async (moodId) => {
                        try {
                            await musicApi.linkMood(moodId, { id: sheet.id, name: sheet.name });
                            loadHome();
                        } catch (err) { setNotice(errorText(err, 'Association impossible.')); }
                    }}
                    onUnlinkMood={async (moodId) => {
                        await musicApi.linkMood(moodId, null).catch(() => {});
                        loadHome();
                    }} />
            )}
        </div>
    );

}

function Header({ now, draft, onDraft, onSearch }: { now: Date; draft: string; onDraft: (q: string) => void; onSearch: (q: string) => void }) {
    return (
        <header className="mz-top">
            <div>
                <div className="mz-date">{DAYS[now.getDay()]} {now.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })}</div>
                <h1>{greeting(now)}</h1>
            </div>
            <form className="mz-search" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(draft.trim()); }}>
                <Icon name="search" size={20} />
                <input type="search" value={draft} onChange={(e) => onDraft(e.target.value)} placeholder="Titre, artiste, album…" aria-label="Rechercher de la musique" enterKeyHint="search" />
                {draft && <button type="button" className="mz-icon-btn" aria-label="Effacer" onClick={() => onSearch('')}><Icon name="close" size={18} /></button>}
            </form>
        </header>
    );
}

function SearchResults(props: {
    query: string; results: YouTubeVideo[] | null; error: boolean; onClose: () => void; busy: string | null; blocked: boolean; playingVideo: string | null;
    onPlay: (tracks: YouTubeVideo[], i: number) => void; onPlaySelection: (t: YouTubeVideo[]) => void;
    onAdd: (t: YouTubeVideo[]) => void; onMix: (t: YouTubeVideo) => void;
}) {
    const { query, error } = props;
    const results = props.results ?? [];
    const loading = props.results === null && !error;
    if (!query) return null;
    return (
        <section className="card mz-results" aria-label="Résultats de recherche">
            <div className="mz-head">
                <h2>Résultats pour « {query} »</h2>
                <button type="button" className="mz-icon-btn" aria-label="Fermer la recherche" onClick={props.onClose}><Icon name="close" size={20} /></button>
            </div>
            {loading && <p className="muted">Recherche…</p>}
            {error && <p className="muted">La recherche ne répond pas, réessaie dans un moment.</p>}
            {!loading && !error && !results.length && <p className="muted">Aucun résultat.</p>}
            {!loading && results.length > 0 && (
                <TrackList tracks={results} busy={props.busy} blocked={props.blocked} playingVideo={props.playingVideo}
                    onPlay={(i) => props.onPlay(results, i)} onPlaySelection={props.onPlaySelection} onAdd={props.onAdd} onMix={props.onMix} />
            )}
        </section>
    );
}

function SuggestionCard({ s, moods, busy, disabled, target, onPlay }: { s: Suggestion; moods: Mood[]; busy: boolean; disabled: boolean; target?: string; onPlay: () => void }) {
    const mood = s.kind === 'mood' ? moods.find((m) => m.id === s.id) : null;
    const tone = mood ? MOOD_LOOK[mood.id]?.tone ?? 'mint' : 'dark';
    const label = s.habit ? 'Ton habitude' : 'Pour ce moment';
    return (
        <section className={`mz-suggest tone-${tone}`} aria-label="Suggestion">
            <span className="mz-bubble one" aria-hidden="true" />
            <span className="mz-bubble two" aria-hidden="true" />
            {!mood && s.thumbnail && <img src={s.thumbnail} alt="" className="mz-suggest-art" />}
            <div className="mz-suggest-text">
                <span className="mz-eyebrow">{label}</span>
                <strong>{mood ? `${mood.name} · ${mood.playlistName || mood.hint}` : s.name}</strong>
                <span>{s.reason}</span>
            </div>
            <button type="button" className="mz-big-play" disabled={disabled || busy} onClick={onPlay}
                aria-label={`Lancer ${s.name}${target ? ` sur ${target}` : ''}`}>
                {busy ? <span className="mz-dots">…</span> : <Icon name="play" size={30} strokeWidth={2.4} />}
            </button>
        </section>
    );
}

function ResumeCard({ home, disabled, busy, onResume, onRecent }: {
    home: MusicHome; disabled: boolean; busy: string | null; onResume: () => void; onRecent: (e: MusicHome['recent'][number]) => void;
}) {
    const r = home.state.resume;
    if (r) {
        return (
            <section className="card mz-resume" aria-label="Reprendre">
                <span className="mz-eyebrow muted">Reprendre</span>
                <button type="button" className="mz-resume-main" disabled={disabled || busy === 'resume'} onClick={onResume}>
                    {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <span className="mz-resume-ph"><Icon name="music" size={26} /></span>}
                    <span>
                        <strong>{r.name}</strong>
                        <span className="muted">{sinceText(r.at)}{r.count ? ` · titre ${r.index + 1} sur ${r.count}` : ''}</span>
                    </span>
                    <span className="mz-round-play">{busy === 'resume' ? '…' : <Icon name="play" size={20} strokeWidth={2.4} />}</span>
                </button>
                {r.count > 0 && <div className="mz-progress"><span style={{ width: `${Math.round(((r.index + 1) / r.count) * 100)}%` }} /></div>}
            </section>
        );
    }
    const recent = home.recent.slice(0, 3);
    return (
        <section className="card mz-resume" aria-label="Récemment">
            <span className="mz-eyebrow muted">Récemment</span>
            {!recent.length && <p className="muted">Tes dernières écoutes apparaîtront ici. Avec le temps, MyHue repère aussi tes habitudes.</p>}
            {recent.map((e) => (
                <button key={`${e.kind}:${e.id}`} type="button" className="mz-recent" disabled={disabled || busy === `recent:${e.id}`} onClick={() => onRecent(e)}>
                    {e.thumbnail ? <img src={e.thumbnail} alt="" /> : <span className="mz-resume-ph small"><Icon name={e.kind === 'radio' ? 'radio' : 'music'} size={18} /></span>}
                    <span><strong>{e.name}</strong><span className="muted">{sinceText(e.t)}</span></span>
                </button>
            ))}
        </section>
    );
}

function Rooms({ rooms, target, nowDevice, busy, onPick, onVolume, onMove }: {
    rooms: Room[]; target: string | null; nowDevice: string | null; busy: string | null;
    onPick: (id: string) => void; onVolume: (room: Room, level: number) => void; onMove: (room: Room) => void;
}) {
    return (
        <section className="mz-section" aria-label="Pièces">
            <div className="mz-head"><h2>Pièces</h2><span className="muted">La musique part dans la pièce sélectionnée</span></div>
            <div className="mz-rooms" role="radiogroup" aria-label="Enceinte">
                {rooms.map((r) => {
                    const selected = r.id === target;
                    const playing = r.id === nowDevice;
                    return (
                        <div key={r.id} className={`mz-room ${selected ? 'selected' : ''} ${playing ? 'playing' : ''}`}>
                            <button type="button" role="radio" aria-checked={selected} className="mz-room-pick" onClick={() => onPick(r.id)}>
                                <span className="mz-room-name">{r.name}{playing && <Equalizer />}</span>
                                <span className="muted">{playing ? 'En lecture' : r.busy ? (r.app === 'DashCast' ? 'Écran affiché' : r.app || 'Occupée') : 'Libre'}</span>
                            </button>
                            <div className="mz-room-vol" role="group" aria-label={`Volume ${r.name}`}>
                                <button type="button" aria-label={`Baisser le volume ${r.name}`} onClick={() => onVolume(r, Math.max(0, (r.volume ?? 50) - VOLUME_STEP))}><Icon name="minus" size={18} strokeWidth={2.4} /></button>
                                <span className="mz-bar" aria-hidden="true"><span style={{ width: `${r.volume ?? 0}%` }} /></span>
                                <span className="mz-vol-num" aria-live="polite">{r.volume != null ? r.volume : '–'}</span>
                                <button type="button" aria-label={`Monter le volume ${r.name}`} onClick={() => onVolume(r, Math.min(100, (r.volume ?? 50) + VOLUME_STEP))}><Icon name="plus" size={18} strokeWidth={2.4} /></button>
                            </div>
                            {nowDevice && !playing && (
                                <button type="button" className="mz-move" disabled={busy === `move:${r.id}`} onClick={() => onMove(r)}>
                                    {busy === `move:${r.id}` ? 'Déplacement…' : 'Écouter ici'}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

function Playlists({ onOpen }: { onOpen: (pl: YouTubePlaylist) => void }) {
    const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([]);
    const [filter, setFilter] = useState<string>('all');
    const [error, setError] = useState(false);

    const load = useCallback(() => {
        youtubeApi.getPlaylists()
            .then(({ playlists: list, accountError }) => { setPlaylists(list); setError(Boolean(accountError)); })
            .catch(() => setError(true));
    }, []);
    useEffect(() => {
        load();
        window.addEventListener('myhue-playlists', load);
        return () => window.removeEventListener('myhue-playlists', load);
    }, [load]);

    const owners = useMemo(() => {
        const m = new Map<string, string>();
        for (const p of playlists) if (p.accountId) m.set(p.accountId, p.accountName || 'Compte');
        return [...m.entries()];
    }, [playlists]);
    const hasLinks = playlists.some((p) => !p.accountId);
    const shown = playlists.filter((p) => filter === 'all' ? true : filter === 'links' ? !p.accountId : filter === 'liked' ? p.liked : p.accountId === filter);

    return (
        <section className="mz-section" aria-label="Playlists">
            <div className="mz-head">
                <h2>Playlists</h2>
                <div className="mz-filters" role="tablist" aria-label="Filtrer les playlists">
                    <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Tout</button>
                    {owners.length > 1 && owners.map(([id, name]) => (
                        <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{name}</button>
                    ))}
                    {owners.length > 0 && <button type="button" role="tab" aria-selected={filter === 'liked'} className={filter === 'liked' ? 'on' : ''} onClick={() => setFilter('liked')}>J’aime</button>}
                    {hasLinks && <button type="button" role="tab" aria-selected={filter === 'links'} className={filter === 'links' ? 'on' : ''} onClick={() => setFilter('links')}>Ajoutées</button>}
                </div>
            </div>
            {error && <p className="muted">Un compte YouTube ne répond pas pour l’instant, réessaie dans un moment.</p>}
            {!playlists.length && !error && <p className="muted">Connecte un compte YouTube plus bas, ou colle le lien d’une playlist.</p>}
            <div className="mz-playlists">
                {shown.map((p) => (
                    <button key={p.id} type="button" className="mz-pl" onClick={() => onOpen(p)}>
                        {p.liked
                            ? <span className="mz-pl-art liked"><Icon name="heart" size={36} /></span>
                            : p.thumbnail ? <img src={p.thumbnail} alt="" className="mz-pl-art" loading="lazy" /> : <span className="mz-pl-art"><Icon name="list" size={30} /></span>}
                        <strong>{p.liked ? `J’aime` : p.name}</strong>
                        <span className="muted">{[owners.length > 1 || p.liked ? p.accountName : null, p.itemCount ? `${p.itemCount} titres` : null].filter(Boolean).join(' · ') || 'Playlist'}</span>
                    </button>
                ))}
            </div>
        </section>
    );
}

function TrackList({ tracks, busy, blocked, playingVideo, onPlay, onPlaySelection, onAdd, onMix }: {
    tracks: YouTubeVideo[]; busy: string | null; blocked: boolean; playingVideo: string | null;
    onPlay: (i: number) => void; onPlaySelection: (t: YouTubeVideo[]) => void; onAdd: (t: YouTubeVideo[]) => void; onMix: (t: YouTubeVideo) => void;
}) {
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const selection = tracks.filter((t) => picked.has(t.videoId));
    const stop = () => { setSelecting(false); setPicked(new Set()); };

    return (
        <div className="mz-tracks">
            <div className="mz-tracks-bar">
                {selecting ? (
                    <>
                        <span className="muted">{selection.length} sélectionné{selection.length > 1 ? 's' : ''}</span>
                        <button type="button" className="mz-chip-btn primary" disabled={!selection.length || blocked} onClick={() => { onPlaySelection(selection); stop(); }}>
                            <Icon name="play" size={16} strokeWidth={2.4} /> Lire
                        </button>
                        <button type="button" className="mz-chip-btn" disabled={!selection.length || blocked} onClick={() => { onAdd(selection); stop(); }}>
                            <Icon name="plus" size={16} strokeWidth={2.4} /> À la file
                        </button>
                        <button type="button" className="mz-chip-btn" onClick={stop}>Annuler</button>
                    </>
                ) : (
                    <button type="button" className="mz-chip-btn" onClick={() => setSelecting(true)}><Icon name="check" size={16} strokeWidth={2.4} /> Sélectionner</button>
                )}
            </div>
            <ul>
                {tracks.map((t, i) => {
                    const playing = t.videoId === playingVideo;
                    const on = picked.has(t.videoId);
                    return (
                        <li key={`${t.videoId}-${i}`} className={`mz-track ${playing ? 'playing' : ''} ${on ? 'on' : ''}`}>
                            <button type="button" className="mz-track-main" disabled={!selecting && (blocked || busy === `t:${t.videoId}`)}
                                aria-pressed={selecting ? on : undefined}
                                onClick={() => (selecting ? toggle(t.videoId) : onPlay(i))}>
                                {selecting && <span className={`mz-check ${on ? 'on' : ''}`} aria-hidden="true">{on && <Icon name="check" size={16} strokeWidth={3} />}</span>}
                                <span className="mz-track-art">
                                    {t.thumbnail && <img src={t.thumbnail} alt="" loading="lazy" />}
                                    {(playing || busy === `t:${t.videoId}`) && <span className="mz-track-badge">{playing ? <Equalizer /> : '…'}</span>}
                                </span>
                                <span className="mz-track-text"><strong>{t.title}</strong><span className="muted">{t.artist}</span></span>
                            </button>
                            {!selecting && (
                                <span className="mz-track-actions">
                                    <button type="button" className="mz-icon-btn" aria-label={`Ajouter ${t.title} à la file`} disabled={blocked} onClick={() => onAdd([t])}><Icon name="plus" size={20} /></button>
                                    <button type="button" className="mz-icon-btn" aria-label={`Radio à partir de ${t.title}`} disabled={blocked || busy === `mix:${t.videoId}`} onClick={() => onMix(t)}><Icon name="waves" size={20} /></button>
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function PlaylistSheet({ playlist, moods, busy, blocked, playingVideo, onClose, onPlayAll, onPlayAt, onPlaySelection, onAdd, onMix, onLinkMood, onUnlinkMood }: {
    playlist: YouTubePlaylist; moods: Mood[]; busy: string | null; blocked: boolean; playingVideo: string | null;
    onClose: () => void; onPlayAll: (shuffle: boolean) => void; onPlayAt: (i: number, t: YouTubeVideo) => void;
    onPlaySelection: (t: YouTubeVideo[]) => void; onAdd: (t: YouTubeVideo[]) => void; onMix: (t: YouTubeVideo) => void;
    onLinkMood: (moodId: string) => void; onUnlinkMood: (moodId: string) => void;
}) {
    const [tracks, setTracks] = useState<YouTubeVideo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        youtubeApi.getPlaylistItems(playlist.id)
            .then((d) => setTracks(d.items))
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [playlist.id]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const linked = moods.find((m) => m.playlistId === playlist.id);

    return (
        <div className="mz-overlay" onClick={onClose}>
            <section className="mz-sheet" role="dialog" aria-modal="true" aria-label={playlist.name} onClick={(e) => e.stopPropagation()}>
                <div className="mz-sheet-head">
                    {playlist.liked
                        ? <span className="mz-sheet-art liked"><Icon name="heart" size={44} /></span>
                        : playlist.thumbnail ? <img src={playlist.thumbnail} alt="" className="mz-sheet-art" /> : <span className="mz-sheet-art"><Icon name="list" size={36} /></span>}
                    <div className="mz-sheet-title">
                        <span className="mz-eyebrow muted">{playlist.accountName || 'Playlist'}</span>
                        <h2>{playlist.liked ? `J’aime` : playlist.name}</h2>
                        <span className="muted">{loading ? 'Chargement…' : `${tracks.length} titres`}</span>
                    </div>
                    <button type="button" className="mz-icon-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} /></button>
                </div>
                <div className="mz-sheet-actions">
                    <button type="button" className="mz-chip-btn primary big" disabled={blocked || !tracks.length || busy === 'pl:all'} onClick={() => onPlayAll(false)}>
                        <Icon name="play" size={18} strokeWidth={2.4} /> {busy === 'pl:all' ? 'Lancement…' : 'Tout lire'}
                    </button>
                    <button type="button" className="mz-chip-btn big" disabled={blocked || !tracks.length || busy === 'pl:shuffle'} onClick={() => onPlayAll(true)}>
                        <Icon name="shuffle" size={18} /> Aléatoire
                    </button>
                    <label className="mz-mood-link">
                        <span className="muted">Ambiance</span>
                        <select value={linked?.id ?? ''} onChange={(e) => (e.target.value ? onLinkMood(e.target.value) : linked && onUnlinkMood(linked.id))}>
                            <option value="">Aucune</option>
                            {moods.map((m) => <option key={m.id} value={m.id}>{m.name}{m.playlistId && m.playlistId !== playlist.id ? ` (remplace « ${m.playlistName} »)` : ''}</option>)}
                        </select>
                    </label>
                    {!playlist.accountId && (
                        <button type="button" className="mz-chip-btn" onClick={async () => { await youtubeApi.removePlaylist(playlist.id).catch(() => {}); window.dispatchEvent(new Event('myhue-playlists')); onClose(); }}>
                            <Icon name="trash" size={16} /> Retirer
                        </button>
                    )}
                </div>
                <div className="mz-sheet-body">
                    {error && <p className="muted">Impossible de charger cette playlist.</p>}
                    {!loading && !error && (
                        <TrackList tracks={tracks} busy={busy} blocked={blocked} playingVideo={playingVideo}
                            onPlay={(i) => onPlayAt(i, tracks[i])} onPlaySelection={onPlaySelection} onAdd={onAdd} onMix={onMix} />
                    )}
                </div>
            </section>
        </div>
    );
}

function QueuePanel({ tracks, index, title, onClose, onJump }: { tracks: YouTubeVideo[]; index: number; title?: string; onClose: () => void; onJump: (i: number) => void }) {
    const current = useRef<HTMLLIElement>(null);
    useEffect(() => { current.current?.scrollIntoView({ block: 'center' }); }, []);
    return (
        <div className="mz-overlay" onClick={onClose}>
            <section className="mz-sheet narrow" role="dialog" aria-modal="true" aria-label="À suivre" onClick={(e) => e.stopPropagation()}>
                <div className="mz-sheet-head">
                    <div className="mz-sheet-title">
                        <span className="mz-eyebrow muted">{title || 'En lecture'}</span>
                        <h2>À suivre</h2>
                        <span className="muted">{index >= 0 ? `${tracks.length - index - 1} titres après celui-ci` : `${tracks.length} titres`}</span>
                    </div>
                    <button type="button" className="mz-icon-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={22} /></button>
                </div>
                <div className="mz-sheet-body">
                    {!tracks.length && <p className="muted">Une radio joue : pas de file d’attente.</p>}
                    <ul className="mz-queue">
                        {tracks.map((t, i) => (
                            <li key={`${t.videoId}-${i}`} ref={i === index ? current : undefined} className={`${i === index ? 'current' : ''} ${i < index ? 'past' : ''}`}>
                                <button type="button" onClick={() => onJump(i)} disabled={i === index}>
                                    <span className="mz-q-num">{i === index ? <Equalizer /> : i + 1}</span>
                                    {t.thumbnail && <img src={t.thumbnail} alt="" loading="lazy" />}
                                    <span className="mz-track-text"><strong>{t.title}</strong><span className="muted">{t.artist}</span></span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </section>
        </div>
    );
}

function PlayerBar({ home, onQueue, onSleep }: { home: MusicHome | null; onQueue: () => void; onSleep: (minutes: number) => void }) {
    const { cast } = useHomeData();
    const [clock, setClock] = useState(() => Date.now());
    useEffect(() => {
        const t = window.setInterval(() => setClock(Date.now()), 15_000);
        return () => window.clearInterval(t);
    }, []);
    const n = cast.now;
    if (!n) return null;
    const state = home?.state;
    const left = state && state.index >= 0 ? state.tracks.length - state.index - 1 : 0;
    const sleepLeft = state?.sleepAt ? Math.max(1, Math.round((state.sleepAt - clock) / 60_000)) : 0;
    const nextSleep = () => {
        const i = SLEEP_STEPS.findIndex((m) => m >= sleepLeft && (sleepLeft ? m > 0 : true));
        onSleep(sleepLeft ? (SLEEP_STEPS[(i + 1) % SLEEP_STEPS.length] ?? 0) : SLEEP_STEPS[1]);
    };
    const pct = n.duration && n.position != null ? Math.min(100, Math.round((n.position / n.duration) * 100)) : null;

    return (
        <div className="mz-player" role="region" aria-label="Lecture en cours">
            {pct != null && <div className="mz-player-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>}
            {n.thumbnail ? <img src={n.thumbnail} alt="" className="mz-player-art" /> : <span className="mz-player-art"><Equalizer paused={n.paused} /></span>}
            <div className="mz-player-text">
                <strong>{n.title}</strong>
                <span className="muted">{[n.subtitle, state?.source?.name && state.source.name !== n.title ? state.source.name : null].filter(Boolean).join(' · ')} · {n.device}</span>
            </div>
            <div className="mz-player-ctl">
                {n.queue && <button type="button" className="mz-icon-btn lg" aria-label="Titre précédent" onClick={() => cast.skip(-1)}><Icon name="prev" size={24} strokeWidth={2.2} /></button>}
                <button type="button" className="mz-play" aria-label={n.paused ? 'Reprendre' : 'Pause'} onClick={() => cast.control(n.paused ? 'play' : 'pause')}>
                    <Icon name={n.paused ? 'play' : 'pause'} size={26} strokeWidth={2.4} />
                </button>
                {n.queue && <button type="button" className="mz-icon-btn lg" aria-label="Titre suivant" onClick={() => cast.skip(1)}><Icon name="next" size={24} strokeWidth={2.2} /></button>}
                <button type="button" className="mz-icon-btn lg" aria-label="Arrêter" onClick={() => cast.control('stop')}><Icon name="stop" size={20} strokeWidth={2.4} /></button>
            </div>
            <div className="mz-player-side">
                {state && state.tracks.length > 0 && (
                    <button type="button" className="mz-chip-btn" onClick={onQueue}><Icon name="list" size={18} /> {left} à suivre</button>
                )}
                <button type="button" className={`mz-chip-btn ${sleepLeft ? 'on' : ''}`} onClick={nextSleep} aria-label={sleepLeft ? `Minuterie : arrêt dans ${sleepLeft} minutes. Changer` : 'Programmer un arrêt'}>
                    <Icon name="timer" size={18} /> {sleepLeft ? `${sleepLeft} min` : 'Minuterie'}
                </button>
                <div className="mz-player-vol" role="group" aria-label="Volume">
                    <button type="button" aria-label="Baisser le volume" onClick={() => cast.volume((n.volume ?? 50) - VOLUME_STEP)}><Icon name="minus" size={18} strokeWidth={2.4} /></button>
                    <span aria-live="polite">{n.volume != null ? `${n.volume} %` : <Icon name="volume" size={18} />}</span>
                    <button type="button" aria-label="Monter le volume" onClick={() => cast.volume((n.volume ?? 50) + VOLUME_STEP)}><Icon name="plus" size={18} strokeWidth={2.4} /></button>
                </div>
            </div>
        </div>
    );
}

function Accounts({ onChange }: { onChange: () => void }) {
    const [configured, setConfigured] = useState(false);
    const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
    const [login, setLogin] = useState<DeviceLogin | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [url, setUrl] = useState('');
    const [adding, setAdding] = useState(false);

    const load = useCallback(() => youtubeApi.getAuthStatus().then((s) => {
        setConfigured(s.oauthConfigured);
        setAccounts(s.accounts ?? []);
        setLogin(s.pending && !s.pending.error ? s.pending : null);
        return s;
    }).catch(() => null), []);
    useEffect(() => { load(); }, [load]);

    // Pendant la connexion : on vérifie toutes les 3 s si le code a été saisi
    useEffect(() => {
        if (!login || login.error) return;
        const count = accounts.length;
        const timer = window.setInterval(async () => {
            const s = await youtubeApi.getAuthStatus().catch(() => null);
            if (!s) return;
            if ((s.accounts?.length ?? 0) > count || !s.pending) {
                setAccounts(s.accounts ?? []);
                setLogin(null);
                onChange();
            } else {
                setLogin(s.pending);
            }
        }, 3000);
        return () => window.clearInterval(timer);
    }, [login?.userCode, login?.error, accounts.length, onChange]);

    const connect = async () => {
        setError(null);
        try { setLogin(await youtubeApi.startLogin()); } catch (err) { setError(errorText(err, 'Connexion YouTube impossible.')); }
    };
    const addLink = async () => {
        if (!url.trim()) return;
        setAdding(true);
        try { await youtubeApi.addPlaylist(url.trim()); setUrl(''); onChange(); } catch (err) { setError(errorText(err, 'Lien de playlist non reconnu.')); } finally { setAdding(false); }
    };

    return (
        <section className="card mz-accounts" aria-label="Comptes YouTube">
            <div className="mz-accounts-row">
                <h2 className="card-title">Comptes YouTube</h2>
                <div className="mz-account-list">
                    {accounts.map((a) => (
                        <span key={a.id} className="mz-account">
                            <Icon name="user" size={16} /> {a.name}
                            <button type="button" aria-label={`Déconnecter ${a.name}`} onClick={async () => { await youtubeApi.logout(a.id).catch(() => {}); load(); onChange(); }}><Icon name="close" size={14} /></button>
                        </span>
                    ))}
                    {configured && !login && (
                        <button type="button" className="mz-chip-btn" onClick={connect}><Icon name="plus" size={16} /> {accounts.length ? 'Ajouter un compte' : 'Connecter mon compte'}</button>
                    )}
                </div>
                <form className="mz-link" onSubmit={(e) => { e.preventDefault(); addLink(); }}>
                    <input type="url" inputMode="url" placeholder="Lien d’une playlist (YouTube ou YouTube Music)" aria-label="Lien d’une playlist" value={url} onChange={(e) => setUrl(e.target.value)} />
                    <button type="submit" className="mz-icon-btn" aria-label="Ajouter la playlist" disabled={adding || !url.trim()}><Icon name="plus" size={20} strokeWidth={2.2} /></button>
                </form>
            </div>
            {login && (
                <div className="yt-login" role="status">
                    {login.error ? (
                        <><p>{login.error}</p><button type="button" className="ghost-btn" onClick={connect}>Recommencer</button></>
                    ) : (
                        <>
                            <p>Sur le téléphone de la personne à ajouter, ouvre <strong>{login.verificationUrl.replace(/^https?:\/\/(www\.)?/, '')}</strong> et entre ce code :</p>
                            <p className="yt-login-code">{login.userCode}</p>
                            <p className="muted">Google affichera « application non vérifiée » : c’est normal, choisis Continuer. La page se met à jour toute seule.</p>
                            <button type="button" className="ghost-btn" onClick={() => { youtubeApi.cancelLogin().catch(() => {}); setLogin(null); }}>Annuler</button>
                        </>
                    )}
                </div>
            )}
            {error && <p className="muted" role="status">{error}</p>}
        </section>
    );
}
