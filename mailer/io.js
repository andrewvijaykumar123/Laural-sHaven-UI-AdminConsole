'use strict';
/* Real Firestore store and Gmail transport for the mailer scripts: OAuth 2.0 over the Gmail API, or an app password over SMTP as a fallback. */
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { SHOP } = require('./lib');

const SENDER = 'lauralshavensupport@gmail.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing secret ${name}`); process.exit(1); }
  return v;
}

function connect() {
  const cred = JSON.parse(need('FIREBASE_SERVICE_ACCOUNT'));
  admin.initializeApp({ credential: admin.credential.cert(cred) });
  const db = admin.firestore();
  const ts = (d) => (d.at && d.at.toMillis ? d.at.toMillis() : 0);
  const mapOrders = (snap) => snap.docs.map((d) => ({ id: d.id, data: d.data(), ts: ts(d.data()) })).filter((x) => x.ts);
  return {
    config: async () => { const s = await db.doc('config/store').get(); return s.exists ? s.data() : {}; },
    recentOrders: async (sinceMs) => mapOrders(await db.collection('orders').where('at', '>=', admin.firestore.Timestamp.fromMillis(sinceMs)).limit(1000).get()),
    ordersBetween: async (a, b) => mapOrders(await db.collection('orders').where('at', '>=', admin.firestore.Timestamp.fromMillis(a)).where('at', '<', admin.firestore.Timestamp.fromMillis(b)).limit(2000).get()),
    status: async (id) => { const s = await db.doc(`status/${id}`).get(); return s.exists ? s.data() : null; },
    mail: async (id) => { const s = await db.doc(`mail/${id}`).get(); return s.exists ? s.data() : null; },
    claimed: async (id, key, now) => { const s = await db.doc(`mailq/${id}_${key}`).get(); const at = s.exists && s.data().at; return !!(at && at.toMillis && now - at.toMillis() < 180000); },
    setMail: (id, patch) => db.doc(`mail/${id}`).set(patch, { merge: true })
  };
}

const hasOAuth = () => !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
const fail = (what, code) => Object.assign(new Error(what), { code });
let cached = { token: '', exp: 0 };

async function accessToken() {
  if (cached.token && cached.exp - 60000 > Date.now()) return cached.token;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID, client_secret: process.env.GMAIL_CLIENT_SECRET, refresh_token: process.env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw fail('Google sign-in failed', `oauth_${String(j.error || r.status).slice(0, 40)}`);
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

function transport() {
  const from = `"${SHOP}" <${SENDER}>`;
  if (!hasOAuth()) {
    const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: SENDER, pass: need('GMAIL_APP_PASSWORD').replace(/\s+/g, '') } });
    return (msg) => t.sendMail({ from, replyTo: SENDER, ...msg });
  }
  // nodemailer only builds the MIME message; the Gmail API (scope gmail.send) delivers it.
  const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  return async (msg) => {
    const { message } = await builder.sendMail({ from, replyTo: SENDER, ...msg });
    const r = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: message.toString('base64url') })
    });
    if (!r.ok) {
      if (r.status === 401) cached = { token: '', exp: 0 };
      throw fail(`Gmail API ${r.status}`, `gmail_${r.status}`);
    }
  };
}

module.exports = { connect, transport, SENDER };
