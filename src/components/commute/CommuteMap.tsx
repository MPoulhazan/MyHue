import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ── Plan du quartier : la maison, l'arrêt de bus et les stations BIXI avec leurs vélos ──

interface Point { lat: number; lon: number }
export interface MapStation extends Point { id: string; name: string; dist: number; bikes: number; ebikes: number | null; docks: number | null }
export interface CommuteMapData {
    home: Point | null;
    work: Point | null;
    stop: (Point & { name: string }) | null;
    stations: MapStation[];
}

const level = (n: number) => (n <= 0 ? 'no' : n <= 2 ? 'low' : 'ok');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const HOME_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 11 12 4l8 7v8H4z" fill="currentColor"/></svg>';

/**
 * @param best   id de la station conseillée (entourée)
 * @param large  la version agrandie : on peut la déplacer, on voit aussi le travail
 */
export function CommuteMap({ data, best, large = false }: { data: CommuteMapData; best?: string | null; large?: boolean }) {
    const el = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map | null>(null);
    const layer = useRef<L.LayerGroup | null>(null);
    const fit = useRef<(() => void) | null>(null);
    const fitted = useRef(false);

    useEffect(() => {
        if (!el.current || !data.home) return;
        const m = L.map(el.current, {
            zoomControl: large,
            attributionControl: true,
            dragging: large,
            scrollWheelZoom: large,
            doubleClickZoom: large,
            touchZoom: large,
            boxZoom: false,
            keyboard: large,
        });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            className: 'cm-tiles',
            attribution: '© OpenStreetMap',
        }).addTo(m);
        map.current = m;
        layer.current = L.layerGroup().addTo(m);
        // La carte naît dans une boîte qui s'anime ou change de taille : on recale le cadrage
        const ro = new ResizeObserver(() => {
            m.invalidateSize();
            fit.current?.();
        });
        ro.observe(el.current);
        return () => {
            ro.disconnect();
            m.remove();
            map.current = null;
        };
    }, [large, data.home?.lat, data.home?.lon]);

    useEffect(() => {
        const m = map.current;
        const g = layer.current;
        if (!m || !g || !data.home) return;
        g.clearLayers();
        const home = L.latLng(data.home.lat, data.home.lon);
        L.marker(home, { icon: L.divIcon({ className: 'cm-home', html: HOME_SVG, iconSize: [26, 26] }), keyboard: false, interactive: false }).addTo(g);
        if (data.stop) {
            L.marker([data.stop.lat, data.stop.lon], { icon: L.divIcon({ className: 'cm-stop', html: '14', iconSize: [24, 20] }), interactive: false, keyboard: false }).addTo(g);
        }
        const shown = data.stations.slice(0, large ? 40 : 12);
        for (const s of shown) {
            const e = s.ebikes ? `<i>⚡${s.ebikes}</i>` : '';
            L.marker([s.lat, s.lon], {
                icon: L.divIcon({ className: `cm-st ${level(s.bikes)} ${s.id === best ? 'best' : ''}`, html: `<b>${s.bikes}</b>${large ? e : ''}`, iconSize: [30, 30] }),
                keyboard: false,
                title: `${s.name} : ${s.bikes} vélos, ${s.ebikes ?? 0} électriques, ${s.docks ?? 0} places`,
            }).bindTooltip(esc(`${s.name} · ${s.dist} m`), { direction: 'top', offset: [0, -14] }).addTo(g);
        }
        if (large && data.work) {
            L.marker([data.work.lat, data.work.lon], { icon: L.divIcon({ className: 'cm-work', html: 'Travail', iconSize: [64, 24] }), interactive: false, keyboard: false }).addTo(g);
        }
        const pts = [home, ...shown.slice(0, large ? 12 : 5).map((s) => L.latLng(s.lat, s.lon))];
        if (large && data.work) pts.push(L.latLng(data.work.lat, data.work.lon));
        fit.current = () => m.fitBounds(L.latLngBounds(pts), { padding: large ? [40, 40] : [18, 18], maxZoom: 17 });
        // Agrandie, on ne recadre pas à chaque relevé : la personne a peut-être déplacé la carte
        if (!large || !fitted.current) fit.current();
        fitted.current = true;
    }, [data, best, large]);

    return <div ref={el} className={`cm-map ${large ? 'is-large' : ''}`} />;
}
