// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direction, toCar, carsWithin, newArrivals, carLabel, whereLabel, foundText, communautoSpeech, parseCommunautoCommand } from './communautoLogic.js';

const home = { lat: 45.52, lon: -73.58 };
const car = (id, dLat, dLon, extra = {}) => ({
    CarId: id, CarBrand: 'Toyota', CarModel: 'Corolla', CarColor: 'silver', CarPlate: 'ABC123',
    Latitude: home.lat + dLat, Longitude: home.lon + dLon, IsElectric: false, EnergyLevel: null, ...extra,
});

test('direction : les huit points cardinaux', () => {
    assert.equal(direction(home, { lat: home.lat + 0.01, lon: home.lon }), 'au nord');
    assert.equal(direction(home, { lat: home.lat - 0.01, lon: home.lon }), 'au sud');
    assert.equal(direction(home, { lat: home.lat, lon: home.lon + 0.01 }), 'à l’est');
    assert.equal(direction(home, { lat: home.lat - 0.005, lon: home.lon - 0.007 }), 'au sud-ouest');
});

test('toCar : couleur en français, batterie seulement pour les électriques', () => {
    const c = toCar(car(1, 0.001, 0), home);
    assert.equal(c.id, '1');
    assert.equal(c.model, 'Toyota Corolla');
    assert.equal(c.color, 'grise');
    assert.equal(c.battery, null);
    assert.ok(Math.abs(c.dist - 111) < 3);
    const ev = toCar(car(2, 0, 0, { CarBrand: 'Kia', CarModel: 'Niro EV', CarColor: 'white', IsElectric: true, EnergyLevel: 64 }), home);
    assert.equal(carLabel(ev), 'Kia Niro EV blanche (64 %)');
});

test('carsWithin : dans le rayon, triées, positions invalides ignorées', () => {
    const list = [car(1, 0.004, 0), car(2, 0.001, 0), car(3, 0.02, 0), { CarId: 4, Latitude: null, Longitude: null }];
    const out = carsWithin(list, home, 500);
    assert.deepEqual(out.map((c) => c.id), ['2', '1']);
    assert.deepEqual(carsWithin(null, home, 500), []);
});

test('newArrivals : seulement les autos pas encore annoncées', () => {
    const cars = carsWithin([car(1, 0.001, 0), car(2, 0.002, 0)], home, 500);
    assert.deepEqual(newArrivals(cars, ['1']).map((c) => c.id), ['2']);
    assert.deepEqual(newArrivals(cars, [1, 2]), []);
});

test('foundText et whereLabel : la rue si on la connaît', () => {
    const [a, b] = carsWithin([car(1, -0.0025, 0), car(2, 0.003, 0)], home, 500);
    a.street = 'Rue des Érables';
    assert.equal(whereLabel(a), `Rue des Érables, à ${a.dist} m au sud`);
    assert.equal(whereLabel(b), `à ${b.dist} m au nord`);
    const text = foundText([a, b]);
    assert.match(text, /^J’ai trouvé une Communauto : Toyota Corolla grise, Rue des Érables/);
    assert.match(text, /Et une autre : Toyota Corolla à \d+ m\./);
    assert.equal(foundText([]), '');
});

test('communautoSpeech : au repos, en recherche, trouvée', () => {
    assert.match(communautoSpeech(null), /joindre/);
    const near = carsWithin([car(1, 0.001, 0)], home, 500);
    assert.match(communautoSpeech({ updatedAt: 1, radiusM: 500, nearby: near, search: null }), /^1 Communauto à moins de 500 m\. La plus proche : Toyota Corolla grise, à \d+ m au nord\.$/);
    assert.match(communautoSpeech({ updatedAt: 1, radiusM: 300, nearby: [], search: null }), /Aucune Communauto Flex à moins de 300 m/);
    const until = Date.now() + 20 * 60_000;
    assert.match(communautoSpeech({ updatedAt: 1, radiusM: 500, nearby: [], search: { active: true, radiusM: 500, until, found: [] } }), /Je cherche une Communauto à moins de 500 m, encore 20 min/);
    assert.match(communautoSpeech({ updatedAt: 1, radiusM: 500, nearby: [], search: { active: true, radiusM: 500, until, found: [{ ...near[0], gone: false }] } }), /J’ai trouvé une Communauto.*Je continue de chercher encore 20 min\./);
});

test('parseCommunautoCommand : lancer, arrêter, demander', () => {
    assert.deepEqual(parseCommunautoCommand('Trouve-moi une Communauto'), { action: 'start', radiusM: null, autoBook: false, nearMe: false });
    assert.deepEqual(parseCommunautoCommand('cherche une communauto à 300 mètres'), { action: 'start', radiusM: 300, autoBook: false, nearMe: false });
    assert.deepEqual(parseCommunautoCommand("j'ai besoin d'une communauto dans 1 km"), { action: 'start', radiusM: 1000, autoBook: false, nearMe: false });
    assert.deepEqual(parseCommunautoCommand('réserve-moi une communauto à 500 m'), { action: 'start', radiusM: 500, autoBook: true, nearMe: false });
    assert.deepEqual(parseCommunautoCommand('annule le blocage de la communauto'), { action: 'cancel' });
    assert.deepEqual(parseCommunautoCommand('réserve-moi une communauto autour de moi à 400 m'), { action: 'start', radiusM: 400, autoBook: true, nearMe: true });
    assert.deepEqual(parseCommunautoCommand('arrête de chercher la communauto'), { action: 'stop' });
    assert.deepEqual(parseCommunautoCommand("c'est bon j'ai réservé la communauto"), { action: 'stop' });
    assert.deepEqual(parseCommunautoCommand('il y a des communauto autour ?'), { action: 'status' });
    assert.equal(parseCommunautoCommand('allume le salon'), null);
});

test('carAppLink : lien de l’appli vers la fiche de l’auto, forcé vers son paquet', async () => {
    const { carAppLink } = await import('./communautoLogic.js');
    assert.equal(carAppLink(11869), 'intent://client.reservauto.net/quebec/dashboard/map/free-floating-info/11869#Intent;scheme=https;package=com.communauto.reservauto;S.browser_fallback_url=https%3A%2F%2Fwww.communauto.com;end');
});
