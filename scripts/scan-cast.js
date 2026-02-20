import axios from 'axios';
import os from 'os';

// Get local network range from network interfaces
const getLocalSubnet = () => {
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal && addr.address.startsWith('192.168.')) {
                const parts = addr.address.split('.');
                return `${parts[0]}.${parts[1]}.${parts[2]}`;
            }
        }
    }
    return null;
};

const subnet = getLocalSubnet();
if (!subnet) {
    console.error('❌ Impossible de déterminer le sous-réseau local (192.168.x.x)');
    process.exit(1);
}

console.log(`🔍 Scan du réseau ${subnet}.0/24 pour trouver les appareils Google Cast...\n`);
console.log('Cela prend environ 10-15 secondes...\n');

const foundDevices = [];

const checkHost = async (ip) => {
    try {
        const { data } = await axios.get(`http://${ip}:8008/setup/eureka_info`, {
            timeout: 1500,
            params: { params: 'name,detail(locale,timezone),net(wifi)' },
        });
        return { ip, info: data };
    } catch {
        return null;
    }
};

// Scan in batches to avoid overwhelming the network
const BATCH_SIZE = 30;
for (let start = 1; start <= 254; start += BATCH_SIZE) {
    const promises = [];
    for (let i = start; i < Math.min(start + BATCH_SIZE, 255); i++) {
        promises.push(checkHost(`${subnet}.${i}`));
    }
    const results = await Promise.all(promises);
    for (const result of results) {
        if (result) {
            foundDevices.push(result);
            console.log(`📱 Trouvé: ${result.info.name} (${result.ip})`);
        }
    }
}

console.log('\n' + '═'.repeat(60));

if (foundDevices.length === 0) {
    console.log('\n⚠️  Aucun appareil Google Cast/Nest trouvé sur le réseau.');
    console.log('Vérifie que tes appareils sont allumés et sur le même réseau WiFi.\n');
} else {
    console.log(`\n✅ ${foundDevices.length} appareil(s) trouvé(s):\n`);

    for (const { ip, info } of foundDevices) {
        console.log(`  📱 ${info.name}`);
        console.log(`     IP: ${ip}`);
        if (info.detail) {
            console.log(`     Locale: ${info.detail.locale?.display_string || 'N/A'}`);
            console.log(`     Timezone: ${info.detail.timezone || 'N/A'}`);
        }
        if (info.net?.wifi) {
            console.log(`     WiFi: ${info.net.wifi.ssid || 'N/A'}`);
        }
        console.log('');
    }

    const castDevicesLine = foundDevices.map(d => `${d.info.name}:${d.ip}`).join(',');
    console.log('─'.repeat(60));
    console.log('\n📋 Ajoute cette ligne dans ton .env:\n');
    console.log(`CAST_DEVICES=${castDevicesLine}\n`);
}

process.exit(0);
