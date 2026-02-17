# MyHue - Smart Home Controller

A modern smart home interface for controlling Philips Hue lights and casting content to Google Home/Chromecast devices. Built with React, TypeScript, and Framer Motion.

## Features

- 🎨 Modern web3-inspired UI with glassmorphism effects
- ✨ Smooth animations and transitions
- 💡 Toggle lights on/off with a single click
- 📊 Real-time status display (total, on, off)
- 🔄 Auto-refresh functionality
- 📱 Fully responsive design
- 🌈 Dynamic light color representation
- ⚡ Optimistic UI updates for instant feedback
- 🤖 AI Assistant powered by Groq (fast, cloud-based LLM)
- 📲 Telegram bot for remote control
- 🎬 Google Cast support (Google Home, Chromecast, Nest)

## Prerequisites

- Node.js (v16 or higher)
- A Philips Hue Bridge connected to your network
- Physical access to your Hue Bridge (to press the link button)
- Groq API key (free at https://console.groq.com)
- (Optional) Telegram bot token for remote control
- (Optional) Google Home/Chromecast devices on your network

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Discover Your Bridge

Run the discovery script to find your Hue Bridge IP address:

```bash
npm run discover-bridge
```

This will display your bridge's IP address. Copy it to your `.env` file:

```
VITE_HUE_BRIDGE_IP=192.168.x.x
```

### 3. Generate API Token

**Important:** You need to press the physical link button on your Hue Bridge before running this command.

```bash
npm run generate-token
```

Follow the prompts:

1. Press the link button on your Hue Bridge
2. Press ENTER in the terminal

The script will automatically update your `.env` file with the generated token.

### 4. Start the Development Server

```bash
npm run dev
```

### 5. Configure Groq AI (Required)

Get your free API key at https://console.groq.com and add it to your `.env`:

```env
GROQ_API_KEY=your_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

Then start the agent server:

```bash
npm run agent
```

### 6. (Optional) Setup Telegram Bot

Create a bot via [@BotFather](https://t.me/BotFather) on Telegram, then add to `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_ALLOWED_USER_IDS=your_telegram_user_id
```

Start the Telegram bot:

```bash
npm run telegram
```

### 7. (Optional) Setup Google Cast

Google Cast devices are auto-discovered on your network. To verify or manually configure:

```bash
npm run discover-cast
```

If auto-discovery doesn't work, manually add devices to `.env`:

```env
CAST_DEVICES=Living Room:192.168.0.100,Bedroom:192.168.0.101
```

### 8. Start the Web Interface

```bash
npm run dev
```

Open your browser and navigate to the URL shown in the terminal (usually `http://localhost:5173`).

## Usage

### Main Interface

- **Light Cards**: Click on any light card to toggle it on/off
- **All On**: Turn all lights on simultaneously
- **All Off**: Turn all lights off simultaneously
- **Refresh**: Manually refresh the lights status

### AI Assistant

Go to the **Agent** tab and interact naturally:

**Hue Commands:**
- "Éteins toutes les lampes"
- "Quelles lampes sont allumées ?"
- "Crée une ambiance chaude dans le salon"
- "Mets la lampe du salon à 50%"

**Google Cast Commands:**
- "Lance une vidéo YouTube sur la Google Home"
- "Joue du contenu sur le Chromecast"
- "Mets pause sur la Nest"
- "Monte le volume à 50% sur la Google Home"

### Telegram Bot

Send messages to your bot just like the web interface:
- "Turn off all lights"
- "Play music on Google Home"
- "What lights are on?"
- Use `/status` to check system status
- Use `/reset` to clear conversation history

### Light Status Indicators

- **Green Glow**: Light is on
- **No Glow**: Light is off
- **Opacity**: Indicates reachability status
- **Brightness %**: Shows current brightness level

## Project Structure

```
MyHue/
├── src/
│   ├── components/
│   │   ├── LightCard.tsx       # Individual light component
│   │   └── LightCard.css       # Light card styles
│   ├── pages/
│   │   ├── Agent.tsx           # AI chat interface
│   │   └── Agent.css           # Chat interface styles
│   ├── services/
│   │   ├── hueApi.ts           # Hue API integration
│   │   └── agentApi.ts         # Agent API integration
│   ├── types/
│   │   └── hue.ts              # TypeScript types
│   ├── App.tsx                 # Main app component
│   ├── App.css                 # Main app styles
│   └── index.css               # Global styles
├── scripts/
│   ├── discover-bridge.js      # Bridge discovery utility
│   ├── generate-token.js       # Token generation utility
│   └── discover-cast.js        # Cast device discovery
├── server/
│   ├── agentServer.js          # AI Agent server (Groq)
│   ├── telegramBot.js          # Telegram bot server
│   └── castService.js          # Google Cast service
└── .env                        # Environment configuration
```

## Technologies Used

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Framer Motion** - Animation library
- **Axios** - HTTP client
- **Express** - Backend server
- **Philips Hue API** - Bridge communication
- **Groq API** - Fast LLM inference (Llama 3.3 70B)
- **Telegram Bot API** - Remote control via Telegram
- **castv2-client** - Google Cast protocol
- **mdns-js** - Device discovery

## Troubleshooting

### "Failed to connect to Hue Bridge"

1. Make sure your bridge IP is correct in `.env`
2. Ensure you've generated a valid API token
3. Check that your computer is on the same network as the bridge
4. Try running `npm run discover-bridge` again

### "Unreachable" Lights

- The light might be powered off at the switch
- The light might be out of range from the bridge
- Try power cycling the light

### HTTPS/Certificate Errors

The Hue Bridge uses a self-signed certificate. The app is configured to handle this automatically.

### AI Agent Offline

1. Check that `npm run agent` is running
2. Verify `GROQ_API_KEY` is set in `.env`
3. Check agent server logs for errors

### Google Cast Not Working

1. Run `npm run discover-cast` to find devices
2. Make sure devices are on the same network
3. Try manually configuring with `CAST_DEVICES` in `.env`
4. Check Windows firewall settings (allow Node.js)

### Telegram Bot Issues

1. Verify bot token with [@BotFather](https://t.me/BotFather)
2. Check `TELEGRAM_ALLOWED_USER_IDS` includes your user ID
3. Restart bot: `npm run telegram`
4. Check bot logs for connection errors

## API Documentation

For more information about the Philips Hue API:

- [Official Hue API Documentation](https://developers.meethue.com/)

## License

MIT

## Author

Built with Claude Code
