/**
 * URL audio directe d'une vidéo YouTube via yt-dlp (en cache 4 h).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const cache = new Map(); // videoId -> { url, expiresAt }

export const getYtDlpAudioUrl = async (videoId) => {
    const cached = cache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const { stdout } = await execFileAsync(
        'yt-dlp',
        [
            '-f',
            'bestaudio[ext=m4a]/bestaudio',
            '--get-url',
            '--no-warnings',
            '--no-playlist',
            `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { timeout: 15000 },
    );

    const url = stdout.trim();
    if (!url) throw new Error('yt-dlp returned empty URL');

    // Les URLs YouTube expirent après ~6 h
    cache.set(videoId, { url, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
    return url;
};

const videoCache = new Map(); // videoId -> { url, expiresAt }

/**
 * URL vidéo directe (sans le son) d'une vidéo YouTube, pour un écran Cast : la bûche de la veillée.
 * H.264 jusqu'à 1080p, sinon le MP4 360p avec le son.
 */
export const getYtDlpVideoUrl = async (videoId) => {
    const cached = videoCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const { stdout } = await execFileAsync(
        'yt-dlp',
        ['-f', 'bestvideo[ext=mp4][vcodec^=avc1][height<=1080]/18', '--get-url', '--no-warnings', '--no-playlist', `https://www.youtube.com/watch?v=${videoId}`],
        { timeout: 20000 },
    );
    const url = stdout.trim().split('\n')[0];
    if (!url) throw new Error('yt-dlp returned empty URL');
    videoCache.set(videoId, { url, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
    return url;
};

const muxedCache = new Map(); // videoId -> { url, expiresAt }

/**
 * URL d'un MP4 avec l'image ET le son (une bande-annonce sur un écran Cast). YouTube ne garde
 * ces fichiers d'un seul tenant qu'en 360p (format 18) pour la plupart des vidéos.
 */
export const getYtDlpMuxedUrl = async (videoId) => {
    const cached = muxedCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const { stdout } = await execFileAsync(
        'yt-dlp',
        ['-f', 'best[ext=mp4][vcodec!=none][acodec!=none][height<=1080]/18', '--get-url', '--no-warnings', '--no-playlist', `https://www.youtube.com/watch?v=${videoId}`],
        { timeout: 20000 },
    );
    const url = stdout.trim().split('\n')[0];
    if (!url) throw new Error('yt-dlp returned empty URL');
    muxedCache.set(videoId, { url, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
    return url;
};
