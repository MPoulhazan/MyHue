/**
 * Client Groq partagé (agent conversationnel, rédaction des messages du compagnon).
 */
import 'dotenv/config';
import axios from 'axios';

export const GROQ_API_KEY = process.env.GROQ_API_KEY;
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

export const groqClient = axios.create({
    baseURL: 'https://api.groq.com/openai/v1',
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    timeout: 30000,
});

const REWRITE_PROMPT = `Tu es le compagnon de la maison MyHue. Tu écris une notification Telegram à l'habitant.
Règles :
- Français naturel, tutoiement, une ou deux phrases courtes, un emoji au début au plus.
- Garde exactement les chiffres fournis, n'invente aucun fait ni aucune cause absente des faits.
- Si une cause probable est fournie, mentionne-la ; sinon pose la question simplement.
- Pas de formule de politesse, pas de signature.`;

/**
 * Reformule un constat en message naturel ; en cas d'échec ou sans clé Groq, renvoie le texte de secours.
 * @param {object} facts  faits structurés (mesures, contexte)
 * @param {string} fallback  message déterministe, déjà correct
 */
export const rewrite = async (facts, fallback) => {
    if (!GROQ_API_KEY) return fallback;
    try {
        const { data } = await groqClient.post(
            '/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: REWRITE_PROMPT },
                    {
                        role: 'user',
                        content: `Faits : ${JSON.stringify(facts)}\nBrouillon : ${fallback}\nÉcris la notification.`,
                    },
                ],
                temperature: 0.4,
                max_tokens: 500,
                reasoning_effort: 'low',
                reasoning_format: 'hidden',
            },
            { timeout: 8000 },
        );
        const text = data?.choices?.[0]?.message?.content?.trim();
        return text && text.length < 400 ? text : fallback;
    } catch (err) {
        console.warn('[LLM] Reformulation impossible:', err.response?.status || err.message);
        return fallback;
    }
};
