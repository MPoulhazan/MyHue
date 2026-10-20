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
