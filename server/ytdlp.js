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
