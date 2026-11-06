import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromEccc, icePreview, fromCityNotices, fromManual, merge, whenLabel, bucket, telegramText, briefingLine, weekendText, mentions, isCityQuestion } from './cityLogic.js';

const TZ = 'America/Toronto';
// Jeudi 24 septembre 2026, 19 h 40 à Montréal (UTC-4)
const NOW = Date.parse('2026-09-24T23:40:00Z');
const at = (iso) => Date.parse(iso);

const eccc = (p) => ({ properties: { status_en: 'issued', alert_type: 'warning', alert_code: 'FRW', alert_short_name_fr: 'pluie verglaçante', alert_text_fr: 'Régions : Montréal.\n\nDe la pluie verglaçante est prévue demain matin. Les surfaces seront glissantes.', validity_datetime: '2026-09-25T09:00:00Z', event_end_datetime: '2026-09-25T14:00:00Z', ...p } });

test('Environnement Canada : un avertissement devient un danger, une fois par type', () => {
    const out = fromEccc([eccc(), eccc({ feature_id: 'autre-zone' }), eccc({ status_en: 'ended', alert_code: 'WDW' })], NOW);
    assert.equal(out.length, 1);
    assert.equal(out[0].level, 'danger');
    assert.equal(out[0].kind, 'ice');
    assert.equal(out[0].title, 'Pluie verglaçante');
    assert.equal(out[0].detail, 'De la pluie verglaçante est prévue demain matin.');
    assert.match(out[0].advice, /BIXI/);
    const watch = fromEccc([eccc({ alert_type: 'watch', alert_code: 'SNW', alert_short_name_fr: 'neige' })], NOW)[0];
    assert.equal(watch.level, 'heads');
    assert.equal(watch.kind, 'snow');
    assert.equal(fromEccc([eccc({ event_end_datetime: '2026-09-24T20:00:00Z' })], NOW).length, 0);
});

test('Open-Meteo : verglas prévu, effacé si Environnement Canada le publie', () => {
    const hours = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => ({ ts: NOW + i * 3600_000, code: i >= 9 && i <= 11 ? 66 : 3, precip: 0, temp: 1 }));
    const ice = icePreview(hours, NOW);
    assert.equal(ice.level, 'heads');
    assert.equal(ice.start, NOW + 9 * 3600_000);
    assert.equal(icePreview(hours.map((h) => ({ ...h, code: 3 })), NOW), null);
    const merged = merge([[ice], fromEccc([eccc()], NOW)], NOW);
    assert.deepEqual(merged.map((e) => e.id), ['eccc:FRW:warning']);
});

test('Avis de la Ville : ébullition dans notre rue, levée par l’avis de fin', () => {
    const rec = [
        { _id: 1, titre: 'Avis d’ébullition d’eau – Rue Ontario entre rue Clark et rue Sanguinet, arrondissement de Ville-Marie', date_debut: '2026-09-20T10:00:00', type: 'Urgence' },
        { _id: 2, titre: 'Avis préventif d’ébullition d’eau – Rue Victoria, arrondissement de Lachine', date_debut: '2026-09-21T10:00:00', type: 'Urgence' },
        { _id: 3, titre: 'Fermeture de la circulation – Rue Sanguinet entre Ontario et Sherbrooke – Arrondissement de Ville-Marie', date_debut: '2026-09-23T10:00:00' },
        { _id: 4, titre: 'Fermeture de la circulation – Rue Clarke – Arrondissement de Ville-Marie', date_debut: '2026-09-23T10:00:00' },
    ];
    const opts = { areas: ['Ville-Marie'], streets: ['Clark', 'Sanguinet'], now: NOW };
    const out = fromCityNotices(rec, opts);
    assert.deepEqual(out.map((e) => [e.id, e.level, e.kind]), [['ville:1', 'danger', 'water'], ['ville:3', 'info', 'road']]);
    const ended = fromCityNotices([...rec, { _id: 5, titre: 'Fin de l’avis d’ébullition de l’eau –  Rue Ontario, entre les rues Clark et Sanguinet, arrondissement de Ville-Marie', date_debut: '2026-09-22T10:00:00' }], opts);
    assert.ok(!ended.some((e) => e.id === 'ville:1'));
});

