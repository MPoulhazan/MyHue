// Icônes trait (24×24, stroke = currentColor) — remplacent les emoji dans toute l'app

export type IconName =
    | 'home' | 'lights' | 'rooms' | 'scenes' | 'agent' | 'music'
    | 'cast' | 'rules' | 'heating' | 'settings' | 'grid' | 'power'
    | 'thermo' | 'door' | 'drag'
    | 'screen' | 'glass' | 'moon' | 'leave' | 'check' | 'close' | 'plus' | 'sun' | 'cloud' | 'menu' | 'battery'
    | 'chevron' | 'back' | 'alert'
    | 'play' | 'pause' | 'stop' | 'volume' | 'minus' | 'radio' | 'list'
    | 'trash' | 'drop' | 'wifi' | 'refresh';

const PATHS: Record<IconName, string> = {
    home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
    lights: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
    rooms: 'M3 3h18v18H3zM3 12h9M12 3v18M12 15h9',
    scenes: 'M4 6h16v12H4zM4 10h16M8 6l2 4M13 6l2 4',
    agent: 'M5 8h14v10H5zM12 4v4M9 13h.01M15 13h.01M2 12v3M22 12v3',
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    cast: 'M3 8V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6M3 12a7 7 0 0 1 7 7M3 16a3 3 0 0 1 3 3M3 19h.01',
    rules: 'M4 6h10M4 12h6M4 18h10M17 4v6M14 7h6M15 15l2 2 4-4',
    heating: 'M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.8.8-2.8 1.5-3.5.3 1.5 1.2 2.3 2 2.5-.6-2.5-.2-5.3.5-7.5zM6 21h12',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
    thermo: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0zM12 17v-5',
    door: 'M5 21V3h11v18M16 21h3M13 12h.01M5 21H3',
    drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    screen: 'M3 5h18v12H3zM8 21h8',
    glass: 'M8 3h8l-1 7a3 3 0 0 1-6 0zM12 13v8M9 21h6',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    leave: 'M10 17l5-5-5-5M15 12H3M21 3v18',
    check: 'M5 12l5 5 9-10',
    close: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    cloud: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z',
    menu: 'M4 7h16M4 12h16M4 17h16',
    battery: 'M3 8h15v8H3zM21 11v2',
    chevron: 'M9 6l6 6-6 6',
    back: 'M15 18l-6-6 6-6',
    alert: 'M12 8v5M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    play: 'M7 5v14l12-7z',
    pause: 'M8 5v14M16 5v14',
    stop: 'M6 6h12v12H6z',
    volume: 'M4 9v6h4l5 4V5L8 9zM16.5 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
    minus: 'M5 12h14',
    radio: 'M4 9h16v11H4zM7 9l10-5M9 14.5a1.5 1.5 0 1 0 0 .01M14 13h3M14 16h3',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
    wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
};

export function Icon({ name, size = 20, strokeWidth = 1.8, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={PATHS[name]} />
        </svg>
    );
}
