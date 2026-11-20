// ── Une seule couche d'alertes : qui passe en plein écran, qui en bannière ──
//
// Fonction pure, sans React ni réseau (testée dans server/alertQueue.test.js) :
// AlertHost lui donne ce que la maison sait, elle rend la file des pleins écrans
// (le premier seul est montré, les autres attendent) et les bannières du haut.
// Le reste des avertissements vit en carte, dans « Maintenant ».

/** Plein écran : il faut agir tout de suite. Dans cet ordre de priorité. */
export type TakeoverKind = 'smoke' | 'leak' | 'intrusion' | 'city';
/** Bannière en haut de tous les écrans : à savoir, sans bloquer. */
export type BannerKind = 'service' | 'paused' | 'city';

export interface AlarmIn { did: string; type: string; since: number }
export interface GuardIn { mode: 'alarm' | 'vacation' | null; events: { at: number; sensor: string; what: 'open' | 'motion' }[] }
export interface CityIn {
    takeover: { id: string } | null;
    events: { id: string; level: string; title: string; when: string }[];
}
export interface ServiceIn { id: string; ok: boolean; label: string }
export interface SensorIn { did: string; name: string; pausedUntil?: number | 'forever' | null }

export interface AlertsIn {
    alarms: AlarmIn[];
    guard: GuardIn | null;
    /** Le dernier passage déjà vu sur cet écran (« J'ai vu ») */
    guardSeenAt: number;
    city: CityIn | null;
    services: ServiceIn[];
    sensors: SensorIn[];
    now: number;
}

export interface Takeover { id: string; kind: TakeoverKind }
export interface Banner { id: string; kind: BannerKind; ref: string }

/** Un passage pendant l'absence reste en plein écran une demi-heure, ou jusqu'à « J'ai vu ». */
export const INTRUSION_MS = 30 * 60_000;

const RANK: Record<TakeoverKind, number> = { smoke: 0, leak: 1, intrusion: 2, city: 3 };

/** Le dernier passage qui demande le plein écran, s'il y en a un. */
export function freshIntrusion(guard: GuardIn | null, seenAt: number, now: number) {
    if (!guard?.mode) return null;
    const fresh = guard.events.filter((e) => now - e.at < INTRUSION_MS && e.at > seenAt);
    return fresh.length ? fresh.reduce((a, b) => (b.at > a.at ? b : a)) : null;
}

export function buildAlerts(v: AlertsIn): { takeovers: Takeover[]; banners: Banner[] } {
    const takeovers: Takeover[] = [];
    // Fumée, puis fuite : une seule alerte par sorte, l'écran nomme les autres capteurs
    if (v.alarms.some((a) => a.type === 'smoke')) takeovers.push({ id: 'smoke', kind: 'smoke' });
    if (v.alarms.some((a) => a.type !== 'smoke')) takeovers.push({ id: 'leak', kind: 'leak' });
    const intrusion = freshIntrusion(v.guard, v.guardSeenAt, v.now);
    if (intrusion) takeovers.push({ id: `intrusion-${intrusion.at}`, kind: 'intrusion' });
    if (v.city?.takeover) takeovers.push({ id: `city-${v.city.takeover.id}`, kind: 'city' });
    takeovers.sort((a, b) => RANK[a.kind] - RANK[b.kind]);

    const banners: Banner[] = [
        ...v.services.filter((s) => !s.ok).map((s): Banner => ({ id: `service-${s.id}`, kind: 'service', ref: s.id })),
        ...v.sensors.filter((s) => s.pausedUntil).map((s): Banner => ({ id: `paused-${s.did}`, kind: 'paused', ref: s.did })),
        // Un danger en ville déjà vu en plein écran reste rappelé en haut tant qu'il dure
        ...(v.city?.events ?? [])
            .filter((e) => e.level === 'danger' && e.id !== v.city?.takeover?.id)
            .map((e): Banner => ({ id: `city-${e.id}`, kind: 'city', ref: e.id })),
    ];
    return { takeovers, banners };
}