test('« Clark » ne prend pas « Clarke »', () => {
    assert.equal(mentions('Rue Clarke', ['Clark']), false);
    assert.equal(mentions('Rue Clark Nord', ['Clark']), true);
    assert.equal(mentions('rue Sainte-Elisabeth', ['Sainte-Élisabeth']), true);
});

test('Événement ajouté à la main : heure locale, terminé = disparu', () => {
    const m = fromManual({ id: 'marathon', title: 'Marathon de Montréal', date: '2026-09-27', from: '07:00', to: '14:00' }, NOW, TZ);
    assert.equal(m.start, at('2026-09-27T11:00:00Z'));
    assert.equal(m.end, at('2026-09-27T18:00:00Z'));
    assert.equal(bucket(m, NOW, TZ), 'weekend');
    assert.equal(whenLabel(m, NOW, TZ), 'dimanche 7 h – 14 h');
    assert.equal(fromManual({ title: 'Vieux', date: '2026-09-20' }, NOW, TZ), null);
    const allDay = fromManual({ title: 'Nuit blanche', date: '2026-09-26' }, NOW, TZ);
    assert.equal(whenLabel(allDay, NOW, TZ), 'samedi');
    assert.match(weekendText([m, allDay], NOW, TZ), /^📅 Ce week-end : Marathon de Montréal \(dimanche 7 h – 14 h\), Nuit blanche \(samedi\)\.$/);
});

test('Libellés, Telegram et briefing', () => {
    const [ice] = fromEccc([eccc()], NOW);
    assert.equal(whenLabel(ice, NOW, TZ), 'demain 5 h – 10 h');
    assert.equal(bucket(ice, NOW, TZ), 'tomorrow');
    assert.equal(whenLabel({ start: null, end: at('2026-09-25T02:00:00Z') }, NOW, TZ), 'jusqu’à 22 h');
    assert.match(telegramText(ice, NOW, TZ), /^🧊 Pluie verglaçante : De la pluie verglaçante est prévue demain matin \(demain 5 h – 10 h\)\. Pas de BIXI/);
    assert.match(briefingLine([ice], NOW, TZ), /^Attention, pluie verglaçante demain 5 heures à 10 heures\. Pas de BIXI/);
    assert.equal(briefingLine([], NOW, TZ), null);
});

test('Questions pour Jarvis', () => {
    assert.ok(isCityQuestion('Il se passe quoi ce week-end ?'));
    assert.ok(isCityQuestion('Il y a une alerte météo ?'));
    assert.ok(!isCityQuestion('Allume le salon'));
});

test('STM : ligne orange interrompue, les autres lignes ignorées', async () => {
    const { fromStm } = await import('./cityLogic.js');
    const data = { alerts: [
        { active_periods: { start: NOW / 1000 - 600, end: null }, informed_entities: [{ route_short_name: '2' }], description_texts: [{ language: 'fr', text: 'Arrêt de service entre Berri-UQAM et Jean-Talon. Reprise prévue vers 8 h 15.' }] },
        { active_periods: { start: NOW / 1000 - 600, end: null }, informed_entities: [{ route_short_name: '1' }], description_texts: [{ language: 'fr', text: 'Service normal du métro' }] },
    ] };
    const { status, events } = fromStm(data, ['2', '1'], NOW);
    assert.deepEqual(status.map((s) => [s.name, s.ok]), [['orange', false], ['verte', true]]);
    assert.equal(events.length, 1);
    assert.equal(events[0].title, 'Métro ligne orange');
    assert.equal(fromStm({ alerts: [] }, ['2'], NOW).status[0].text, 'Service normal');
});
