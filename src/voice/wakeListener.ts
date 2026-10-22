// Écoute le micro en continu et appelle onWake quand « Hey Jarvis » est détecté.
// Tout reste dans le navigateur : aucun son ne sort de l'appareil.
import * as ort from 'onnxruntime-web/wasm';
import { WakeWordModel, SAMPLE_RATE, CHUNK } from './wakeWord';

const THRESHOLD = 0.5;
const COOLDOWN_MS = 2000;
const MAX_QUEUE = 6; // au-delà, l'inférence est trop lente : on repart à zéro

// Découpe le flux micro en blocs de CHUNK échantillons
const WORKLET = `
class ChunkProcessor extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(${CHUNK}); this.n = 0; }
    process(inputs) {
        const ch = inputs[0][0];
        if (ch) for (let i = 0; i < ch.length; i++) {
            this.buf[this.n++] = ch[i];
            if (this.n === ${CHUNK}) { this.port.postMessage(this.buf.slice()); this.n = 0; }
        }
        return true;
    }
}
registerProcessor('chunk-processor', ChunkProcessor);
`;

let modelPromise: Promise<WakeWordModel> | null = null;
const loadModel = () => {
    if (!modelPromise) {
        // Le multi-thread exige crossOriginIsolated, que l'app n'active pas
        ort.env.wasm.numThreads = 1;
        modelPromise = WakeWordModel.load('/models/wakeword').catch((error) => {
            modelPromise = null;
            throw error;
        });
    }
    return modelPromise;
};

export class WakeListener {
    private onWake: () => void;
    private ctx: AudioContext | null = null;
    private stream: MediaStream | null = null;
    private queue: Float32Array[] = [];
    private draining = false;
    private lastHit = 0;

    constructor(onWake: () => void) {
        this.onWake = onWake;
    }

    // Renvoie false si le navigateur attend un geste (politique autoplay)
    async start(): Promise<boolean> {
        const model = await loadModel();
        model.reset();
        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await this.ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        const node = new AudioWorkletNode(this.ctx, 'chunk-processor');
        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
            this.queue.push(e.data);
            this.drain(model);
        };
        this.ctx.createMediaStreamSource(this.stream).connect(node);

        if (this.ctx.state === 'suspended') await this.resume();
        return this.ctx.state === 'running';
    }

    get running() {
        return this.ctx?.state === 'running';
    }

    // resume() peut ne jamais répondre (autoplay bloqué, sortie audio absente)
    async resume() {
        if (!this.ctx) return;
        await Promise.race([
            this.ctx.resume().catch(() => {}),
            new Promise((res) => setTimeout(res, 1500)),
        ]);
    }

    stop() {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.ctx?.close().catch(() => {});
        this.stream = null;
        this.ctx = null;
        this.queue = [];
    }

    private async drain(model: WakeWordModel) {
        if (this.draining) return;
        this.draining = true;
        try {
            while (this.queue.length && this.ctx) {
                if (this.queue.length > MAX_QUEUE) {
                    this.queue = [];
                    model.reset();
                    break;
                }
                const score = await model.process(this.queue.shift()!);
                if (score >= THRESHOLD && Date.now() - this.lastHit > COOLDOWN_MS) {
                    this.lastHit = Date.now();
                    model.reset();
                    this.queue = [];
                    this.onWake();
                }
            }
        } finally {
            this.draining = false;
        }
    }
}
