"""Entraîne le modèle de mot d'activation « Jean-Claude » pour openWakeWord.

Chaîne identique à src/voice/wakeWord.ts : audio 16 kHz (échelle int16)
→ melspectrogram.onnx (v/10 + 2) → embedding_model.onnx (76 trames, pas de 8)
→ fenêtre de 16 embeddings × 96 → petit réseau → score 0..1.

Données :
  positifs : <wakeword>/<locuteur>/*.wav (enregistrés sur /wakeword) et
             <wakeword>/piper/positive/*.wav, augmentés (bruit, gain, écho)
  négatifs : <wakeword>/piper/negative/*.wav (mots proches), débuts de
             « Jean-Claude » pas encore fini, et les features openWakeWord
             publiées (parole, musique, bruit) : validation_set_features.npy
             et des tranches acav_<offset>.bin de
             openwakeword_features_ACAV100M_2000_hrs_16bit.npy
             (huggingface.co/datasets/davidscripka/openwakeword_features)

Usage :
  py -I scripts/train-wakeword.py --wakeword server/data/wakeword \
      --negfeat <dossier des features> --out public/models/wakeword/jean_claude.onnx
"""
import argparse
import glob
import os

import numpy as np
import onnx
import onnxruntime as ort
import soundfile as sf
from onnx import TensorProto, helper, numpy_helper
from scipy.signal import resample_poly
from sklearn.neural_network import MLPClassifier

RATE = 16000
MEL_WINDOW = 76
EMB_WINDOW = 16
EMB = 96
FLAT = EMB_WINDOW * EMB
rng = np.random.default_rng(7)

ap = argparse.ArgumentParser()
ap.add_argument('--wakeword', required=True)
ap.add_argument('--negfeat', required=True)
ap.add_argument('--models', default='public/models/wakeword')
ap.add_argument('--out', required=True)
ap.add_argument('--cache', help='fichier .npz des fenêtres calculées (réutilisé s\'il existe)')
ap.add_argument('--holdout', type=int, default=10, help='prises perso gardées pour le test')
ap.add_argument('--user-aug', type=int, default=30)
ap.add_argument('--piper-aug', type=int, default=6)
ap.add_argument('--rounds', type=int, default=3, help='tours de minage des faux positifs')
args = ap.parse_args()

so = ort.SessionOptions()
so.log_severity_level = 3
mel_sess = ort.InferenceSession(os.path.join(args.models, 'melspectrogram.onnx'), so)
emb_sess = ort.InferenceSession(os.path.join(args.models, 'embedding_model.onnx'), so)


def log(msg):
    print(msg, flush=True)


