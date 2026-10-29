/**
 * Home Assistant Service - client REST (HA OS sur le Pi)
 * Config: HA_URL=http://homeassistant.local:8123, HA_TOKEN=<long-lived token>
 */

import 'dotenv/config';
import axios from 'axios';

const HA_URL = (process.env.HA_URL || '').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';

const client = axios.create({
    baseURL: `${HA_URL}/api`,
    timeout: 8000,
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
});

export const isConfigured = () => Boolean(HA_URL && HA_TOKEN);

function ensureConfigured() {
    if (!isConfigured()) throw new Error('Home Assistant non configuré (HA_URL / HA_TOKEN)');
}

export async function getStatus() {
    if (!isConfigured()) return { configured: false, connected: false };
    try {
        const { data } = await client.get('/config');
        return {
            configured: true,
            connected: true,
            version: data.version,
            location: data.location_name,
        };
    } catch (err) {
        return { configured: true, connected: false, error: err.message };
    }
}

/** Configuration HA : position (latitude, longitude), fuseau, unités. */
export async function getConfig() {
    ensureConfigured();
    const { data } = await client.get('/config');
    return data;
}

/** Tous les états, filtrables par domaine (light, sensor, climate...). */
export async function getStates(domain) {
    ensureConfigured();
    const { data } = await client.get('/states');
    return domain ? data.filter((s) => s.entity_id.startsWith(`${domain}.`)) : data;
}

export async function getState(entityId) {
    ensureConfigured();
    const { data } = await client.get(`/states/${entityId}`);
    return data;
}

/** ex: callService('light', 'turn_on', { entity_id: 'light.salon', brightness_pct: 50 }) */
export async function callService(domain, service, serviceData = {}) {
    ensureConfigured();
    const { data } = await client.post(`/services/${domain}/${service}`, serviceData);
    return data;
}

/**
 * Une commande WebSocket HA (connexion courte). L'historique revient vide via le proxy
 * REST du Supervisor dans l'add-on ; la WebSocket, elle, marche partout.
 */
export function wsCommand(message, timeoutMs = 15000) {
    ensureConfigured();
    // Add-on : http://supervisor/core → ws://supervisor/core/websocket ; sinon /api/websocket
    const base = HA_URL.replace(/^http/, 'ws');
    const url = /\/core$/.test(HA_URL) ? `${base}/websocket` : `${base}/api/websocket`;
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('WebSocket HA : délai dépassé'));
        }, timeoutMs);
        const done = (fn, value) => {
            clearTimeout(timer);
            ws.close();
            fn(value);
        };
        ws.onmessage = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
            else if (m.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, ...message }));
            else if (m.type === 'auth_invalid') done(reject, new Error('WebSocket HA : jeton refusé'));
            else if (m.id === 1) {
                if (m.success) done(resolve, m.result);
                else done(reject, new Error(m.error?.message || 'commande HA refusée'));
            }
        };
        ws.onerror = () => done(reject, new Error('WebSocket HA injoignable'));
    });
}

/** Historique de plusieurs entités en un appel : { entity_id: [{ ts, value }] }. */
export async function getHistoryMulti(entityIds, hours = 24) {
    if (entityIds.length === 0) return {};
    const result = await wsCommand({
        type: 'history/history_during_period',
        start_time: new Date(Date.now() - hours * 3600 * 1000).toISOString(),
        entity_ids: entityIds,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
    });
    // Format compact : { entity_id: [{ s: état, lu: secondes epoch }] }
    return Object.fromEntries(
        Object.entries(result).map(([id, points]) => [
            id,
            points.map((p) => ({
                ts: Math.round((p.lu ?? p.lc) * 1000),
                value: isNaN(Number(p.s)) ? p.s : Number(p.s),
            })),
        ]),
    );
}

/** Météo extérieure (intégration météo par défaut de HA). */
export async function getWeather(entityId = process.env.HA_WEATHER_ENTITY || 'weather.forecast_home') {
    const { state, attributes: a } = await getState(entityId);
    return {
        condition: state,
        temperature: a.temperature ?? null,
        humidity: a.humidity ?? null,
        windSpeed: a.wind_speed ?? null,
        unit: a.temperature_unit || '°C',
    };
}

/** Historique du recorder HA (24h par défaut). */
export async function getHistory(entityId, hours = 24) {
    ensureConfigured();
    const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data } = await client.get(`/history/period/${start}`, {
        params: { filter_entity_id: entityId, minimal_response: true },
    });
    return (data[0] || []).map((p) => ({
        ts: new Date(p.last_changed).getTime(),
        value: isNaN(Number(p.state)) ? p.state : Number(p.state),
    }));
}
