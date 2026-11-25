/**
 * Présence : qui est à la maison, d'après les entités `person.*` de Home Assistant
 * (alimentées par l'app HA Companion du téléphone). Vérifié toutes les minutes ;
 * un départ ou un retour va au journal et sur le bus ('presence').
 */
import * as haService from './haService.js';
import * as journal from './journal.js';
import { bus } from './events.js';
import * as wifi from './wifiPresence.js';

const POLL_MS = 60_000;
// entity_id -> { name, state: 'home' | 'not_home' | zone | 'unknown', since }
const people = new Map();

const isHome = (state) => state === 'home';
const isKnown = (state) => state && state !== 'unknown' && state !== 'unavailable';

const poll = async () => {
    if (!haService.isConfigured()) return emitIfChanged();
    let states;
    try {
        states = await haService.getStates('person');
    } catch {
        return emitIfChanged(); // HA injoignable : on garde le dernier état GPS, le Wi-Fi compte encore
    }
    for (const s of states) {
        const name = s.attributes?.friendly_name || s.entity_id.replace('person.', '');
        const prev = people.get(s.entity_id);
        people.set(s.entity_id, {
            name,
            state: s.state,
            since: prev && prev.state === s.state ? prev.since : Date.parse(s.last_changed) || Date.now(),
        });
    }
    emitIfChanged();
};

// Maison occupée ou vide : seul ce changement déclenche « Je pars » / « Je rentre »
let lastCombined = null;
const emitIfChanged = () => {
    const now = anyoneHome();
    const prev = lastCombined;
    lastCombined = now;
    // Au premier passage on ne fait que mémoriser ; ensuite, seuls les vrais changements comptent
    if (prev === null || now === null || prev === now) return;
    const via = wifi.someoneHome() !== null ? 'Wi-Fi' : 'GPS';
    journal.log({ kind: 'presence', title: now ? `Maison : quelqu’un est rentré (${via})` : `Maison : plus personne (${via})`, data: { home: now, via } });
    bus.emit('presence', { entity: 'home', name: 'Maison', home: now, anyoneHome: now });
};

const gpsAnyoneHome = () => {
    const known = [...people.values()].filter((p) => isKnown(p.state));
    return known.length ? known.some((p) => isHome(p.state)) : null;
};

/**
 * Quelqu'un à la maison ? Dès qu'un téléphone est connu sur le Wi-Fi, c'est lui qui fait foi
 * (au moins un téléphone vu en 15 min = quelqu'un) : il compte aussi ceux qui n'ont pas
 * HA Companion, et le GPS d'Android reste parfois figé « à la maison ». Sinon, le GPS.
 * null tant qu'on ne sait rien.
 */
export const anyoneHome = () => {
    const w = wifi.someoneHome();
    return w !== null ? w : gpsAnyoneHome();
};

export const getPeople = () =>
    [...people.entries()].map(([entity, p]) => ({ entity, name: p.name, home: isKnown(p.state) ? isHome(p.state) : null, since: p.since }));

export const start = () => {
    wifi.start().catch((err) => console.error('❌ Présence Wi-Fi :', err.message));
    poll();
    setInterval(poll, POLL_MS);
};
