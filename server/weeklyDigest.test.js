// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doorStats, activityStats, measureStats, mailStats, draftText, fmtDuration, keepLocked } from './weeklyDigest.js';

const H = 3600_000;
const from = 1000 * H;
const to = from + 168 * H;
const door = (ts, isOpen, name = 'Porte balcon', did = 'a') => ({ kind: 'door', ts, title: `${name} : ${isOpen ? 'ouverte' : 'fermée'}`, data: { did, isOpen } });
// Heure locale simulée : heures écoulées depuis from, modulo 24
const hourOf = (ts) => Math.floor((ts - from) / H) % 24;

test('doorStats : ouvertures, temps ouvert, plus longue, nuit', () => {
    const d = doorStats([
        door(from + 10 * H, true), door(from + 10.5 * H, false), // 30 min
        door(from + 23.5 * H, true), door(from + 23.6 * H, false), // nuit, 6 min
        door(from + 2 * H, true, 'Porte d\'entrée', 'b'), door(from + 2.1 * H, false, 'Porte d\'entrée', 'b'),
    ], from, to, hourOf);
    const balcon = d.find((x) => x.name === 'Porte balcon');
    assert.equal(balcon.openings, 2);
    assert.equal(balcon.openMin, 36);
    assert.equal(balcon.longest.min, 30);
    assert.equal(balcon.night, 1);
    assert.equal(d.find((x) => x.name === 'Porte d\'entrée').night, 1);
});

test('doorStats : ouverte avant la période, seule la partie dans la semaine compte', () => {
    const d = doorStats([door(from - 2 * H, true), door(from + H, false)], from, to, hourOf);
    assert.equal(d[0].openings, 0);
    assert.equal(d[0].openMin, 60);
});

test('doorStats : encore ouverte à la fin', () => {
    const d = doorStats([door(to - H, true)], from, to, hourOf);
    assert.equal(d[0].stillOpen, true);
});

test('activityStats : commandes, arrêts, pointes, automatismes', () => {
    const a = activityStats([
        { kind: 'heating', ts: from + H, title: 'Thermopompe : arrêt', data: { state: { power: false } } },
        { kind: 'heating', ts: from + 2 * H, title: 'Pointe Flex D : consigne 21 → 19 °C', data: {} },
        { kind: 'automation', ts: from + 3 * H, title: 'Porte balcon oubliée', data: {} },
        { kind: 'automation', ts: from + 4 * H, title: 'Porte balcon oubliée', data: {} },
        { kind: 'heating', ts: from - H, title: 'avant', data: {} },
    ], from, to);
    assert.equal(a.heatingCommands, 2);
    assert.equal(a.heatingOffs, 1);
    assert.equal(a.flexPeaks, 1);
    assert.deepEqual(a.automations, [{ title: 'Porte balcon oubliée', count: 2 }]);
});

test('measureStats : moyenne pondérée par le temps et heures sous le seuil', () => {
    const pts = [
        { ts: from, temperature: 20 },
        { ts: from + 2 * H, temperature: 17 }, // 2 h à 20°, puis 2 h à 17°
        { ts: from + 4 * H, temperature: 20 },
    ];
    const s = measureStats(pts, 'temperature', from, from + 6 * H);
    assert.equal(s.min, 17);
    assert.equal(s.max, 20);
    assert.equal(s.hoursBelow, 2);
    assert.equal(s.avg, 19);
    assert.equal(measureStats([], 'temperature', from, to), null);
});

test('draftText : semaine calme sans faits', () => {
    const t = draftText({ sensors: [], doors: [], activity: { heatingCommands: 0, heatingOffs: 0, flexPeaks: 0, automations: [] }, batteries: [], silent: [] });
    assert.match(t, /Semaine calme/);
});

test('mailStats et ligne courrier', () => {
    const m = mailStats([
        { at: from + H, kind: 'delivery' }, { at: from + 2 * H, kind: 'pickup' },
        { at: from + 30 * H, kind: 'delivery' }, { at: from - H, kind: 'delivery' },
    ], from, to);
    assert.deepEqual(m, { postmanVisits: 2, mailCollectedByUs: 1, mailboxOpenedAtNight: 0 });
    const t = draftText({ sensors: [], doors: [], mail: m, activity: { heatingCommands: 0, heatingOffs: 0, flexPeaks: 0, automations: [] }, batteries: [], silent: [] });
    assert.match(t, /📬 Courrier : 2 passages du facteur, courrier relevé 1 fois\./);
});

test('fmtDuration', () => {
    assert.equal(fmtDuration(45), '45 min');
    assert.equal(fmtDuration(120), '2 h');
    assert.equal(fmtDuration(1346), '22 h 26');
});

test('keepLocked remet la ligne courrier du brouillon telle quelle', () => {
    const draft = '🗓️ Ta semaine\n🌡️ Salon\n📬 Courrier : 0 passage du facteur, courrier relevé 6 fois.';
    assert.equal(keepLocked('🗓️ Ta semaine  \n📬 6 colis récupérés', draft), '🗓️ Ta semaine\n📬 Courrier : 0 passage du facteur, courrier relevé 6 fois.');
    assert.equal(keepLocked('🗓️ Ta semaine', '🗓️ Ta semaine\nSemaine calme'), '🗓️ Ta semaine');
});

test('doorStats : le nom actuel du capteur remplace celui du journal', () => {
    const d = doorStats([door(from + H, true), door(from + 2 * H, false)], from, to, hourOf, { a: 'Porte terrasse' });
    assert.equal(d[0].name, 'Porte terrasse');
});
