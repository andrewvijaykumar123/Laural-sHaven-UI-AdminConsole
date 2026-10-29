/* Cloudflare Worker for the Laural's Haven admin console. Only the signed-in admin can use it.
     POST /send   sends one email straight away through Gmail SMTP (a few seconds, no GitHub Actions involved).
     POST /       starts a mailer workflow on GitHub (the scheduled fallback and the daily report).
   Secrets: GMAIL_APP_PASSWORD (Gmail app password of SENDER; /send answers 501 until it is set) and GH_TOKEN (fine-grained
   token, this repo only, Actions: read and write; needed only for POST /). */
import { connect } from 'cloudflare:sockets';

const PROJECT_ID = 'laural-shavencafe';
const ADMIN_UIDS = ['4FSqW048fSdUFMQZJ1OJVp7GLob2', 'Sa0bXzyAK6fGrOioIg7x9qizB792'];
const REPO = 'andrewvijaykumar123/Laural-sHaven-UI-AdminConsole';
const ORIGIN = 'https://andrewvijaykumar123.github.io';
const WORKFLOWS = ['mailer.yml', 'daily-report.yml'];
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const SENDER = 'andrewvijaykumar123@gmail.com';
const SHOP = "Laural's Haven";
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465; // implicit TLS
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const MAX_PER_WINDOW = 120; // emails per 10 minutes, per Worker instance
const WINDOW_MS = 600000;

const enc = new TextEncoder();
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

async function verifyAdmin(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return false;
  const header = json(b64(parts[0]));
  const claims = json(b64(parts[1]));
  if (header.alg !== 'RS256') return false;
  const { keys } = await (await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = enc.encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]), signed))) return false;
  const now = Date.now() / 1000;
  return claims.aud === PROJECT_ID
    && claims.iss === `https://securetoken.google.com/${PROJECT_ID}`
    && claims.exp > now && claims.iat <= now + 60
    && ADMIN_UIDS.includes(claims.sub)
    && claims.firebase && claims.firebase.sign_in_provider === 'password';
}

/* ---------- Minimal SMTP client (RFC 5321 over an implicit-TLS socket) ---------- */
const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const wrap64 = (text) => (toB64(enc.encode(text)).match(/.{1,76}/g) || ['']).join('\r\n');
const oneLine = (s) => String(s ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();
// RFC 2047 encoded words for non-ASCII header text (split by characters so multi-byte letters are never cut).
const header = (s) => {
  const t = oneLine(s);
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  const chars = Array.from(t);
  const words = [];
  for (let i = 0; i < chars.length; i += 12) words.push(`=?UTF-8?B?${toB64(enc.encode(chars.slice(i, i + 12).join('')))}?=`);
  return words.join('\r\n ');
};

function buildMessage({ from, name, to, subject, text, html, id }) {
  const boundary = `lh_${id}`;
  return [
    `From: ${header(name)} <${from}>`,
    `To: <${to}>`,
    `Reply-To: <${from}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@laurals-haven.workers.dev>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap64(html),
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out`)), ms); })]).finally(() => clearTimeout(t));
}

