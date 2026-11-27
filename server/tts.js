/**
 * Synthèse vocale par Home Assistant : Piper (add-on local, voix française
 * fr_FR-siwis-medium) en priorité, sinon le premier moteur TTS de HA.
 * Sert aux enceintes (briefing, annonces) et à la tablette (GET /api/tts).
 */
import * as haService from './haService.js';

/** Piper n'accepte que « fr_FR », Google Translate veut « fr ». */
export const ttsLanguage = (engineId) => (/piper/.test(engineId) ? 'fr_FR' : 'fr');

let engineCache = null;

/** Moteur à utiliser ; BRIEFING_TTS force une entité précise. */
export const ttsEngine = async () => {
    if (process.env.BRIEFING_TTS) return process.env.BRIEFING_TTS;
    if (engineCache && Date.now() - engineCache.at < 10 * 60_000) return engineCache.id;
    const engines = (await haService.getStates('tts')).map((s) => s.entity_id);
    if (!engines.length) throw new Error('Aucun moteur de synthèse vocale dans Home Assistant');
    const id = engines.find((e) => /piper/.test(e)) || engines[0];
    engineCache = { id, at: Date.now() };
    return id;
};

// Les réponses courantes (« C'est fait. ») reviennent souvent : petit cache en mémoire
const audioCache = new Map();
const CACHE_MAX = 60;

/**
 * mp3 d'une phrase, pour la lire dans le navigateur.
 * voice : une autre voix Piper (Cooper parle avec fr_FR-tom-medium) ; si elle échoue, voix par défaut.
 */
export const synthesize = async (text, { voice = null } = {}) => {
    const message = String(text || '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 1000);
    if (!message) throw new Error('Texte vide');
    const key = voice ? `${voice}|${message}` : message;
    if (audioCache.has(key)) return audioCache.get(key);
    const engine = await ttsEngine();
    const lang = ttsLanguage(engine);
    const audio = voice && /piper/.test(engine)
        ? await haService.ttsAudio(engine, message, lang, { voice }).catch((err) => {
            console.warn(`⚠️  Voix ${voice} indisponible, voix par défaut :`, err.message);
            return haService.ttsAudio(engine, message, lang);
        })
        : await haService.ttsAudio(engine, message, lang);
    audioCache.set(key, audio);
    if (audioCache.size > CACHE_MAX) audioCache.delete(audioCache.keys().next().value);
    return audio;
};

export function installTtsRoutes(app) {
    app.get('/api/tts', async (req, res) => {
        try {
            const audio = await synthesize(req.query.text);
            res.set('Cache-Control', 'private, max-age=3600').type('audio/mpeg').send(audio);
        } catch (error) {
            res.status(503).json({ error: error.message });
        }
    });
}
