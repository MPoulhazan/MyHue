import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import type { Sensor, ServiceHealth } from '../../hooks/useHome';
import { HomeAlarm } from '../alarm/HomeAlarm';
import type { ActiveAlarm } from '../alarm/HomeAlarm';
import { CityAlert } from '../city/CityAlert';
import { useCity } from '../city/useCity';
import type { CityView } from '../city/useCity';
import { GuardAlert } from '../guard/GuardAlert';
import type { GuardView } from '../guard/GuardCard';
import { alarmPoll, guardPoll } from '../home/widgets/polls';
import { hhmm } from '../home/cards';
import { Icon } from '../Icon';
import { buildAlerts, freshIntrusion } from './alertQueue';
import './Alerts.css';

// ── Une seule couche d'alertes pour toute l'app ──────────────────────────────
//
// Plein écran (un seul à la fois, les autres en file) : fumée, fuite, passage pendant
// l'alarme, danger en ville. Bannière en haut de tous les écrans : service en panne,
// capteur en pause, danger en ville déjà vu. Le reste : les cartes de « Maintenant ».
// Au-dessus de tout, mode nuit compris (z-index dans Alerts.css).

const SEEN_KEY = 'myhue.guard.seenAt';
const readSeen = () => {
    try {
        return Number(localStorage.getItem(SEEN_KEY)) || 0;
    } catch {
        return 0;
    }
};

const sinceLabel = (iso: string) => {
    const d = new Date(iso);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return `depuis ${time}`;
    return `depuis le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`;
};
const pausedUntil = (u: Sensor['pausedUntil']) => {
    if (u == null || u === 'forever') return '';
    const d = new Date(u);
    return ` jusqu’à ${d.toDateString() === new Date().toDateString() ? '' : 'demain '}${hhmm(d)}`;
};

// ── Données de démonstration : ?alertdemo=smoke,leak,intrusion,city,service,paused,citybanner ──
// Pour vérifier chaque écran sans déclencher une vraie alarme. Les boutons n'y touchent rien.

function demoData(kinds: string[], now: number) {
    const has = (k: string) => kinds.includes(k);
    const alarms: ActiveAlarm[] = [
        ...(has('smoke') ? [{ did: 'demo-smoke', name: 'Détecteur de fumée', room: 'Cuisine', type: 'smoke', since: now - 60_000 }] : []),
        ...(has('leak') ? [{ did: 'demo-leak', name: 'Capteur fuite d’eau', room: 'Cuisine', type: 'water_leak', since: now - 120_000 }] : []),
    ];
    const guard: GuardView | null = has('intrusion') ? {
        mode: 'alarm', since: now - 3600_000, by: 'démo', simulate: false,
        sim: { onFrom: '18:00', onTo: '19:00', offFrom: '22:30', offTo: '23:30' }, simToday: null,
        events: [{ at: now - 90_000, sensor: 'Porte d’entrée', what: 'open' }],
    } : null;
    const danger = { id: 'demo-ice', level: 'danger' as const, kind: 'ice', title: 'Pluie verglaçante', detail: 'Environnement Canada : 5 à 10 mm de verglas.', advice: 'Évite le vélo, crampons aux bottes.', start: now, end: null, source: 'Environnement Canada', link: null, when: 'ce soir dès 18 h', bucket: 'today' as const };
    const city: CityView | null = has('city') || has('citybanner') ? {
        enabled: true, updatedAt: now, metro: null,
        events: [danger],
        takeover: has('city') ? { ...danger, lamp: 'ice' } : null,
    } : null;
    const services: ServiceHealth[] = has('service') ? [{ id: 'demo-z2m', ok: false, label: 'Zigbee2MQTT', since: new Date(now - 600_000).toISOString(), hint: 'Les capteurs ne remontent plus : redémarre l’add-on.' } as ServiceHealth] : [];
    const sensors = has('paused') ? [{ did: 'demo-stairs', name: 'Escalier', pausedUntil: now + 3600_000 } as Sensor] : [];
    return { alarms, guard, city, services, sensors };
}

