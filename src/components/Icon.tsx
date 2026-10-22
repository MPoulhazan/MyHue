// Icônes trait (24×24, stroke = currentColor) — remplacent les emoji dans toute l'app

export type IconName =
    | 'home' | 'lights' | 'rooms' | 'scenes' | 'stats' | 'agent' | 'music'
    | 'cast' | 'rules' | 'heating' | 'privacy' | 'settings' | 'grid' | 'power'
    | 'thermo' | 'door' | 'drag';

const PATHS: Record<IconName, string> = {
    home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
    lights: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
    rooms: 'M3 3h18v18H3zM3 12h9M12 3v18M12 15h9',
    scenes: 'M4 6h16v12H4zM4 10h16M8 6l2 4M13 6l2 4',
    stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    agent: 'M5 8h14v10H5zM12 4v4M9 13h.01M15 13h.01M2 12v3M22 12v3',
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    cast: 'M3 8V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6M3 12a7 7 0 0 1 7 7M3 16a3 3 0 0 1 3 3M3 19h.01',
    rules: 'M4 6h10M4 12h6M4 18h10M17 4v6M14 7h6M15 15l2 2 4-4',
    heating: 'M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.8.8-2.8 1.5-3.5.3 1.5 1.2 2.3 2 2.5-.6-2.5-.2-5.3.5-7.5zM6 21h12',
    privacy: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6zM9.5 12l2 2 3.5-4',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
    thermo: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0zM12 17v-5',
    door: 'M5 21V3h11v18M16 21h3M13 12h.01M5 21H3',
    drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
};

export function Icon({ name, size = 20, strokeWidth = 1.8, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={PATHS[name]} />
        </svg>
    );
}
