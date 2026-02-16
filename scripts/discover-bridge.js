import https from 'https';

/**
 * Discover Philips Hue Bridge on the local network
 * This script uses the Hue discovery service to find your bridge
 */

console.log('🔍 Searching for Philips Hue Bridge...\n');

const options = {
  hostname: 'discovery.meethue.com',
  port: 443,
  path: '/',
  method: 'GET',
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const bridges = JSON.parse(data);

      if (bridges.length === 0) {
        console.log('❌ No bridges found on your network.');
        console.log('Make sure your Hue Bridge is connected and powered on.\n');
        return;
      }

      console.log(`✅ Found ${bridges.length} bridge(s):\n`);

      bridges.forEach((bridge, index) => {
        console.log(`Bridge ${index + 1}:`);
        console.log(`  IP Address: ${bridge.internalipaddress}`);
        console.log(`  ID: ${bridge.id}\n`);
      });

      console.log('📝 Copy the IP address to your .env file:');
      console.log(`   VITE_HUE_BRIDGE_IP=${bridges[0].internalipaddress}\n`);

      console.log('Next step: Run "npm run generate-token" to create an API username');
    } catch (error) {
      console.error('❌ Error parsing response:', error.message);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error discovering bridge:', error.message);
  console.log('\nTroubleshooting:');
  console.log('- Check your internet connection');
  console.log('- Make sure your Hue Bridge is on the same network');
  console.log('- Try finding your bridge IP manually in the Hue app');
});

req.end();
