import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AGENT_API_URL = process.env.AGENT_API_URL || 'http://localhost:5174';
const ALLOWED_USER_IDS = process.env.TELEGRAM_ALLOWED_USER_IDS
    ? process.env.TELEGRAM_ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim()))
    : [];

if (!TELEGRAM_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set in .env');
    process.exit(1);
}

if (ALLOWED_USER_IDS.length === 0) {
    console.warn('⚠️  WARNING: No whitelist configured! Anyone can use this bot.');
    console.warn('⚠️  Add TELEGRAM_ALLOWED_USER_IDS to .env for security.');
}

// Middleware pour vérifier l'accès
const checkAccess = (userId, username) => {
    if (ALLOWED_USER_IDS.length === 0) {
        // Pas de whitelist = accès ouvert (mais log l'ID pour faciliter la config)
        console.log(`📝 User accessing bot: ${username} (ID: ${userId})`);
        return true;
    }

    const isAllowed = ALLOWED_USER_IDS.includes(userId);
    if (!isAllowed) {
        console.log(`🚫 Unauthorized access attempt: ${username} (ID: ${userId})`);
    }
    return isAllowed;
};

// Stockage de l'historique des conversations par utilisateur
const userHistories = new Map();

// Créer le bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('🤖 Telegram bot started!');

// Commande /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    const firstName = msg.from?.first_name || 'ami';

    // Vérifier l'accès
    if (!checkAccess(userId, username)) {
        bot.sendMessage(
            chatId,
            '🚫 Accès refusé.\n\n' +
            `Votre ID Telegram : ${userId}\n\n` +
            'Contactez l\'administrateur du bot pour obtenir l\'accès.'
        );
        return;
    }

    userHistories.set(chatId, []);

    bot.sendMessage(
        chatId,
        `👋 Salut ${firstName} !\n\n` +
        `Je suis ton assistant MyHue. Je peux contrôler tes lampes Philips Hue via l'IA.\n\n` +
        `Essaie par exemple :\n` +
        `• "Éteins toutes les lampes"\n` +
        `• "Allume la lampe du salon"\n` +
        `• "Crée une ambiance chaude"\n` +
        `• "Quelles lampes sont allumées ?"\n\n` +
        `Envoie-moi simplement ton message ! ✨`
    );
});

// Commande /reset
bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';

    if (!checkAccess(userId, username)) {
        bot.sendMessage(chatId, '🚫 Accès refusé.');
        return;
    }

    userHistories.set(chatId, []);
    bot.sendMessage(chatId, '🔄 Conversation réinitialisée !');
});

// Commande /status
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';

    if (!checkAccess(userId, username)) {
        bot.sendMessage(chatId, '🚫 Accès refusé.');
        return;
    }

    try {
        const response = await axios.get(`${AGENT_API_URL}/api/agent/status`);
        const status = response.data;

        let statusText = '📊 Statut du système :\n\n';
        statusText += `✅ Agent : ${status.ok ? 'En ligne' : 'Hors ligne'}\n`;
        statusText += `${status.hueConfigured ? '✅' : '❌'} Hue : ${status.hueConfigured ? 'Configuré' : 'Non configuré'}\n`;
        statusText += `${status.groqConfigured ? '✅' : '❌'} Groq : ${status.groqConfigured ? 'Configuré' : 'Non configuré'}\n`;
        statusText += `🤖 Modèle : ${status.model}`;

        bot.sendMessage(chatId, statusText);
    } catch (error) {
        bot.sendMessage(
            chatId,
            '❌ Impossible de se connecter au serveur agent.\n' +
            'Assure-toi que le serveur tourne sur ' + AGENT_API_URL
        );
    }
});

// Commande /rules
bot.onText(/\/rules/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';

    if (!checkAccess(userId, username)) {
        bot.sendMessage(chatId, '🚫 Accès refusé.');
        return;
    }

    try {
        const response = await axios.get(`${AGENT_API_URL}/api/rules`);
        const rules = response.data;

        if (rules.length === 0) {
            bot.sendMessage(chatId, '📋 Aucune règle de notification active.\n\nDis-moi par exemple : "Préviens-moi si la température dépasse 25°C"');
            return;
        }

        let text = `📋 Règles de notification (${rules.length})\n\n`;
        rules.forEach((rule, i) => {
            const status = rule.enabled ? '✅' : '⏸️';
            const triggers = rule.triggerCount > 0 ? ` (${rule.triggerCount}x)` : '';
            text += `${status} ${i + 1}. ${rule.name}${triggers}\n`;
            text += `   ${rule.sensorName} — ${rule.condition.property} ${rule.condition.operator} ${rule.condition.value ?? ''}\n`;
            text += `   ${rule.message}\n\n`;
        });
        text += `Pour supprimer : /delrule <numéro>`;

        bot.sendMessage(chatId, text);
    } catch (error) {
        bot.sendMessage(chatId, '❌ Erreur lors de la récupération des règles.');
    }
});

