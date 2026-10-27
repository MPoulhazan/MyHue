import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API cible en dev : le serveur local, ou l'add-on (MYHUE_API=http://192.168.0.17:5174)
const API = process.env.MYHUE_API || 'http://localhost:5174';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    // Le pré-bundling casse la résolution du .wasm d'onnxruntime (mot d'activation)
    optimizeDeps: { exclude: ['onnxruntime-web'] },
    server: {
        proxy: {
            '/api/sensors/events': {
                target: API,
                changeOrigin: true,
            },
            '/api': {
                target: API,
                changeOrigin: true,
            },
        },
    },
});
