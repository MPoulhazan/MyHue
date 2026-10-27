/**
 * Maison : chauffage, capteurs Zigbee (registre, appairage, flux SSE), règles, Home Assistant.
 */
import express from 'express';
import * as rulesEngine from '../rulesEngine.js';
import * as broadlinkService from '../broadlinkService.js';
import * as zigbeeService from '../zigbeeService.js';
import * as sensorRegistry from '../sensorRegistry.js';
import * as haService from '../haService.js';
import * as journal from '../journal.js';
import { getSensors, getSensorHistory, getOutdoorWeather } from '../sensors.js';

export const router = express.Router();

// --- Chauffage ---

router.get('/api/heating/status', (_req, res) => {
    res.json(broadlinkService.getStatus());
});

router.post('/api/heating/control', async (req, res) => {
    try {
        res.json(await broadlinkService.applyPatch(req.body || {}));
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Heating control failed' });
    }
});

router.post('/api/heating/discover', async (_req, res) => {
    try {
        await broadlinkService.discover();
        res.json({ ok: true, ...broadlinkService.getStatus() });
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Discovery failed' });
    }
});

// --- Règles ---

router.get('/api/rules', (_req, res) => {
    res.json(rulesEngine.getRules());
});

router.delete('/api/rules/:id', (req, res) => {
    if (!rulesEngine.deleteRule(req.params.id)) {
        return res.status(404).json({ error: 'Rule not found' });
    }
    res.json({ ok: true });
});

router.patch('/api/rules/:id/toggle', (req, res) => {
    const rule = rulesEngine.toggleRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
});

// --- Capteurs ---

router.get('/api/sensors', async (_req, res) => {
    try {
        res.json({ sensors: await getSensors() });
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Failed to fetch sensors' });
    }
});

router.get('/api/sensors/registry', (_req, res) => {
    res.json({ sensors: sensorRegistry.getAll() });
});

router.post('/api/sensors/registry', (req, res) => {
    const { ieee, name, type } = req.body || {};
    if (!ieee || !name || !type) {
        return res.status(400).json({ error: '"ieee", "name" et "type" sont requis' });
    }
    res.json(sensorRegistry.upsert({ ieee, name, type }));
});

router.delete('/api/sensors/registry/:ieee', (req, res) => {
    if (!sensorRegistry.remove(decodeURIComponent(req.params.ieee))) {
        return res.status(404).json({ error: 'Capteur introuvable dans le registre' });
    }
    res.json({ ok: true });
});

// Flux temps réel des capteurs (SSE)
const sseClients = new Set();

router.get('/api/sensors/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
        res.write(`data: ${JSON.stringify(await getSensors())}\n\n`);
    } catch { /* ignore */ }

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

let sseBroadcastTimer = null;
zigbeeService.emitter.on('update', () => {
    // Regroupe les mises à jour rapprochées (200 ms)
    if (sseBroadcastTimer) return;
    sseBroadcastTimer = setTimeout(async () => {
        sseBroadcastTimer = null;
        if (sseClients.size === 0) return;
        try {
            const data = `data: ${JSON.stringify(await getSensors())}\n\n`;
            for (const client of sseClients) client.write(data);
        } catch { /* ignore */ }
    }, 200);
});

// --- Zigbee (zigbee2mqtt via Mosquitto) ---

const unregisteredDevices = () => {
    const registered = new Set(sensorRegistry.getAll().map((e) => e.ieee));
    return zigbeeService
        .getDevices()
        .filter((d) => !registered.has(d.ieeeAddr))
        .map((d) => ({
            ieeeAddr: d.ieeeAddr,
            friendlyName: d.friendlyName,
            model: d.model || null,
            vendor: d.vendor || null,
            description: d.description || null,
            lastSeen: d.lastSeen ? new Date(d.lastSeen).toISOString() : null,
        }));
};

router.get('/api/zigbee/devices', (_req, res) => {
    res.json(zigbeeService.getDevices());
});

router.get('/api/zigbee/unregistered', (_req, res) => {
    res.json({ devices: unregisteredDevices() });
});

// Statut d'appairage, interrogé par l'UI pendant le mode appairage
router.get('/api/zigbee/pairing-status', (_req, res) => {
    res.json({
        permitJoinActive: zigbeeService.isPermitJoinActive(),
        lastJoin: zigbeeService.getLastJoinEvent(),
        newDevices: unregisteredDevices(),
    });
});

router.post('/api/zigbee/permit-join', async (req, res) => {
    try {
        const seconds = req.body?.seconds ?? 120;
        await zigbeeService.permitJoin(seconds);
        res.json({ ok: true, seconds });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/zigbee/stop-join', async (_req, res) => {
    try {
        await zigbeeService.disallowJoin();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/zigbee/rename', async (req, res) => {
    try {
        const { from: fromName, to: toName } = req.body || {};
        if (!fromName || !toName) {
            return res.status(400).json({ error: '"from" et "to" sont requis' });
        }
        await zigbeeService.setFriendlyName(fromName, toName);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ?hours=24 par défaut, jusqu'à 30 jours (recorder Home Assistant)
router.get('/api/zigbee/history/:deviceId', async (req, res) => {
    const hours = Math.min(Number(req.query.hours) || 24, 24 * 30);
    const points = await getSensorHistory(decodeURIComponent(req.params.deviceId), hours);
    res.json({ deviceId: req.params.deviceId, hours, points });
});

router.post('/api/zigbee/install-code', async (req, res) => {
    const { code } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'code requis' });
    try {
        await zigbeeService.addInstallCode(code.trim());
        res.json({ ok: true });
    } catch (err) {
        res.status(503).json({ error: err.message });
    }
});

// --- Journal ---

router.get('/api/journal', (req, res) => {
    res.json({
        entries: journal.list({
            limit: Math.min(Number(req.query.limit) || 50, 500),
            kind: req.query.kind || undefined,
            since: req.query.since ? Number(req.query.since) : undefined,
        }),
    });
});

// Nouvelles entrées en direct (SSE)
router.get('/api/journal/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (entry) => res.write(`data: ${JSON.stringify(entry)}

`);
    journal.emitter.on('entry', send);
    req.on('close', () => journal.emitter.off('entry', send));
});

// --- Météo extérieure ---

router.get('/api/weather', async (_req, res) => {
    const weather = await getOutdoorWeather();
    if (!weather) return res.status(503).json({ error: 'Météo indisponible' });
    res.json(weather);
});

// --- Home Assistant ---

router.get('/api/ha/status', async (_req, res) => {
    res.json({ ...(await haService.getStatus()), zigbee: zigbeeService.isRunning() });
});

router.get('/api/ha/states', async (req, res) => {
    try {
        res.json(await haService.getStates(req.query.domain));
    } catch (err) {
        res.status(503).json({ error: err.message });
    }
});
