# MyHue - Smart Light Controller

A modern web3-style interface for controlling your Philips Hue lights. Built with React, TypeScript, and Framer Motion.

## Features

- 🎨 Modern web3-inspired UI with glassmorphism effects
- ✨ Smooth animations and transitions
- 💡 Toggle lights on/off with a single click
- 📊 Real-time status display (total, on, off)
- 🔄 Auto-refresh functionality
- 📱 Fully responsive design
- 🌈 Dynamic light color representation
- ⚡ Optimistic UI updates for instant feedback

## Prerequisites

- Node.js (v16 or higher)
- A Philips Hue Bridge connected to your network
- Physical access to your Hue Bridge (to press the link button)

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

Open your browser and navigate to the URL shown in the terminal (usually `http://localhost:5173`).

## Usage

### Main Interface

- **Light Cards**: Click on any light card to toggle it on/off
- **All On**: Turn all lights on simultaneously
- **All Off**: Turn all lights off simultaneously
- **Refresh**: Manually refresh the lights status

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
│   ├── services/
│   │   └── hueApi.ts          # Hue API integration
│   ├── types/
│   │   └── hue.ts             # TypeScript types
│   ├── App.tsx                # Main app component
│   ├── App.css                # Main app styles
│   └── index.css              # Global styles
├── scripts/
│   ├── discover-bridge.js     # Bridge discovery utility
│   └── generate-token.js      # Token generation utility
└── .env                       # Environment configuration
```

## Technologies Used

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Framer Motion** - Animation library
- **Axios** - HTTP client
- **Philips Hue API** - Bridge communication

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

## API Documentation

For more information about the Philips Hue API:
- [Official Hue API Documentation](https://developers.meethue.com/)

## License

MIT

## Author

Built with Claude Code
