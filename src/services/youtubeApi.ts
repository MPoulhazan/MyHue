import axios from 'axios';

export interface YouTubeVideo {
    videoId: string;
    title: string;
    artist: string;
    thumbnail: string;
    thumbnailHigh: string;
    position: number;
}

export interface YouTubePlaylist {
    id: string;
    name: string;
    thumbnail: string;
    itemCount?: number;
}

export interface PlaylistData {
    playlistId: string;
    playlistName: string;
    playlistThumbnail: string;
    items: YouTubeVideo[];
    totalResults: number;
}

export interface AudioExtraction {
    audioUrl: string;
    contentType: string;
    cached?: boolean;
}

export interface DeviceLogin {
    userCode: string;
    verificationUrl: string;
    expiresAt: number;
    error: string | null;
}

export interface AuthStatus {
    authenticated: boolean;
    oauthConfigured: boolean;
    pending?: DeviceLogin | null;
}

export const youtubeApi = {
    async getAuthStatus(): Promise<AuthStatus> {
        const { data } = await axios.get<AuthStatus>('/api/youtube/auth/status');
        return data;
    },

    /** Démarre la connexion par code (google.com/device). */
    async startLogin(): Promise<DeviceLogin> {
        const { data } = await axios.post<DeviceLogin>('/api/youtube/auth/start');
        return data;
    },

    async cancelLogin(): Promise<void> {
        await axios.post('/api/youtube/auth/cancel');
    },

    async logout(): Promise<void> {
        await axios.post('/api/youtube/auth/logout');
    },

    async getPlaylists(): Promise<{ playlists: YouTubePlaylist[]; authenticated: boolean; accountError?: string | null }> {
        const { data } = await axios.get<{ playlists: YouTubePlaylist[]; authenticated: boolean; accountError?: string | null }>('/api/youtube/playlists');
        return data;
    },

    async getPlaylistItems(playlistId: string): Promise<PlaylistData> {
        const { data } = await axios.get<PlaylistData>(`/api/youtube/playlist/${playlistId}`);
        return data;
    },

    async extractAudio(videoId: string): Promise<AudioExtraction> {
        const { data } = await axios.post<AudioExtraction>('/api/youtube/extract-audio', { videoId });
        return data;
    },

    async addPlaylist(url: string): Promise<YouTubePlaylist> {
        const { data } = await axios.post<YouTubePlaylist>('/api/youtube/playlist/add', { url });
        return data;
    },
};
