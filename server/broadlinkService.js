import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const STATE_FILE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'data', 'heating-state.json');

let device = null;
let broadlink = null;

const DEFAULT_STATE = {
    power: false,
    mode: 'heat',
    temperature: 22,
    fanSpeed: 'auto',
    vaneVertical: 'auto',
    lastUpdated: null,
};

// --- State persistence ---

const loadState = () => {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        }
    } catch (err) {
        console.error('❌ Failed to load heating state:', err.message);
    }
    return { ...DEFAULT_STATE };
};

const saveState = (state) => {
    try {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
        console.error('❌ Failed to save heating state:', err.message);
    }
};

let currentState = loadState();

// --- Mitsubishi Electric IR Protocol Encoder ---
// Based on reverse engineering docs: https://www.analysir.com/blog/2015/01/06/reverse-engineering-mitsubishi-ac-infrared-protocol/
// and IRremoteESP8266 ir_Mitsubishi.cpp

const MODE_MAP = {
    heat: 0x08,
    dry: 0x10,
    cool: 0x18,
    fan: 0x38,
    auto: 0x20,
};

const FAN_MAP = {
    auto: 0x00,
    quiet: 0x01,
    low: 0x02,
    med: 0x03,
    high: 0x05,
};

const VANE_MAP = {
    auto: 0x00,
    '1': 0x01,
    '2': 0x02,
    '3': 0x03,
    '4': 0x04,
    '5': 0x05,
    swing: 0x07,
};

const buildMitsubishiPayload = (state) => {
    const bytes = new Uint8Array(18);

    // Header (fixed for Mitsubishi Electric)
    bytes[0] = 0x23;
    bytes[1] = 0xCB;
    bytes[2] = 0x26;
    bytes[3] = 0x01;
    bytes[4] = 0x00;

    // Byte 5: Power + Mode
    const power = state.power ? 0x20 : 0x00;
    bytes[5] = power | (MODE_MAP[state.mode] || MODE_MAP.heat);

    // Byte 6: not used in basic commands
    bytes[6] = 0x00;

    // Byte 7: Temperature (16-31°C mapped to 0x00-0x0F)
    const temp = Math.max(16, Math.min(31, state.temperature));
    bytes[7] = temp - 16;

    // Byte 8: Mode setting (same as byte 5 mode bits for some models)
    bytes[8] = MODE_MAP[state.mode] || MODE_MAP.heat;

    // Byte 9: Fan speed
    bytes[9] = (FAN_MAP[state.fanSpeed] || FAN_MAP.auto) << 3;

    // Byte 10: Vane vertical
    bytes[10] = VANE_MAP[state.vaneVertical] || VANE_MAP.auto;

    // Bytes 11-16: Not used (timers, etc.)
    bytes[11] = 0x00;
    bytes[12] = 0x00;
    bytes[13] = 0x00;
    bytes[14] = 0x00;
    bytes[15] = 0x00;
    bytes[16] = 0x00;

    // Byte 17: Checksum (sum of bytes 0-16 mod 256)
    let checksum = 0;
    for (let i = 0; i < 17; i++) {
        checksum += bytes[i];
    }
    bytes[17] = checksum & 0xFF;

    return bytes;
};

// --- Broadlink IR encoding ---
// Convert Mitsubishi IR data to Broadlink's proprietary format
// Broadlink uses timing pairs (mark, space) in units of 269µs (1/38kHz * 269)

const TICK = 269; // µs per Broadlink tick (roughly 1/38kHz period)

// Mitsubishi Electric AC timing (µs)
const HEADER_MARK = 3400;
const HEADER_SPACE = 1750;
const BIT_MARK = 450;
const ONE_SPACE = 1300;
const ZERO_SPACE = 420;
const GAP = 17500; // Gap between the two identical frames

const usToTicks = (us) => Math.round(us / TICK);

