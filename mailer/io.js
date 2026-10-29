'use strict';
/* Real Firestore store and Gmail SMTP transport for the mailer scripts. */
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { SHOP } = require('./lib');

const SENDER = 'andrewvijaykumar123@gmail.com';

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
    menu: async () => { const s = await db.doc('config/menu').get(); return s.exists ? s.data() : null; },
    recentOrders: async (sinceMs) => mapOrders(await db.collection('orders').where('at', '>=', admin.firestore.Timestamp.fromMillis(sinceMs)).limit(1000).get()),
    ordersBetween: async (a, b) => mapOrders(await db.collection('orders').where('at', '>=', admin.firestore.Timestamp.fromMillis(a)).where('at', '<', admin.firestore.Timestamp.fromMillis(b)).limit(2000).get()),
    status: async (id) => { const s = await db.doc(`status/${id}`).get(); return s.exists ? s.data() : null; },
    mail: async (id) => { const s = await db.doc(`mail/${id}`).get(); return s.exists ? s.data() : null; },
    claimed: async (id, key, now) => { const s = await db.doc(`mailq/${id}_${key}`).get(); const at = s.exists && s.data().at; return !!(at && at.toMillis && now - at.toMillis() < 180000); },
    setMail: (id, patch) => db.doc(`mail/${id}`).set(patch, { merge: true })
  };
}

function transport() {
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: SENDER, pass: need('GMAIL_APP_PASSWORD').replace(/\s+/g, '') } });
  return (msg) => t.sendMail({ from: `"${SHOP}" <${SENDER}>`, replyTo: SENDER, ...msg });
}

module.exports = { connect, transport, SENDER };
