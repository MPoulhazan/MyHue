import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { stateToHex, ctToHex, hexToXy, pctToBri, briToPct } from '../utils/hueColor';

export interface DashLight {
    id: string;
    name: string;
    room: string;
    color: string;
    level: number; // 0-100, 0 = éteinte
    reachable: boolean;
    dimmable: boolean;
    colorable: boolean;
}

export interface Swatch {
    label: string;
    hex: string;
    ct?: number;
}

export const SWATCHES: Swatch[] = [
    { label: 'Blanc chaud', hex: ctToHex(420), ct: 420 },
    { label: 'Blanc neutre', hex: ctToHex(300), ct: 300 },
    { label: 'Blanc froid', hex: ctToHex(200), ct: 200 },
    { label: 'Corail', hex: '#FF7A59' },
    { label: 'Rouge', hex: '#FF3B5C' },
    { label: 'Violet', hex: '#A26BFF' },
    { label: 'Bleu', hex: '#4F7DFF' },
    { label: 'Vert', hex: '#2FD98A' },
];

export interface LogEntry {
    id: number;
    t: string;
    msg: string;
    color?: string;
    href?: string;
}

export interface Climate {
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
    battery: number | null;
}

export interface Heating {
    connected: boolean;
    power: boolean;
    mode: string;
    temperature: number;
}

const hhmm = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const now = () => hhmm(new Date());
let logSeq = 0;

// Entrée du journal serveur (/api/journal)
interface JournalEntry {
    id: string;
    ts: number;
    kind: string;
    title: string;
    data?: { isOpen?: boolean; level?: string };
}

const journalColor = (e: JournalEntry) => {
    if (e.data?.level === 'alert') return '#FF3B5C';
    if (e.kind === 'door' && e.data?.isOpen) return '#FFB547';
    if (e.kind === 'companion' || e.kind === 'automation') return '#C8F560';
    return undefined;
};

const fromJournal = (e: JournalEntry): LogEntry => ({
    id: ++logSeq,
    t: hhmm(new Date(e.ts)),
    msg: e.title,
    color: journalColor(e),
});

