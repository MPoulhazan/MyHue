/**
 * « Trouve-moi autre chose » : une nouvelle recherche d'idées de sortie, lancée depuis la tablette
 * (lot 5 de « Sortie à deux v2 »).
 *
 * 1. La tâche Claude du mercredi, déclenchée par son adresse /fire (déclencheur « API » ajouté sur
 *    claude.ai/code/routines, jeton dans les options de l'add-on). Elle dépose ses idées par le
 *    connecteur MyHue avec set_outing_ideas(append: true), en 2 à 5 minutes.
 * 2. Sans jeton : Groq, avec sa recherche Web intégrée (outil browser_search de openai/gpt-oss-120b),
 *    en moins d'une minute. (groq/compound n'est pas ouvert sur ce compte : 404.)
 */
import axios from 'axios';
import { GROQ_API_KEY, groqClient } from './llm.js';
import * as myDay from './myDay.js';
import { parseIdeasJson } from './historyLogic.js';

const ROUTINE_URL = (process.env.OUTING_ROUTINE_URL || '').trim();
const ROUTINE_TOKEN = (process.env.OUTING_ROUTINE_TOKEN || '').trim();
const GROQ_SEARCH_MODEL = process.env.GROQ_SEARCH_MODEL || 'openai/gpt-oss-120b';
const MAX_PER_DAY = 6;

let today = { day: null, count: 0 };

/** Par où passerait une recherche : la tâche Claude, Groq, ou rien. */
export const via = () => (ROUTINE_URL && ROUTINE_TOKEN ? 'claude' : GROQ_API_KEY ? 'groq' : null);

const FIRE_TEXT = 'Recherche demandée depuis la tablette (« Trouve-moi autre chose ») : propose 4 idées à deux NOUVELLES, différentes de outings.current, outings.alreadyDone et du style de outings.notOurThing, puis appelle set_outing_ideas avec append: true. Pas d’idées de jour de repos cette fois.';

const fireRoutine = async () => {
    const { data } = await axios.post(ROUTINE_URL, { text: FIRE_TEXT }, {
        timeout: 20_000,
        headers: {
            Authorization: `Bearer ${ROUTINE_TOKEN}`,
            'anthropic-beta': 'experimental-cc-routine-2026-04-01',
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
    });
    return data?.claude_code_session_url || null;
};

const groqPrompt = (ctx) => `Tu cherches sur le Web 4 idées de sortie à deux pour un couple qui vit à Montréal, pour les soirs du mercredi au samedi des 7 prochains jours (aujourd’hui : ${new Date().toLocaleDateString('fr-CA', { timeZone: 'America/Toronto', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}).
Règles : île de Montréal seulement (pas Laval, pas Longueuil). Variété : un événement daté, un resto, une expo ou une activité. Vérifie chaque fait (date, heure, lieu, prix) dans une source, n’invente rien : laisse un champ vide si tu ne sais pas.
À éviter (déjà proposé ou déjà fait) : ${JSON.stringify([...ctx.outings.current, ...ctx.outings.alreadyDone].slice(-40))}
Pas leur genre : ${JSON.stringify(ctx.outings.notOurThing.map((d) => d.title))}
Leurs avis : ${JSON.stringify(ctx.outings.ratings || [])}
Réponds UNIQUEMENT par un tableau JSON de 4 objets avec les champs : kind (event, cinema, concert, museum, resto ou activity), title (court), date (AAAA-MM-JJ si daté), when, where (lieu et quartier), why (une phrase factuelle, sans superlatif), url (la source), price, free, duration, address, lat, lon, indoor.`;

const searchGroq = async () => {
    const { data } = await groqClient.post('/chat/completions', {
        model: GROQ_SEARCH_MODEL,
        messages: [{ role: 'user', content: groqPrompt(myDay.getContextForClaude()) }],
        tools: [{ type: 'browser_search' }],
        tool_choice: 'required',
        temperature: 0.3,
        max_tokens: 4000,
    }, { timeout: 120_000 });
    const ideas = parseIdeasJson(data?.choices?.[0]?.message?.content);
    if (!ideas.length) throw new Error('Pas d’idée trouvée cette fois');
    myDay.setOutings(ideas, { append: true });
    return ideas.length;
};

/** Lance une recherche ; répond tout de suite, les idées arrivent ensuite dans la fiche. */
export const request = async () => {
    const how = via();
    if (!how) throw new Error('Aucun moyen de chercher : ni tâche Claude ni clé Groq');
    if (myDay.searchStatus().running) return { started: false, ...myDay.searchStatus() };
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    if (today.day !== day) today = { day, count: 0 };
    if (today.count >= MAX_PER_DAY) throw new Error('Assez de recherches pour aujourd’hui : réessaie demain');
    today.count += 1;
    myDay.searchStarted(how);
    if (how === 'claude') {
        try {
            await fireRoutine();
        } catch (err) {
            const msg = err.response?.status === 401 ? 'Jeton de la tâche Claude refusé' : `Tâche Claude injoignable (${err.response?.status || err.message})`;
            myDay.searchFailed(msg);
            throw new Error(msg);
        }
    } else {
        searchGroq().catch((err) => {
            console.warn('[Sorties] Recherche Groq :', err.response?.status || err.message);
            myDay.searchFailed(err.response?.status ? `Groq a répondu ${err.response.status}` : err.message);
        });
    }
    return { started: true, ...myDay.searchStatus() };
};
