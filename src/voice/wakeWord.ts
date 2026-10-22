// Détection du mot d'activation « Hey Jarvis » avec les modèles openWakeWord
// (https://github.com/dscripka/openWakeWord), exécutés en local via ONNX.
// Pipeline par bloc de 80 ms : audio → mel-spectrogramme → embedding → score.
import * as ort from 'onnxruntime-web/wasm';

export const SAMPLE_RATE = 16000;
export const CHUNK = 1280; // 80 ms à 16 kHz
const MEL_CONTEXT = 160 * 3; // recouvrement entre blocs pour le mel
const MEL_BINS = 32;
const MEL_WINDOW = 76; // trames mel par embedding
const EMB_SIZE = 96;
const EMB_WINDOW = 16; // embeddings par prédiction (~1,3 s)

const tensor = (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims);

export class WakeWordModel {
    private raw = new Float32Array(0);
    private mel: Float32Array[] = [];
    private emb: Float32Array[] = [];
    private melSession: ort.InferenceSession;
    private embSession: ort.InferenceSession;
    private wakeSession: ort.InferenceSession;

    private constructor(
        melSession: ort.InferenceSession,
        embSession: ort.InferenceSession,
        wakeSession: ort.InferenceSession,
    ) {
        this.melSession = melSession;
        this.embSession = embSession;
        this.wakeSession = wakeSession;
    }

    static async load(baseUrl: string, wakeModel = 'hey_jarvis_v0.1.onnx') {
        const open = async (file: string) => {
            const res = await fetch(`${baseUrl}/${file}`);
            if (!res.ok) throw new Error(`Modèle introuvable : ${file}`);
            return ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()));
        };
        const [mel, emb, wake] = await Promise.all([
            open('melspectrogram.onnx'),
            open('embedding_model.onnx'),
            open(wakeModel),
        ]);
        return new WakeWordModel(mel, emb, wake);
    }

    reset() {
        this.raw = new Float32Array(0);
        this.mel = [];
        this.emb = [];
    }

    // chunk : CHUNK échantillons en [-1, 1]. Renvoie le score (0 à 1),
    // ou 0 tant que les tampons ne sont pas remplis.
    async process(chunk: Float32Array): Promise<number> {
        // openWakeWord attend l'échelle int16
        const scaled = chunk.map((v) => Math.max(-1, Math.min(1, v)) * 32767);
        const joined = new Float32Array(this.raw.length + scaled.length);
        joined.set(this.raw);
        joined.set(scaled, this.raw.length);
        this.raw = joined.slice(-(CHUNK + MEL_CONTEXT));

        const melOut = await this.run(this.melSession, tensor(this.raw, [1, this.raw.length]));
        for (let i = 0; i + MEL_BINS <= melOut.length; i += MEL_BINS) {
            this.mel.push(melOut.slice(i, i + MEL_BINS).map((v) => v / 10 + 2));
        }
        if (this.mel.length > MEL_WINDOW) this.mel = this.mel.slice(-MEL_WINDOW);
        if (this.mel.length < MEL_WINDOW) return 0;

        const melInput = new Float32Array(MEL_WINDOW * MEL_BINS);
        this.mel.forEach((frame, i) => melInput.set(frame, i * MEL_BINS));
        const embOut = await this.run(this.embSession, tensor(melInput, [1, MEL_WINDOW, MEL_BINS, 1]));
        this.emb.push(embOut.slice(0, EMB_SIZE));
        if (this.emb.length > EMB_WINDOW) this.emb.shift();
        if (this.emb.length < EMB_WINDOW) return 0;

        const embInput = new Float32Array(EMB_WINDOW * EMB_SIZE);
        this.emb.forEach((e, i) => embInput.set(e, i * EMB_SIZE));
        const score = await this.run(this.wakeSession, tensor(embInput, [1, EMB_WINDOW, EMB_SIZE]));
        return score[0];
    }

    private async run(session: ort.InferenceSession, input: ort.Tensor) {
        const out = await session.run({ [session.inputNames[0]]: input });
        return out[session.outputNames[0]].data as Float32Array;
    }
}
