import { useEffect, useState } from 'react';
import axios from 'axios';
import { useHomeData } from '../hooks/useHome';
import { youtubeApi, type YouTubePlaylist, type YouTubeVideo } from '../services/youtubeApi';
import { Icon } from '../components/Icon';
import { Equalizer } from '../components/shell/MiniPlayer';
import './Dashboard.css';
import './Music.css';

interface Radio {
    id: string;
    name: string;
    description: string;
    streamUrl: string;
}

const RADIOS: Radio[] = [
    { id: 'lofi', name: 'Lo-fi', description: 'Pour se concentrer ou décompresser', streamUrl: 'https://streams.ilovemusic.de/iloveradio17.mp3' },
    { id: 'jazz', name: 'Jazz doux', description: 'Saxophone et ambiance feutrée', streamUrl: 'https://streaming.radio.co/s774887f7b/listen' },
    { id: 'electronic', name: 'Électro', description: 'Rythmes et synthés', streamUrl: 'https://streams.ilovemusic.de/iloveradio2.mp3' },
    { id: 'ambient', name: 'Ambient', description: 'Nappes calmes et atmosphériques', streamUrl: 'https://uk2.internet-radio.com/proxy/radioart_ambient?mp=/stream' },
    { id: 'piano', name: 'Piano', description: 'Pièces pour piano seul', streamUrl: 'https://live.musopen.org:8085/streamvbr0' },
    { id: 'rock', name: 'Rock', description: 'Les grands classiques', streamUrl: 'https://streams.ilovemusic.de/iloveradio3.mp3' },
    { id: 'classical', name: 'Classique', description: 'Orchestre et musique de chambre', streamUrl: 'https://stream.srg-ssr.ch/m/rsc_de/mp3_128' },
    { id: 'chillout', name: 'Chill-out', description: 'Ambiance détendue', streamUrl: 'https://streams.ilovemusic.de/iloveradio7.mp3' },
];

// Teintes des vignettes, reprises de la palette du tableau de bord
const TINTS = ['lime', 'amber', 'blue'] as const;

const VOLUME_STEP = 10;

type Tab = 'radios' | 'playlists';

