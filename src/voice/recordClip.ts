// Enregistre une prise courte du mot d'activation au format attendu par
// l'entraînement openWakeWord : WAV 16 kHz, mono, 16 bits, silences rognés.
// (pas d'import depuis wakeWord : il embarquerait onnxruntime dans la page)
const SAMPLE_RATE = 16000;

const WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const ch = inputs[0][0];
        if (ch) this.port.postMessage(ch.slice());
        return true;
    }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

const FRAME = 320; // 20 ms à 16 kHz
const MARGIN = 0.2; // secondes de silence gardées autour de la voix

// Mêmes réglages micro que l'écoute du mot d'activation
export const openMic = () =>
    navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });

const capture = async (stream: MediaStream, seconds: number) => {
    const ctx = new AudioContext();
    try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        if (ctx.state === 'suspended') await ctx.resume();
        const node = new AudioWorkletNode(ctx, 'capture-processor');
        const blocks: Float32Array[] = [];
        node.port.onmessage = (e: MessageEvent<Float32Array>) => blocks.push(e.data);
        ctx.createMediaStreamSource(stream).connect(node);
        await new Promise((res) => setTimeout(res, seconds * 1000));
        const total = blocks.reduce((n, b) => n + b.length, 0);
        const pcm = new Float32Array(total);
        let offset = 0;
        for (const b of blocks) {
            pcm.set(b, offset);
            offset += b.length;
        }
        return { pcm, rate: ctx.sampleRate };
    } finally {
        ctx.close().catch(() => {});
    }
};

// Rééchantillonnage par le navigateur (filtre anti-repliement inclus)
const resample = async (pcm: Float32Array, rate: number) => {
    const length = Math.ceil((pcm.length * SAMPLE_RATE) / rate);
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
    const buffer = offline.createBuffer(1, pcm.length, rate);
    buffer.copyToChannel(pcm, 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
};

// Garde la zone où il y a de la voix ; null si la prise est quasi muette
const trim = (pcm: Float32Array) => {
    const rms: number[] = [];
    for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
        let sum = 0;
        for (let j = i; j < i + FRAME; j++) sum += pcm[j] * pcm[j];
        rms.push(Math.sqrt(sum / FRAME));
    }
    const peak = Math.max(...rms);
    if (peak < 0.01) return null;
    const floor = Math.max(0.005, peak * 0.15);
    const first = rms.findIndex((v) => v >= floor);
    const last = rms.length - 1 - [...rms].reverse().findIndex((v) => v >= floor);
    const margin = Math.round((MARGIN * SAMPLE_RATE) / FRAME);
    const start = Math.max(0, first - margin) * FRAME;
    const end = Math.min(rms.length, last + 1 + margin) * FRAME;
    return { pcm: pcm.slice(start, end), peak };
};

const encodeWav = (pcm: Float32Array) => {
    const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + pcm.length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, pcm.length * 2, true);
    pcm.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
    return new Blob([view.buffer], { type: 'audio/wav' });
};

export type Clip = { wav: Blob; seconds: number; peak: number };

// null : rien entendu
export async function recordClip(stream: MediaStream, seconds = 2.5): Promise<Clip | null> {
    const { pcm, rate } = await capture(stream, seconds);
    const trimmed = trim(await resample(pcm, rate));
    if (!trimmed) return null;
    return {
        wav: encodeWav(trimmed.pcm),
        seconds: trimmed.pcm.length / SAMPLE_RATE,
        peak: trimmed.peak,
    };
}
