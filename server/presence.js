/**
 * Présence : qui est à la maison, d'après les entités `person.*` de Home Assistant
 * (alimentées par l'app HA Companion du téléphone). Vérifié toutes les minutes ;
 * un départ ou un retour va au journal et sur le bus ('presence').
 */
import * as haService from './haService.js';
import * as journal from './journal.js';
import { bus } from './events.js';

const POLL_MS = 60_000;
// entity_id -> { name, state: 'home' | 'not_home' | zone | 'unknown', since }
const people = new Map();

const isHome = (state) => state === 'home';
const isKnown = (state) => state && state !== 'unknown' && state !== 'unavailable';

const poll = async () => {
    if (!haService.isConfigured()) return;
    let states;
    try {
        states = await haService.getStates('person');
    } catch {
        return; // HA injoignable : on garde le dernier état connu
    }
    for (const s of states) {
        const name = s.attributes?.friendly_name || s.entity_id.replace('person.', '');
        const prev = people.get(s.entity_id);
        people.set(s.entity_id, {
            name,
            state: s.state,
            since: prev && prev.state === s.state ? prev.since : Date.parse(s.last_changed) || Date.now(),
        });
        // Au premier passage on ne fait que mémoriser ; ensuite, seuls les vrais changements comptent
        if (!prev || !isKnown(prev.state) || !isKnown(s.state) || isHome(prev.state) === isHome(s.state)) continue;
        const home = isHome(s.state);
        journal.log({ kind: 'presence', title: `${name} : ${home ? 'retour à la maison' : 'départ de la maison'}`, data: { entity: s.entity_id, home } });
        bus.emit('presence', { entity: s.entity_id, name, home, anyoneHome: anyoneHome() });
    }
};

/** null tant qu'aucun téléphone ne remonte sa position (HA Companion pas encore installé). */
export const anyoneHome = () => {
    const known = [...people.values()].filter((p) => isKnown(p.state));
    return known.length ? known.some((p) => isHome(p.state)) : null;
};

export const getPeople = () =>
    [...people.entries()].map(([entity, p]) => ({ entity, name: p.name, home: isKnown(p.state) ? isHome(p.state) : null, since: p.since }));

export const start = () => {
    poll();
    setInterval(poll, POLL_MS);
};