def load(path):
    audio, sr = sf.read(path, dtype='float32', always_2d=True)
    audio = audio.mean(axis=1)
    if sr != RATE:
        g = np.gcd(sr, RATE)
        audio = resample_poly(audio, RATE // g, sr // g).astype(np.float32)
    return audio


def embeddings(audio):
    """audio float [-1, 1] → (n, 96) embeddings, un toutes les 80 ms."""
    x = (np.clip(audio, -1, 1) * 32767).astype(np.float32)[None, :]
    mel = mel_sess.run(None, {mel_sess.get_inputs()[0].name: x})[0].squeeze() / 10 + 2
    n = (len(mel) - MEL_WINDOW) // 8 + 1
    if n <= 0:
        return np.zeros((0, EMB), np.float32)
    batch = np.stack([mel[i * 8:i * 8 + MEL_WINDOW] for i in range(n)])[..., None].astype(np.float32)
    return emb_sess.run(None, {emb_sess.get_inputs()[0].name: batch})[0].reshape(n, EMB)


def windows(e):
    if len(e) < EMB_WINDOW:
        return np.zeros((0, EMB_WINDOW, EMB), np.float32)
    return np.lib.stride_tricks.sliding_window_view(e, (EMB_WINDOW, EMB))[:, 0]


def word_bounds(audio):
    """Début et fin (en échantillons) de la parole, par énergie sur 20 ms."""
    frame = 320
    n = len(audio) // frame
    if n == 0:
        return 0, len(audio)
    rms = np.sqrt((audio[:n * frame].reshape(n, frame) ** 2).mean(axis=1) + 1e-10)
    db = 20 * np.log10(rms)
    voiced = np.where(db > db.max() - 30)[0]
    return voiced[0] * frame, (voiced[-1] + 1) * frame


def augment(audio):
    a = audio * rng.uniform(0.3, 1.6)
    if rng.random() < 0.5:  # petit écho de pièce
        ir_len = int(RATE * rng.uniform(0.05, 0.3))
        ir = rng.standard_normal(ir_len) * np.exp(-np.linspace(0, rng.uniform(4, 9), ir_len))
        ir[0] = 1.0
        a = np.convolve(a, ir / np.abs(ir).sum() * 2.5)[:len(a) + ir_len // 3]
    return a.astype(np.float32)


def add_noise(audio, snr_db):
    sig = np.sqrt((audio ** 2).mean() + 1e-10)
    noise = rng.standard_normal(len(audio)).astype(np.float32)
    if rng.random() < 0.5:  # bruit grave (ventilation, frigo)
        noise = np.cumsum(noise)
        noise -= np.convolve(noise, np.ones(64) / 64, mode='same')
    noise *= sig / (np.sqrt((noise ** 2).mean()) + 1e-10) / (10 ** (snr_db / 20))
    return audio + noise


def clip_windows(clip, aug=True):
    """Fenêtres où « Jean-Claude » vient de finir (positifs) et où il n'est pas fini (négatifs durs)."""
    start, end = word_bounds(clip)
    lead = max(0, start - 1600)
    clip, end = clip[lead:end + 800], end - lead
    if aug:
        clip = augment(clip)
    pre = int(RATE * rng.uniform(1.8, 2.6))
    audio = np.concatenate([np.zeros(pre, np.float32), clip, np.zeros(int(RATE * 0.6), np.float32)])
    w = windows(embeddings(add_noise(audio, rng.uniform(8, 35) if aug else 40)))
    # l'embedding k couvre les échantillons jusqu'à ~(8k + 76) * 160 + 400 ; w[i] finit à l'embedding i + 15
    k_end = int(np.ceil(((pre + end - 400) / 160 - MEL_WINDOW) / 8)) - (EMB_WINDOW - 1)
    return w[max(0, k_end):k_end + 4], w[:max(0, k_end - 5)]


def padded_windows(clip, aug=True):
    if aug:
        clip = augment(clip)
    a = np.concatenate([np.zeros(int(RATE * 2.2), np.float32), clip, np.zeros(int(RATE * 0.6), np.float32)])
    return windows(embeddings(add_noise(a, rng.uniform(8, 35) if aug else 40)))


# ---------- Fichiers ----------
root = args.wakeword
speakers = [d for d in sorted(os.listdir(root))
            if os.path.isdir(os.path.join(root, d)) and d not in ('piper', 'tts') and glob.glob(os.path.join(root, d, '*.wav'))]
user_train, user_test = [], []
for sp in speakers:
    files = sorted(glob.glob(os.path.join(root, sp, '*.wav')))
    rng.shuffle(files)
    user_test += files[:args.holdout]
    user_train += files[args.holdout:]
piper_pos = sorted(glob.glob(os.path.join(root, 'piper', 'positive', '*.wav')))
piper_neg = sorted(glob.glob(os.path.join(root, 'piper', 'negative', '*.wav')))
log(f'prises perso : {len(user_train)} entraînement, {len(user_test)} test ; piper : {len(piper_pos)} pos, {len(piper_neg)} neg')

# ---------- Fenêtres audio (positifs, débuts non finis, mots proches) ----------
if args.cache and os.path.exists(args.cache):
    c = np.load(args.cache)
    P, N_hard, N_near = c['P'], c['N_hard'], c['N_near']
    log(f'cache relu : {args.cache}')
else:
    P, N_hard, N_near = [], [], []
    for files, reps, keep in ((user_train, args.user_aug, 4), (piper_pos, args.piper_aug, 2)):
        for f in files:
            clip = load(f)
            for _ in range(reps):
                p, n = clip_windows(clip)
                P.append(p)
                N_hard.append(n[-keep:])
    for f in piper_neg:
        clip = load(f)
        for _ in range(3):
            N_near.append(padded_windows(clip))
    P, N_hard, N_near = (np.concatenate(x).astype(np.float32) for x in (P, N_hard, N_near))
    if args.cache:
        np.savez(args.cache, P=P, N_hard=N_hard, N_near=N_near)
log(f'positifs : {len(P)}, débuts non finis : {len(N_hard)}, mots proches : {len(N_near)}')

# ---------- Features openWakeWord publiées ----------
ROW = FLAT * 2  # float16
acav_files = [p for p in sorted(glob.glob(os.path.join(args.negfeat, 'acav_*.bin'))) if not p.endswith('acav_head.bin')]


def load_acav(path):
    offset = int(os.path.basename(path)[5:-4])
    raw = np.fromfile(path, dtype=np.uint8)
    raw = raw[(ROW - (offset - 128) % ROW) % ROW:]  # aligne sur une ligne entière (en-tête npy de 128 octets)
    return raw[:len(raw) // ROW * ROW].view(np.float16).reshape(-1, FLAT)


# Échantillon fixe pour l'entraînement de base ; toutes les tranches servent au minage, une à la fois
acav = np.concatenate([a[rng.choice(len(a), 120000 // len(acav_files), replace=False)] for a in map(load_acav, acav_files)])
val = np.load(os.path.join(args.negfeat, 'validation_set_features.npy')).astype(np.float32)


class Picked:
    """Sous-ensemble d'une vue de fenêtres, copié par petits morceaux seulement."""

    def __init__(self, view, idx):
        self.view, self.idx = view, idx

    def __len__(self):
        return len(self.idx)

    def __getitem__(self, key):
        return self.view[self.idx[key]]


# Le contenu du jeu de validation change au fil du flux : on alterne des blocs
# de ~3 min, un sur trois pour l'entraînement, les autres pour compter les fausses alertes
val_w = windows(val)
block = (np.arange(len(val_w)) // 2500) % 3 == 0
val_train = Picked(val_w, np.where(block)[0])
val_test = Picked(val_w, np.where(~block)[0])
log(f'ACAV100M : {len(acav)} fenêtres ; validation : {len(val_train)} entraînement, {len(val_test)} test ({len(val_test) * 0.08 / 3600:.1f} h)')

# ---------- Normalisation (repliée dans la 1re couche à l'export) ----------
mu = val.mean(axis=0)
sd = val.std(axis=0) + 1e-6
MU, SD = np.tile(mu, EMB_WINDOW), np.tile(sd, EMB_WINDOW)


def norm(x):
    return ((np.asarray(x, np.float32).reshape(-1, FLAT) - MU) / SD).astype(np.float32)


# ---------- Entraînement avec minage des faux positifs ----------
pos = norm(P)
base_neg = np.concatenate([norm(N_hard), norm(N_near), norm(acav), norm(val_train[::4])])
# les mots proches comptent double
base_w = np.concatenate([np.ones(len(N_hard)), np.full(len(N_near), 2.0), np.ones(len(base_neg) - len(N_hard) - len(N_near))])
mined = np.zeros((0, FLAT), np.float32)
pool = [lambda p=p: load_acav(p) for p in acav_files] + [lambda: val_train]


def score(clf, x, batch=50000):
    return np.concatenate([clf.predict_proba(norm(x[i:i + batch]))[:, 1] for i in range(0, len(x), batch)]) if len(x) else np.zeros(0)


for r in range(args.rounds):
    X = np.concatenate([base_neg, mined, pos])
    y = np.concatenate([np.zeros(len(base_neg) + len(mined)), np.ones(len(pos))])
    reps = max(1.0, (base_w.sum() + 6 * len(mined)) / (len(pos) * 8))  # positifs ≈ 1/8 du poids
    w = np.concatenate([base_w, np.full(len(mined), 6.0), np.full(len(pos), reps)])
    clf = MLPClassifier(hidden_layer_sizes=(64, 32), alpha=1e-2, batch_size=1024, learning_rate_init=1e-3, max_iter=12,
                        tol=1e-5, random_state=r)  # sans early_stopping : évite une copie de X en mémoire
    clf.fit(X, y, sample_weight=w)
    del X, y, w
    found = []
    for get in pool:
        src = get()
        s = score(clf, src)
        found.append(norm(src[s > 0.2]))
    found = np.concatenate(found)
    log(f'tour {r + 1} : {len(base_neg) + len(mined)} négatifs dont {len(mined)} minés, {len(pos)} positifs ×{reps:.1f}, '
        f'{clf.n_iter_} itérations, {len(found)} faux positifs trouvés')
    if len(found) > 30000:
        found = found[rng.choice(len(found), 30000, replace=False)]
    mined = np.concatenate([mined, found])

# ---------- Évaluation ----------
vs = score(clf, val_test)
hours = len(val_test) * 0.08 / 3600


def run_min(s, frames):
    """Score minimal sur `frames` blocs consécutifs (comme SENSITIVITIES.frames dans wakeListener.ts)."""
    s = np.asarray(s)
    return s if frames == 1 or len(s) < frames else np.lib.stride_tricks.sliding_window_view(s, frames).min(axis=1)


# Avec un peu de contexte autour de la fin du mot, pour que 2 blocs d'affilée soient possibles
test_clean = [score(clf, padded_windows(load(f), aug=False)) for f in user_test]
test_noisy = [score(clf, padded_windows(load(f))) for f in user_test]
near = [score(clf, padded_windows(load(f), aug=False)) for f in piper_neg[::5]]
for frames in (1, 2):
    for th in (0.5, 0.7, 0.9, 0.97):
        count, cooldown = 0, 0  # une alerte = un front montant, puis 2 s de pause
        for h in run_min(vs, frames) >= th:
            if cooldown:
                cooldown -= 1
            elif h:
                count, cooldown = count + 1, 25
        hit = lambda scores: sum(len(s) and run_min(s, frames).max() >= th for s in scores)
        log(f'{frames} bloc(s), seuil {th} : {count / hours:.2f} fausses alertes/h ; prises test {hit(test_clean)}/{len(test_clean)}, '
            f'avec bruit {hit(test_noisy)}/{len(test_noisy)} ; mots proches {hit(near)}/{len(near)}')

# ---------- Export ONNX : [1, 16, 96] → [1, 1] ----------
W0 = clf.coefs_[0] / SD[:, None]
b0 = clf.intercepts_[0] - (MU / SD) @ clf.coefs_[0]
coefs, biases = [W0] + clf.coefs_[1:], [b0] + clf.intercepts_[1:]
inits = [numpy_helper.from_array(np.array([-1, FLAT], np.int64), 'shape')]
nodes = [helper.make_node('Reshape', ['input', 'shape'], ['h0'])]
prev = 'h0'
for i, (W, b) in enumerate(zip(coefs, biases)):
    inits += [numpy_helper.from_array(W.astype(np.float32), f'W{i}'), numpy_helper.from_array(b.astype(np.float32), f'b{i}')]
    nodes.append(helper.make_node('Gemm', [prev, f'W{i}', f'b{i}'], [f'g{i}']))
    last = i == len(coefs) - 1
    nodes.append(helper.make_node('Sigmoid' if last else 'Relu', [f'g{i}'], ['score' if last else f'h{i + 1}']))
    prev = f'h{i + 1}'
graph = helper.make_graph(nodes, 'jean_claude', [helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, EMB_WINDOW, EMB])],
                          [helper.make_tensor_value_info('score', TensorProto.FLOAT, [1, 1])], inits)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, args.out)
check = ort.InferenceSession(args.out, so).run(None, {'input': P[:1]})[0][0][0]
log(f'modèle écrit : {args.out} ({os.path.getsize(args.out) // 1024} Ko), contrôle ONNX {check:.3f} vs {score(clf, P[:1])[0]:.3f}')
