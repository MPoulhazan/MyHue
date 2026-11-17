import axios from 'axios';

export interface YouTubeVideo {
    videoId: string;
    title: string;
    artist: string;
    thumbnail: string;
    thumbnailHigh?: string;
    position?: number;
}

export interface YouTubePlaylist {
    id: string;
    name: string;
    thumbnail: string;
    itemCount?: number;
    /** Compte propriétaire (absent : playlist ajoutée par lien) */
    accountId?: string;
    accountName?: string;
    liked?: boolean;
}

export interface YouTubeAccount {
    id: string;
    name: string;
}

export interface PlaylistData {
    playlistId: string;
    playlistName: string;
    playlistThumbnail: string;
    items: YouTubeVideo[];
    totalResults: number;
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
    accounts?: YouTubeAccount[];
    pending?: DeviceLogin | null;
}

export const youtubeApi = {
    async getAuthStatus(): Promise<AuthStatus> {
        const { data } = await axios.get<AuthStatus>('/api/youtube/auth/status');
        return data;
    },

    /** Démarre la connexion par code (google.com/device) ; ajoute un compte. */
    async startLogin(): Promise<DeviceLogin> {
        const { data } = await axios.post<DeviceLogin>('/api/youtube/auth/start');
        return data;
    },

    async cancelLogin(): Promise<void> {
        await axios.post('/api/youtube/auth/cancel');
    },

    async logout(accountId?: string): Promise<void> {
        await axios.post('/api/youtube/auth/logout', { accountId });
    },

    async getPlaylists(): Promise<{ playlists: YouTubePlaylist[]; authenticated: boolean; accountError?: string | null }> {
        const { data } = await axios.get<{ playlists: YouTubePlaylist[]; authenticated: boolean; accountError?: string | null }>('/api/youtube/playlists');
        return data;
    },

    async getPlaylistItems(playlistId: string): Promise<PlaylistData> {
        const { data } = await axios.get<PlaylistData>(`/api/youtube/playlist/${encodeURIComponent(playlistId)}`);
        return data;
    },

    async addPlaylist(url: string): Promise<YouTubePlaylist> {
        const { data } = await axios.post<YouTubePlaylist>('/api/youtube/playlist/add', { url });
        return data;
    },

    async removePlaylist(id: string): Promise<void> {
        await axios.post('/api/youtube/playlist/remove', { id });
    },
};
