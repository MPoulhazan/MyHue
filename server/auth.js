// Auth par token pour l'accès distant (Cloudflare Tunnel).
// Le LAN reste libre : la tablette et le bot Telegram n'ont rien à configurer.
// Une requête venue du tunnel porte toujours cf-connecting-ip (ajouté par
// Cloudflare), même si cloudflared tourne sur la machine elle-même.

import { createHash, timingSafeEqual } from 'crypto';

export const TOKEN = process.env.MYHUE_TOKEN || '';
const COOKIE = 'myhue_token';
const ONE_YEAR_S = 365 * 24 * 3600;

const PRIVATE_IP =
    /^(::1$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:|fe80:)/i;

const isRemote = (req) => {
    if (req.headers['cf-connecting-ip']) return true;
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    return !PRIVATE_IP.test(ip);
};

const sha = (value) => createHash('sha256').update(String(value)).digest();
export const isValidToken = (candidate) =>
    Boolean(TOKEN && candidate) && timingSafeEqual(sha(candidate), sha(TOKEN));

const readCookie = (req, name) => {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
};

const readToken = (req) => {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return readCookie(req, COOKIE);
};

const loginPage = (error) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MyHue</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f17;color:#e6edf7;font-family:system-ui,sans-serif}
form{display:flex;flex-direction:column;gap:12px;width:min(320px,90vw)}
input,button{font:inherit;padding:12px;border-radius:10px;border:1px solid #2a3446;background:#121826;color:inherit}
button{background:#3b82f6;border-color:#3b82f6;cursor:pointer}
p{margin:0;color:#f87171}
</style></head><body>
<form method="post" action="/login">
<h1>MyHue</h1>
${error ? '<p>Token invalide.</p>' : ''}
<input name="token" type="password" placeholder="Token d'accès" autocomplete="current-password" autofocus>
<button type="submit">Entrer</button>
</form></body></html>`;

const setSessionCookie = (req, res) => {
    const secure = req.headers['x-forwarded-proto'] === 'https' || isRemote(req);
    res.setHeader(
        'Set-Cookie',
        `${COOKIE}=${encodeURIComponent(TOKEN)}; Path=/; Max-Age=${ONE_YEAR_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    );
};

// À monter avant toutes les routes protégées
export const installAuth = (app, express) => {
    if (!TOKEN) {
        console.warn('⚠️  MYHUE_TOKEN absent : aucune auth, ne pas exposer MyHue hors du LAN');
        return;
    }

    // GET /login?token=... : lien à ouvrir une fois sur le téléphone
    app.get('/login', (req, res) => {
        if (isValidToken(req.query.token)) {
            setSessionCookie(req, res);
            return res.redirect('/');
        }
        res.status(req.query.token ? 401 : 200).type('html').send(loginPage(Boolean(req.query.token)));
    });

    app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
        if (!isValidToken(req.body?.token)) {
            return res.status(401).type('html').send(loginPage(true));
        }
        setSessionCookie(req, res);
        res.redirect('/');
    });

    app.use((req, res, next) => {
        // /mcp/<token> se valide dans sa propre route
        if (req.path.startsWith('/mcp/')) return next();
        if (!isRemote(req) || isValidToken(readToken(req))) return next();
        if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/')) {
            return res.redirect('/login');
        }
        res.status(401).json({ error: 'Unauthorized' });
    });
};
