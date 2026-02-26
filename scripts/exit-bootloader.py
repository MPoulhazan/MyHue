"""
Exit Gecko bootloader on EFR32 (Sonoff Zigbee dongle) if needed.
Returns exit code:
  0 = NCP in EZSP mode (or successfully exited bootloader)
  1 = Failed / error
"""
import serial, time, sys

PORT = sys.argv[1] if len(sys.argv) > 1 else 'COM3'
BAUD = 115200

CANCEL = bytes([0x1a] * 32)
RST    = bytes([0xC0, 0x38, 0xBC, 0x7E])

def open_port():
    return serial.Serial(PORT, BAUD, timeout=1, rtscts=False, dsrdtr=False,
                         xonxoff=False, exclusive=True)

def drain(s, t=0.1):
    time.sleep(t)
    s.reset_input_buffer()

def wait_rstack(s, timeout=2.5):
    buf = b''
    end = time.time() + timeout
    while time.time() < end:
        d = s.read(32)
        if d:
            buf += d
        if b'\xc1' in buf:
            return True
    return False

def exit_bootloader(s):
    """Try to exit Gecko bootloader mode."""
    # Prompt the bootloader menu
    s.write(b'\n')
    time.sleep(0.4)
    banner = s.read(200)
    if b'BL' not in banner and b'Bootloader' not in banner and b'>' not in banner:
        # Not in bootloader, just flush and return
        return True
    print(f'[exit-bootloader] In Gecko Bootloader. Sending run command (2)...', flush=True)
    s.write(b'2')
    time.sleep(2.0)   # Wait for firmware to boot
    drain(s, 0.1)
    return True

try:
    s = open_port()

    # First, send a quick RST to see if NCP already responds
    drain(s, 0.05)
    s.write(CANCEL + RST)
    if wait_rstack(s, 1.5):
        print('[exit-bootloader] NCP in EZSP mode, RSTACK received.', flush=True)
        s.close()
        sys.exit(0)

    # No RSTACK — might be in bootloader, try to exit
    print('[exit-bootloader] No RSTACK, probing bootloader...', flush=True)
    exit_bootloader(s)

    # Try RST again
    drain(s, 0.1)
    s.write(CANCEL + RST)
    if wait_rstack(s, 2.5):
        print('[exit-bootloader] Exited bootloader. RSTACK received.', flush=True)
        s.close()
        sys.exit(0)

    print('[exit-bootloader] Still no RSTACK after bootloader exit attempt.', flush=True)
    s.close()
    sys.exit(1)

except Exception as e:
    print(f'[exit-bootloader] Error: {e}', flush=True)
    sys.exit(1)
