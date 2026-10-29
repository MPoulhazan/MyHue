// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeBriefing } from './briefing.js';

const H = 3600_000;
const day = (ts) => (ts < 24 * H ? '2026-01-15' : '2026-01-16');

const outfit = (moment, hour, extra) => ({
    day: 'today', moment, hour, past: false, feels: 0, rainProb: 0, gust: 20, items: ['Manteau d’hiver', 'Tuque', 'Gants'], tip: null, ...extra,
});
const weather = (extra = {}) => ({
    current: { temp: 2.4, feels: -1.6 },
    outfits: [outfit('out', 8), outfit('back', 17, { feels: 5, items: ['Manteau mi-saison'] })],
    storm: { level: 'calm', maxGust: 30, window: null },
    ...extra,
});

test('briefing calme : météo, tenue aller et retour', () => {
    const t = composeBriefing(weather(), null, '2026-01-15', day);
    assert.match(t, /^Bonjour ! Il fait 2 degrés dehors, ressenti moins 2./);
    assert.match(t, /Pour sortir à 8 heures : manteau d’hiver, tuque et gants\./);
    assert.match(t, /Au retour, vers 17 heures, ressenti 5 degrés : manteau mi-saison\./);
    assert.doesNotMatch(t, /tempête|Flex D/i);
    assert.match(t, /Bonne journée !$/);
});

test('briefing : pluie au retour et tempête dans la journée', () => {
    const w = weather({
        outfits: [outfit('out', 8), outfit('back', 17, { rainProb: 80, gust: 70, items: ['Imperméable à capuche'], tip: 'Rafales à 70 km/h : mise sur la capuche.' })],
        storm: { level: 'likely', maxGust: 80, window: { from: 14 * H, to: 22 * H } },
    });
    const t = composeBriefing(w, null, '2026-01-15', day);
    assert.match(t, /pluie probable à 80 pour cent/);
    assert.match(t, /Rafales à 70 km\/h/);
    assert.match(t, /tempête probable aujourd'hui de \d+ heures à \d+ heures, avec des rafales jusqu'à 80 kilomètres heure/);
});

test('briefing : pointe Flex D du jour seulement, pas celle ignorée ni celle de demain', () => {
    const flex = {
        enabled: true,
        upcoming: [
            { start: 16 * H, end: 20 * H, skipped: false },
            { start: 6 * H, end: 10 * H, skipped: true },
            { start: 30 * H, end: 34 * H, skipped: false },
        ],
    };
    const t = composeBriefing(weather(), flex, '2026-01-15', day);
    assert.equal(t.match(/Pointe Flex D/g)?.length, 1);
    assert.match(t, /évite la sécheuse/);
});

test('briefing : sortie du matin déjà passée, on ne parle que du retour', () => {
    const w = weather({ outfits: [outfit('out', 8, { past: true }), outfit('back', 17, { items: ['Veste légère'] })] });
    const t = composeBriefing(w, null, '2026-01-15', day);
    assert.doesNotMatch(t, /Pour sortir/);
    assert.match(t, /: veste légère\./);
});
