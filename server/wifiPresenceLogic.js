/**
 * Présence par le Wi-Fi (logique pure, testée) : au moins un téléphone vu sur le réseau
 * dans les 15 dernières minutes = au moins une personne à la maison, sans savoir laquelle.
 */

// Un téléphone en veille peut lâcher le Wi-Fi quelques minutes : c'est aussi le délai avant « parti »
export const RECENT_MS = 15 * 60_000;

/** /proc/net/arp → [{ ip, mac }] (entrées complètes seulement). */
export const parseArp = (text) =>
    String(text || '')
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((c) => c.length >= 4 && c[2] === '0x2' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(c[3]) && c[3] !== '00:00:00:00:00:00')
        .map((c) => ({ ip: c[0], mac: c[3].toLowerCase() }));

/** Adresse MAC « privée » (aléatoire), celle que prennent les téléphones récents. */
export const isPrivateMac = (mac) => /^[0-9a-f]([26ae])/i.test(mac || '');

/** Le nom donné par la box ressemble-t-il à un téléphone ? (les tablettes et ordinateurs non) */
export const looksLikePhone = (name) => {
    const n = String(name || '').toLowerCase();
    if (!n || /tab|ipad|laptop|desktop|pc-|macbook|tv|chromecast|nest|hub|light|yeelink|rmmini|hue|printer/.test(n)) return false;
    return /pixel|iphone|galaxy|android|phone|oneplus|xiaomi|redmi|motorola|moto-|huawei|honor|oppo|samsung/.test(n);
};

/**
 * Téléphones retenus : choix explicite de l'utilisateur, sinon devinés d'après le nom.
 * choices : { [mac]: true | false }
 */
export const isPhone = (device, choices = {}) =>
    choices[device.mac] !== undefined ? choices[device.mac] === true : looksLikePhone(device.name);

/** Quelqu'un à la maison ? true / false, ou null tant qu'aucun téléphone n'est connu. */
export const phonesSayHome = (devices, choices, now) => {
    const phones = devices.filter((d) => isPhone(d, choices));
    if (!phones.length) return null;
    return phones.some((d) => now - d.lastSeen < RECENT_MS);
};
