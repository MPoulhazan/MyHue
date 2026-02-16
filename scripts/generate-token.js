import http from 'http';
import readline from 'readline';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file
config({ path: join(__dirname, '..', '.env') });

const bridgeIP = process.env.VITE_HUE_BRIDGE_IP;

if (!bridgeIP) {
  console.log('❌ Bridge IP not found in .env file');
  console.log('Please run "npm run discover-bridge" first\n');
  process.exit(1);
}

console.log('🔐 Philips Hue API Token Generator\n');
console.log(`Bridge IP: ${bridgeIP}\n`);
console.log('⚠️  IMPORTANT: Press the link button on your Hue Bridge NOW!');
console.log('You have 30 seconds after pressing it to generate the token.\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Press ENTER after you have pressed the link button... ', () => {
  rl.close();

  console.log('\n🔄 Generating token...\n');

  const postData = JSON.stringify({
    devicetype: 'myhue_app#web',
  });

  const options = {
    hostname: bridgeIP,
    port: 80,
    path: '/api',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': postData.length,
    },
  };

  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        const result = response[0];

        if (result.error) {
          console.log('❌ Error:', result.error.description);

          if (result.error.type === 101) {
            console.log('\n💡 The link button was not pressed.');
            console.log('Please press the button on the bridge and try again.\n');
          }

          process.exit(1);
        }

        if (result.success) {
          const username = result.success.username;

          console.log('✅ Token generated successfully!\n');
          console.log(`Username: ${username}\n`);

          // Update .env file
          const envPath = join(__dirname, '..', '.env');
          let envContent = fs.readFileSync(envPath, 'utf8');

          if (envContent.includes('VITE_HUE_USERNAME=')) {
            envContent = envContent.replace(
              /VITE_HUE_USERNAME=.*/,
              `VITE_HUE_USERNAME=${username}`
            );
          } else {
            envContent += `\nVITE_HUE_USERNAME=${username}\n`;
          }

          fs.writeFileSync(envPath, envContent);

          console.log('📝 Your .env file has been updated automatically!\n');
          console.log('🚀 You can now run "npm run dev" to start the app');
        }
      } catch (error) {
        console.error('❌ Error parsing response:', error.message);
        console.log('Response:', data);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Error connecting to bridge:', error.message);
    console.log('\nMake sure:');
    console.log('- The bridge IP is correct in your .env file');
    console.log('- Your computer is on the same network as the bridge');
  });

  req.write(postData);
  req.end();
});
