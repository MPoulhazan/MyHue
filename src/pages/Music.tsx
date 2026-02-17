import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { youtubeApi, type YouTubePlaylist, type YouTubeVideo, type PlaylistData } from '../services/youtubeApi';
import './Music.css';

interface MusicGenre {
    id: string;
    name: string;
    emoji: string;
    gradient: string;
    streamUrl: string;
    description: string;
}

interface CastDevice {
    id: string;
    name: string;
    host: string;
    port: number;
}

type MusicMode = 'radios' | 'playlists';

const musicGenres: MusicGenre[] = [
    {
        id: 'lofi',
        name: 'Lo-Fi Hip Hop',
        emoji: '🎧',
        gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        streamUrl: 'https://streams.ilovemusic.de/iloveradio17.mp3',
        description: 'Beats to relax/study to'
    },
    {
        id: 'jazz',
        name: 'Smooth Jazz',
        emoji: '🎷',
        gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        streamUrl: 'https://streaming.radio.co/s774887f7b/listen',
        description: 'Relaxing saxophone melodies'
    },
    {
        id: 'electronic',
        name: 'Electronic',
        emoji: '🎹',
        gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        streamUrl: 'https://streams.ilovemusic.de/iloveradio2.mp3',
        description: 'Energetic beats and synths'
    },
    {
        id: 'ambient',
        name: 'Ambient',
        emoji: '🌌',
        gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        streamUrl: 'https://uk2.internet-radio.com/proxy/radioart_ambient?mp=/stream',
        description: 'Peaceful atmospheric sounds'
    },
    {
        id: 'piano',
        name: 'Piano',
        emoji: '🎹',
        gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
        streamUrl: 'https://live.musopen.org:8085/streamvbr0',
        description: 'Beautiful piano compositions'
    },
    {
        id: 'rock',
        name: 'Rock',
        emoji: '🎸',
        gradient: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
        streamUrl: 'https://streams.ilovemusic.de/iloveradio3.mp3',
        description: 'Classic rock anthems'
    },
    {
        id: 'classical',
        name: 'Classical',
        emoji: '🎻',
        gradient: 'linear-gradient(135deg, #fad0c4 0%, #ffd1ff 100%)',
        streamUrl: 'https://stream.srg-ssr.ch/m/rsc_de/mp3_128',
        description: 'Timeless orchestral pieces'
    },
    {
        id: 'chillout',
        name: 'Chillout',
        emoji: '🌊',
        gradient: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
        streamUrl: 'https://streams.ilovemusic.de/iloveradio7.mp3',
        description: 'Laid-back vibes'
    }
];

