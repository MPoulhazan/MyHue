/**
 * « Ce soir à deux » : 20 min avant l'heure de départ d'une sortie prévue, un message Telegram
 * et la lampe du bar en rose, jusqu'à 10 min après l'heure de départ (lot 4 de « Sortie à deux v2 »).
 *
 * La lampe du bar est partagée : Cooper passe avant, la collecte aussi ; le courrier nous laisse
 * la place. Elle n'est pas prise si personne n'est à la maison ou si une alarme sonne, et elle
 * n'est pas remise si quelqu'un l'a changée entre-temps.
 */
import { hueClient, hueBaseUrl, restoreLight } from './hue.js';
import * as notifier from './notifier.js';
import * as journal from './journal.js';
import * as builtins from './builtins.js';
import * as presence from './presence.js';
import * as alarm from './alarm.js';
import * as cooper from './cooper.js';
import * as mailbox from './mailbox.js';
import * as myDay from './myDay.js';
import { shouldRemind, reminderText } from './tonightLogic.js';

const TZ = process.env.TZ || 'America/Toronto';
const TICK_MS = 60_000;
const PINK = [0.45, 0.21];
const BRI = 140;
const HOLD_AFTER_MS = 10 * 60_000;

let lamp = null; // { id, before, until }

const isOurs = (s) => s.on && Math.abs(s.bri - BRI) <= 5 && s.colormode === 'xy' && Math.abs(s.xy[0] - PINK[0]) < 0.03 && Math.abs(s.xy[1] - PINK[1]) < 0.03;

const takeLamp = async (until) => {
    if (!builtins.allows('tonight.reminder', 'lamp')) return false;
    if (!hueBaseUrl || presence.anyoneHome() === false || alarm.anyActive() || cooper.lampBusy() || mailbox.lampHeld()) return false;
    const id = await cooper.pickBarLight();
    if (!id) return false;
    const { data } = await hueClient.get(`/lights/${id}`);
    if (!data.state.xy) return false; // une ampoule blanche ne peut pas dire « rose »
    cooper.claimBar('sortie', true);
    lamp = { id, before: data.state, until };
    await hueClient.put(`/lights/${id}/state`, { on: true, bri: BRI, xy: PINK, transitiontime: 20 });
    await new Promise((r) => setTimeout(r, 2500));
    await hueClient.put(`/lights/${id}/state`, { alert: 'lselect' }).catch(() => {});
    builtins.ran('tonight.reminder', 'lamp', 'Bar en rose');
    return true;
};

const releaseLamp = async () => {
    const l = lamp;
    lamp = null;
    cooper.claimBar('sortie', false);
    if (!l) return;
    try {
        const { data } = await hueClient.get(`/lights/${l.id}`);
        if (isOurs(data.state)) await restoreLight(l.id, l.before);
    } catch (err) {
        console.warn('⚠️  Sortie, lampe:', err.message);
    }
};

const tick = async () => {
    if (lamp && Date.now() >= lamp.until) await releaseLamp();
    const t = await myDay.tonightView().catch(() => null);
    if (!t) {
        if (lamp) await releaseLamp();
        return;
    }
    if (!shouldRemind(t, t.reminded)) return;
    myDay.markReminded();
    await notifier.notify({ text: reminderText(t, TZ), builtin: 'tonight.reminder', detail: t.title }).catch((err) => console.warn('⚠️  Sortie, Telegram:', err.message));
    const lit = await takeLamp(t.leaveAt + HOLD_AFTER_MS).catch((err) => {
        console.warn('⚠️  Sortie, lampe:', err.message);
        return false;
    });
    journal.log({ kind: 'system', title: `Rappel de sortie : ${t.title}, départ ${new Date(t.leaveAt).toLocaleTimeString('fr-CA', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })}${lit ? ' (lampe du bar en rose)' : ''}` });
};

export const start = () => {
    setInterval(() => tick().catch((err) => console.warn('⚠️  Sortie:', err.message)), TICK_MS).unref?.();
};
