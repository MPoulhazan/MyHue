import axios from 'axios';
import type { YouTubeVideo } from './youtubeApi';

export type SourceKind = 'radio' | 'playlist' | 'mood' | 'mix' | 'tracks' | 'resume';

export interface MusicSource {
    kind: SourceKind;
    id: string | null;
    name: string;
    thumbnail: string | null;
}

export interface Radio {
    id: string;
    name: string;
    description: string;
}

export interface Mood {
    id: string;
    name: string;
    hint: string;
    radio: string;
    sleepMinutes?: number;
    playlistId: string | null;
    playlistName: string | null;
}

export interface Suggestion {
    kind: SourceKind;
    id: string;
    name: string;
    thumbnail?: string | null;
    hint?: string;
    habit: boolean;
    reason: string;
}

export interface MusicState {
    source: MusicSource | null;
    tracks: YouTubeVideo[];
    index: number;
    sleepAt: number | null;
    resume: (MusicSource & { deviceId: string; at: number; index: number; count: number }) | null;
}

export interface RecentEntry {
    t: number;
    kind: SourceKind;
    id: string;
    name: string;
    thumbnail: string | null;
}

export interface MusicHome {
    radios: Radio[];
    moods: Mood[];
    suggestion: Suggestion;
    state: MusicState;
    recent: RecentEntry[];
    /** Enceinte utilisée quand on n'en choisit pas */
    device: { id: string; name: string } | null;
}

export interface Room {
    id: string;
    name: string;
    volume: number | null;
    busy: boolean;
    app: string | null;
}

export interface PlayRequest {
    deviceId: string;
    kind: SourceKind;
    id?: string | null;
    name?: string;
    thumbnail?: string | null;
    tracks?: YouTubeVideo[];
    startIndex?: number;
    shuffle?: boolean;
}

export const musicApi = {
    async home(): Promise<MusicHome> {
        return (await axios.get<MusicHome>('/api/music/home')).data;
    },
    async state(): Promise<MusicState> {
        return (await axios.get<MusicState>('/api/music/state')).data;
    },
    async rooms(): Promise<Room[]> {
        return (await axios.get<{ rooms: Room[] }>('/api/cast/rooms')).data.rooms;
    },
    async play(req: PlayRequest): Promise<{ state: MusicState }> {
        return (await axios.post('/api/music/play', req)).data;
    },
    async skip(delta: 1 | -1): Promise<MusicState> {
        return (await axios.post(delta > 0 ? '/api/music/next' : '/api/music/prev')).data;
    },
    async jump(index: number): Promise<MusicState> {
        return (await axios.post('/api/music/jump', { index })).data;
    },
    async enqueue(deviceId: string, tracks: YouTubeVideo[]): Promise<{ queued?: number; state: MusicState }> {
        return (await axios.post('/api/music/enqueue', { deviceId, tracks })).data;
    },
    async transfer(deviceId: string): Promise<MusicState> {
        return (await axios.post('/api/music/transfer', { deviceId })).data;
    },
    async sleep(minutes: number): Promise<{ sleepAt: number | null }> {
        return (await axios.post('/api/music/sleep', { minutes })).data;
    },
    async linkMood(moodId: string, playlist: { id: string; name: string } | null): Promise<Mood[]> {
        return (await axios.post('/api/music/mood-link', { moodId, playlist })).data.moods;
    },
    async search(q: string): Promise<YouTubeVideo[]> {
        return (await axios.get<{ results: YouTubeVideo[] }>('/api/music/search', { params: { q } })).data.results;
    },
};