/** Écran Musique : choisir l'enceinte, lancer une radio ou une playlist YouTube, piloter la lecture. */
export function Music() {
    const { cast } = useHomeData();
    const now = cast.now;
    const live = cast.speakers.filter((s) => s.online);
    const offline = cast.speakers.filter((s) => !s.online);

    const [picked, setPicked] = useState<string | null>(null);
    // Par défaut : l'enceinte qui joue, sinon la première joignable
    const speaker = live.find((s) => s.id === picked) ?? live.find((s) => s.id === now?.deviceId) ?? live[0] ?? null;

    const [tab, setTab] = useState<Tab>('radios');
    const [starting, setStarting] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // Playlists YouTube
    const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([]);
    const [playlist, setPlaylist] = useState<YouTubePlaylist | null>(null);
    const [tracks, setTracks] = useState<YouTubeVideo[]>([]);
    const [loadingTracks, setLoadingTracks] = useState(false);
    const [customUrl, setCustomUrl] = useState('');
    const [adding, setAdding] = useState(false);
    const [yt, setYt] = useState({ authenticated: false, oauthConfigured: false });

    useEffect(() => {
        youtubeApi.getAuthStatus().then(setYt).catch(() => {});
        // Retour de la fenêtre de connexion YouTube
        const onMessage = (e: MessageEvent) => {
            if (e.data === 'youtube-auth-success') {
                setYt((s) => ({ ...s, authenticated: true }));
                loadPlaylists();
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    useEffect(() => {
        if (tab === 'playlists') loadPlaylists();
    }, [tab]);

    const loadPlaylists = () => {
        youtubeApi.getPlaylists()
            .then(({ playlists: list, authenticated }) => {
                setPlaylists(list);
                setYt((s) => ({ ...s, authenticated }));
            })
            .catch(() => setNotice('Impossible de charger les playlists YouTube.'));
    };

    const openPlaylist = async (pl: YouTubePlaylist) => {
        setPlaylist(pl);
        setTracks([]);
        setLoadingTracks(true);
        try {
            const data = await youtubeApi.getPlaylistItems(pl.id);
            setTracks(data.items);
        } catch (err) {
            setNotice(errorText(err, 'Impossible de charger cette playlist.'));
        } finally {
            setLoadingTracks(false);
        }
    };

    const addPlaylist = async () => {
        if (!customUrl.trim()) return;
        setAdding(true);
        try {
            const pl = await youtubeApi.addPlaylist(customUrl.trim());
            setPlaylists((list) => [...list, pl]);
            setCustomUrl('');
            openPlaylist(pl);
        } catch (err) {
            setNotice(errorText(err, 'Lien de playlist non reconnu.'));
        } finally {
            setAdding(false);
        }
    };

    const connectYouTube = async () => {
        try {
            window.open(await youtubeApi.getAuthUrl(), 'youtube-auth', 'width=500,height=600');
        } catch (err) {
            setNotice(errorText(err, 'Connexion YouTube impossible.'));
        }
    };

    const playRadio = async (radio: Radio) => {
        if (!speaker) return;
        setNotice(null);
        setStarting(radio.id);
        await cast.play(speaker.id, { mediaUrl: radio.streamUrl, contentType: 'audio/mpeg', title: radio.name, subtitle: radio.description });
        setStarting(null);
    };

    const playTrack = async (track: YouTubeVideo) => {
        if (!speaker) return;
        setNotice(null);
        setStarting(track.videoId);
        try {
            const { audioUrl, contentType } = await youtubeApi.extractAudio(track.videoId);
            await cast.play(speaker.id, { mediaUrl: audioUrl, contentType, title: track.title, subtitle: track.artist, thumbnail: track.thumbnail });
        } catch (err) {
            setNotice(errorText(err, `Impossible de lire « ${track.title} ».`));
        } finally {
            setStarting(null);
        }
    };

    const blocked = !speaker;

    return (
        <div className="home music">
            <header className="home-top">
                <div className="home-hello"><h1>Musique</h1></div>
                {live.length > 0 && (
                    <div className="speaker-pick" role="radiogroup" aria-label="Enceinte">
                        <span className="muted">Sur</span>
                        {live.map((s) => (
                            <button key={s.id} type="button" role="radio" aria-checked={speaker?.id === s.id}
                                className={speaker?.id === s.id ? 'active' : ''} onClick={() => setPicked(s.id)}>
                                {s.name}
                            </button>
                        ))}
                    </div>
                )}
            </header>

            {!live.length && (
                <div className="warn-line">
                    {cast.speakers.length
                        ? 'Aucune enceinte joignable. Vérifie qu’elles sont allumées : MyHue les recherche toutes les 2 minutes.'
                        : 'Aucune enceinte connue. Ajoute-les dans les options de l’add-on (cast_devices).'}
                </div>
            )}
            {offline.length > 0 && live.length > 0 && (
                <p className="muted music-offline">Hors ligne : {offline.map((s) => s.name).join(', ')}</p>
            )}
            {notice && <div className="warn-line" role="status">{notice}</div>}

            {now && (
                <section className="card now-card" aria-label="Lecture en cours">
                    {now.thumbnail
                        ? <img src={now.thumbnail} alt="" className="now-art" />
                        : <span className="now-art"><Equalizer paused={now.paused} /></span>}
                    <div className="now-text">
                        <span className="muted">{now.paused ? 'En pause' : 'En lecture'} sur {now.device}</span>
                        <strong>{now.title}</strong>
                        {now.subtitle && <span className="muted">{now.subtitle}</span>}
                    </div>
                    <div className="now-controls">
                        <button type="button" className="now-btn main" aria-label={now.paused ? 'Reprendre' : 'Pause'}
                            onClick={() => cast.control(now.paused ? 'play' : 'pause')}>
                            <Icon name={now.paused ? 'play' : 'pause'} size={24} strokeWidth={2.4} />
                        </button>
                        <button type="button" className="now-btn" aria-label="Arrêter" onClick={() => cast.control('stop')}>
                            <Icon name="stop" size={22} strokeWidth={2.4} />
                        </button>
                        <div className="mini-stepper" role="group" aria-label="Volume">
                            <button type="button" aria-label="Baisser le volume" onClick={() => cast.volume((now.volume ?? 50) - VOLUME_STEP)}>−</button>
                            <span aria-live="polite">{now.volume != null ? `${now.volume} %` : 'Volume'}</span>
                            <button type="button" aria-label="Monter le volume" onClick={() => cast.volume((now.volume ?? 50) + VOLUME_STEP)}>+</button>
                        </div>
                    </div>
                </section>
            )}

            <div className="chips music-tabs" role="tablist" aria-label="Source">
                <button type="button" role="tab" aria-selected={tab === 'radios'} className={tab === 'radios' ? 'active' : ''}
                    onClick={() => setTab('radios')}><Icon name="radio" size={18} /> Radios</button>
                <button type="button" role="tab" aria-selected={tab === 'playlists'} className={tab === 'playlists' ? 'active' : ''}
                    onClick={() => setTab('playlists')}><Icon name="list" size={18} /> Playlists YouTube</button>
            </div>

            {tab === 'radios' && (
                <div className="radio-grid">
                    {RADIOS.map((r, i) => {
                        const playing = now?.title === r.name;
                        return (
                            <button key={r.id} type="button" className={`radio-card ${playing ? 'playing' : ''}`}
                                disabled={blocked || starting === r.id} onClick={() => playRadio(r)}>
                                <span className={`radio-tile ${TINTS[i % TINTS.length]}`}>
                                    {playing ? <Equalizer paused={now?.paused} /> : <Icon name="music" size={22} strokeWidth={2} />}
                                </span>
                                <span className="radio-text">
                                    <strong>{r.name}</strong>
                                    <span className="muted">{starting === r.id ? 'Lancement…' : playing ? 'En lecture' : r.description}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {tab === 'playlists' && (
                <div className="yt-layout">
                    <section className="card yt-lists" aria-label="Mes playlists">
                        <h2 className="card-title">Mes playlists</h2>
                        {yt.oauthConfigured && !yt.authenticated && (
                            <button type="button" className="ghost-btn" onClick={connectYouTube}>Connecter mon compte YouTube</button>
                        )}
                        {!playlists.length && (
                            <p className="muted yt-hint">
                                {yt.authenticated ? 'Aucune playlist sur ce compte. Colle le lien d’une playlist ci-dessous.' : 'Colle le lien d’une playlist YouTube ci-dessous.'}
                            </p>
                        )}
                        <ul>
                            {playlists.map((pl) => (
                                <li key={pl.id}>
                                    <button type="button" className={playlist?.id === pl.id ? 'active' : ''} onClick={() => openPlaylist(pl)}>
                                        {pl.thumbnail ? <img src={pl.thumbnail} alt="" /> : <span className="yt-ph"><Icon name="list" size={18} /></span>}
                                        <span>
                                            <strong>{pl.name}</strong>
                                            {pl.itemCount != null && <span className="muted">{pl.itemCount} titres</span>}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <form className="yt-add" onSubmit={(e) => { e.preventDefault(); addPlaylist(); }}>
                            <input type="url" inputMode="url" placeholder="Lien d’une playlist YouTube" aria-label="Lien d’une playlist YouTube"
                                value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
                            <button type="submit" className="round-btn small" aria-label="Ajouter la playlist" disabled={adding || !customUrl.trim()}>
                                <Icon name="plus" size={20} strokeWidth={2.2} />
                            </button>
                        </form>
                    </section>

                    <section className="card yt-tracks" aria-label={playlist ? playlist.name : 'Titres'}>
                        {!playlist && <p className="muted">Choisis une playlist pour voir ses titres.</p>}
                        {playlist && (
                            <>
                                <h2 className="card-title">{playlist.name}{tracks.length ? ` · ${tracks.length} titres` : ''}</h2>
                                {loadingTracks && <p className="muted">Chargement…</p>}
                                <div className="track-grid">
                                    {tracks.map((t) => {
                                        const playing = now?.title === t.title;
                                        return (
                                            <button key={t.videoId} type="button" className={`track ${playing ? 'playing' : ''}`}
                                                disabled={blocked || starting === t.videoId} onClick={() => playTrack(t)}>
                                                <span className="track-art">
                                                    <img src={t.thumbnailHigh || t.thumbnail} alt="" loading="lazy" />
                                                    {(playing || starting === t.videoId) && (
                                                        <span className="track-badge">{playing ? <Equalizer paused={now?.paused} /> : '…'}</span>
                                                    )}
                                                </span>
                                                <strong>{t.title}</strong>
                                                <span className="muted">{t.artist}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}

// Les erreurs du serveur sont en anglais et techniques : on garde un message clair, le détail va dans la console
const errorText = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err)) console.warn(fallback, err.response?.data?.error ?? err.message);
    return fallback;
};
