/**
 * Scène « Comment s'habiller » (maquette B validée le 2026-11-05) : nos deux personnages dessinés,
 * habillés selon la prévision, chaque vêtement pointé par une étiquette, et Cooper en photo,
 * « À poil » quelle que soit la météo. Pas de prénoms ni de visages : le dépôt est public.
 */
import './OutfitScene.css';

export interface SceneGear { hat: boolean; gloves: boolean; scarf: boolean; hood: boolean; umbrella: boolean; boots: boolean; sunglasses: boolean }
export interface SceneOutfit {
    feels: number;
    rainProb: number;
    coat: 'winter' | 'mid' | 'light' | 'rain' | 'none';
    gear: SceneGear;
    items: string[];
}

type Key = 'coat' | 'hat' | 'gloves' | 'scarf' | 'boots' | 'umbrella' | 'sunglasses' | 'cream' | 'top' | 'hood';

const keyOf = (item: string): Key | null => {
    if (/bottes/i.test(item)) return 'boots'; // avant « imperméable » : les bottes imperméables ne sont pas un manteau
    if (/capuche/i.test(item)) return 'hood';
    if (/manteau|veste|imperm/i.test(item)) return 'coat';
    if (/tuque/i.test(item)) return 'hat';
    if (/gants|mitaines/i.test(item)) return 'gloves';
    if (/foulard/i.test(item)) return 'scarf';
    if (/parapluie/i.test(item)) return 'umbrella';
    if (/lunettes/i.test(item)) return 'sunglasses';
    if (/crème/i.test(item)) return 'cream';
    if (/chandail|t-shirt/i.test(item)) return 'top';
    return null;
};

// Deux silhouettes : cheveux attachés et barbe, cheveux longs bruns
const P = {
    a: { beard: true, skin: '#d9a07c', hair: '#2a1c14', top: '#d8dbe0', tee: '#ecebe4', pants: '#24262c', shoes: '#f1f1ee',
        winter: '#3b4a5c', mid: '#8a7456', light: '#a89270', rain: '#2f5d7c', tuque: '#c9932e', scarf: '#c2532d', gloves: '#2b2b2b', umbrella: '#2c3e5c', sw: 32, hw: 33, lx: 13, lw: 22 },
    b: { beard: false, skin: '#eec3a3', hair: '#3b2418', top: '#9b1c32', tee: '#9b1c32', pants: '#151515', shoes: '#1b1b1b',
        winter: '#6e2436', mid: '#b08866', light: '#c6a483', rain: '#4b3f6b', tuque: '#e6ddcb', scarf: '#e6ddcb', gloves: '#e6ddcb', umbrella: '#7a2a3c', sw: 27, hw: 29, lx: 10, lw: 18 },
};
type Who = keyof typeof P;

