import { useRef, useState } from 'react';
import axios from 'axios';
import { Icon } from '../Icon';
import type { HistoryEntry } from '../../pages/outingTypes';

// Photo souvenir d'une sortie, prise ou choisie sur le téléphone, réduite avant l'envoi

const MAX_SIDE = 1280;

/** Réduit l'image (1280 px au plus) en JPEG : quelques centaines de Ko, que le serveur accepte. */
const shrink = async (file: File): Promise<string> => {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('Image illisible'));
            i.src = url;
        });
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const q of [0.82, 0.7, 0.55]) {
            const data = canvas.toDataURL('image/jpeg', q);
            if (data.length < 900_000) return data;
        }
        throw new Error('Image trop lourde');
    } finally {
        URL.revokeObjectURL(url);
    }
};

export function PhotoButton({ entry, onSaved, className = '' }: { entry: HistoryEntry; onSaved: (e: HistoryEntry) => void; className?: string }) {
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const pick = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        setError(null);
        try {
            const image = await shrink(file);
            const { data } = await axios.post<HistoryEntry>(`/api/day/history/${entry.id}/photo`, { image });
            onSaved(data);
        } catch (e) {
            setError(axios.isAxiosError(e) ? e.response?.data?.error || 'Envoi impossible' : e instanceof Error ? e.message : 'Envoi impossible');
        } finally {
            setBusy(false);
            if (input.current) input.current.value = '';
        }
    };

    return (
        <>
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" className={`hs-photo-btn ${className}`} disabled={busy} onClick={() => input.current?.click()}>
                <Icon name="plus" size={18} strokeWidth={2} />{busy ? 'Envoi…' : entry.photo ? 'Changer la photo' : 'Ajouter une photo'}
            </button>
            {error && <span className="hs-error">{error}</span>}
        </>
    );
}
