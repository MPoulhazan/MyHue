import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../commute/Commute.css';

// ── Mini-carte de la fiche sortie : la maison, le lieu, et les stations BIXI du trajet ──

interface Point { lat: number; lon: number }

const HOME_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 11 12 4l8 7v8H4z" fill="currentColor"/></svg>';

export function OutingMap({ home, place, start, end }: { home: Point; place: Point; start?: (Point & { bikes: number }) | null; end?: (Point & { docks: number }) | null }) {
    const el = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!el.current) return;
        const m = L.map(el.current, {
            zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false,
            doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false,
        });
        // Relayées par le Pi : OSM bloque les tuiles demandées directement par la tablette
        L.tileLayer('/api/tiles/{z}/{x}/{y}.png', { maxZoom: 19, className: 'cm-tiles', attribution: '© OpenStreetMap' }).addTo(m);
        const pts = [L.latLng(home.lat, home.lon), L.latLng(place.lat, place.lon)];
        L.polyline(pts, { color: '#6fa8ff', weight: 3, dashArray: '6 6', interactive: false }).addTo(m);
        L.marker(pts[0], { icon: L.divIcon({ className: 'cm-home', html: HOME_SVG, iconSize: [26, 26] }), interactive: false, keyboard: false }).addTo(m);
        L.marker(pts[1], { icon: L.divIcon({ className: 'om-place', html: '', iconSize: [22, 22] }), interactive: false, keyboard: false }).addTo(m);
        if (start) L.marker([start.lat, start.lon], { icon: L.divIcon({ className: 'cm-st ok', html: `<b>${start.bikes}</b>`, iconSize: [26, 26] }), interactive: false, keyboard: false }).addTo(m);
        if (end) L.marker([end.lat, end.lon], { icon: L.divIcon({ className: 'cm-st ok', html: `<b>P</b>`, iconSize: [26, 26] }), interactive: false, keyboard: false }).addTo(m);
        const fit = () => m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 16 });
        fit();
        const ro = new ResizeObserver(() => { m.invalidateSize(); fit(); });
        ro.observe(el.current);
        return () => { ro.disconnect(); m.remove(); };
        // Les points arrivent en objets neufs à chaque rendu : on ne refait la carte que si leurs valeurs changent
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [home.lat, home.lon, place.lat, place.lon, start?.lat, start?.lon, start?.bikes, end?.lat, end?.lon]);

    return <div ref={el} className="cm-map om-map" role="img" aria-label="Plan : la maison et le lieu de la sortie" />;
}