export function useHome() {
    const [lights, setLights] = useState<DashLight[]>([]);
    const [rooms, setRooms] = useState<string[]>([]);
    const [climate, setClimate] = useState<Climate>({ temperature: null, humidity: null, pressure: null, battery: null });
    const [door, setDoor] = useState<{ name: string; open: boolean | null; since: string } | null>(null);
    const [heating, setHeating] = useState<Heating | null>(null);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [online, setOnline] = useState({ hue: false, zigbee: false });

    const editing = useRef<Record<string, number>>({});
    const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const roomOf = useRef<Record<string, string>>({});

    const push = useCallback((msg: string, color?: string, href?: string) => {
        setLog((l) => [{ id: ++logSeq, t: now(), msg, color, href }, ...l].slice(0, 40));
    }, []);

    // --- Hue ---
    const loadLights = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/hue/lights');
            setOnline((o) => ({ ...o, hue: true }));
            setLights((prev) => {
                const byId = Object.fromEntries(prev.map((l) => [l.id, l]));
                return Object.entries<any>(data).map(([id, l]) => {
                    // Ne pas écraser une lampe que l'utilisateur est en train de régler
                    if (byId[id] && Date.now() - (editing.current[id] || 0) < 2500) return byId[id];
                    const dimmable = l.state.bri !== undefined;
                    return {
                        id,
                        name: l.name.replace(/^Hue lightstrip /, 'Strip '),
                        room: roomOf.current[id] || 'Autres',
                        color: dimmable ? stateToHex(l.state) : '#FFE2B8',
                        level: l.state.on ? (dimmable ? briToPct(l.state.bri) : 100) : 0,
                        reachable: l.state.reachable !== false,
                        dimmable,
                        colorable: Boolean(l.state.colormode),
                    };
                });
            });
        } catch {
            setOnline((o) => ({ ...o, hue: false }));
        }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await axios.get('/api/hue/groups');
                const names: string[] = [];
                for (const g of Object.values<any>(data)) {
                    if (g.type !== 'Room' || !g.lights.length) continue;
                    names.push(g.name);
                    g.lights.forEach((id: string) => (roomOf.current[id] = g.name));
                }
                setRooms(names);
            } catch { /* pont injoignable */ }
            await loadLights();
        })();
        const t = setInterval(loadLights, 3000);
        return () => clearInterval(t);
    }, [loadLights, push]);

    const sendState = useCallback((id: string, body: object, delay = 120) => {
        clearTimeout(pending.current[id]);
        pending.current[id] = setTimeout(() => {
            axios.put(`/api/hue/lights/${id}/state`, { ...body, transitiontime: 2 }).catch(() => {});
        }, delay);
    }, []);

    const lightsRef = useRef<DashLight[]>([]);
    lightsRef.current = lights;

    const setLevel = useCallback((ids: string[], pct: number) => {
        const targets = lightsRef.current.filter((l) => ids.includes(l.id) && l.reachable);
        targets.forEach((l) => {
            editing.current[l.id] = Date.now();
            sendState(l.id, pct === 0 ? { on: false } : l.dimmable ? { on: true, bri: pctToBri(pct) } : { on: true });
        });
        const set = new Set(targets.map((l) => l.id));
        setLights((ls) => ls.map((l) => (set.has(l.id) ? { ...l, level: l.dimmable ? pct : pct > 0 ? 100 : 0 } : l)));
    }, [sendState]);

    const setColor = useCallback((ids: string[], sw: Swatch) => {
        const targets = lightsRef.current.filter((l) => ids.includes(l.id) && l.reachable && l.colorable);
        targets.forEach((l, i) => {
            editing.current[l.id] = Date.now();
            const level = l.level || 60;
            // Décalage par lampe : la couleur se propage en vague
            sendState(l.id, { on: true, bri: pctToBri(level), ...(sw.ct ? { ct: sw.ct } : { xy: hexToXy(sw.hex) }) }, i * 60);
        });
        const set = new Set(targets.map((l) => l.id));
        setLights((ls) => ls.map((l) => (set.has(l.id) ? { ...l, color: sw.hex, level: l.level || 60 } : l)));
    }, [sendState]);

    // --- Capteurs (SSE) ---
    useEffect(() => {
        const es = new EventSource('/api/sensors/events');
        let lastDoor: boolean | null = null;
        es.onmessage = (ev) => {
            try {
                const sensors = JSON.parse(ev.data) as any[];
                setOnline((o) => ({ ...o, zigbee: true }));
                const th = sensors.find((s) => s.props?.temperature != null);
                if (th) setClimate({ ...th.props, name: th.name });
                const d = sensors.find((s) => s.type === 'door');
                if (d) {
                    const open = d.props?.isOpen ?? null;
                    if (open !== lastDoor) setDoor({ name: d.name, open, since: now() });
                    lastDoor = open;
                }
            } catch { /* ignore */ }
        };
        es.onerror = () => setOnline((o) => ({ ...o, zigbee: false }));
        return () => es.close();
    }, []);

    // --- Journal de la maison (portes, clim, automatismes, compagnon) ---
    // Les échanges avec l'agent restent locaux : ils sont déjà affichés par askAgent
    useEffect(() => {
        axios.get('/api/journal', { params: { limit: 25 } }).then(({ data }) => {
            const entries = (data.entries as JournalEntry[]).filter((e) => e.kind !== 'agent');
            setLog((l) => [...l, ...entries.map(fromJournal)].slice(0, 40));
        }).catch(() => {});
        const es = new EventSource('/api/journal/stream');
        es.onmessage = (ev) => {
            try {
                const e = JSON.parse(ev.data) as JournalEntry;
                if (e.kind !== 'agent') setLog((l) => [fromJournal(e), ...l].slice(0, 40));
            } catch { /* ignore */ }
        };
        return () => es.close();
    }, []);

    // --- Chauffage ---
    useEffect(() => {
        axios.get('/api/heating/status').then(({ data }) =>
            setHeating({ connected: data.connected, ...data.state }),
        ).catch(() => {});
    }, []);

    const controlHeating = useCallback(async (patch: Partial<Heating>) => {
        setHeating((h) => (h ? { ...h, ...patch } : h));
        try {
            const { data } = await axios.post('/api/heating/control', patch);
            if (data?.mode) setHeating((h) => (h ? { ...h, ...data } : h));
        } catch {
            push('Clim · commande échouée', '#FF3B5C');
        }
    }, [push]);

    // --- Agent ---
    // Renvoie la réponse de l'agent (lue à voix haute quand la demande est vocale)
    const askAgent = useCallback(async (message: string): Promise<string | undefined> => {
        push(`> ${message}`);
        try {
            const { data } = await axios.post('/api/agent', { message, history: [] });
            const reply: string = data.message || data.reply || 'OK';
            push(reply, '#C8F560', data.escalation?.url);
            setTimeout(loadLights, 600);
            return reply;
        } catch {
            push('Agent indisponible', '#FF3B5C');
            return 'Agent indisponible.';
        }
    }, [push, loadLights]);

    return { lights, rooms, climate, door, heating, log, online, push, setLevel, setColor, controlHeating, askAgent };
}
