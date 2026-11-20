/* Cloudflare Worker for the Laural's Haven admin console. Email and workflow routes are for the signed-in admin only.
     POST /send   sends one email straight away through Gmail SMTP (a few seconds, no GitHub Actions involved).
     POST /       starts a mailer workflow on GitHub (the scheduled fallback and the daily report).
   Background notifications (Web Push, work with the app closed), any signed-in Firebase user unless noted:
     POST /push/sub     registers this device. role "admin" (admin only) gets new-order alerts; role "shop" follows one order or booking the caller owns.
     POST /push/notify  a customer's device reports its new order, booking or cancellation; the Worker checks it in Firestore with the caller's own token, then alerts the admin devices.
     POST /push/status  admin only: tells the customer's device that an order or booking changed status.
     POST /push/test    admin only: sends a test notification to the device that is registering.
     POST /push/unsub   admin only: forgets an admin device.
   Secrets: GMAIL_APP_PASSWORD (Gmail app password of SENDER; /send answers 501 until it is set) and GH_TOKEN (fine-grained
   token, this repo only, Actions: read and write; needed only for POST /). For push: a KV namespace bound as PUSH and the secret
   VAPID_PRIVATE_JWK (the private JWK printed by tools/gen-vapid.mjs); /push/* answers 501 until both exist. */
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
const MAX_PER_RECIPIENT = 8; // emails per 10 minutes to one address, so the relay cannot be used to mail-bomb someone
const WINDOW_MS = 600000;

const enc = new TextEncoder();
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

// Verifies a Firebase ID token (signature, audience, issuer, expiry) and returns its claims, or null.
async function verifyUser(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  const header = json(b64(parts[0]));
  const claims = json(b64(parts[1]));
  if (header.alg !== 'RS256') return null;
  const { keys } = await (await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = enc.encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]), signed))) return null;
  const now = Date.now() / 1000;
  const ok = claims.aud === PROJECT_ID
    && claims.iss === `https://securetoken.google.com/${PROJECT_ID}`
    && claims.exp > now && claims.iat <= now + 60
    && typeof claims.sub === 'string' && claims.sub.length > 0;
  return ok ? claims : null;
}

const isAdminClaims = (claims) => !!claims && ADMIN_UIDS.includes(claims.sub) && !!claims.firebase && claims.firebase.sign_in_provider === 'password';

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
const byRecipient = new Map();
function allowSend(now = Date.now(), to = '') {
  while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_WINDOW) return false;
  const times = (byRecipient.get(to) || []).filter((t) => now - t <= WINDOW_MS);
  if (to && times.length >= MAX_PER_RECIPIENT) return false;
  for (const [k, v] of byRecipient) if (!v.some((t) => now - t <= WINDOW_MS)) byRecipient.delete(k);
  recent.push(now);
  if (to) { times.push(now); byRecipient.set(to, times); }
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
  if (!allowSend(Date.now(), to)) return [429, 'Too many emails, slow down'];
  try {
    await smtpSend({ open, user: env.GMAIL_USER || SENDER, pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, ''), to, subject, text, html });
    return [204, null];
  } catch (e) {
    return [502, String(e && e.message || 'SMTP error').slice(0, 200)];
  }
}

/* ---------- Web Push (RFC 8030 delivery, RFC 8291 encryption, RFC 8292 VAPID) ---------- */
const b64u = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// aes128gcm body for one push message. `fixed` (an ECDH key pair and a salt) exists so the RFC 8291 test vector can be checked.
async function encryptPayload(sub, plaintext, fixed = {}) {
  const ua = b64(sub.keys.p256dh);
  const auth = b64(sub.keys.auth);
  const eph = fixed.eph || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const prk = await hkdf(auth, secret, concat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPub.length]), asPub, sealed);
}

