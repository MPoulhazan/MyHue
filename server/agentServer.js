/**
 * Serveur MyHue : API maison, agent, MCP et front buildé.
 */
import 'dotenv/config';
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import * as rulesEngine from './rulesEngine.js';
import * as broadlinkService from './broadlinkService.js';
import * as zigbeeService from './zigbeeService.js';
import { installAuth, TOKEN, PUBLIC_PORT } from './auth.js';
import { installWakewordRoutes } from './wakewordSamples.js';
import { hueProxy } from './hue.js';
import { getSensors } from './sensors.js';
import { router as agentRoutes, GROQ_MODEL } from './routes/agent.js';
import { router as mediaRoutes } from './routes/media.js';
import { router as homeRoutes } from './routes/home.js';

const PORT = Number(process.env.AGENT_PORT || 5174);

const app = express();
app.use(express.json({ limit: '1mb' }));
installAuth(app, express);
installWakewordRoutes(app, express);

app.use(agentRoutes);
app.use(mediaRoutes);
app.use(homeRoutes);
app.use('/api/hue', hueProxy);

// --- Front buildé (add-on / prod) ---

const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '../dist');
if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(DIST_DIR, 'index.html')));
}

// --- Démarrage ---

app.listen(PORT, () => {
    console.log(`🤖 MyHue agent server running on http://localhost:${PORT}`);
    console.log(`Using Groq with model: ${GROQ_MODEL}`);
    rulesEngine.startEngine(getSensors);
    broadlinkService.discover().catch((err) => console.warn('⚠️  Broadlink:', err.message));
    zigbeeService.start().catch((err) => console.warn('⚠️  Zigbee:', err.message));
});

// Port réservé au proxy local (Tailscale) : loopback seulement, token exigé
if (TOKEN) {
    app.listen(PUBLIC_PORT, '127.0.0.1', () => {
        console.log(`🔒 Accès distant (token requis) sur http://127.0.0.1:${PUBLIC_PORT}`);
    });
}
