import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localOutdoor, coolingAdvice, frostLine, emptyRecords, addSample, coldNews, heatNews, summary, winterOf } from './outdoorLogic.js';
import { roleOf, indoorClimate } from './sensorRoles.js';

const NOW = Date.parse('2026-11-22T03:00:00Z');
const thermo = (name, room, t, ago = 5 * 60_000) => ({
    did: name, name, room, type: 'temperature_humidity', props: { temperature: t, humidity: 70 }, lastUpdated: new Date(NOW - ago).toISOString(),
});

test('rôles : balcon, hotte, pièces', () => {
    assert.equal(roleOf(thermo('Extérieur', 'Extérieur', 3)), 'outdoor');
    assert.equal(roleOf(thermo('Cuisinière', 'Cuisine', 22)), 'stove');
    assert.equal(roleOf(thermo('Salon', null, 21)), 'indoor');
    assert.equal(roleOf({ ...thermo('Salon', null, 21), role: 'outdoor' }), 'outdoor');
    assert.equal(roleOf({ name: 'Boite aux lettres', room: 'Extérieur', type: 'other', props: {} }), null);
    assert.deepEqual(indoorClimate([thermo('Extérieur', 'Extérieur', 3), thermo('Salon', null, 21), thermo('Cuisinière', 'Cuisine', 22)]).map((s) => s.name), ['Salon']);
});

test('balcon : retenu s’il est frais et proche de la météo', () => {
    assert.equal(localOutdoor([thermo('Extérieur', 'Extérieur', 9.6)], 10.8, NOW).temperature, 9.6);
    assert.equal(localOutdoor([thermo('Extérieur', 'Extérieur', 19.5)], 10.8, NOW), null); // pas encore acclimaté
    assert.equal(localOutdoor([thermo('Extérieur', 'Extérieur', 9.6, 3 * 3600_000)], 10.8, NOW), null); // muet
    assert.equal(localOutdoor([thermo('Salon', null, 21)], 10.8, NOW), null);
});

test('aérer gratuitement', () => {
    assert.equal(coolingAdvice({ indoor: 26, outdoor: 21, doorOpen: false, heatingMode: null, raining: false }), 'open');
    assert.equal(coolingAdvice({ indoor: 26, outdoor: 21, doorOpen: false, heatingMode: null, raining: true }), null);
    assert.equal(coolingAdvice({ indoor: 26, outdoor: 21, doorOpen: false, heatingMode: 'heat', raining: false }), null);
    assert.equal(coolingAdvice({ indoor: 24, outdoor: 27, doorOpen: true, heatingMode: null, raining: false }), 'close');
    assert.equal(coolingAdvice({ indoor: 21, outdoor: 15, doorOpen: false, heatingMode: null, raining: false }), null);
});

test('gel et verglas', () => {
    assert.equal(frostLine({ min: 2, max: 8 }), null);
    assert.match(frostLine({ min: -3, max: -1, humidityAtMin: 70, precip: 0 }), /^Gelé cette nuit : −3°/);
    assert.match(frostLine({ min: -1, max: 4, humidityAtMin: 70, precip: 2 }), /verglas possible.*pattes de Cooper/);
    assert.doesNotMatch(frostLine({ min: -1, max: 4, precip: 2 }, { cooper: false }), /Cooper/);
});

const day = (k) => Date.parse(`${k}T12:00:00Z`);
const fill = (state, from, n, min, max) => {
    for (let i = 0; i < n; i++) {
        const k = new Date(Date.parse(`${from}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
        addSample(state, k, min, day(k));
        addSample(state, k, max, day(k));
    }
};

test('hiver de juillet à juin', () => {
    assert.equal(winterOf('2026-11-21'), '2026-2027');
    assert.equal(winterOf('2027-02-01'), '2026-2027');
    assert.equal(winterOf('2027-07-01'), '2027-2028');
});

test('nuit la plus froide de l’hiver, pas avant trois semaines de mesures', () => {
    const s = emptyRecords();
    fill(s, '2026-11-21', 10, -5, 2);
    addSample(s, '2026-12-01', -12, day('2026-12-01'));
    assert.deepEqual(coldNews(s, '2026-12-01').filter((n) => n.kind === 'cold_record'), []);
    fill(s, '2026-12-02', 25, -8, 0);
    addSample(s, '2026-12-27', -15.4, day('2026-12-27'));
    const news = coldNews(s, '2026-12-27');
    assert.equal(news.length, 1);
    assert.match(news[0].text, /Nuit la plus froide de l’hiver 2026-2027 : −15,4° .*avant : −12°/);
});

test('premiers seuils : seulement si la sonde surveillait déjà', () => {
    const s = emptyRecords();
    fill(s, '2026-11-21', 5, -2, 3);
    // Installée le 21 nov. : le premier gel de la saison est passé sans elle, le −10 non
    addSample(s, '2026-11-26', -11, day('2026-11-26'));
    const news = coldNews(s, '2026-11-26');
    assert.equal(news.length, 1);
    assert.match(news[0].text, /Premier −10° de l’hiver : −11°/);
    fill(s, '2026-11-27', 3, -3, 1);
    addSample(s, '2026-11-30', -12, day('2026-11-30'));
    assert.deepEqual(coldNews(s, '2026-11-30'), []);
});

test('journée la plus chaude de l’année', () => {
    const s = emptyRecords();
    fill(s, '2027-06-01', 30, 15, 27);
    addSample(s, '2027-07-01', 31.2, day('2027-07-01'));
    assert.match(heatNews(s, '2027-07-01')[0].text, /Journée la plus chaude de 2027 : 31,2°/);
    const sum = summary(s, '2027-07-01');
    assert.equal(sum.year.warmest.value, 31.2);
    assert.equal(sum.winter.firstFrost, null);
});
