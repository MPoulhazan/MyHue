/**
 * Chauffage quand la maison se vide (règles dans heatingAwayLogic.js) : −2° au départ,
 * 17° après 2 h, consigne d'avant au retour. Ne fait rien quand le thermostat intelligent
 * pilote (il gère l'absence lui-même) ni quand l'état de la thermopompe est douteux.
 * État : data/heating-away.json (survit à un redémarrage pendant l'absence).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataFile } from './dataDir.js';
import { bus } from './events.js';
import * as presence from './presence.js';
import * as broadlinkService from './broadlinkService.js';
import * as thermostat from './thermostat.js';
import * as flexd from './flexd.js';
import * as journal from './journal.js';
import { currentOutdoorTemp } from './outdoor.js';
import { decide, DEFAULTS } from './heatingAwayLogic.js';

const FILE = dataFile('heating-away.json');
const TICK_MS = 5 * 60_000;

let data = { cfg: { ...DEFAULTS }, st: null };
try {
    if (existsSync(FILE)) {
        const saved = JSON.parse(readFileSync(FILE, 'utf8'));
        data = { cfg: { ...DEFAULTS, ...saved.cfg }, st: saved.st || null };
    }
} catch (err) {
    console.error('❌ heating-away.json illisible:', err.message);
}
const save = () => {
    try {
        writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Sauvegarde heating-away impossible:', err.message);
    }
};

const run = async () => {
    if (thermostat.isEnabled()) {
        if (data.st) {
            data.st = null;
            save();
        }
        return;
    }
    if (broadlinkService.isUncertain()) return;
    const home = presence.anyoneHome();
    let outdoor = null;
    if (home === false) outdoor = await currentOutdoorTemp().catch(() => null);
    const d = decide({ st: data.st, heating: broadlinkService.getState(), home, now: Date.now(), outdoor, cfg: data.cfg, flex: flexd.current() });
    if (!d) return;
    let patch = d.patch;
    if (patch && home === true) {
        // Retour pendant une pointe Flex D : on remet la consigne d'avant décalée, et Flex D la remettra à la fin
        const delta = flexd.deltaNow();
        if (delta) {
            patch = { temperature: Math.max(16, Math.min(31, patch.temperature + delta)) };
            flexd.handOver(d.patch.temperature, patch.temperature);
        }
    }
    if (patch) await broadlinkService.applyPatch(patch, 'absence');
    if (d.log) journal.log({ kind: 'heating', title: d.log, data: {} });
    data.st = d.st;
    save();
};

let running = false;
const safeRun = async () => {
    if (running) return;
    running = true;
    try {
        await run();
    } catch (err) {
        console.error('❌ Chauffage absence:', err.message);
    } finally {
        running = false;
    }
};

export const getStatus = () => ({ ...data.cfg, state: data.st });

export const start = () => {
    bus.on('presence', () => setTimeout(safeRun, 3000)); // après « Je pars » / « Je rentre »
    setInterval(safeRun, TICK_MS).unref?.();
    setTimeout(safeRun, 20_000);
    console.log(`🌡️  Chauffage absence : ${data.cfg.enabled ? `−${data.cfg.firstDrop}° puis ${data.cfg.awayTarget}° après ${data.cfg.deepAfterMin / 60} h` : 'désactivé'}`);
};
