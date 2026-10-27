/**
 * Notifications Telegram avec boutons d'action.
 * Le serveur envoie directement via l'API Bot ; les clics arrivent au processus
 * telegramBot.js (seul à faire du polling), qui les relaie à POST /api/notify/callback.
 */
import 'dotenv/config';
import axios from 'axios';
import { randomBytes } from 'crypto';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
    .split(',')
    .map((id) => parseInt(id.trim()))
    .filter(Boolean);

const BUTTON_TTL_MS = 24 * 60 * 60 * 1000;
// id court -> { buttons: [{ label, run }], at }
const pending = new Map();

const purge = () => {
    const limit = Date.now() - BUTTON_TTL_MS;
    for (const [id, p] of pending) if (p.at < limit) pending.delete(id);
};

export const isConfigured = () => Boolean(TOKEN && USER_IDS.length);

/**
 * @param {object} n
 * @param {string} n.text  message en texte brut
 * @param {{ label: string, run: () => Promise<string> }[]} [n.buttons]
 */
export const notify = async ({ text, buttons = [] }) => {
    if (!isConfigured()) {
        console.warn('⚠️  Notification non envoyée (Telegram non configuré):', text);
        return false;
    }
    purge();
    let reply_markup;
    if (buttons.length) {
        const id = randomBytes(4).toString('hex');
        pending.set(id, { buttons, at: Date.now() });
        reply_markup = {
            inline_keyboard: [buttons.map((b, i) => ({ text: b.label, callback_data: `nb:${id}:${i}` }))],
        };
    }
    let sent = false;
    for (const chat_id of USER_IDS) {
        try {
            await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
                chat_id,
                text,
                reply_markup,
            });
            sent = true;
        } catch (err) {
            console.error(`❌ Telegram vers ${chat_id}:`, err.response?.data?.description || err.message);
        }
    }
    return sent;
};

/** Exécute le bouton cliqué ; renvoie le texte de confirmation à afficher. */
export const handleCallback = async (data) => {
    const m = /^nb:([0-9a-f]+):(\d+)$/.exec(data || '');
    const entry = m && pending.get(m[1]);
    const button = entry?.buttons[Number(m[2])];
    if (!button) return { ok: false, text: 'Bouton expiré.' };
    pending.delete(m[1]); // un seul clic par message
    try {
        return { ok: true, label: button.label, text: await button.run() };
    } catch (err) {
        return { ok: false, text: `Échec : ${err.message}` };
    }
};
