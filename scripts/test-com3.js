/**
 * Diagnostic: Open COM3, send bootloader exit + ASH RST, print raw response
 */
import { SerialPort } from 'serialport';

const PORT = process.env.ZIGBEE_PORT || 'COM3';
const BAUD = 115200;

// ASH RST frame: 32x CANCEL (0x1a) + RST (0xC0) + 0x38 + CRC (0xBC, 0x7E)
const CANCEL = Buffer.alloc(32, 0x1a);
const RST = Buffer.from([0xc0, 0x38, 0xbc, 0x7e]);

console.log(`Opening ${PORT} at ${BAUD} baud...`);

const port = new SerialPort({ path: PORT, baudRate: BAUD, rtscts: false });

let buf = Buffer.alloc(0);
let timer;

port.on('error', (err) => {
    console.error('Serial error:', err.message);
    process.exit(1);
});

port.on('open', () => {
    console.log('Port open. Sending bootloader "2" (run) then RST...');

    // Step 1: send ASCII '2' to exit Gecko bootloader (in case it's in bootloader mode)
    port.write('2', 'ascii');

    // Step 2: after 300ms, send ASH RST
    setTimeout(() => {
        console.log('Sending CANCEL x32 + RST frame...');
        port.write(Buffer.concat([CANCEL, RST]));
        // Wait 3s for response
        timer = setTimeout(() => {
            console.log('\n=== No RSTACK received within 3s ===');
            console.log(`Raw bytes received (hex): ${buf.toString('hex')}`);
            console.log(
                `Raw bytes (ascii):        ${buf.toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`,
            );
            port.close(() => process.exit(1));
        }, 3000);
    }, 300);
});

port.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const hex = buf.toString('hex');

    // RSTACK frame: 1a c1 02 XX XX XX 7e
    if (hex.includes('1ac1') || (buf.includes(0xc1) && buf.length >= 7)) {
        clearTimeout(timer);
        console.log(`\n✅ RSTACK received!`);
        console.log(`Raw hex: ${hex}`);
        // Decode reset code
        const idx = buf.indexOf(0xc1);
        if (idx >= 0 && buf.length > idx + 3) {
            const resetCode = buf[idx + 3];
            const codes = {
                1: 'RESET_POWER_ON',
                9: 'RESET_SOFTWARE',
                11: 'RESET_SOFTWARE',
                2: 'RESET_WATCHDOG',
                3: 'RESET_ASSERT',
                6: 'RESET_BOOTLOADER_SOFTWARE',
            };
            console.log(
                `Reset code: 0x${resetCode.toString(16)} = ${codes[resetCode] || 'unknown'}`,
            );
        }
        port.close(() => process.exit(0));
    }

    // Gecko bootloader menu detection
    const ascii = buf.toString('ascii');
    if (ascii.includes('Gecko Bootloader') || ascii.includes('BL >')) {
        clearTimeout(timer);
        console.log('\n⚠️  NCP is in Gecko BOOTLOADER mode!');
        console.log(
            'Bootloader response:',
            ascii.replace(/[^\x20-\x7E\r\n]/g, '?'),
        );
        port.close(() => process.exit(2));
    }
});