async function vapidAuth(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: `mailto:${SENDER}` })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${b64u(concat(new Uint8Array([4]), b64(jwk.x), b64(jwk.y)))}`;
}

// Only the browsers' own push services are ever contacted, never an address a client made up.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
function cleanEndpoint(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !PUSH_HOSTS.test(u.hostname) || u.href.length > 700) return null;
  return u.href;
}
function cleanSub(s) {
  if (!s || typeof s !== 'object') return null;
  const endpoint = cleanEndpoint(s.endpoint);
  if (!endpoint) return null;
  const k = s.keys && typeof s.keys === 'object' ? s.keys : {};
  try {
    const p = b64(String(k.p256dh));
    const a = b64(String(k.auth));
    if (p.length !== 65 || p[0] !== 4 || a.length !== 16) return null;
  } catch (e) { return null; }
  return { endpoint, keys: { p256dh: String(k.p256dh), auth: String(k.auth) } };
}

// 'sent', 'gone' (the subscription is dead and should be forgotten) or 'failed'.
async function pushOne(env, sub, payload) {
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: await vapidAuth(sub.endpoint, env) },
      body
    });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.status >= 200 && r.status < 300 ? 'sent' : 'failed';
  } catch (e) { return 'failed'; }
}

const hashOf = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('');
const ID_RE = { order: /^LH-[A-Z0-9]{6,10}$/, event: /^EV-[A-Z0-9]{6,10}$/ };
const MAX_ADMIN_DEVICES = 25;
const DAY = 86400;
const SVC = { dine: 'Dine-in', take: 'Takeaway', deliver: 'Home delivery' };
const ORDER_PUSH = {
  accepted: ['Order accepted', 'is accepted and will be cooked shortly.'], cooking: ['Cooking now', 'is being prepared.'], ready: ['Ready!', 'is ready.'],
  out: ['On its way', 'is out for delivery.'], completed: ['Order complete', 'is complete. Thank you!'], rejected: ['Order not accepted', 'could not be accepted.']
};
const EVENT_PUSH = {
  confirmed: ['Booking confirmed', 'is confirmed. See you there!'], declined: ['Booking declined', 'could not be accepted.'],
  cancelled: ['Booking cancelled', 'has been cancelled.'], completed: ['Thank you', 'is complete. Thank you for celebrating with us!']
};

async function readDoc(path, idToken) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
  return r.ok ? r.json() : null;
}
function field(doc, k) {
  const v = doc && doc.fields && doc.fields[k];
  if (!v) return undefined;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  return v.stringValue ?? v.doubleValue ?? v.booleanValue;
}
const freshMs = (doc, key = 'createTime') => { const t = Date.parse(doc && doc[key]); return Number.isFinite(t) ? Date.now() - t : Infinity; };

const pushHits = new Map();
function allowPush(uid, now = Date.now()) {
  const times = (pushHits.get(uid) || []).filter((t) => now - t <= WINDOW_MS);
  if (times.length >= 30) { pushHits.set(uid, times); return false; }
  times.push(now);
  pushHits.set(uid, times);
  for (const [k, v] of pushHits) if (!v.some((t) => now - t <= WINDOW_MS)) pushHits.delete(k);
  return true;
}

async function alertAdmins(env, payload) {
  const { keys } = await env.PUSH.list({ prefix: 'a:', limit: MAX_ADMIN_DEVICES });
  await Promise.all(keys.map(async ({ name }) => {
    const rec = await env.PUSH.get(name, 'json');
    if (!rec || !rec.sub) return;
    if ((await pushOne(env, rec.sub, payload)) === 'gone') await env.PUSH.delete(name);
  }));
  return keys.length;
}

/* body: parsed JSON; who: { token, claims, admin }. Returns [status, text]. */
async function handlePush(path, body, who, env) {
  if (!env.PUSH || !env.VAPID_PRIVATE_JWK) return [501, 'Notifications are not configured on the relay'];
  if (!allowPush(who.claims.sub)) return [429, 'Too many requests, slow down'];
  const kind = body.k === 'event' ? 'event' : 'order';

  if (path === '/push/sub') {
    const sub = cleanSub(body.sub);
    if (!sub) return [400, 'Invalid subscription'];
    if (body.role === 'admin') {
      if (!who.admin) return [401, 'Unauthorized'];
      const key = `a:${await hashOf(sub.endpoint)}`;
      if (!(await env.PUSH.get(key))) {
        const { keys } = await env.PUSH.list({ prefix: 'a:', limit: MAX_ADMIN_DEVICES + 1 });
        if (keys.length >= MAX_ADMIN_DEVICES) return [429, 'Too many admin devices'];
      }
      await env.PUSH.put(key, JSON.stringify({ sub, ts: Date.now() }), { expirationTtl: 90 * DAY });
      return [204, null];
    }
    if (!ID_RE[kind].test(String(body.id))) return [400, 'Invalid id'];
    // The caller can only read documents that are theirs, so a successful read proves it is their order or booking.
    if (!(await readDoc(`${kind === 'event' ? 'events' : 'orders'}/${body.id}`, who.token))) return [403, 'Not your order'];
    await env.PUSH.put(`o:${body.id}`, JSON.stringify({ sub, ts: Date.now() }), { expirationTtl: (kind === 'event' ? 120 : 3) * DAY });
    return [204, null];
  }

  if (path === '/push/notify') {
    const what = body.k === 'cancel' ? 'cancel' : kind;
    if (!ID_RE[what === 'event' ? 'event' : 'order'].test(String(body.id))) return [400, 'Invalid id'];
    const doc = await readDoc(`${what === 'event' ? 'events' : what === 'cancel' ? 'status' : 'orders'}/${body.id}`, who.token);
    if (!doc) return [403, 'Not found'];
    if (what === 'cancel' ? (field(doc, 's') !== 'rejected' || field(doc, 'r') !== 'Cancelled by customer' || freshMs(doc, 'updateTime') > 15 * 60000) : freshMs(doc) > 15 * 60000) return [409, 'Too old'];
    const mark = `d:${what}:${body.id}`;
    if (await env.PUSH.get(mark)) return [204, null];
    await env.PUSH.put(mark, '1', { expirationTtl: 3600 });
    const text = what === 'event' ? ['New event request', `${body.id} \u00b7 ${Number(field(doc, 'g')) || 0} guests \u00b7 ${String(field(doc, 'd') || '').slice(0, 10)}`, '#events']
      : what === 'cancel' ? ['Order cancelled', `${body.id} was cancelled by the customer.`, '#orders']
        : ['New order', `${body.id} \u00b7 \u20b9${Number(field(doc, 'total')) || 0} \u00b7 ${SVC[field(doc, 'svc')] || 'Order'}`, '#orders'];
    await alertAdmins(env, { t: text[0], b: text[1], g: `${what}-${body.id}`, h: text[2] });
    return [204, null];
  }

  if (!who.admin) return [401, 'Unauthorized'];

  if (path === '/push/status') {
    const map = kind === 'event' ? EVENT_PUSH : ORDER_PUSH;
    if (!ID_RE[kind].test(String(body.id)) || !Object.hasOwn(map, body.s)) return [400, 'Invalid status'];
    const rec = await env.PUSH.get(`o:${body.id}`, 'json');
    if (!rec || !rec.sub) return [204, null];
    const reason = body.s === 'rejected' || body.s === 'declined' || body.s === 'cancelled' ? oneLine(body.r).slice(0, 80) : '';
    const word = kind === 'event' ? 'Booking' : 'Order';
    const payload = { t: map[body.s][0], b: `${word} ${body.id} ${map[body.s][1]}${reason ? ` Reason: ${reason}` : ''}`, g: body.id, h: kind === 'event' ? '#events' : '#orders' };
    if ((await pushOne(env, rec.sub, payload)) === 'gone') await env.PUSH.delete(`o:${body.id}`);
    return [204, null];
  }

  if (path === '/push/test') {
    const sub = cleanSub(body.sub);
    if (!sub) return [400, 'Invalid subscription'];
    const res = await pushOne(env, sub, { t: "Laural's Haven", b: 'Notifications are on for this device.', g: 'test', h: '' });
    return res === 'sent' ? [204, null] : [502, 'The push service did not accept the message'];
  }

  if (path === '/push/unsub') {
    const endpoint = cleanEndpoint(body.endpoint);
    if (!endpoint) return [400, 'Invalid subscription'];
    await env.PUSH.delete(`a:${await hashOf(endpoint)}`);
    return [204, null];
  }
  return [404, 'Not found'];
}

const worker = {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    };
    const reply = (status, text) => new Response(text || null, { status, headers: cors });
    if (req.method === 'OPTIONS') return reply(204);
    if (req.method !== 'POST') return reply(405, 'Method not allowed');

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    let claims = null;
    try { claims = await verifyUser(token); } catch (e) { claims = null; }
    if (!claims) return reply(401, 'Unauthorized');
    const admin = isAdminClaims(claims);
    const path = new URL(req.url).pathname;
    if (!path.startsWith('/push/') && !admin) return reply(401, 'Unauthorized');

    let body;
    try { body = await req.json(); } catch (e) { return reply(400, 'Bad request'); }
    if (!body || typeof body !== 'object') return reply(400, 'Bad request');

    if (path.startsWith('/push/')) {
      try {
        const [status, text] = await handlePush(path, body, { token, claims, admin }, env);
        return reply(status, text);
      } catch (e) { return reply(502, 'Push failed'); }
    }

    if (path === '/send') {
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
