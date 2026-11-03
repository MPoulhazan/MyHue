import { useEffect, useRef } from 'react';

/**
 * Lune réaliste : la carte de la surface prise par la sonde LRO (NASA, domaine public, public/moon-texture.jpg)
 * est plaquée sur une sphère et éclairée selon la phase. Dans l'hémisphère nord, la lune croissante est éclairée
 * à droite, la décroissante à gauche. Le côté sombre garde une faible lumière cendrée.
 */

let texture: Promise<ImageData> | null = null;
function loadTexture() {
    if (!texture) {
        texture = new Promise<ImageData>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                if (!ctx) return reject(new Error('canvas'));
                ctx.drawImage(img, 0, 0);
                resolve(ctx.getImageData(0, 0, c.width, c.height));
            };
            img.onerror = () => { texture = null; reject(new Error('texture')); };
            img.src = '/moon-texture.jpg';
        });
    }
    return texture;
}

const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

function render(tex: ImageData, n: number, fraction: number, waxing: boolean) {
    const out = new ImageData(n, n);
    const o = out.data;
    const t = tex.data;
    const tw = tex.width;
    const th = tex.height;
    const c = (n - 1) / 2;
    const r = (n / 2) * 0.96;
    const phaseAngle = Math.acos(clamp(2 * fraction - 1, -1, 1));
    const sx = (waxing ? 1 : -1) * Math.sin(phaseAngle);
    const sz = Math.cos(phaseAngle);
    const tint = [1, 0.985, 0.95];
    for (let py = 0; py < n; py++) {
        const y = -(py - c) / r;
        for (let px = 0; px < n; px++) {
            const x = (px - c) / r;
            const d2 = x * x + y * y;
            if (d2 > 1.03) continue;
            const z = Math.sqrt(Math.max(0, 1 - d2));
            // Coordonnées sur la carte (longitude 0 au centre de la face visible)
            const lat = Math.asin(clamp(y, -1, 1));
            const lon = Math.atan2(x, z);
            const u = (lon / (2 * Math.PI) + 0.5) * (tw - 1);
            const v = (0.5 - lat / Math.PI) * (th - 1);
            const u0 = Math.floor(u), v0 = Math.floor(v);
            const u1 = Math.min(u0 + 1, tw - 1), v1 = Math.min(v0 + 1, th - 1);
            const fu = u - u0, fv = v - v0;
            const i00 = (v0 * tw + u0) * 4, i01 = (v0 * tw + u1) * 4, i10 = (v1 * tw + u0) * 4, i11 = (v1 * tw + u1) * 4;
            // Éclairage : Lommel-Seeliger (aspect plat de la vraie lune) + un peu de Lambert, terminateur adouci
            const cosI = x * sx + z * sz;
            const mu0 = Math.max(cosI, 0);
            const ls = mu0 > 0 ? (2 * mu0) / (mu0 + z + 1e-6) : 0;
            let shade = 0.55 * clamp(ls / 1.7) + 0.45 * Math.pow(mu0, 0.45);
            shade *= Math.pow(clamp((cosI + 0.02) / 0.06), 1.5);
            const lum = clamp(shade * 1.18 + 0.045 * clamp(1 - mu0 * 3));
            let rgb = [0, 1, 2].map((k) => (
                (t[i00 + k] * (1 - fu) + t[i01 + k] * fu) * (1 - fv) + (t[i10 + k] * (1 - fu) + t[i11 + k] * fu) * fv
            ) / 255);
            const gray = (rgb[0] + rgb[1] + rgb[2]) / 3;
            rgb = rgb.map((ch) => clamp((gray + (ch - gray) * 0.55 - 0.42) * 1.45 + 0.5));
            const j = (py * n + px) * 4;
            o[j] = rgb[0] * lum * tint[0] * 255;
            o[j + 1] = rgb[1] * lum * tint[1] * 255;
            o[j + 2] = rgb[2] * lum * tint[2] * 255;
            o[j + 3] = clamp(((1 - Math.sqrt(d2)) * r) / 1.2) * 255;
        }
    }
    return out;
}

export function MoonCanvas({ size, fraction, waxing, label }: { size: number; fraction: number; waxing: boolean; label: string }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let alive = true;
        loadTexture().then((tex) => {
            const canvas = ref.current;
            if (!alive || !canvas) return;
            // Rendu deux fois plus fin que l'écran puis réduit : bords et cratères nets sans crénelage
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const n = Math.round(size * dpr);
            const big = document.createElement('canvas');
            big.width = big.height = n * 2;
            big.getContext('2d')?.putImageData(render(tex, n * 2, fraction, waxing), 0, 0);
            canvas.width = canvas.height = n;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.imageSmoothingQuality = 'high';
            ctx.clearRect(0, 0, n, n);
            ctx.drawImage(big, 0, 0, n, n);
        }).catch(() => {});
        return () => { alive = false; };
    }, [size, fraction, waxing]);
    return <canvas ref={ref} className="moon-canvas" style={{ width: size, height: size }} role="img" aria-label={label} />;
}
