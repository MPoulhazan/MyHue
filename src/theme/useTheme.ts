import { useSyncExternalStore } from 'react';
import { getPreference, subscribeTheme } from './theme';

// Valeur concrète d'un token (pour canvas / attributs SVG qui n'acceptent pas var())
export const themeColor = (token: string, alpha = 1) => {
    const style = document.documentElement.style;
    const rgb = style.getPropertyValue(`--${token}-rgb`).trim();
    if (rgb) return `rgba(${rgb}, ${alpha})`;
    return style.getPropertyValue(`--${token}`).trim();
};

const snapshot = () => `${getPreference()}|${document.documentElement.style.getPropertyValue('--darkness')}`;

/** Re-rend le composant à chaque changement de thème (préférence ou crépuscule). */
export function useTheme() {
    const key = useSyncExternalStore(subscribeTheme, snapshot);
    const [preference, darkness] = key.split('|');
    return { preference: preference as ReturnType<typeof getPreference>, darkness: Number(darkness) || 0 };
}
