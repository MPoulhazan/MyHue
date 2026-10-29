import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

export interface Speaker {
    id: string;
    name: string;
    host: string;
    online: boolean;
}

export interface NowPlaying {
    deviceId: string;
    device: string;
    title: string;
    subtitle: string;
    thumbnail: string | null;
    paused: boolean;
    volume: number | null; // 0-100
}

export interface CastMedia {
    mediaUrl: string;
    contentType: string;
    title: string;
    subtitle?: string;
    thumbnail?: string;
}

/** Enceintes Cast et lecture en cours, partagées par l'écran Musique et le mini-lecteur. */
export function useCast(push: (msg: string, color?: string) => void) {
    const [speakers, setSpeakers] = useState<Speaker[]>([]);
    const [now, setNow] = useState<NowPlaying | null>(null);

    const loadSpeakers = useCallback(() => {
        axios.get('/api/cast/devices').then(({ data }) => setSpeakers(data.devices || [])).catch(() => {});
    }, []);
    const loadNow = useCallback(() => {
        axios.get('/api/cast/now').then(({ data }) => setNow(data.now ?? null)).catch(() => {});
    }, []);

    useEffect(() => {
        loadSpeakers();
        loadNow();
        const s = setInterval(loadSpeakers, 60_000);
        const n = setInterval(loadNow, 10_000);
        return () => { clearInterval(s); clearInterval(n); };
    }, [loadSpeakers, loadNow]);

    const fail = useCallback((what: string) => push(`Musique · ${what}`, '#FF3B5C'), [push]);

    const play = useCallback(async (deviceId: string, media: CastMedia): Promise<boolean> => {
        try {
            await axios.post('/api/cast/play', {
                deviceId,
                mediaUrl: media.mediaUrl,
                contentType: media.contentType,
                metadata: { title: media.title, subtitle: media.subtitle, thumbnail: media.thumbnail },
            });
            loadNow();
            return true;
        } catch {
            fail(`${media.title} : enceinte injoignable`);
            loadSpeakers();
            return false;
        }
    }, [fail, loadNow, loadSpeakers]);

    const control = useCallback(async (command: 'play' | 'pause' | 'stop') => {
        if (!now) return;
        setNow((n) => (n ? (command === 'stop' ? null : { ...n, paused: command === 'pause' }) : n));
        try {
            await axios.post('/api/cast/control', { deviceId: now.deviceId, command });
        } catch {
            fail(command === 'stop' ? 'arrêt impossible' : 'commande refusée');
        }
        loadNow();
    }, [now, fail, loadNow]);

    const volume = useCallback(async (pct: number) => {
        if (!now) return;
        const level = Math.max(0, Math.min(100, Math.round(pct)));
        setNow((n) => (n ? { ...n, volume: level } : n));
        try {
            await axios.post('/api/cast/volume', { deviceId: now.deviceId, level: level / 100 });
        } catch {
            fail('volume refusé');
            loadNow();
        }
    }, [now, fail, loadNow]);

    return { speakers, now, play, control, volume, refresh: loadNow };
}

export type Cast = ReturnType<typeof useCast>;
