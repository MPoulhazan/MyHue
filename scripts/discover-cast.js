import mdns from 'mdns-js';

console.log('🔍 Recherche des appareils Google Cast sur votre réseau...\n');
console.log('Appuyez sur Ctrl+C pour arrêter la recherche.\n');

const browser = mdns.createBrowser(mdns.tcp('googlecast'));

const foundDevices = new Set();

browser.on('ready', () => {
    browser.discover();
});

browser.on('update', (device) => {
    if (device.type && device.type.includes('googlecast')) {
        const addresses = device.addresses || [];
        const ipv4 = addresses.find(addr => addr.includes('.'));

        if (ipv4 && !foundDevices.has(ipv4)) {
            foundDevices.add(ipv4);

            const name = device.fullname || device.txt?.fn || 'Unknown Device';
            const id = device.txt?.id || 'N/A';

            console.log('📱 Appareil trouvé:');
            console.log(`   Nom: ${name}`);
            console.log(`   IP: ${ipv4}`);
            console.log(`   ID: ${id}`);
            console.log(`   Port: ${device.port || 8009}`);
            console.log('');
            console.log(`   Pour ajouter cet appareil manuellement, ajoutez cette ligne dans .env:`);
            console.log(`   CAST_DEVICES=${name}:${ipv4}`);
            console.log('');
            console.log('   Si vous avez plusieurs appareils, séparez-les par des virgules:');
            console.log(`   CAST_DEVICES=${name}:${ipv4},Autre Appareil:192.168.x.y`);
            console.log('\n' + '─'.repeat(60) + '\n');
        }
    }
});

browser.on('error', (error) => {
    console.error('❌ Erreur de découverte:', error.message);
});

// Arrêter après 30 secondes
setTimeout(() => {
    console.log('\n🏁 Recherche terminée.');
    if (foundDevices.size === 0) {
        console.log('\n⚠️  Aucun appareil trouvé.');
        console.log('\nSi vous connaissez l\'adresse IP de votre appareil Google Cast,');
        console.log('vous pouvez l\'ajouter manuellement dans le fichier .env:');
        console.log('\nCAST_DEVICES=Nom de l\'appareil:192.168.x.y\n');
    } else {
        console.log(`\n✅ ${foundDevices.size} appareil(s) trouvé(s)!\n`);
    }
    process.exit(0);
}, 30000);
