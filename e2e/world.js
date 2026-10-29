'use strict';
/* End-to-end test world: serves both apps, replaces Firebase with an in-process fake Firestore (rules-lite, live snapshots),
   fakes the Cloudflare relay (records every email) and drives Microsoft Edge through Playwright.
   It exercises the apps' own logic; it cannot prove the real firestore.rules or real SMTP delivery. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadCore } = require('../mailer/lib');

function loadPlaywright() {
  try { return require('playwright-core'); } catch (e) { /* fall through */ }
  return require(path.join(process.env.TEMP || '', 'lhrules', 'node_modules', 'playwright-core'));
}

const ADMIN_UID = '4FSqW048fSdUFMQZJ1OJVp7GLob2';
const ADMIN_EMAIL = 'admin@laurals.test';
const ADMIN_PASSWORD = 'correct-horse-battery';
const RELAY_HOST = 'lauralshaven.andrewvijaykumar123.workers.dev';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

class Db {
  constructor(LH) { this.LH = LH; this.docs = new Map(); this.listeners = new Map(); this.anon = 0; this.latency = 40; this.writes = []; }

  val(v) { return v && typeof v === 'object' && v.__ts !== undefined ? v.__ts : v; }
  cfg() { return this.docs.get('config/store') || {}; }

  validOrder(d, id, uid) {
    const it = (Array.isArray(d.it) ? d.it : []).map((s) => { const i = String(s).lastIndexOf(':'); return [String(s).slice(0, i), Number(String(s).slice(i + 1))]; });
    const o = this.LH.validateOrder({ id: d.id, ts: Date.now(), n: d.n, p: d.p, em: d.em, nt: d.nt, pay: d.pay, svc: d.svc, tbl: d.tbl, addr: d.addr, lat: d.lat, lng: d.lng, otp: d.otp, it });
    if (!o || d.id !== id || d.uid !== uid || !d.at || !d.at.__serverTs || o.total !== d.total) return false;
    // The delivery code is optional, 4 digits, delivery orders only; noOtpRules simulates rules published before the feature existed.
    if ('otp' in d && (this.noOtpRules || d.svc !== 'deliver' || !/^[0-9]{4}$/.test(String(d.otp)))) return false;
    if (d.svc === 'deliver' && (!this.cfg().del || o.fee !== d.fee)) return false;
    return true;
  }

  // Mirrors validFeedback() in firestore.rules: the caller's own, completed order; one rating 1-5; optional short comment.
  validFeedback(d, id, uid) {
    const order = this.docs.get(`orders/${id}`);
    const st = this.docs.get(`status/${id}`);
    if (!order || !st || st.s !== 'completed') return false;
    const keys = Object.keys(d);
    if (keys.some((k) => !['id', 'uid', 'at', 'n', 'svc', 'sr', 'ir', 'c'].includes(k)) || !['id', 'uid', 'at', 'n', 'svc', 'sr', 'ir'].every((k) => k in d)) return false;
    if (d.id !== id || d.uid !== uid || d.uid !== order.uid || !d.at || !d.at.__serverTs || d.n !== order.n || d.svc !== order.svc) return false;
    if (!Number.isInteger(d.sr) || d.sr < 1 || d.sr > 5 || !Array.isArray(d.ir) || d.ir.length > 60) return false;
    return !('c' in d) || (typeof d.c === 'string' && d.c.length <= 300 && !/[<>]/.test(d.c));
  }

  allowed(op, p, uid, data) {
    const [col, id] = p.split('/');
    if (this.noMailRules && (col === 'mail' || col === 'mailq')) return false; // simulates firestore.rules not yet republished
    if (this.noFeedbackRules && col === 'feedback') return false;
    const admin = uid === ADMIN_UID;
    const signedIn = !!uid;
    if (col === 'feedback') {
      if (op === 'create') return signedIn && /^LH-[A-Z0-9]{6,10}$/.test(id) && this.validFeedback(data, id, uid);
      return admin;
    }
    if (col === 'orders') {
      if (op === 'create') return signedIn && this.cfg().open !== false && /^LH-[A-Z0-9]{6,10}$/.test(id) && this.validOrder(data, id, uid);
      return admin;
    }
    if (col === 'status') return op === 'get' ? signedIn : admin;
    if (col === 'config') return op === 'get' || op === 'list' ? true : admin;
    if (col === 'mail') return admin;
    if (col === 'mailq') return op === 'update' ? false : admin && (op !== 'create' || /^LH-[A-Z0-9]{6,10}_[pcorx]$/.test(id));
    return false;
  }

