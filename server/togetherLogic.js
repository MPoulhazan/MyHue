/**
 * Logique pure de « À deux » (testée dans togetherLogic.test.js) : commandes vocales
 * de la liste d'épicerie et des petits mots, choix du mot à lire au retour.
 */

const WAKE = /^\s*(?:ok\s+|hey\s+)?jean[- ]?claude[\s,:]*/i;
const LIST = String.raw`(?:la\s+|l['’]\s*)?(?:liste(?:\s+d['’]\s*[ée]picerie|\s+de\s+courses|\s+des\s+courses)?|[ée]picerie|courses)`;
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** « du lait, des œufs et du pain » → ['lait', 'œufs', 'pain'] */
export const splitItems = (text) =>
    text
        .split(/\s*(?:,|\bet\b|\bpuis\b)\s*/i)
        .map((s) => s.replace(/^(?:du|de la|de l['’]|des|de|d['’]|un|une|le|la|les|l['’])\s*/i, '').replace(/[.!?]+$/, '').trim())
        .filter((s) => s.length > 0 && s.length <= 60);

/**
 * Comprend une phrase sur la liste ou les mots.
 * @param people [{ id, name }]
 * @returns {null | {action:'add', items} | {action:'list'} | {action:'remove', item} | {action:'clear'} | {action:'note', to, text} | {action:'read'}}
 */
export const parseTogether = (raw, people = []) => {
    const text = String(raw || '').replace(WAKE, '').trim();
    let m = text.match(new RegExp(String.raw`^(?:ajoute|rajoute|mets|note)\s+(.+?)\s+(?:à|a|sur|dans)\s+${LIST}\s*[.!]?$`, 'i'));
    if (m) {
        const items = splitItems(m[1]);
        return items.length ? { action: 'add', items } : null;
    }
    m = text.match(new RegExp(String.raw`^(?:enl[eè]ve|retire|supprime|barre)\s+(.+?)\s+(?:de|du|sur)\s+${LIST}\s*[.!]?$`, 'i'));
    if (m) return { action: 'remove', item: splitItems(m[1])[0] || m[1] };
    if (new RegExp(String.raw`^(?:vide|efface)\s+${LIST}`, 'i').test(text)) return { action: 'clear' };
    if (new RegExp(String.raw`(?:qu['’]est[- ]ce qu['’]il (?:y a|reste)|c['’]est quoi|lis(?:-moi)?|donne(?:-moi)?)\s+(?:sur\s+|dans\s+)?${LIST}`, 'i').test(text)) return { action: 'list' };

    m = text.match(/^(?:dis|laisse(?:\s+un\s+(?:mot|message))?|[ée]cris(?:\s+un\s+mot)?)\s+(?:à|a)\s+([\p{L}-]+)\s*(?:que\s+|:\s*|,\s*)(.+)$/iu);
    if (m) {
        const to = people.find((p) => normalize(p.name) === normalize(m[1]));
        if (to) return { action: 'note', to: to.id, text: m[2].replace(/[.]+$/, '').trim() };
    }
    if (/\b(?:j['’]ai (?:un|des) (?:mot|message)s?|il y a (?:un|des) (?:mot|message)s? pour moi|lis(?:-moi)? (?:mes|le|les) (?:mots?|messages?))\b/i.test(text)) return { action: 'read' };
    return null;
};

/** « lait, œufs et pain » pour la voix. */
export const sayList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);

/**
 * Mot à lire quand la porte d'entrée s'ouvre : non lu, pas encore annoncé, laissé depuis au moins
 * 10 minutes (sinon c'est son auteur qui sort), entre 7 h et 22 h.
 */
export const noteToAnnounce = (notes, now, localHour) => {
    if (localHour < 7 || localHour >= 22) return null;
    return notes.filter((n) => !n.readAt && !n.announcedAt && now - n.at >= 10 * 60_000).sort((a, b) => a.at - b.at)[0] || null;
};