export default function Music() {
    const [selectedDevice, setSelectedDevice] = useState<CastDevice | null>(null);
    const [devices, setDevices] = useState<CastDevice[]>([]);
    const [loading, setLoading] = useState<string | null>(null);
    const [nowPlaying, setNowPlaying] = useState<{ title: string; subtitle: string; thumbnail?: string } | null>(null);
    const [message, setMessage] = useState('');
    const [mode, setMode] = useState<MusicMode>('radios');

    // Playlist state
    const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([]);
    const [selectedPlaylist, setSelectedPlaylist] = useState<YouTubePlaylist | null>(null);
    const [tracks, setTracks] = useState<YouTubeVideo[]>([]);
    const [playlistName, setPlaylistName] = useState('');
    const [loadingTracks, setLoadingTracks] = useState(false);
    const [extracting, setExtracting] = useState<string | null>(null);
    const [customUrl, setCustomUrl] = useState('');
    const [addingPlaylist, setAddingPlaylist] = useState(false);
    const [ytAuthenticated, setYtAuthenticated] = useState(false);
    const [ytOAuthConfigured, setYtOAuthConfigured] = useState(false);

    useEffect(() => {
        fetchDevices();
        checkYouTubeAuth();

        // Listen for OAuth popup callback
        const handler = (e: MessageEvent) => {
            if (e.data === 'youtube-auth-success') {
                setYtAuthenticated(true);
                fetchPlaylists();
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        if (mode === 'playlists') {
            fetchPlaylists();
        }
    }, [mode]);

    const fetchDevices = async () => {
        try {
            const { data } = await axios.get('/api/agent/status');
            const devs: CastDevice[] = data.devices || [];
            setDevices(devs);
            if (devs.length > 0) setSelectedDevice(devs[0]);
        } catch (error) {
            console.error('Error fetching devices:', error);
        }
    };

    const checkYouTubeAuth = async () => {
        try {
            const status = await youtubeApi.getAuthStatus();
            setYtAuthenticated(status.authenticated);
            setYtOAuthConfigured(status.oauthConfigured);
        } catch {}
    };

    const connectYouTube = async () => {
        try {
            const url = await youtubeApi.getAuthUrl();
            window.open(url, 'youtube-auth', 'width=500,height=600');
        } catch (error: any) {
            setMessage(error?.response?.data?.error || 'Erreur OAuth');
        }
    };

    const fetchPlaylists = async () => {
        try {
            const { playlists: list, authenticated } = await youtubeApi.getPlaylists();
            setPlaylists(list);
            setYtAuthenticated(authenticated);
        } catch (error) {
            console.error('Error fetching playlists:', error);
        }
    };

    const selectPlaylist = async (playlist: YouTubePlaylist) => {
        setSelectedPlaylist(playlist);
        setLoadingTracks(true);
        setTracks([]);
        try {
            const data: PlaylistData = await youtubeApi.getPlaylistItems(playlist.id);
            setTracks(data.items);
            setPlaylistName(data.playlistName);
        } catch (error: any) {
            const errMsg = error?.response?.data?.error || 'Erreur chargement playlist';
            setMessage(errMsg);
        } finally {
            setLoadingTracks(false);
        }
    };

    const addCustomPlaylist = async () => {
        if (!customUrl.trim()) return;
        setAddingPlaylist(true);
        try {
            const playlist = await youtubeApi.addPlaylist(customUrl.trim());
            setPlaylists(prev => [...prev, playlist]);
            setCustomUrl('');
            selectPlaylist(playlist);
        } catch (error: any) {
            const errMsg = error?.response?.data?.error || 'URL invalide';
            setMessage(errMsg);
        } finally {
            setAddingPlaylist(false);
        }
    };

    // --- Playback ---

    const playRadio = async (genre: MusicGenre) => {
        if (!selectedDevice) { setMessage('Selectionne un appareil Google Cast'); return; }
        setLoading(genre.id);
        setMessage('');
        try {
            await axios.post('/api/cast/play', {
                deviceId: selectedDevice.id,
                mediaUrl: genre.streamUrl,
                contentType: 'audio/mpeg',
                metadata: { title: genre.name, subtitle: genre.description },
            });
            setNowPlaying({ title: genre.name, subtitle: genre.description });
            setMessage(`${genre.name} en lecture sur ${selectedDevice.name}`);
        } catch (error: any) {
            setMessage(error?.response?.data?.error || 'Erreur lors de la lecture');
        } finally {
            setLoading(null);
        }
    };

    const playTrack = async (track: YouTubeVideo) => {
        if (!selectedDevice) { setMessage('Selectionne un appareil Google Cast'); return; }
        setExtracting(track.videoId);
        setMessage('');
        try {
            const { audioUrl, contentType } = await youtubeApi.extractAudio(track.videoId);
            await axios.post('/api/cast/play', {
                deviceId: selectedDevice.id,
                mediaUrl: audioUrl,
                contentType,
                metadata: { title: track.title, subtitle: track.artist },
            });
            setNowPlaying({ title: track.title, subtitle: track.artist, thumbnail: track.thumbnail });
            setMessage(`${track.title} en lecture sur ${selectedDevice.name}`);
        } catch (error: any) {
            setMessage(error?.response?.data?.error || 'Erreur lors de la lecture');
        } finally {
            setExtracting(null);
        }
    };

    const controlPlayback = async (command: 'pause' | 'play' | 'stop') => {
        if (!selectedDevice) return;
        try {
            await axios.post('/api/cast/control', { deviceId: selectedDevice.id, command });
            if (command === 'stop') setNowPlaying(null);
            setMessage({ pause: 'Pause', play: 'Lecture', stop: 'Stop' }[command]);
        } catch (error: any) {
            setMessage(error?.response?.data?.error || 'Erreur');
        }
    };

    const handleVolume = async (level: number) => {
        if (!selectedDevice) return;
        try {
            await axios.post('/api/cast/volume', { deviceId: selectedDevice.id, level: level / 100 });
            setMessage(`Volume : ${level}%`);
        } catch (error: any) {
            setMessage(error?.response?.data?.error || 'Erreur volume');
        }
    };

    return (
        <div className="music-container">
            {/* Header */}
            <div className="music-header">
                <div>
                    <h1>Music Player</h1>
                    <p className="subtitle">Choisis ton ambiance musicale</p>
                </div>
                <div className="device-selector">
                    <label>Appareil :</label>
                    <select
                        value={selectedDevice?.id || ''}
                        onChange={(e) => {
                            const dev = devices.find(d => d.id === e.target.value);
                            if (dev) setSelectedDevice(dev);
                        }}
                        disabled={devices.length === 0}
                    >
                        {devices.length === 0 ? (
                            <option>Aucun appareil</option>
                        ) : (
                            devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                        )}
                    </select>
                </div>
            </div>

            {/* Mode toggle */}
            <div className="mode-toggle">
                <button className={mode === 'radios' ? 'active' : ''} onClick={() => setMode('radios')}>
                    Radios
                </button>
                <button className={mode === 'playlists' ? 'active' : ''} onClick={() => setMode('playlists')}>
                    Playlists YouTube
                </button>
                <div className="mode-indicator" style={{ transform: mode === 'playlists' ? 'translateX(100%)' : 'translateX(0)' }} />
            </div>

            {/* Message */}
            <AnimatePresence mode="wait">
                {message && (
                    <motion.div
                        className="music-message"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        key={message}
                    >
                        {message}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Now Playing */}
            {nowPlaying && (
                <motion.div
                    className="now-playing"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                >
                    <div className="now-playing-info">
                        {nowPlaying.thumbnail ? (
                            <img src={nowPlaying.thumbnail} alt="" className="now-playing-thumb" />
                        ) : (
                            <div className="now-playing-emoji">🎵</div>
                        )}
                        <div>
                            <div className="now-playing-title">En lecture</div>
                            <div className="now-playing-genre">{nowPlaying.title}</div>
                            {nowPlaying.subtitle && <div className="now-playing-artist">{nowPlaying.subtitle}</div>}
                        </div>
                    </div>
                    <div className="playback-controls">
                        <button onClick={() => controlPlayback('play')} title="Lecture">▶️</button>
                        <button onClick={() => controlPlayback('pause')} title="Pause">⏸️</button>
                        <button onClick={() => controlPlayback('stop')} title="Stop">⏹️</button>
                    </div>
                    <div className="volume-controls">
                        <span>🔉</span>
                        <button onClick={() => handleVolume(20)}>20%</button>
                        <button onClick={() => handleVolume(50)}>50%</button>
                        <button onClick={() => handleVolume(80)}>80%</button>
                    </div>
                </motion.div>
            )}

            {/* Radios mode */}
            {mode === 'radios' && (
                <div className="music-grid">
                    {musicGenres.map((genre, index) => (
                        <motion.div
                            key={genre.id}
                            className={`music-card ${loading === genre.id ? 'loading' : ''} ${nowPlaying?.title === genre.name ? 'active' : ''}`}
                            style={{ background: genre.gradient }}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            whileHover={{ scale: 1.05, y: -5 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => playRadio(genre)}
                        >
                            <div className="music-card-emoji">{genre.emoji}</div>
                            <div className="music-card-content">
                                <h3>{genre.name}</h3>
                                <p>{genre.description}</p>
                            </div>
                            {loading === genre.id && (
                                <div className="music-card-loader"><div className="spinner"></div></div>
                            )}
                            {nowPlaying?.title === genre.name && (
                                <div className="music-card-playing">
                                    <div className="equalizer">
                                        <div className="bar"></div><div className="bar"></div>
                                        <div className="bar"></div><div className="bar"></div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Playlists mode */}
            {mode === 'playlists' && (
                <div className="playlists-layout">
                    {/* Sidebar */}
                    <div className="playlist-sidebar">
                        <h3>Mes playlists</h3>

                        {ytOAuthConfigured && !ytAuthenticated && (
                            <button className="yt-connect-btn" onClick={connectYouTube}>
                                Connecter YouTube
                            </button>
                        )}

                        {playlists.length === 0 && !addingPlaylist && ytAuthenticated && (
                            <p className="playlist-hint">Aucune playlist trouvee. Ajoute-en une ci-dessous.</p>
                        )}

                        {playlists.length === 0 && !addingPlaylist && !ytAuthenticated && !ytOAuthConfigured && (
                            <p className="playlist-hint">Configure YOUTUBE_CLIENT_ID et YOUTUBE_CLIENT_SECRET dans .env pour connecter ton compte, ou colle une URL ci-dessous.</p>
                        )}

                        {playlists.map(pl => (
                            <motion.div
                                key={pl.id}
                                className={`playlist-item ${selectedPlaylist?.id === pl.id ? 'active' : ''}`}
                                onClick={() => selectPlaylist(pl)}
                                whileHover={{ x: 4 }}
                            >
                                {pl.thumbnail && <img src={pl.thumbnail} alt="" className="playlist-thumb" />}
                                <div className="playlist-item-info">
                                    <span className="playlist-item-name">{pl.name}</span>
                                    {pl.itemCount && <span className="playlist-item-count">{pl.itemCount} titres</span>}
                                </div>
                            </motion.div>
                        ))}

                        <div className="add-playlist">
                            <input
                                type="text"
                                placeholder="Coller l'URL d'une playlist..."
                                value={customUrl}
                                onChange={(e) => setCustomUrl(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addCustomPlaylist()}
                            />
                            <button onClick={addCustomPlaylist} disabled={addingPlaylist || !customUrl.trim()}>
                                {addingPlaylist ? '...' : '+'}
                            </button>
                        </div>
                    </div>

                    {/* Track list */}
                    <div className="track-list-area">
                        {!selectedPlaylist && (
                            <div className="track-list-empty">
                                <p>Selectionne une playlist ou colle une URL</p>
                            </div>
                        )}

                        {selectedPlaylist && loadingTracks && (
                            <div className="track-list-loading">
                                <div className="spinner"></div>
                                <p>Chargement de la playlist...</p>
                            </div>
                        )}

                        {selectedPlaylist && !loadingTracks && tracks.length > 0 && (
                            <>
                                <div className="track-list-header">
                                    <h2>{playlistName}</h2>
                                    <span className="track-count">{tracks.length} titres</span>
                                </div>
                                <div className="track-grid">
                                    {tracks.map((track, index) => (
                                        <motion.div
                                            key={track.videoId}
                                            className={`track-card ${extracting === track.videoId ? 'extracting' : ''} ${nowPlaying?.title === track.title ? 'active' : ''}`}
                                            initial={{ opacity: 0, y: 15 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: index * 0.03 }}
                                            whileHover={{ scale: 1.03 }}
                                            whileTap={{ scale: 0.97 }}
                                            onClick={() => playTrack(track)}
                                        >
                                            <div className="track-thumb-wrap">
                                                <img
                                                    src={track.thumbnailHigh || track.thumbnail}
                                                    alt=""
                                                    className="track-thumb"
                                                    loading="lazy"
                                                />
                                                <div className="track-play-overlay">
                                                    {extracting === track.videoId ? (
                                                        <div className="spinner small"></div>
                                                    ) : nowPlaying?.title === track.title ? (
                                                        <div className="equalizer">
                                                            <div className="bar"></div><div className="bar"></div>
                                                            <div className="bar"></div><div className="bar"></div>
                                                        </div>
                                                    ) : (
                                                        <span className="play-icon">▶</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="track-info">
                                                <span className="track-title">{track.title}</span>
                                                <span className="track-artist">{track.artist}</span>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {devices.length === 0 && (
                <div className="no-devices">
                    <p>Aucun appareil Google Cast detecte</p>
                    <p className="hint">Assure-toi que tes appareils sont allumes et sur le meme reseau, ou configure CAST_DEVICES dans .env</p>
                </div>
            )}
        </div>
    );
}