/* open() returns a socket with { readable, writable } (Workers connect() or a test double). */
async function smtpSend({ open, user, pass, to, subject, text, html, name = SHOP, timeoutMs = 15000 }) {
  const sock = open();
  const reader = sock.readable.getReader();
  const writer = sock.writable.getWriter();
  const dec = new TextDecoder();
  let buf = '';

  async function reply() {
    for (;;) {
      const lines = buf.split('\r\n');
      const done = lines.slice(0, -1).findIndex((l) => /^\d{3}( |$)/.test(l));
      if (done >= 0) {
        buf = lines.slice(done + 1).join('\r\n');
        const last = lines[done];
        return { code: Number(last.slice(0, 3)), text: lines.slice(0, done + 1).map((l) => l.slice(4)).join(' ') };
      }
      const { value, done: closed } = await withTimeout(reader.read(), timeoutMs, 'SMTP read');
      if (closed) throw new Error('SMTP connection closed');
      buf += dec.decode(value, { stream: true });
    }
  }
  const cmd = async (line, ok, secret) => {
    await withTimeout(writer.write(enc.encode(`${line}\r\n`)), timeoutMs, 'SMTP write');
    const r = await reply();
    if (!ok.includes(r.code)) throw new Error(`SMTP ${secret ? 'AUTH' : line.split(' ')[0]} failed: ${r.code} ${r.text.slice(0, 120)}`);
    return r;
  };

  try {
    const hello = await reply();
    if (hello.code !== 220) throw new Error(`SMTP greeting failed: ${hello.code}`);
    await cmd('EHLO laurals-haven.workers.dev', [250]);
    await cmd(`AUTH PLAIN ${toB64(enc.encode(`\u0000${user}\u0000${pass}`))}`, [235], true);
    await cmd(`MAIL FROM:<${user}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const id = crypto.randomUUID();
    const msg = buildMessage({ from: user, name, to, subject, text, html, id }).replace(/^\./gm, '..');
    await withTimeout(writer.write(enc.encode(`${msg}\r\n.\r\n`)), timeoutMs, 'SMTP write');
    const sent = await reply();
    if (sent.code !== 250) throw new Error(`SMTP DATA failed: ${sent.code} ${sent.text.slice(0, 120)}`);
    try { await writer.write(enc.encode('QUIT\r\n')); } catch (e) { /* already closed */ }
    return { id };
  } finally {
    try { reader.releaseLock(); writer.releaseLock(); } catch (e) { /* ignore */ }
    try { await sock.close(); } catch (e) { /* ignore */ }
  }
}

/* ---------- Request handling ---------- */
const recent = [];
function allowSend(now = Date.now()) {
  while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_WINDOW) return false;
  recent.push(now);
  return true;
}

async function handleSend(body, env, open) {
  if (!env.GMAIL_APP_PASSWORD) return [501, 'Email sending is not configured on the relay'];
  const to = oneLine(body.to).toLowerCase();
  const subject = oneLine(body.subject);
  const text = typeof body.text === 'string' ? body.text : '';
  const html = typeof body.html === 'string' ? body.html : '';
  if (!EMAIL_RE.test(to) || to.length > 120) return [400, 'Invalid recipient'];
  if (!subject || subject.length > 200 || !text || text.length > 30000 || !html || html.length > 150000) return [400, 'Invalid message'];
  if (!allowSend()) return [429, 'Too many emails, slow down'];
  try {
    await smtpSend({ open, user: env.GMAIL_USER || SENDER, pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, ''), to, subject, text, html });
    return [204, null];
  } catch (e) {
    return [502, String(e && e.message || 'SMTP error').slice(0, 200)];
  }
}

const worker = {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin'
    };
    const reply = (status, text) => new Response(text || null, { status, headers: cors });
    if (req.method === 'OPTIONS') return reply(204);
    if (req.method !== 'POST') return reply(405, 'Method not allowed');

    let ok = false;
    try { ok = await verifyAdmin((req.headers.get('Authorization') || '').replace(/^Bearer /, '')); } catch (e) { ok = false; }
    if (!ok) return reply(401, 'Unauthorized');

    let body;
    try { body = await req.json(); } catch (e) { return reply(400, 'Bad request'); }
    if (!body || typeof body !== 'object') return reply(400, 'Bad request');

    if (new URL(req.url).pathname === '/send') {
      const [status, text] = await handleSend(body, env, () => connect({ hostname: SMTP_HOST, port: SMTP_PORT }, { secureTransport: 'on', allowHalfOpen: false }));
      return reply(status, text);
    }

    if (!WORKFLOWS.includes(body.workflow)) return reply(400, 'Unknown workflow');
    const inputs = body.workflow === 'daily-report.yml' && /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? { date: body.date } : undefined;

    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${body.workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'laurals-haven-relay',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main', ...(inputs ? { inputs } : {}) })
    });
    let detail = '';
    if (r.status !== 204) { try { detail = String((await r.json()).message || '').slice(0, 120); } catch (e) { /* no body */ } }
    return reply(r.status === 204 ? 204 : 502, r.status === 204 ? null : `GitHub ${r.status}: ${detail}`);
  }
};

export default worker;
