/**
 * Santé des services dont dépend la maison : pont Hue, Zigbee (zigbee2mqtt), Home Assistant,
 * émetteur infrarouge de la thermopompe. Vérifiés toutes les minutes, Zigbee en direct.
 * Un pont Zigbee arrêté rend tous les capteurs muets, alerte fuite d'eau comprise :
 * au-delà de quelques minutes, journal + Telegram, et de même à son retour.
 */
import { hueClient, hueBaseUrl } from './hue.js';
import * as haService from './haService.js';
import * as zigbeeService from './zigbeeService.js';
import * as broadlinkService from './broadlinkService.js';
import * as journal from './journal.js';
import * as notifier from './notifier.js';

const POLL_MS = 60_000;
// Une coupure plus courte (redémarrage de z2m, reconnexion MQTT) ne mérite pas d'alerte
const ZIGBEE_GRACE_MS = 3 * 60_000;

// id -> { ok, since } : depuis quand le service est dans son état actuel
const status = {};

const record = (id, ok) => {
    if (status[id]?.ok !== ok) status[id] = { ok, since: Date.now() };
};

const checkHue = async () => {
    if (!hueBaseUrl) return;
    try {
        const { data } = await hueClient.get('/config', { timeout: 5000 });
        record('hue', !(Array.isArray(data) && data[0]?.error));
    } catch {
        record('hue', false);
    }
};

const checkHa = async () => {
    if (!haService.isConfigured()) return;
    record('homeassistant', (await haService.getStatus()).connected);
};

const poll = () => {
    checkHue();
    checkHa();
    if (process.env.BROADLINK_IP) record('broadlink', broadlinkService.isConnected());
};

// --- Zigbee : alerte si le pont reste hors ligne ---
let zigbeeTimer = null;
let zigbeeAlerted = false;

const zigbeeOk = () => {
    const { mqtt, bridge } = zigbeeService.getBridgeStatus();
    return mqtt && bridge !== false;
};

const onBridge = () => {
    const ok = zigbeeOk();
    record('zigbee', ok);
    clearTimeout(zigbeeTimer);
    if (!ok && !zigbeeAlerted) {
        zigbeeTimer = setTimeout(() => {
            if (zigbeeOk()) return;
            zigbeeAlerted = true;
            const text = 'Zigbee hors ligne : les capteurs (portes, température, fuite d’eau) ne remontent plus rien. Vérifie la clé USB Zigbee, puis redémarre zigbee2mqtt dans Home Assistant.';
            journal.log({ kind: 'system', title: 'Zigbee hors ligne : capteurs muets', data: { level: 'alert' } });
            notifier.notify({ text: `⚠️ ${text}` });
        }, ZIGBEE_GRACE_MS);
    }
    if (ok && zigbeeAlerted) {
        zigbeeAlerted = false;
        journal.log({ kind: 'system', title: 'Zigbee de retour : les capteurs remontent à nouveau', data: {} });
        notifier.notify({ text: '✅ Zigbee de retour : les capteurs remontent à nouveau.', silent: true });
    }
};

export function start() {
    // Premier passage différé : laisse le temps à la découverte Broadlink
    setTimeout(poll, 15_000);
    setInterval(poll, POLL_MS);
    if (zigbeeService.isConfigured()) {
        zigbeeService.emitter.on('bridge', onBridge);
        // Pas de nouvelle du pont au démarrage : broker injoignable ou z2m jamais lancé
        setTimeout(onBridge, ZIGBEE_GRACE_MS / 3);
    }
}

const LABELS = {
    hue: 'Pont Hue',
    zigbee: 'Capteurs Zigbee',
    homeassistant: 'Home Assistant',
    broadlink: 'Thermopompe (infrarouge)',
};

const HINTS = {
    hue: 'Lumières non pilotables : vérifie que le pont Hue est allumé et sur le réseau.',
    zigbee: 'Capteurs muets : vérifie la clé USB Zigbee, puis redémarre zigbee2mqtt dans Home Assistant.',
    homeassistant: 'Présence et météo indisponibles : Home Assistant ne répond pas.',
    broadlink: 'Commandes de la thermopompe non envoyées : l’émetteur Broadlink ne répond pas.',
};

/** Services configurés et vérifiés au moins une fois, dans un ordre stable. */
export function getHealth() {
    return Object.keys(LABELS)
        .filter((id) => status[id])
        .map((id) => ({
            id,
            label: LABELS[id],
            ok: status[id].ok,
            since: new Date(status[id].since).toISOString(),
            hint: status[id].ok ? null : HINTS[id],
        }));
}
