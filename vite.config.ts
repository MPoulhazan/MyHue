import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    // Le pré-bundling casse la résolution du .wasm d'onnxruntime (mot d'activation)
    optimizeDeps: { exclude: ['onnxruntime-web'] },
    server: {
        proxy: {
            '/api/sensors/events': {
                target: 'http://localhost:5174',
                changeOrigin: true,
            },
            '/api': {
                target: 'http://localhost:5174',
                changeOrigin: true,
            },
        },
    },
});