const encodeForBroadlink = (irBytes) => {
    // Broadlink packet format:
    // [0x26, 0x00, length_lo, length_hi, ...timing_data, 0x0D, 0x05]
    // Timing data: each value is in ticks of ~269µs (38kHz carrier period)
    // Values > 255 are encoded as: 0x00, hi_byte, lo_byte

    const timings = [];

    // We send the frame twice (as per Mitsubishi protocol)
    for (let frame = 0; frame < 2; frame++) {
        // Header
        timings.push(usToTicks(HEADER_MARK));
        timings.push(usToTicks(HEADER_SPACE));

        // Data bits (LSB first for each byte)
        for (let byteIdx = 0; byteIdx < irBytes.length; byteIdx++) {
            for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
                const bit = (irBytes[byteIdx] >> bitIdx) & 1;
                timings.push(usToTicks(BIT_MARK));
                timings.push(usToTicks(bit ? ONE_SPACE : ZERO_SPACE));
            }
        }

        // Footer mark
        timings.push(usToTicks(BIT_MARK));

        // Gap between frames (only after first frame)
        if (frame === 0) {
            timings.push(usToTicks(GAP));
        }
    }

    // Encode timings into Broadlink byte array
    const encoded = [];
    for (const t of timings) {
        if (t > 255) {
            encoded.push(0x00);
            encoded.push((t >> 8) & 0xFF);
            encoded.push(t & 0xFF);
        } else {
            encoded.push(t);
        }
    }

    // Build final packet
    const len = encoded.length;
    const packet = Buffer.alloc(6 + len);
    packet[0] = 0x26; // IR type
    packet[1] = 0x00; // Repeat: 0
    packet[2] = len & 0xFF;
    packet[3] = (len >> 8) & 0xFF;
    Buffer.from(encoded).copy(packet, 4);
    packet[4 + len] = 0x0D;
    packet[4 + len + 1] = 0x05;

    return packet;
};

// --- Broadlink device communication ---

export const discover = async () => {
    try {
        const BroadlinkJS = (await import('kiwicam-broadlinkjs-rm')).default;
        broadlink = new BroadlinkJS();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Broadlink discovery timed out (10s)'));
            }, 10000);

            broadlink.on('deviceReady', (dev) => {
                clearTimeout(timeout);
                device = dev;

                const ip = process.env.BROADLINK_IP;
                // If IP is specified, only accept that device
                if (ip && dev.host?.address !== ip) {
                    return; // Skip, wait for the right one
                }

                console.log(`🔌 Broadlink RM4 Mini discovered at ${dev.host?.address}`);
                resolve(dev);
            });

            broadlink.discover();
        });
    } catch (err) {
        console.error('❌ Broadlink discovery failed:', err.message);
        throw err;
    }
};

export const isConnected = () => device !== null;

export const getState = () => ({ ...currentState });

export const getStatus = () => ({
    connected: isConnected(),
    deviceIp: device?.host?.address || null,
    state: { ...currentState },
});

export const sendCommand = async (newState) => {
    if (!device) {
        throw new Error('Broadlink device not connected. Run discovery first.');
    }

    // Build IR payload
    const irBytes = buildMitsubishiPayload(newState);
    const broadlinkPacket = encodeForBroadlink(irBytes);

    // Send via Broadlink
    return new Promise((resolve, reject) => {
        device.sendData(broadlinkPacket, false, (err) => {
            if (err) {
                console.error('❌ Failed to send IR command:', err.message);
                reject(err);
                return;
            }

            // Update persisted state
            currentState = {
                ...newState,
                lastUpdated: new Date().toISOString(),
            };
            saveState(currentState);

            console.log(`🔥 Heating command sent: power=${newState.power}, mode=${newState.mode}, temp=${newState.temperature}°C, fan=${newState.fanSpeed}`);
            resolve(currentState);
        });
    });
};

// For testing without a Broadlink device
export const sendCommandDryRun = (newState) => {
    currentState = {
        ...newState,
        lastUpdated: new Date().toISOString(),
    };
    saveState(currentState);
    console.log(`🔥 [DRY RUN] Heating command: power=${newState.power}, mode=${newState.mode}, temp=${newState.temperature}°C, fan=${newState.fanSpeed}`);
    return currentState;
};
