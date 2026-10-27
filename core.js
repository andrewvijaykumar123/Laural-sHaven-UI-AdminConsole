/* Laural's Haven shared core: menu, crypto and the realtime relay layer. Identical in storefront and admin console. */
(() => {
  'use strict';

  const RELAY = 'https://ntfy.sh';
  const BASE = 'lh-haven-9d4b7e21c6a05f38';
  const TOPICS = { orders: `${BASE}-orders`, ops: `${BASE}-ops` };
  const KEYS = window.LH_KEYS || {};
  const UPI = { id: 'paytm.s1pl5v7@pty', name: "Laural's Haven" };

  /* ---------- Menu (source: Laural's Haven - Complete Cafe Menu.pdf, 85 items) ---------- */
  // diet: v = veg, e = egg, n = non-veg
  const RAW_MENU = [
    ['Tea & Coffee', '☕', 28, 'Hot classics, brewed fresh', [
      ['Masala Tea', 25, 'v'], ['Lemon Tea', 25, 'v'], ['Black Brew', 25, 'v'], ['Ginger Tea', 30, 'v'], ['Filter Coffee', 30, 'v']]],
    ['Sandwiches', '🥪', 38, 'Toasted, stuffed, never boring', [
      ['Veg Sandwich', 59, 'v'], ['Paneer Sandwich', 69, 'v'], ['Mushroom Sandwich', 69, 'v'], ['Chicken Sandwich', 79, 'n'], ['Schezwan Chicken Sandwich', 89, 'n']]],
    ['Maggie', '🍜', 48, 'Comfort in a bowl', [
      ['Plain Maggie', 49, 'v'], ['Veg Maggie', 59, 'v'], ['Cheese Maggie', 59, 'v'], ['Egg Maggie', 69, 'e'], ['Chicken Maggie', 79, 'n']]],
    ['Omelettes', '🍳', 45, 'Fluffy, hot, made to order', [
      ['Plain Omelette', 30, 'e'], ['Cheese Omelette', 49, 'e'], ['Chicken Omelette', 59, 'n']]],
    ["Momo's", '🥟', 350, 'Steamed pockets of joy', [
      ["Veg Momos", 69, 'v'], ["Schezwan Veg Momos", 79, 'v'], ["Chicken Momos", 89, 'n'], ["Schezwan Chicken Momos", 99, 'n']]],
    ['Kids Snacks', '🍟', 12, 'Little bites, big smiles', [
      ['Paneer Pops', 99, 'v'], ['Chicken Pops', 99, 'n'], ['French Fries', 99, 'v'], ['Peri Peri Fries', 99, 'v'], ['Patty Veg Burger', 129, 'v'],
      ['Chicken Burger', 139, 'n'], ['Kiddo Veg Burger', 89, 'v'], ['Kiddo Chicken Burger', 99, 'n'], ['Chicken Loaded Fries', 189, 'n'], ['Paneer Loaded Fries', 159, 'v']]],
    ['Water Based Drinks (400ml)', '🍉', 150, 'Cool, fresh and fruity', [
      ['Watermelon', 49, 'v'], ['Musk Melon', 49, 'v'], ['Lemon Juice', 29, 'v'], ['Mint Lime', 29, 'v'], ['Guava', 69, 'v'], ['Sapodilla (Sapota)', 69, 'v'], ['Grape', 69, 'v']]],
    ['Milk Based Drinks (300ml)', '🥛', 320, 'Thick, creamy, indulgent shakes', [
      ['Tender Coconut', 149, 'v'], ['Avocado', 149, 'v'], ['Jackfruit', 149, 'v'], ['Strawberry', 149, 'v'], ['Custard Apple', 149, 'v'], ['Mango', 149, 'v'], ['Dry Fig', 149, 'v']]],
    ["Haven's Specials", '🍗', 18, 'Signature plates from our kitchen', [
      ['Cheesy Chicken', 249, 'n'], ['Dragon Fire Chicken', 249, 'n'], ['Chicken Protein Salad', 229, 'n'], ['Veg Protein Salad', 189, 'v']]],
    ['Haven Special Drinks', '🍫', 25, 'Our most-loved sips', [
      ['Mocha Mist', 159, 'v'], ['Magic Milo', 149, 'v'], ['Hot Chocolate', 169, 'v'], ['Haven Fuel', 159, 'v'], ['Chocolate Shake', 159, 'v']]],
    ["Chicken Tikka's", '🍢', 8, 'Char-grilled, juicy, smoky', [
      ['Mint Fusion Tikka', 279, 'n'], ['Malai Mist Tikka', 279, 'n'], ['Tandoori Blaze Tikka', 279, 'n']]],
    ['Veg Tikkas', '🧆', 140, 'Tandoor-kissed vegetarian stars', [
      ['Herb Paneer Tikka', 229, 'v'], ['Forest Mushroom Tikka', 219, 'v']]],
    ['Non-Veg Burgers', '🍔', 20, 'Stacked, saucy, unforgettable', [
      ['The Artemis Tikka Burger (UFO)', 239, 'n'], ['The Aurora Mint Burger', 249, 'n'], ['Hot & Crispy Burger', 229, 'n'], ['The Apollo Tikka Burger (UFO)', 249, 'n']]],
    ['Veg Burgers', '🥬', 100, 'Crunchy, melty and meat-free', [
      ['Mystic Mushroom Burger', 189, 'v'], ['Paneer Royale Burger', 199, 'v']]],
    ['Cosmic Wraps (Non-Veg)', '🌯', 5, 'Rolled, wrapped, out of this world', [
      ['Crispy Chicken Wrap', 179, 'n'], ['Mint Magic Wrap', 189, 'n'], ['Malai Tikka Wrap', 189, 'n'], ['Tandoori Tikka Wrap', 189, 'n']]],
    ['Cosmic Wraps (Veg)', '🥙', 125, 'Fresh, hearty vegetarian wraps', [
      ['Mushroom Medley Wrap', 159, 'v'], ['Paneer Peri Wrap', 169, 'v']]],
    ['Combo Boxes & Combos', '🍱', 265, 'More food, better value', [
      ['Tea/Coffee/Cookies + French Fries', 69, 'v'], ["Tea/Coffee/Cookies + Veg Momos", 99, 'v'], ["Tea/Coffee/Cookies + Chicken Momos", 119, 'n'],
      ['Tea/Coffee/Cookies + Veg Sandwich', 99, 'v'], ['Tea/Coffee/Cookies + Chicken Sandwich', 119, 'n'],
      ['Veg Burger/Wrap + Paneer Pops + Fries + Coke', 219, 'v'], ['Non Veg Burger/Wrap + Popcorn + Fries + Coke', 259, 'n'],
      ['Paneer Loaded Fries + Mojito', 219, 'v'], ['Chicken Loaded Fries + Mojito', 249, 'n']]],
    ['Tikka & Protein Combos', '💪', 175, 'Protein-packed power meals', [
      ['Tikka + 2 Roti + Grape Splash', 329, 'n'], ['Veg Tikka + 2 Roti + Grape Splash', 299, 'v'],
      ['Non Veg Salad + Red Banana Shake', 329, 'n'], ['Veg Salad + Red Banana Shake', 299, 'v']]]
  ];

  const BESTSELLERS = new Set(['haven-fuel', 'mocha-mist', 'masala-tea', 'paneer-sandwich', 'chicken-momos', 'french-fries', 'tandoori-blaze-tikka', 'chicken-burger', 'mango']);
  const ICON_RULES = [
    [/coffee|mocha|brew/i, '☕'], [/tea/i, '🍵'], [/sandwich/i, '🥪'], [/maggie/i, '🍜'], [/omelette/i, '🍳'], [/momo/i, '🥟'],
    [/burger/i, '🍔'], [/wrap/i, '🌯'], [/loaded|fries/i, '🍟'], [/pops/i, '🍗'], [/watermelon/i, '🍉'], [/musk/i, '🍈'],
    [/lemon|mint lime/i, '🍋'], [/guava/i, '🍐'], [/sapodilla/i, '🥔'], [/grape/i, '🍇'], [/coconut/i, '🥥'], [/avocado/i, '🥑'],
    [/jackfruit/i, '🍈'], [/strawberry/i, '🍓'], [/custard/i, '🍏'], [/mango/i, '🥭'], [/fig/i, '🫐'], [/chocolate|milo/i, '🍫'],
    [/fuel/i, '🥤'], [/salad/i, '🥗'], [/tikka|chicken/i, '🍢'], [/paneer|mushroom/i, '🧀']
  ];
  const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const iconFor = (name, fallback) => {
    const hit = ICON_RULES.find(([re]) => re.test(name));
    return hit ? hit[1] : fallback;
  };

  const ITEMS = new Map();
  const MENU = RAW_MENU.map(([name, icon, hue, tagline, items]) => {
    const cat = { id: slug(name), name, icon, hue, tagline, items: [] };
    items.forEach(([iname, price, diet]) => {
      const item = { id: slug(iname), name: iname, price, diet, cat: cat.id, icon: iconFor(iname, icon), best: false };
      item.best = BESTSELLERS.has(item.id);
      if (ITEMS.has(item.id)) throw new Error(`Duplicate menu id ${item.id}`);
      ITEMS.set(item.id, item);
      cat.items.push(item);
    });
    return cat;
  });

  /* ---------- Status model ---------- */
  const STATUS = {
    pending: { label: 'Received', short: 'New', color: '#f59e0b', step: 0 },
    accepted: { label: 'Accepted', short: 'Accepted', color: '#3b82f6', step: 1 },
    cooking: { label: 'Cooking', short: 'Cooking', color: '#f97316', step: 2 },
    ready: { label: 'Ready', short: 'Ready', color: '#10b981', step: 3 },
    completed: { label: 'Completed', short: 'Done', color: '#22c55e', step: 4 },
    rejected: { label: 'Rejected', short: 'Rejected', color: '#ef4444', step: -1 }
  };
  const NEXT = { pending: ['accepted', 'rejected'], accepted: ['cooking', 'rejected'], cooking: ['ready'], ready: ['completed'], completed: [], rejected: [] };

  /* ---------- Helpers ---------- */
  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomString = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => ALPHABET[x % ALPHABET.length]).join('');
  const newOrderId = () => `LH-${randomString(6)}`;
  const validId = (id) => typeof id === 'string' && /^LH-[A-Z0-9]{6,10}$/.test(id);
  const textEnc = new TextEncoder();
  const textDec = new TextDecoder();
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  /* ---------- App-scoped storage and clock ---------- */
  let prefix = 'lh.';
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    del(key) { try { localStorage.removeItem(prefix + key); } catch (e) { /* storage unavailable */ } }
  };
  let offset = 0;
  const now = () => Date.now() + offset;
  const setOffset = (ms) => {
    if (Number.isFinite(ms) && Math.abs(ms) < 6 * 3600 * 1000) { offset = ms; store.set('offset', ms); }
  };

  /* ---------- Tiny event emitter ---------- */
  const handlers = {};
  const on = (event, fn) => { (handlers[event] || (handlers[event] = [])).push(fn); };
  const emit = (event, data) => (handlers[event] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  /* ---------- Order and event validation ---------- */
  function priceLines(lines) {
    const merged = new Map();
    (Array.isArray(lines) ? lines : []).slice(0, 60).forEach((line) => {
      const id = Array.isArray(line) ? line[0] : line && line.id;
      const qty = Math.floor(Number(Array.isArray(line) ? line[1] : line && line.qty));
      if (!ITEMS.has(id) || !(qty >= 1 && qty <= 25)) return;
      merged.set(id, Math.min(25, (merged.get(id) || 0) + qty));
    });
    const it = [...merged.entries()];
    const total = it.reduce((sum, [id, qty]) => sum + ITEMS.get(id).price * qty, 0);
    return { it, total };
  }

  function validateOrder(o) {
    if (!o || !validId(o.id)) return null;
    const { it, total } = priceLines(o.it);
    if (!it.length) return null;
    const name = clean(o.n, 40);
    const phone = String(o.p ?? '').replace(/[^\d+]/g, '').slice(0, 15);
    if (!name || phone.replace(/\D/g, '').length < 7) return null;
    let ts = Number(o.ts);
    if (!Number.isFinite(ts) || Math.abs(ts - now()) > 3 * 86400000) ts = now();
    return {
      id: o.id, ts, n: name, p: phone, nt: clean(o.nt, 140), it, total,
      pay: o.pay === 'counter' ? 'counter' : 'upi', svc: o.svc === 'take' ? 'take' : 'dine', tbl: clean(o.tbl, 8)
    };
  }

  const canon = (m) => JSON.stringify([m.k, m.e, m.ts, m.id || '', m.s || '', m.r || '', m.v ? 1 : 0, m.open ? 1 : 0,
    (m.oos || []).join(','), m.prep || 0, m.note || '']);

  /* ---------- Crypto ---------- */
  let pubKeysPromise = null;
  const publicKeys = () => pubKeysPromise || (pubKeysPromise = (async () => {
    if (!KEYS.enc || !KEYS.sig) throw new Error('Keys missing');
    return {
      enc: await crypto.subtle.importKey('jwk', KEYS.enc, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']),
      sig: await crypto.subtle.importKey('jwk', KEYS.sig, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    };
  })());

  async function sealOrder(order) {
    const pub = await publicKeys();
    const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = textEnc.encode(JSON.stringify({ id: order.id, ts: order.ts, n: order.n, p: order.p, nt: order.nt, it: order.it, pay: order.pay, svc: order.svc, tbl: order.tbl }));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, body);
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub.enc, await crypto.subtle.exportKey('raw', aes));
    return { k: 'o', e: randomString(12), id: order.id, w: toB64(wrapped), i: toB64(iv), c: toB64(ct) };
  }

  async function openOrder(msg, privateKey) {
    const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromB64(msg.w));
    const aes = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(msg.i) }, aes, fromB64(msg.c));
    return validateOrder(JSON.parse(textDec.decode(plain)));
  }

  async function verifyAdminMessage(msg) {
    try {
      if (typeof msg.sig !== 'string' || msg.sig.length > 200) return false;
      const pub = await publicKeys();
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub.sig, fromB64(msg.sig), textEnc.encode(canon(msg)));
    } catch (e) { return false; }
  }

  let adminKeys = null; // { dec, sign } CryptoKeys, set only in the admin console
  const setAdminKeys = (keys) => { adminKeys = keys; };

  async function unwrapAdminKeys(password) {
    const wrap = KEYS.wrap;
    if (!wrap) throw new Error('No wrapped keys');
    const material = await crypto.subtle.importKey('raw', textEnc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromB64(wrap.salt), iterations: wrap.iter, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(wrap.iv) }, key, fromB64(wrap.ct)); // throws on a wrong password
    const jwks = JSON.parse(textDec.decode(plain));
    return {
      dec: await crypto.subtle.importKey('jwk', jwks.enc, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']),
      sign: await crypto.subtle.importKey('jwk', jwks.sig, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    };
  }

  /* ---------- Config shared by the admin (store open, sold-out items, prep time) ---------- */
  let cfg = { open: true, oos: [], prep: 12, note: '', ts: 0 };

  /* ---------- Ingest: every message (relay, other tab, or local) flows through here ---------- */
  const seen = new Set();
  async function ingest(topicName, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.e !== 'string' || msg.e.length > 40 || seen.has(msg.e)) return;
    seen.add(msg.e);
    if (seen.size > 5000) seen.delete(seen.values().next().value);

    if (topicName === 'orders') {
      if (msg.k !== 'o' || !adminKeys || !validId(msg.id) || [msg.w, msg.i, msg.c].some((v) => typeof v !== 'string' || v.length > 3000)) return;
      try {
        const order = await openOrder(msg, adminKeys.dec);
        if (order && order.id === msg.id) emit('order', order);
      } catch (e) { /* not encrypted for us or tampered */ }
      return;
    }

    if (!(await verifyAdminMessage(msg))) return;
    const ts = Number(msg.ts);
    if (!Number.isFinite(ts)) return;
    if (msg.k === 'st' && validId(msg.id) && STATUS[msg.s]) emit('status', { id: msg.id, s: msg.s, r: clean(msg.r, 80), ts });
    else if (msg.k === 'pv' && validId(msg.id)) emit('pay', { id: msg.id, v: !!msg.v, ts });
    else if (msg.k === 'clr') emit('clear', { ts });
    else if (msg.k === 'cfg' && ts >= cfg.ts) {
      cfg = { open: !!msg.open, oos: (Array.isArray(msg.oos) ? msg.oos : []).filter((id) => ITEMS.has(id)).slice(0, 200),
        prep: Math.min(180, Math.max(1, Math.floor(Number(msg.prep)) || 12)), note: clean(msg.note, 120), ts };
      store.set('cfg', cfg);
      emit('cfg', cfg);
    }
  }

  /* ---------- Transport: local tabs (BroadcastChannel) + ntfy relay with retrying outbox ---------- */
  let channel = null;
  const relayState = { orders: false, ops: false };
  const emitRelay = () => emit('relay', { ...relayState, queued: store.get('outbox', []).length });

  let flushing = false;
  let retryTimer = null;
  let retryDelay = 3000;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      let queue = store.get('outbox', []);
      while (queue.length) {
        const item = queue[0];
        const res = await fetch(`${RELAY}/${TOPICS[item.topic]}`, { method: 'POST', body: JSON.stringify(item.msg) });
        if (!res.ok) throw new Error(`Relay ${res.status}`);
        try {
          const info = await res.json();
          if (info && info.time && queue.length === 1) setOffset(info.time * 1000 - Date.now());
        } catch (e) { /* response body is optional */ }
        queue = store.get('outbox', []).filter((q) => q.msg.e !== item.msg.e);
        store.set('outbox', queue);
        retryDelay = 3000;
        emitRelay();
      }
    } catch (e) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
      emitRelay();
    } finally { flushing = false; }
  }

  async function send(topicName, msg) {
    await ingest(topicName, msg);
    if (channel) channel.postMessage({ topic: topicName, msg });
    const queue = store.get('outbox', []);
    queue.push({ topic: topicName, msg });
    store.set('outbox', queue.slice(-300));
    emitRelay();
    flush();
  }

  async function publishAdmin(fields) {
    if (!adminKeys) throw new Error('Console is locked');
    const msg = { ...fields, e: randomString(12), ts: now() };
    msg.sig = toB64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, adminKeys.sign, textEnc.encode(canon(msg))));
    return send('ops', msg);
  }

  async function publishOrder(draft) {
    const order = validateOrder({ ...draft, id: draft.id || newOrderId(), ts: now() });
    if (!order) throw new Error('Invalid order');
    await send('orders', await sealOrder(order));
    return order;
  }

  /* ---------- Streams (SSE with polling fallback) ---------- */
  const streams = {};
  function connect(name) {
    if (streams[name]) return;
    const topic = TOPICS[name];
    const key = `since.${name}`;
    let since = Number(store.get(key, 0)) || 0;
    let source = null;
    let reconnect = null;
    let poller = null;
    let backoff = 1500;

    const sinceParam = () => (since ? String(Math.max(0, since - 30)) : 'all');
    const setUp = (up) => { if (relayState[name] !== up) { relayState[name] = up; emitRelay(); } };
    const handle = (m) => {
      if (!m || m.event !== 'message') return;
      if (m.time && m.time > since) { since = m.time; store.set(key, since); }
      let parsed = null;
      try { parsed = JSON.parse(m.message); } catch (e) { return; }
      ingest(name, parsed);
    };
    const poll = async () => {
      try {
        const res = await fetch(`${RELAY}/${topic}/json?poll=1&since=${sinceParam()}`);
        if (!res.ok) throw new Error(String(res.status));
        (await res.text()).split('\n').filter(Boolean).forEach((line) => { try { handle(JSON.parse(line)); } catch (e) { /* skip */ } });
        setUp(true);
      } catch (e) { setUp(false); }
    };
    const startPoll = () => { if (!poller) { poll(); poller = setInterval(poll, 6000); } };
    const stopPoll = () => { clearInterval(poller); poller = null; };
    const open = () => {
      clearTimeout(reconnect);
      if (source) source.close();
      source = new EventSource(`${RELAY}/${topic}/sse?since=${sinceParam()}`);
      source.addEventListener('open', (e) => {
        backoff = 1500;
        stopPoll();
        setUp(true);
        if (e.data) { try { const m = JSON.parse(e.data); if (m.time) setOffset(m.time * 1000 - Date.now()); } catch (err) { /* ignore */ } }
      });
      source.addEventListener('message', (e) => { try { handle(JSON.parse(e.data)); } catch (err) { /* ignore */ } });
      source.addEventListener('error', () => {
        source.close();
        setUp(false);
        startPoll();
        reconnect = setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 30000);
      });
    };
    streams[name] = { reopen: () => { if (!relayState[name]) open(); } };
    open();
  }

  function init(app) {
    prefix = `lh.${app}.`;
    offset = Number(store.get('offset', 0)) || 0;
    cfg = { ...cfg, ...store.get('cfg', {}) };
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('lh-bus');
      channel.onmessage = (e) => {
        const d = e.data;
        if (d && TOPICS[d.topic]) ingest(d.topic, d.msg);
      };
    }
    window.addEventListener('online', () => { flush(); Object.values(streams).forEach((s) => s.reopen()); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { flush(); Object.values(streams).forEach((s) => s.reopen()); }
    });
    if (store.get('outbox', []).length) flush();
  }

  window.LH = {
    UPI, MENU, ITEMS, STATUS, NEXT, TOPICS,
    fmt, esc, clean, slug, randomString, newOrderId, validId, priceLines, validateOrder,
    store, now, on, emit, init, connect, flush,
    publishOrder, publishAdmin, unwrapAdminKeys, setAdminKeys,
    getCfg: () => cfg,
    getRelay: () => ({ ...relayState, queued: store.get('outbox', []).length }),
    hasWrap: () => !!KEYS.wrap
  };
})();
