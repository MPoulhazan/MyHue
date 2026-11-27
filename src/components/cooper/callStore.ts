import { useEffect, useState } from 'react';
import axios from 'axios';

// ── État de l'appel vidéo de Cooper (GET /api/cooper/call, server/cooper.js) ──
//
// Lu toutes les 4 s sur la tablette murale (l'appel doit sonner vite), toutes les minutes ailleurs
// (pour la carte : appel manqué). Une seule boucle pour toute l'app.

export type CallKind = 'meal' | 'walk' | 'test';
export type CallOutcome = 'fed' | 'walked' | 'later' | 'hung' | 'timeout';
export interface ActiveCall { id: string; kind: CallKind; key: string | null; retry: boolean; at: number; line: string }
export interface EndedCall { id: string; kind: CallKind; key: string | null; outcome: CallOutcome; at: number; line: string }
export interface CallSettings { mode: 'never' | 'sometimes' | 'always'; walk: boolean; voice: string | null; volume: number | null }
export interface CallState {
    active: ActiveCall | null;
    ended: EndedCall | null;
    missed: { key: string; n: number; label: string }[];
    retryAt: number | null;
    settings: CallSettings;
    /** Le serveur reconnaît la tablette murale à son adresse (celle de l'appairage ADB) */
    wall: boolean;
    video: boolean;
    /** Répliques enregistrées (ElevenLabs) sur le serveur ; sinon Piper */
    voicePack?: boolean;
}

// Cet écran est-il la tablette murale ? « 1 » / « 0 » force le choix (Réglages › Cooper)
const WALL_KEY = 'myhue.wallTablet';
export const readWallOverride = (): boolean | null => {
    try {
        const v = localStorage.getItem(WALL_KEY);
        return v === '1' ? true : v === '0' ? false : null;
    } catch {
        return null;
    }
};
export const writeWallOverride = (v: boolean | null) => {
    try {
        if (v === null) localStorage.removeItem(WALL_KEY);
        else localStorage.setItem(WALL_KEY, v ? '1' : '0');
    } catch {
        // Pas de stockage : le choix ne tient pas
    }
    notify();
};
export const isWallScreen = (s: CallState | null) => readWallOverride() ?? Boolean(s?.wall);

let value: CallState | null = null;
const listeners = new Set<() => void>();
let timer = 0;
const notify = () => listeners.forEach((fn) => fn());

export const publishCall = (v: CallState) => {
    value = value ? { ...value, ...v } : v;
    notify();
};

export const loadCall = async () => {
    try {
        const { data } = await axios.get<CallState>('/api/cooper/call');
        publishCall(data);
    } catch {
        // Hors ligne : on garde le dernier état
    }
};

const loop = async () => {
    await loadCall();
    if (!listeners.size) {
        timer = 0;
        return;
    }
    timer = window.setTimeout(loop, isWallScreen(value) ? 4_000 : 60_000);
};

export function useCallState() {
    const [, force] = useState(0);
    useEffect(() => {
        const fn = () => force((n) => n + 1);
        listeners.add(fn);
        if (!timer) timer = window.setTimeout(loop, 0);
        return () => {
            listeners.delete(fn);
        };
    }, []);
    return value;
}

export const endCall = async (id: string, outcome: CallOutcome) => {
    try {
        const { data } = await axios.post<CallState>('/api/cooper/call/end', { id, outcome });
        publishCall(data);
        return data;
    } catch {
        loadCall();
        return null;
    }
};

export const startCall = async (body: { kind: CallKind; key?: string | null }) => {
    const { data } = await axios.post<CallState>('/api/cooper/call/start', body);
    publishCall(data);
    return data;
};
