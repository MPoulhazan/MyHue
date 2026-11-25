/**
 * Présence par le Wi-Fi : les téléphones connectés au réseau de la maison.
 *
 * Découverte toutes les 5 min : un petit paquet UDP vers chaque adresse du /24 remplit la table
 * ARP, lue dans /proc/net/arp ; le nom vient de la box (DNS inverse, « Pixel-7.ht.home »).
 * Toutes les minutes, chaque téléphone est interrogé par arping : la puce Wi-Fi répond même
 * quand le téléphone dort, là où le ping ICMP se tait. Aucune appli sur les téléphones.
 */
import { execFile } from 'child_process';
import dgram from 'dgram';
import { promises as dnsp } from 'dns';
import os from 'os';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { parseArp, isPhone, isPrivateMac, phonesSayHome, RECENT_MS } from './wifiPresenceLogic.js';

const FILE = dataFile('wifi-presence.json');
const CHECK_MS = 60_000;
const DISCOVER_MS = 5 * 60_000;

// mac -> { mac, ip, name, firstSeen, lastSeen }
let devices = new Map();
let choices = {}; // mac -> true (téléphone) | false (pas un téléphone)
let iface = null; // { name, address, subnet }
let lastDiscover = 0;
let available = false; // arping et /proc/net/arp présents (Pi) ; faux sur un PC de dev

const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify({ choices, devices: [...devices.values()] }, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ wifi-presence.json :', err.message);
    }
};

const load = () => {
    try {
        if (!existsSync(FILE)) return;
        const data = JSON.parse(readFileSync(FILE, 'utf8'));
        choices = data.choices || {};
        devices = new Map((data.devices || []).map((d) => [d.mac, d]));
    } catch {
        // fichier abîmé : on repart de zéro
    }
};

const pickInterface = () => {
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family === 'IPv4' && !a.internal && a.netmask === '255.255.255.0' && /^(192\.168|10)\./.test(a.address)) {
                return { name, address: a.address, subnet: a.address.split('.').slice(0, 3).join('.') };
            }
        }
    }
    return null;
};

const run = (cmd, args, timeout) => new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
});

const nameOf = async (ip) => {
    try {
        const r = new dnsp.Resolver({ timeout: 1500, tries: 1 });
        r.setServers([`${iface.subnet}.1`]);
        return (await r.reverse(ip))[0] || null;
    } catch {
        return null;
    }
};

const discover = async () => {
    lastDiscover = Date.now();
    const sock = dgram.createSocket('udp4');
    await Promise.all(Array.from({ length: 254 }, (_, i) => new Promise((resolve) => {
        sock.send(Buffer.from([0]), 9, `${iface.subnet}.${i + 1}`, () => resolve());
    })));
    sock.close();
    await new Promise((r) => setTimeout(r, 2500));
    let arp = '';
    try {
        arp = readFileSync('/proc/net/arp', 'utf8');
    } catch {
        return;
    }
    const now = Date.now();
    for (const { ip, mac } of parseArp(arp)) {
        if (ip === iface.address) continue;
        const known = devices.get(mac);
        const name = known?.ip === ip && known.name ? known.name : await nameOf(ip);
        devices.set(mac, { mac, ip, name: name || known?.name || null, firstSeen: known?.firstSeen || now, lastSeen: known?.lastSeen || now });
    }
    save();
};

/** Les téléphones répondent-ils ? arping, en parallèle. */
const checkPhones = async () => {
    const phones = [...devices.values()].filter((d) => isPhone(d, choices));
    const now = Date.now();
    const answers = await Promise.all(phones.map((d) => run('arping', ['-c', '2', '-w', '3', '-I', iface.name, d.ip], 5000)));
    let changed = false;
    answers.forEach((a, i) => {
        if (a.ok) {
            phones[i].lastSeen = now;
            changed = true;
        }
    });
    if (changed) save();
};

const tick = async () => {
    if (!iface) return;
    try {
        if (Date.now() - lastDiscover > DISCOVER_MS) await discover();
        if (available) await checkPhones();
    } catch (err) {
        console.error('❌ Présence Wi-Fi :', err.message);
    }
};

/** true / false, ou null si la présence Wi-Fi ne sait rien (aucun téléphone, ou pas sur le Pi). */
export const someoneHome = () => (available ? phonesSayHome([...devices.values()], choices, Date.now()) : null);

/** Liste pour l'écran : téléphones d'abord, puis le reste ; les appareils de la maison connus sont écartés. */
export const list = (exclude = new Set()) => {
    const now = Date.now();
    return [...devices.values()]
        .filter((d) => !exclude.has(d.ip))
        .map((d) => ({
            mac: d.mac,
            ip: d.ip,
            name: d.name ? d.name.replace(/\.ht\.home$|\.home$|\.lan$|\.local$/i, '') : null,
            phone: isPhone(d, choices),
            chosen: choices[d.mac] !== undefined,
            privateMac: isPrivateMac(d.mac),
            lastSeen: d.lastSeen,
            here: now - d.lastSeen < RECENT_MS,
        }))
        .sort((a, b) => Number(b.phone) - Number(a.phone) || Number(b.privateMac) - Number(a.privateMac) || (a.name || 'zz').localeCompare(b.name || 'zz'));
};

export const setPhone = (mac, phone) => {
    const m = String(mac || '').toLowerCase();
    if (!devices.has(m)) throw new Error('Appareil inconnu');
    choices[m] = phone === true;
    save();
    return list();
};

export const status = () => ({ available, someoneHome: someoneHome(), phones: [...devices.values()].filter((d) => isPhone(d, choices)).length });

export const start = async () => {
    load();
    iface = pickInterface();
    if (!iface) return console.log('📶 Présence Wi-Fi : pas de réseau local');
    available = existsSync('/proc/net/arp') && (await run('sh', ['-c', 'command -v arping'], 3000)).ok;
    console.log(`📶 Présence Wi-Fi : ${available ? `active sur ${iface.name} (${iface.subnet}.0/24)` : 'indisponible ici (pas d’arping)'}`);
    if (!available) return;
    await tick();
    setInterval(tick, CHECK_MS);
};
