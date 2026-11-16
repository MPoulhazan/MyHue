// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, inHours, DASHCAST_APP_ID, PAUSE_MS, RETRY_MS } from './kitchenDisplayLogic.js';

const cfg = { enabled: true, device: 'Cuisine', from: '06:30', to: '23:00' };
const fresh = { session: null, pausedUntil: 0, lastTryAt: 0, keepUntil: 0 };
const NOON = 12 * 60;
const NIGHT = 23 * 60 + 30;
const now = 10_000_000;
const dash = { appId: DASHCAST_APP_ID, sessionId: 'dash-1' };
const youtube = { appId: '233637DE', sessionId: 'yt-1' };

test('inHours : plage simple et plage qui passe minuit', () => {
    assert.equal(inHours(6 * 60 + 29, '06:30', '23:00'), false);
    assert.equal(inHours(6 * 60 + 30, '06:30', '23:00'), true);
    assert.equal(inHours(23 * 60, '06:30', '23:00'), false);
    assert.equal(inHours(23 * 60 + 30, '22:00', '02:00'), true);
    assert.equal(inHours(60, '22:00', '02:00'), true);
    assert.equal(inHours(NOON, '22:00', '02:00'), false);
});

test('step : Hub libre dans les heures → on affiche, puis pas de nouvel essai trop tôt', () => {
    const a = step({ now, min: NOON, apps: [], config: cfg, state: fresh });
    assert.equal(a.action, 'show');
    const b = step({ now: now + 30_000, min: NOON, apps: [], config: cfg, state: a.state });
    assert.equal(b.action, 'none');
    const c = step({ now: now + RETRY_MS, min: NOON, apps: [], config: cfg, state: b.state });
    assert.equal(c.action, 'show');
});

test('step : notre vue déjà là → rien, et on retient sa session', () => {
    const r = step({ now, min: NOON, apps: [dash], config: cfg, state: fresh });
    assert.equal(r.action, 'none');
    assert.equal(r.state.session, 'dash-1');
});

test('step : une autre appli joue → on ne coupe rien, et ce n’est pas un arrêt', () => {
    const r = step({ now, min: NOON, apps: [youtube], config: cfg, state: { ...fresh, session: 'dash-1' } });
    assert.equal(r.action, 'none');
    assert.equal(r.state.session, null);
    // YouTube fini : le Hub est libre, on revient sans attendre
    const after = step({ now: now + 60_000, min: NOON, apps: [], config: cfg, state: r.state });
    assert.equal(after.action, 'show');
});

test('step : vue arrêtée à la voix → pause de 30 min', () => {
    const r = step({ now, min: NOON, apps: [], config: cfg, state: { ...fresh, session: 'dash-1' } });
    assert.equal(r.action, 'none');
    assert.equal(r.state.pausedUntil, now + PAUSE_MS);
    assert.equal(step({ now: now + PAUSE_MS - 1, min: NOON, apps: [], config: cfg, state: r.state }).action, 'none');
    assert.equal(step({ now: now + PAUSE_MS, min: NOON, apps: [], config: cfg, state: r.state }).action, 'show');
});

test('step : la nuit on ferme notre vue, jamais celle des autres', () => {
    const ours = step({ now, min: NIGHT, apps: [dash], config: cfg, state: { ...fresh, session: 'dash-1' } });
    assert.equal(ours.action, 'stop');
    assert.equal(ours.sessionId, 'dash-1');
    assert.equal(step({ now, min: NIGHT, apps: [youtube], config: cfg, state: fresh }).action, 'none');
    assert.equal(step({ now, min: NIGHT, apps: [], config: cfg, state: fresh }).action, 'none');
});

test('step : affichée à la main le soir → gardée jusqu’à keepUntil', () => {
    const state = { ...fresh, session: 'dash-1', keepUntil: now + 1000 };
    assert.equal(step({ now, min: NIGHT, apps: [dash], config: cfg, state }).action, 'none');
    assert.equal(step({ now: now + 1000, min: NIGHT, apps: [dash], config: cfg, state }).action, 'stop');
});

test('step : désactivé → rien', () => {
    assert.equal(step({ now, min: NOON, apps: [], config: { ...cfg, enabled: false }, state: fresh }).action, 'none');
});

test('isKitchenShowCommand : affiche l’écran, pas les lumières', async () => {
    const { isKitchenShowCommand } = await import('./kitchenDisplayLogic.js');
    assert.equal(isKitchenShowCommand('Affiche MyHue dans la cuisine'), true);
    assert.equal(isKitchenShowCommand('allume l’écran de la cuisine'), true);
    assert.equal(isKitchenShowCommand('remets l’écran de la cuisine'), true);
    assert.equal(isKitchenShowCommand('affiche-le sur la cuisine'), true);
    assert.equal(isKitchenShowCommand('allume la cuisine'), false);
    assert.equal(isKitchenShowCommand('éteins les lumières de la cuisine'), false);
    assert.equal(isKitchenShowCommand('affiche la météo dans la cuisine'), false);
    assert.equal(isKitchenShowCommand('mets une radio dans la cuisine'), false);
});