// Commande /delrule
bot.onText(/\/delrule\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';

    if (!checkAccess(userId, username)) {
        bot.sendMessage(chatId, '🚫 Accès refusé.');
        return;
    }

    const arg = match[1].trim();

    try {
        const response = await axios.get(`${AGENT_API_URL}/api/rules`);
        const rules = response.data;

        let ruleId;
        const num = parseInt(arg);
        if (!isNaN(num) && num >= 1 && num <= rules.length) {
            ruleId = rules[num - 1].id;
        } else {
            const found = rules.find(r => r.id.startsWith(arg));
            ruleId = found?.id;
        }

        if (!ruleId) {
            bot.sendMessage(chatId, `❌ Règle "${arg}" non trouvée. Utilise /rules pour voir la liste.`);
            return;
        }

        await axios.delete(`${AGENT_API_URL}/api/rules/${ruleId}`);
        bot.sendMessage(chatId, '✅ Règle supprimée !');
    } catch (error) {
        bot.sendMessage(chatId, '❌ Erreur lors de la suppression.');
    }
});

// Gérer tous les messages texte
bot.on('message', async (msg) => {
    // Ignorer les commandes (elles sont gérées séparément)
    if (msg.text && msg.text.startsWith('/')) {
        return;
    }

    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    const text = msg.text;

    // Vérifier l'accès
    if (!checkAccess(userId, username)) {
        bot.sendMessage(
            chatId,
            '🚫 Accès refusé.\n\n' +
            `Votre ID : ${userId}\n\n` +
            'Contactez l\'administrateur pour obtenir l\'accès.'
        );
        return;
    }

    if (!text) {
        return;
    }

    // Récupérer l'historique de l'utilisateur
    let history = userHistories.get(chatId) || [];

    // Envoyer l'indicateur de frappe
    bot.sendChatAction(chatId, 'typing');

    try {
        // Appeler l'API de l'agent
        const response = await axios.post(
            `${AGENT_API_URL}/api/agent`,
            {
                message: text,
                history: history,
            },
            { timeout: 30000 }
        );

        const agentResponse = response.data;

        if (agentResponse.error) {
            bot.sendMessage(chatId, `❌ Erreur : ${agentResponse.error}`);
            return;
        }

        // Mettre à jour l'historique
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: agentResponse.message });

        // Garder seulement les 10 derniers messages
        if (history.length > 20) {
            history = history.slice(-20);
        }
        userHistories.set(chatId, history);

        // Envoyer la réponse
        bot.sendMessage(chatId, agentResponse.message);

        // Si des actions ont été exécutées, envoyer un résumé
        if (agentResponse.actionResults && agentResponse.actionResults.length > 0) {
            const successCount = agentResponse.actionResults.filter(r => r.status === 'ok').length;
            const errorCount = agentResponse.actionResults.filter(r => r.status === 'error').length;

            if (successCount > 0 || errorCount > 0) {
                let summary = '\n📊 Actions exécutées :\n';
                if (successCount > 0) summary += `✅ ${successCount} réussie(s)\n`;
                if (errorCount > 0) summary += `❌ ${errorCount} échouée(s)`;

                bot.sendMessage(chatId, summary);
            }
        }

    } catch (error) {
        console.error('Error calling agent API:', error.message);

        let errorMessage = '❌ Erreur lors de la communication avec l\'agent.\n\n';

        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            errorMessage += '⏱️ Le délai d\'attente est dépassé. L\'agent met trop de temps à répondre.';
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage += '🔌 Impossible de se connecter au serveur agent.\n' +
                           'Assure-toi qu\'il tourne sur ' + AGENT_API_URL;
        } else {
            errorMessage += error.message || 'Erreur inconnue';
        }

        bot.sendMessage(chatId, errorMessage);
    }
});

// Gérer les erreurs
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
});

console.log('✅ Bot is listening for messages...');