  deny() { return Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); }

  write(ops, uid) {
    const now = Date.now();
    const plan = ops.map((o) => {
      const exists = this.docs.has(o.path);
      const rule = o.op === 'delete' ? 'delete' : exists ? 'update' : 'create';
      if (!this.allowed(rule, o.path, uid, o.data || {})) throw this.deny();
      return o;
    });
    const stamp = (v) => (v && v.__serverTs ? { __ts: now } : v);
    plan.forEach((o) => {
      if (o.op === 'delete') { this.docs.delete(o.path); return; }
      const data = {};
      Object.keys(o.data || {}).forEach((k) => { data[k] = stamp(o.data[k]); });
      this.docs.set(o.path, o.merge ? { ...(this.docs.get(o.path) || {}), ...data } : data);
      this.writes.push({ t: now, path: o.path, uid });
    });
    this.flush();
  }

  cmp(a, op, b) {
    if (a === undefined || a === null) return false;
    return op === '==' ? a === b : op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : false;
  }

  run(spec) {
    if (spec.doc) { const d = this.docs.get(spec.doc); return d ? [{ path: spec.doc, data: d }] : []; }
    let rows = [...this.docs].filter(([p]) => p.startsWith(`${spec.col}/`) && p.split('/').length === 2).map(([p, data]) => ({ path: p, data }));
    const order = (spec.cons || []).find((c) => c.kind === 'order');
    (spec.cons || []).filter((c) => c.kind === 'where').forEach((c) => { rows = rows.filter((r) => this.cmp(this.val(r.data[c.f]), c.op, c.v)); });
    if (order) {
      rows = rows.filter((r) => r.data[order.f] !== undefined);
      rows.sort((a, b) => (this.val(a.data[order.f]) > this.val(b.data[order.f]) ? 1 : -1) * (order.dir === 'desc' ? -1 : 1));
    }
    const lim = (spec.cons || []).find((c) => c.kind === 'limit');
    return lim ? rows.slice(0, lim.n) : rows;
  }

  readOp(spec) { return spec.doc ? 'get' : 'list'; }

  push(l, msg) {
    const send = () => l.page.evaluate(([id, m]) => window.__fbPush && window.__fbPush(id, m), [l.id, msg]).catch(() => {});
    setTimeout(send, this.latency);
  }

  flush() {
    this.listeners.forEach((l) => {
      const rows = this.run(l.spec);
      const cur = new Map(rows.map((r) => [r.path, JSON.stringify(r.data)]));
      const changes = [];
      cur.forEach((j, p) => { if (!l.last.has(p)) changes.push({ type: 'added', path: p }); else if (l.last.get(p) !== j) changes.push({ type: 'modified', path: p }); });
      l.last.forEach((j, p) => { if (!cur.has(p)) changes.push({ type: 'removed', path: p }); });
      if (!changes.length && !l.first) return;
      l.first = false; l.last = cur;
      this.push(l, { docs: rows, changes });
    });
  }

  handle(page, op, a) {
    try {
      if (op === 'signin') {
        if (a.anon) return { uid: `anon-${++this.anon}` };
        if (a.email === ADMIN_EMAIL && a.password === ADMIN_PASSWORD) return { uid: ADMIN_UID };
        return { err: { code: 'auth/invalid-credential', message: 'bad credentials' } };
      }
      if (op === 'set') { this.write([{ op: 'set', path: a.path, data: a.data, merge: a.merge }], a.uid); return {}; }
      if (op === 'batch') { this.write(a.ops, a.uid); return {}; }
      if (op === 'get') {
        if (!this.allowed(this.readOp(a.spec), a.spec.doc || `${a.spec.col}/x`, a.uid, {})) throw this.deny();
        return { docs: this.run(a.spec) };
      }
      if (op === 'listen') {
        const l = { page, id: a.id, spec: a.spec, uid: a.uid, last: new Map(), first: true };
        this.listeners.set(`${page.__lhid}:${a.id}`, l);
        if (!this.allowed(this.readOp(a.spec), a.spec.doc || `${a.spec.col}/x`, a.uid, {})) { this.push(l, { err: { code: 'permission-denied', message: 'Missing or insufficient permissions.' } }); return {}; }
        this.flush();
        return {};
      }
      if (op === 'unlisten') { this.listeners.delete(`${page.__lhid}:${a.id}`); return {}; }
    } catch (e) { return { err: { code: e.code || 'internal', message: e.message } }; }
    return {};
  }
}

