/** « samedi 28 nov. · 19 h » */
export const planWhen = (ts: number) => {
    const d = new Date(ts);
    const day = d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short' });
    const h = d.toLocaleTimeString('fr-CA', { hour: 'numeric', minute: '2-digit' }).replace(':', ' h ').replace(' h 00', ' h');
    return `${day} · ${h}`;
};
