import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;
const ERP_BASE = 'https://rgipterp.com';
const LOGIN_URL = `${ERP_BASE}/erp/login.php`;

const allowedOrigins = [
  /^http:\/\/localhost(:\d+)?$/,          // local dev
  /^https:\/\/.*\.vercel\.app$/,           // Vercel preview + prod domains
];
if (process.env.ALLOWED_ORIGIN) {
  allowedOrigins.push(process.env.ALLOWED_ORIGIN); // custom domain if any
}

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Connection: 'keep-alive',
};

// ── Stateless Session Store using Token Encryption ──────────
const SESSION_SECRET = process.env.SESSION_SECRET || 'a_secure_fallback_secret_for_ergipterp__';
const ENCRYPTION_KEY = crypto.scryptSync(SESSION_SECRET, 'salt', 32);

function encryptSession(data) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return Buffer.from(`${iv.toString('hex')}:${encrypted}`).toString('base64');
}

function decryptSession(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    const parts = decoded.split(':');
    if (parts.length !== 2) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
}

app.use(cors({ 
  origin: allowedOrigins, 
  credentials: true,
  exposedHeaders: ['x-new-token'] 
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Cookie helpers ──────────────────────────────────────────────────────────

function parseSetCookies(headers) {
  const raw = headers.raw()['set-cookie'] || [];
  const map = {};
  raw.forEach(h => {
    const [pair] = h.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) {
      map[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  });
  return map;
}

function mergeCookies(existing, incoming) {
  return { ...existing, ...(incoming || {}) };
}

function serialise(map) {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ── Auth middleware: decrypt token from Authorization header ──────────────────
function getSession(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const sess = decryptSession(token);
  if (!sess) return null;
  
  // Expiry check (6 hours)
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  if (sess.createdAt < cutoff) return null;

  return sess;
}

// ── Generic proxy ──────────────────────────────────────────────────────────

app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (!url.startsWith(ERP_BASE)) return res.status(403).json({ error: 'URL not allowed' });

  const sess = getSession(req);
  if (!sess || Object.keys(sess.erpCookieMap).length === 0) {
    return res.status(401).json({ error: 'Session expired', message: 'Please log in first.' });
  }

  try {
    const response = await fetch(url, {
      headers: { ...COMMON_HEADERS, Cookie: serialise(sess.erpCookieMap), Referer: ERP_BASE },
      redirect: 'manual',
    });

    // Persist any new cookies ERP sends
    const newCookies = parseSetCookies(response.headers);
    if (Object.keys(newCookies).length > 0) {
      sess.erpCookieMap = mergeCookies(sess.erpCookieMap, newCookies);
      res.setHeader('x-new-token', encryptSession(sess));
    }

    if (response.status === 301 || response.status === 302) {
      return res.status(401).json({ error: 'Session expired' });
    }

    const html = await response.text();

    if (html.includes('name="roll_email"') || html.includes('name="verif_box"')) {
      return res.status(401).json({ error: 'Session expired' });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy failed', details: err.message });
  }
});

// ── Login ──────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credentials required' });

  try {
    // 1. GET login page — capture PHPSESSID + captcha
    const getResp = await fetch(LOGIN_URL, {
      headers: { ...COMMON_HEADERS },
      redirect: 'follow',
    });

    let cookieMap = parseSetCookies(getResp.headers);
    console.log(`[login] GET cookies: ${JSON.stringify(Object.keys(cookieMap))}`);

    const html = await getResp.text();

    const captchaMatch = html.match(/class=["']captcha-code["'][^>]*>\s*(\d+)\s*</i);
    const captchaVal = captchaMatch ? captchaMatch[1].trim() : '';
    console.log(`[login] Captcha: '${captchaVal}', PHPSESSID: ${cookieMap['PHPSESSID']}`);

    if (!captchaVal) {
      return res.status(500).json({ error: 'Could not read captcha from ERP login page.' });
    }

    // 2. POST credentials with same PHPSESSID
    const formBody = new URLSearchParams({
      roll_email: username,
      password,
      verif_box: captchaVal,
      login_btnid: '',
    }).toString();

    const postResp = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: serialise(cookieMap),
        Referer: LOGIN_URL,
        Origin: ERP_BASE,
      },
      body: formBody,
      redirect: 'manual',
    });

    const postCookies = parseSetCookies(postResp.headers);
    cookieMap = mergeCookies(cookieMap, postCookies);

    const redirectUrl = postResp.headers.get('location') || '';
    console.log(`[login] POST → ${postResp.status} | redirect: ${redirectUrl}`);

    if (postResp.status === 302) {
      const isSuccess = !redirectUrl.toLowerCase().includes('login.php');
      if (isSuccess) {
        // Follow redirect to pick up any further cookies
        const followResp = await fetch(`${ERP_BASE}${redirectUrl.startsWith('/') ? '' : '/erp/'}${redirectUrl.replace(/^.*\/erp\//, '')}`, {
          headers: { ...COMMON_HEADERS, Cookie: serialise(cookieMap) },
          redirect: 'manual',
        }).catch(() => null);
        if (followResp) {
          cookieMap = mergeCookies(cookieMap, parseSetCookies(followResp.headers));
        }

        // Create a stateless encrypted token
        const token = encryptSession({ erpCookieMap: cookieMap, createdAt: Date.now() });
        console.log(`[login] ✅ Login success. Token created, ${Object.keys(cookieMap).length} cookies stored.`);
        return res.json({ success: true, token });
      } else {
        console.log(`[login] ❌ Redirected back to login — bad credentials/captcha`);
        return res.status(401).json({ success: false, error: 'Invalid credentials. Please try again.' });
      }
    }

    return res.status(401).json({ success: false, error: 'Login failed. Check credentials.' });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// ── Session check ──────────────────────────────────────────────────────────
app.get('/api/session', (req, res) => {
  const sess = getSession(req);
  res.json({ active: !!(sess && Object.keys(sess.erpCookieMap).length > 0) });
});

// ── Serve React frontend (Railway & Local) ──────────────────────────────────
import path from 'path';
import { fileURLToPath } from 'url';

// Vercel serverless functions export the Express app
export default app;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, '../dist');

// Only setup static serving if we aren't executing within Vercel
if (!process.env.VERCEL) {
  app.use(express.static(distPath));

  // All non-API routes → React's index.html (handles React Router)
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });

  // Listen for local/Railway deployment
  app.listen(PORT, () => {
    console.log(`\n🚀 ERP Proxy API running at port ${PORT}`);
    console.log(`   ERP: ${ERP_BASE}\n`);
  });
}
