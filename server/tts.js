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

/** mp3 d'une phrase, pour la lire dans le navigateur. */
export const synthesize = async (text) => {
    const message = String(text || '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 1000);
    if (!message) throw new Error('Texte vide');
    if (audioCache.has(message)) return audioCache.get(message);
    const engine = await ttsEngine();
    const audio = await haService.ttsAudio(engine, message, ttsLanguage(engine));
    audioCache.set(message, audio);
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