const shade = (hex: string, k: number) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/** Personnage en SVG, coordonnées internes x 0..200, y −40..340. Données de la prévision uniquement. */
function person(id: Who, o: SceneOutfit): string {
    const p = P[id];
    const g = o.gear;
    const out: string[] = [];
    const kind = o.coat === 'winter' ? 'winter' : o.coat === 'none' ? 'none' : 'mid';
    const coat = o.coat === 'none' ? null : p[o.coat];
    const tee = o.feels > 23;
    const bottom = kind === 'winter' ? 262 : kind === 'mid' ? 236 : 212;
    const hw = coat ? p.hw + (kind === 'winter' ? 10 : 5) : p.hw;
    const sleeve = coat || (tee ? p.tee : p.top);
    const armW = coat ? (kind === 'winter' ? 19 : 16) : 14;
    const L = 100 - p.sw;
    const R = 100 + p.sw;
    if (!p.beard) out.push(`<path d="M72 56 Q70 26 100 26 Q130 26 128 56 L135 150 Q120 158 110 146 L110 92 H90 L90 146 Q80 158 65 150 Z" fill="${p.hair}"/>`);
    else out.push(`<g fill="${p.hair}"><circle cx="79" cy="90" r="9"/><circle cx="84" cy="101" r="8"/><circle cx="121" cy="90" r="9"/><circle cx="116" cy="101" r="7"/></g>`);
    // Jambes et chaussures
    out.push(`<path d="M${100 - p.lx} 205 L${100 - p.lx - 1} 328 M${100 + p.lx} 205 L${100 + p.lx + 1} 328" stroke="${p.pants}" stroke-width="${p.lw}" stroke-linecap="round"/>`);
    if (g.boots) {
        const bc = p.beard ? '#3a3226' : '#2a2320';
        out.push(`<path d="M${100 - p.lx - 13} 300 H${100 - p.lx + 11} V336 H${100 - p.lx - 19} Q${100 - p.lx - 21} 326 ${100 - p.lx - 13} 324 Z" fill="${bc}"/><path d="M${100 + p.lx - 11} 300 H${100 + p.lx + 13} V324 Q${100 + p.lx + 21} 326 ${100 + p.lx + 19} 336 H${100 + p.lx - 11} Z" fill="${bc}"/>`);
        out.push(`<path d="M${100 - p.lx - 13} 304 H${100 - p.lx + 11} M${100 + p.lx - 11} 304 H${100 + p.lx + 13}" stroke="#e6ddcb" stroke-width="4" opacity=".6"/>`);
    } else {
        out.push(`<ellipse cx="${100 - p.lx - 4}" cy="334" rx="${p.beard ? 15 : 11}" ry="6" fill="${p.shoes}"/><ellipse cx="${100 + p.lx + 4}" cy="334" rx="${p.beard ? 15 : 11}" ry="6" fill="${p.shoes}"/>`);
    }
    // Bras (le droit tient le parapluie)
    const up = g.umbrella;
    const lh: [number, number] = [L - 14, 200];
    const rh: [number, number] = up ? [R + 16, 150] : [R + 14, 200];
    const arm = (x1: number, y1: number, [x2, y2]: [number, number], col: string, w: number) =>
        `<path d="M${x1} ${y1} L${x2} ${y2 - 6}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
    if (!coat && tee) {
        out.push(arm(L + 4, 114, lh, p.skin, 11), arm(R - 4, 114, rh, p.skin, 11));
        out.push(`<path d="M${L + 4} 112 L${L - 3} 140 M${R - 4} 112 L${R + 3} 140" stroke="${sleeve}" stroke-width="16" stroke-linecap="round"/>`);
    } else out.push(arm(L + 4, 114, lh, sleeve, armW), arm(R - 4, 114, rh, sleeve, armW));
    // Torse
    const torso = coat || (tee ? p.tee : p.top);
    out.push(`<path d="M${L} 108 Q100 98 ${R} 108 L${100 + hw} ${bottom} H${100 - hw} Z" fill="${torso}"/>`);
    if (!coat && p.beard && !tee) {
        out.push(`<g fill="#8f949c">${[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3].map((c) => `<circle cx="${80 + c * 13 + (r % 2) * 6}" cy="${122 + r * 18}" r="1.6"/>`).join('')).join('')}</g>`);
        out.push(`<path d="M100 104 V210" stroke="#b9bdc4" stroke-width="1.5"/><rect x="${100 - hw}" y="204" width="${hw * 2}" height="8" fill="#3b2a20"/><rect x="95" y="203" width="10" height="10" rx="2" fill="#9a9a9a"/>`);
    }
    if (coat) {
        out.push(`<path d="M100 104 V${bottom}" stroke="${shade(coat, 0.7)}" stroke-width="2.5"/>`);
        if (kind === 'winter') out.push(`<path d="${[140, 172, 204, 236].map((y) => `M${100 - hw + 6 + (y - 100) * 0.06} ${y} H${100 + hw - 6 - (y - 100) * 0.06}`).join(' ')}" stroke="${shade(coat, 0.8)}" stroke-width="2"/>`);
        out.push(`<path d="M${L + 6} 106 L100 124 L${R - 6} 106" stroke="${shade(coat, 1.25)}" stroke-width="6" fill="none" stroke-linejoin="round"/>`);
        if (kind === 'mid') out.push(`<path d="M${100 - hw + 2} 196 H${100 + hw - 2}" stroke="${shade(coat, 0.75)}" stroke-width="5"/>`);
    }
    // Mains
    const hand = g.gloves ? p.gloves : p.skin;
    out.push(`<circle cx="${lh[0]}" cy="${lh[1]}" r="8" fill="${hand}"/><circle cx="${rh[0]}" cy="${rh[1]}" r="8" fill="${hand}"/>`);
    // Cou, tête, oreilles
    out.push(`<rect x="92" y="86" width="16" height="20" fill="${shade(p.skin, 0.92)}"/>`);
    out.push(`<ellipse cx="76" cy="64" rx="5" ry="7" fill="${p.skin}"/><ellipse cx="124" cy="64" rx="5" ry="7" fill="${p.skin}"/><ellipse cx="100" cy="62" rx="24" ry="28" fill="${p.skin}"/>`);
    if (!coat && !p.beard) out.push('<path d="M88 104 Q100 118 112 104" stroke="#d9c7a0" stroke-width="1.4" fill="none"/>');
    // Cheveux, barbe, sourire
    if (p.beard) {
        out.push(`<path d="M75 60 Q73 30 100 30 Q127 30 125 60 Q122 44 112 42 Q100 46 88 42 Q78 44 75 60 Z" fill="${p.hair}"/>`);
        out.push(`<path d="M76 64 Q76 96 100 98 Q124 96 124 64 Q121 76 112 79 Q100 75 88 79 Q79 76 76 64 Z" fill="${p.hair}"/>`);
        out.push(`<path d="M89 77 Q100 72 111 77" stroke="${p.hair}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
        out.push('<path d="M91 82 Q100 90 109 82 Z" fill="#fff"/>');
    } else {
        out.push(`<path d="M76 60 Q71 100 69 148 Q78 153 86 144 Q84 110 85 78 Z M124 60 Q129 100 131 148 Q122 153 114 144 Q116 110 115 78 Z" fill="${p.hair}"/>`);
        out.push(`<path d="M74 64 Q72 26 100 27 Q128 26 126 64 Q120 42 106 40 Q96 50 80 52 Q76 56 74 64 Z" fill="${p.hair}"/>`);
        out.push('<path d="M91 79 Q100 87 109 79 Z" fill="#fff" stroke="#b9485a" stroke-width="1.5"/>');
    }
    // Yeux, sourcils, joues
    out.push('<circle cx="90" cy="62" r="2.7" fill="#22170f"/><circle cx="110" cy="62" r="2.7" fill="#22170f"/>');
    out.push(`<path d="M85 55 Q90 52 95 55 M105 55 Q110 52 115 55" stroke="${p.hair}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
    if (!p.beard) out.push('<circle cx="84" cy="72" r="5" fill="#e88f8f" opacity=".35"/><circle cx="116" cy="72" r="5" fill="#e88f8f" opacity=".35"/>');
    if (o.items.some((it) => keyOf(it) === 'cream')) out.push('<path d="M80 70 h6 M114 70 h6" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>');
    // Accessoires
    if (g.scarf) out.push(`<path d="M80 100 Q100 116 120 100" stroke="${p.scarf}" stroke-width="11" fill="none" stroke-linecap="round"/><path d="M112 108 L117 150" stroke="${p.scarf}" stroke-width="9" stroke-linecap="round"/><path d="M110 146 h12" stroke="${shade(p.scarf, 0.7)}" stroke-width="3"/>`);
    if (g.hood) {
        const hc = coat || p.rain;
        out.push(`<path d="M70 70 Q68 22 100 20 Q132 22 130 70 L126 100 Q124 70 118 52 Q100 40 82 52 Q76 70 74 100 Z" fill="${hc}"/>`);
    }
    if (g.hat && !g.hood) out.push(`<path d="M73 52 Q73 23 100 23 Q127 23 127 52 Z" fill="${p.tuque}"/><rect x="71" y="45" width="58" height="13" rx="6" fill="${shade(p.tuque, 0.8)}"/><circle cx="100" cy="19" r="7" fill="${shade(p.tuque, 1.1)}"/>`);
    if (g.sunglasses) out.push('<rect x="82" y="56" width="15" height="10" rx="4" fill="#111"/><rect x="103" y="56" width="15" height="10" rx="4" fill="#111"/><path d="M97 60 H103 M82 59 L76 57 M118 59 L124 57" stroke="#111" stroke-width="2"/>');
    if (up) {
        const uc = p.umbrella;
        out.push(`<path d="M${rh[0]} ${rh[1] + 10} Q${rh[0]} ${rh[1] + 20} ${rh[0] - 8} ${rh[1] + 18}" stroke="#222" stroke-width="3" fill="none"/>`);
        out.push(`<path d="M${rh[0]} ${rh[1] + 10} L118 -8" stroke="#333" stroke-width="3"/>`);
        out.push(`<path d="M44 8 Q118 -66 192 8 Q174 0 155 8 Q136 0 118 8 Q99 0 81 8 Q62 0 44 8 Z" fill="${uc}"/><path d="M118 -29 V8 M81 8 Q96 -40 118 -29 M155 8 Q140 -40 118 -29" stroke="${shade(uc, 1.4)}" stroke-width="1.5" fill="none"/>`);
    }
    return out.join('');
}

// Point d'accroche de chaque étiquette sur le personnage (coordonnées internes)
const ANCHOR: Record<Key, [number, number]> = {
    hat: [100, 30], hood: [100, 30], scarf: [118, 120], gloves: [54, 200], coat: [80, 170], top: [82, 150],
    boots: [86, 318], umbrella: [70, -4], sunglasses: [88, 61], cream: [82, 70],
};

/** Le petit mot de Cooper, qui reste à poil quoi qu'il arrive. */
export const dogTip = (o: SceneOutfit) => {
    if (o.feels <= -5) return 'Sel sur les trottoirs : on lui essuie les pattes en rentrant.';
    if (o.rainProb >= 50) return 'Serviette à l’entrée : chien mouillé en approche.';
    if (o.feels >= 27) return 'Bitume brûlant : promenade tôt ou tard, eau fraîche.';
    return 'Parfait pour la grande promenade.';
};

const W = 940;
const H = 430;
const POS: Record<Who, number> = { a: 210, b: 420 };
const DOG = { x: 668, w: 150, h: 273 }; // photo 360 × 655
const DOG_Y = H - 44 - DOG.h; // même sol que les pieds (336 + 44)

/** Contenu SVG de la scène (chaîne), séparé pour pouvoir le rendre et le vérifier hors de React. */
export const sceneMarkup = (o: SceneOutfit, photo = '/cooper-poil.webp') => {
    const at = (id: Who, [x, y]: [number, number]) => [POS[id] + x, y + 44];
    // Triées par hauteur du vêtement sur le personnage : les traits ne se croisent pas
    const labelled = o.items.map((t) => ({ t, key: keyOf(t) })).filter((x): x is { t: string; key: Key } => x.key != null)
        .sort((x, y) => ANCHOR[x.key][1] - ANCHOR[y.key][1]);
    const n = labelled.length;
    const step = n > 1 ? (H - 110) / (n - 1) : 0;
    const labels = labelled.map(({ t, key }, i) => {
        const ly = n === 1 ? 190 : 50 + i * step;
        const [ax, ay] = at('a', ANCHOR[key]);
        const [bx, by] = at('b', ANCHOR[key]);
        const w = t.length * 9 + 30;
        const x2 = 20 + w;
        return `<path d="M${x2} ${ly} C${(x2 + ax) / 2} ${ly} ${(x2 + ax) / 2} ${ay} ${ax} ${ay}" class="os-line"/><circle cx="${ax}" cy="${ay}" r="5" class="os-dot"/>`
            + `<circle cx="${bx}" cy="${by}" r="4" class="os-dot" opacity=".55"/>`
            + `<rect x="20" y="${ly - 20}" width="${w}" height="40" rx="20" class="os-tag"/><text x="${20 + w / 2}" y="${ly + 6}" text-anchor="middle" class="os-tag-text">${t}</text>`;
    }).join('');
    const scene = `<ellipse cx="420" cy="${H - 48}" rx="260" ry="12" fill="#000" opacity=".22"/>`
        + `<g transform="translate(${POS.a} 44)">${person('a', o)}</g>`
        + `<g transform="translate(${POS.b} 44)">${person('b', o)}</g>`
        + `<ellipse cx="${DOG.x + DOG.w / 2}" cy="${H - 46}" rx="70" ry="8" fill="#000" opacity=".25"/>`
        + `<image href="${photo}" x="${DOG.x}" y="${DOG_Y}" width="${DOG.w}" height="${DOG.h}"/>`
        + `<text x="${DOG.x + DOG.w / 2}" y="${H - 16}" text-anchor="middle" class="os-name">Cooper</text>`
        + `<g class="os-labels">${labels}</g>`
        + `<path d="M${DOG.x + 150} 118 C${DOG.x + 165} 140 ${DOG.x + 140} ${DOG_Y + 20} ${DOG.x + 105} ${DOG_Y + 36}" class="os-poil-line"/><circle cx="${DOG.x + 105}" cy="${DOG_Y + 36}" r="5" class="os-poil-dot"/>`
        + `<g transform="translate(${DOG.x + 96} 62) rotate(-7)"><rect width="150" height="56" rx="16" class="os-poil"/><text x="75" y="35" text-anchor="middle" class="os-poil-text">À poil</text></g>`;
    return scene;
};

export function OutfitScene({ o }: { o: SceneOutfit }) {
    const scene = sceneMarkup(o);
    return (
        <svg className="os-scene" viewBox={`0 -30 ${W} ${H + 30}`} role="img"
            aria-label={`Nos deux personnages habillés : ${o.items.join(', ')}. Cooper, lui, reste à poil.`}
            dangerouslySetInnerHTML={{ __html: scene }} />
    );
}
