import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const RULES_FILE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'data', 'rules.json');
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_IDS = process.env.TELEGRAM_ALLOWED_USER_IDS
    ? process.env.TELEGRAM_ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim()))
    : [];

const EVAL_INTERVAL_MS = 30_000; // Evaluate rules every 30 seconds

let rules = [];
let evalInterval = null;
let getSensorsFn = null;

// --- Persistence ---

export const loadRules = () => {
    try {
        if (fs.existsSync(RULES_FILE)) {
            const data = fs.readFileSync(RULES_FILE, 'utf-8');
            rules = JSON.parse(data);
            console.log(`📋 Loaded ${rules.length} notification rule(s)`);
        } else {
            rules = [];
        }
    } catch (err) {
        console.error('❌ Failed to load rules:', err.message);
        rules = [];
    }
};

const saveRules = () => {
    try {
        const dir = path.dirname(RULES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), 'utf-8');
    } catch (err) {
        console.error('❌ Failed to save rules:', err.message);
    }
};

// --- CRUD ---

export const getRules = () => rules;

export const addRule = (ruleData) => {
    const rule = {
        id: randomUUID(),
        name: ruleData.name || 'Règle sans nom',
        sensorDid: ruleData.sensorDid,
        sensorName: ruleData.sensorName || '',
        condition: {
            property: ruleData.property,
            operator: ruleData.operator,
            value: ruleData.value ?? null,
        },
        message: ruleData.message || 'Notification déclenchée',
        cooldownMinutes: ruleData.cooldownMinutes || 30,
        enabled: true,
        createdAt: new Date().toISOString(),
        lastTriggeredAt: null,
        triggerCount: 0,
    };
    rules.push(rule);
    saveRules();
    console.log(`📋 Rule created: "${rule.name}" (${rule.id})`);
    return rule;
};

export const deleteRule = (id) => {
    const index = rules.findIndex(r => r.id === id);
    if (index === -1) return false;
    const removed = rules.splice(index, 1)[0];
    saveRules();
    console.log(`📋 Rule deleted: "${removed.name}" (${id})`);
    return true;
};

export const toggleRule = (id) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return null;
    rule.enabled = !rule.enabled;
    saveRules();
    console.log(`📋 Rule ${rule.enabled ? 'enabled' : 'disabled'}: "${rule.name}"`);
    return rule;
};

// --- Condition evaluation ---

const evaluateCondition = (value, operator, threshold) => {
    switch (operator) {
        case 'gt': return value > threshold;
        case 'lt': return value < threshold;
        case 'gte': return value >= threshold;
        case 'lte': return value <= threshold;
        case 'eq': return value === threshold;
        case 'neq': return value !== threshold;
        case 'is_true': return value === true;
        case 'is_false': return value === false;
        default: return false;
    }
};

const isCooldownExpired = (rule) => {
    if (!rule.lastTriggeredAt) return true;
    const elapsed = Date.now() - new Date(rule.lastTriggeredAt).getTime();
    return elapsed >= rule.cooldownMinutes * 60 * 1000;
};

// --- Telegram notification ---

const sendTelegramNotification = async (message) => {
    if (!TELEGRAM_TOKEN || ALLOWED_USER_IDS.length === 0) {
        console.warn('⚠️  Cannot send Telegram notification: missing token or user IDs');
        return;
    }

    const text = `🔔 *Notification MyHue*\n\n${message}`;

    for (const userId of ALLOWED_USER_IDS) {
        try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                chat_id: userId,
                text,
                parse_mode: 'Markdown',
            });
        } catch (err) {
            console.error(`❌ Failed to send Telegram to ${userId}:`, err.message);
        }
    }
};

// --- Rule evaluation loop ---

const evaluateRules = async () => {
    if (!getSensorsFn) return;

    const enabledRules = rules.filter(r => r.enabled);
    if (enabledRules.length === 0) return;

    let sensors;
    try {
        sensors = await getSensorsFn();
    } catch (err) {
        console.error('❌ Rules engine: failed to get sensors:', err.message);
        return;
    }

    for (const rule of enabledRules) {
        try {
            const sensor = sensors.find(s => s.did === rule.sensorDid);
            if (!sensor) continue;

            const propValue = sensor.props?.[rule.condition.property];
            if (propValue === undefined) continue;

            const triggered = evaluateCondition(propValue, rule.condition.operator, rule.condition.value);

            if (triggered && isCooldownExpired(rule)) {
                console.log(`🔔 Rule triggered: "${rule.name}" (${rule.condition.property} ${rule.condition.operator} ${rule.condition.value ?? ''} → ${propValue})`);
                await sendTelegramNotification(rule.message);
                rule.lastTriggeredAt = new Date().toISOString();
                rule.triggerCount++;
                saveRules();
            }
        } catch (err) {
            console.error(`❌ Error evaluating rule "${rule.name}":`, err.message);
        }
    }
};

// --- Engine lifecycle ---

export const startEngine = (getSensors) => {
    getSensorsFn = getSensors;
    loadRules();

    if (evalInterval) clearInterval(evalInterval);
    evalInterval = setInterval(evaluateRules, EVAL_INTERVAL_MS);

    // Run first evaluation after 5 seconds (let sensors initialize)
    setTimeout(evaluateRules, 5000);

    console.log(`🔔 Rules engine started (eval every ${EVAL_INTERVAL_MS / 1000}s)`);
};

export const stopEngine = () => {
    if (evalInterval) {
        clearInterval(evalInterval);
        evalInterval = null;
    }
    console.log('🔔 Rules engine stopped');
};