export function AlertHost({ services, sensors }: { services: ServiceHealth[]; sensors: Sensor[] }) {
    const demo = useMemo(() => {
        try {
            const v = new URLSearchParams(window.location.search).get('alertdemo');
            return v ? v.split(',') : null;
        } catch {
            return null;
        }
    }, []);
    const alarmView = alarmPoll.use();
    const guardView = guardPoll.use();
    const { view: cityView, ack } = useCity();
    const [seenAt, setSeenAt] = useState(readSeen);
    // L'heure avance pour qu'un passage sorte du plein écran après sa demi-heure
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, []);

    const fake = demo ? demoData(demo, now) : null;
    const alarms = fake?.alarms ?? alarmView?.active ?? [];
    const guard = fake ? fake.guard : guardView;
    const city = fake ? fake.city : cityView;
    const allServices = fake ? fake.services : services;
    const allSensors = fake ? fake.sensors : sensors;

    const { takeovers, banners } = buildAlerts({ alarms, guard, guardSeenAt: seenAt, city, services: allServices, sensors: allSensors, now });
    const first = takeovers[0];
    const waiting = takeovers.length - 1;

    const seen = (at: number) => {
        setSeenAt(at);
        try {
            localStorage.setItem(SEEN_KEY, String(at));
        } catch {
            // Pas de stockage (navigation privée) : vu pour cette session seulement
        }
    };
    const resume = (did: string) => {
        if (fake) return;
        axios.delete(`/api/sensors/${encodeURIComponent(did)}/pause`).catch(() => {});
    };

    let takeover = null;
    if (first?.kind === 'smoke' || first?.kind === 'leak') {
        const mine = alarms.filter((a) => (first.kind === 'smoke' ? a.type === 'smoke' : a.type !== 'smoke'));
        takeover = <HomeAlarm alarms={mine} all={fake ? [] : alarms} waiting={waiting} onCleared={() => alarmPoll.load()} />;
    } else if (first?.kind === 'intrusion' && guard) {
        const ev = freshIntrusion(guard, seenAt, now);
        if (ev) takeover = <GuardAlert view={guard} event={ev} waiting={waiting} onSeen={fake ? () => setSeenAt(ev.at) : seen} demo={Boolean(fake)} />;
    } else if (first?.kind === 'city' && city?.takeover) {
        takeover = <CityAlert event={city.takeover} waiting={waiting} onAck={fake ? () => {} : ack} />;
    }

    return (
        <>
            {banners.length > 0 && (
                <div className="alert-banners" role="region" aria-label="Alertes">
                    {banners.map((b) => {
                        if (b.kind === 'service') {
                            const s = allServices.find((x) => x.id === b.ref);
                            if (!s) return null;
                            return (
                                <div key={b.id} className="alert-banner bad" role="alert">
                                    <Icon name="alert" size={22} strokeWidth={2.2} />
                                    <div className="alert-banner-text">
                                        <strong>{s.label} hors ligne</strong> <span className="alert-banner-since">{sinceLabel(s.since)}</span>
                                        {s.hint && <div className="alert-banner-hint">{s.hint}</div>}
                                    </div>
                                </div>
                            );
                        }
                        if (b.kind === 'paused') {
                            const s = allSensors.find((x) => x.did === b.ref);
                            if (!s) return null;
                            return (
                                <div key={b.id} className="alert-banner warn">
                                    <Icon name="pause" size={20} strokeWidth={2.4} />
                                    <div className="alert-banner-text"><strong>{s.name}</strong> en pause{pausedUntil(s.pausedUntil)} : ce capteur ne déclenche rien.</div>
                                    <button type="button" className="alert-banner-btn" onClick={() => resume(s.did)}>Réactiver</button>
                                </div>
                            );
                        }
                        const e = city?.events.find((x) => x.id === b.ref);
                        if (!e) return null;
                        return (
                            <div key={b.id} className="alert-banner bad">
                                <Icon name="city" size={20} strokeWidth={2.2} />
                                <div className="alert-banner-text"><strong>{e.title}</strong> <span className="alert-banner-since">{e.when}</span>{e.advice && <div className="alert-banner-hint">{e.advice}</div>}</div>
                            </div>
                        );
                    })}
                </div>
            )}
            {takeover}
        </>
    );
}