async function createWorld({ shopDir, adminDir, port = 8130, headed = false } = {}) {
  const LH = loadCore();
  const db = new Db(LH);
  const { chromium } = loadPlaywright();
  const world = {
    LH, db, port, emails: [], dispatches: [], errors: [], pages: [], origin: `http://127.0.0.1:${port}`,
    relay: { mode: 'ok', smtpMs: 600 }, // ok | unset (501) | old (400) | down (network error)
    t0: Date.now()
  };
  const dirs = { shop: shopDir, admin: adminDir };
  const server = http.createServer((q, r) => {
    const url = decodeURIComponent(q.url.split('?')[0]);
    const m = /^\/(shop|admin)(\/.*)?$/.exec(url);
    if (!m) { r.writeHead(404); return r.end(); }
    let rel = m[2] || '/';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = rel === '/fb.js' ? path.join(__dirname, 'fake-fb.js') : path.join(dirs[m[1]], rel);
    if (!file.startsWith(dirs[m[1]]) && rel !== '/fb.js') { r.writeHead(403); return r.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(r);
  }).listen(port, '127.0.0.1');

  const browser = await chromium.launch({ channel: 'msedge', headless: !headed });
  let pageSeq = 0;

  async function relayRoute(route) {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (world.relay.mode === 'down') return route.abort('failed');
    const auth = req.headers().authorization || '';
    if (auth !== `Bearer fake-token-${ADMIN_UID}`) return route.fulfill({ status: 401, headers: cors, body: 'Unauthorized' });
    const body = req.postDataJSON() || {};
    if (new URL(req.url()).pathname === '/send') {
      if (world.relay.mode === 'old') return route.fulfill({ status: 400, headers: cors, body: 'Unknown workflow' });
      if (world.relay.mode === 'unset') return route.fulfill({ status: 501, headers: cors, body: 'Email sending is not configured on the relay' });
      const recv = Date.now();
      await new Promise((r) => setTimeout(r, world.relay.smtpMs));
      world.emails.push({ t: Date.now(), recv, to: body.to, subject: body.subject, text: body.text, html: body.html });
      return route.fulfill({ status: 204, headers: cors });
    }
    world.dispatches.push({ t: Date.now(), workflow: body.workflow });
    return route.fulfill({ status: 204, headers: cors });
  }

  /* kind: 'shop' | 'admin'. Each page gets its own browser context, like a separate phone. */
  async function open(kind, opts = {}) {
    const ctx = await browser.newContext({
      viewport: opts.viewport || { width: 390, height: 844 }, hasTouch: !!opts.mobile, isMobile: !!opts.mobile,
      geolocation: opts.geo, permissions: opts.geo ? ['geolocation'] : [], serviceWorkers: 'block', acceptDownloads: true
    });
    await ctx.exposeBinding('__fbCall', ({ page }, op, a) => db.handle(page, op, a));
    await ctx.route((u) => u.hostname !== '127.0.0.1', (route) => (new URL(route.request().url()).hostname === RELAY_HOST ? relayRoute(route) : route.abort()));
    const page = await ctx.newPage();
    page.__lhid = ++pageSeq;
    page.setDefaultTimeout(8000);
    const errs = [];
    const note = (m) => { errs.push(m); world.errors.push(m); };
    page.on('pageerror', (e) => note(`PAGE ${kind}: ${e.message.slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|ERR_BLOCKED/.test(m.text())) note(`CONSOLE ${kind}: ${m.text().slice(0, 200)}`); });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const handle = { ctx, page, errs, kind };
    world.pages.push(handle);
    if (opts.url !== false) await page.goto(`${world.origin}/${kind}/`, { waitUntil: 'domcontentloaded' });
    return handle;
  }

  async function login(h, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
    const p = h.page;
    await p.waitForSelector('#lock:not([hidden]), #app:not([hidden])');
    if (await p.locator('#app:not([hidden])').count()) return true;
    await p.fill('#email', email);
    await p.fill('#pw', password);
    await p.click('#loginBtn');
    await p.waitForSelector('#app:not([hidden]), #lockMsg:not(:empty)');
    return (await p.locator('#app:not([hidden])').count()) > 0;
  }

  async function close() {
    for (const h of world.pages) await h.ctx.close().catch(() => {});
    await browser.close();
    server.close();
  }

  Object.assign(world, { open, login, close, ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD });
  return world;
}

module.exports = { createWorld, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_UID };
