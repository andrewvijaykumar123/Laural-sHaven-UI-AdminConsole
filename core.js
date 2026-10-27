/* Laural's Haven shared core: menu and the Firebase realtime layer. Identical in storefront and admin console. */
(() => {
  'use strict';

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
  const now = () => Date.now();

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
    if (!Number.isFinite(ts) || ts > now() + 86400000) ts = now();
    return {
      id: o.id, ts, n: name, p: phone, nt: clean(o.nt, 140), it, total,
      pay: o.pay === 'counter' ? 'counter' : 'upi', svc: o.svc === 'take' ? 'take' : 'dine', tbl: clean(o.tbl, 8)
    };
  }


  /* ---------- Config shared by the admin (store open, sold-out items, prep time) ---------- */
  let cfg = { open: true, oos: [], prep: 12, note: '', ts: 0 };
  let lastClr = 0;

  /* ---------- Firebase ---------- */
  const relayState = { orders: false, ops: false };
  let inflight = 0;
  const emitRelay = () => emit('relay', { ...relayState, queued: inflight });

  let fb = null;
  function firebase() {
    if (fb) return fb;
    const FB = window.LH_FB;
    const config = window.LH_FIREBASE;
    if (!FB || !config || !config.projectId) throw new Error('Firebase is not configured');
    const app = FB.initializeApp(config);
    let db;
    try {
      db = FB.initializeFirestore(app, { localCache: FB.persistentLocalCache({ tabManager: FB.persistentMultipleTabManager() }) });
    } catch (e) { db = FB.getFirestore(app); }
    fb = { app, db, auth: FB.getAuth(app) };
    return fb;
  }

  let authReady = null;
  const authInit = () => authReady || (authReady = new Promise((resolve) => {
    const off = window.LH_FB.onAuthStateChanged(firebase().auth, () => { off(); resolve(); });
  }));
  async function ensureUser() {
    await authInit();
    const { auth } = firebase();
    return auth.currentUser || (await window.LH_FB.signInAnonymously(auth)).user;
  }
  async function adminUser() {
    await authInit();
    const u = firebase().auth.currentUser;
    return u && !u.isAnonymous ? u : null;
  }
  const adminAuth = {
    current: adminUser,
    async signIn(email, password) { return (await window.LH_FB.signInWithEmailAndPassword(firebase().auth, email, password)).user; },
    async signOut() { await authInit(); await window.LH_FB.signOut(firebase().auth); }
  };

  // Resolves after 8 s even if offline: the write stays queued in the local cache and syncs later.
  function write(promise) {
    inflight++;
    emitRelay();
    const done = promise.finally(() => { inflight--; emitRelay(); });
    return Promise.race([done, new Promise((resolve) => setTimeout(resolve, 8000))]);
  }

  const toDoc = (o) => ({ id: o.id, n: o.n, p: o.p, nt: o.nt, it: o.it.map(([id, q]) => `${id}:${q}`), total: o.total, pay: o.pay, svc: o.svc, tbl: o.tbl });
  const fromDoc = (d) => validateOrder({
    id: d.id, ts: d.at && d.at.toMillis ? d.at.toMillis() : now(), n: d.n, p: d.p, nt: d.nt, pay: d.pay, svc: d.svc, tbl: d.tbl,
    it: (Array.isArray(d.it) ? d.it : []).map((s) => { const i = String(s).lastIndexOf(':'); return [String(s).slice(0, i), Number(String(s).slice(i + 1))]; })
  });

  async function publishOrder(draft) {
    const order = validateOrder({ ...draft, id: draft.id || newOrderId(), ts: now() });
    if (!order) throw new Error('Invalid order');
    const user = await ensureUser();
    const { db } = firebase();
    await write(window.LH_FB.setDoc(window.LH_FB.doc(db, 'orders', order.id), { ...toDoc(order), uid: user.uid, at: window.LH_FB.serverTimestamp() }));
    return order;
  }

  const finalStatus = new Map();
  async function clearBoard(ts) {
    const FB = window.LH_FB;
    const { db } = firebase();
    await write(FB.setDoc(FB.doc(db, 'config', 'store'), { clr: ts }, { merge: true }));
    for (;;) {
      const snap = await FB.getDocs(FB.query(FB.collection(db, 'orders'), FB.limit(200)));
      if (snap.empty) break;
      const batch = FB.writeBatch(db);
      snap.docs.forEach((d) => {
        batch.delete(d.ref);
        if (finalStatus.get(d.id)) batch.delete(FB.doc(db, 'status', d.id));
      });
      await batch.commit();
      if (snap.size < 200) break;
    }
  }

  async function publishAdmin(f) {
    if (!(await adminUser())) throw new Error('Console is locked');
    const FB = window.LH_FB;
    const { db } = firebase();
    const ts = now();
    if (f.k === 'st') {
      if (!validId(f.id) || !STATUS[f.s]) throw new Error('Invalid status');
      return write(FB.setDoc(FB.doc(db, 'status', f.id), { s: f.s, r: clean(f.r, 80), ts, u: ts }, { merge: true }));
    }
    if (f.k === 'pv') {
      if (!validId(f.id)) throw new Error('Invalid order');
      return write(FB.setDoc(FB.doc(db, 'status', f.id), { v: !!f.v, pts: ts, u: ts }, { merge: true }));
    }
    if (f.k === 'cfg') {
      return write(FB.setDoc(FB.doc(db, 'config', 'store'), {
        open: !!f.open, oos: (Array.isArray(f.oos) ? f.oos : []).filter((id) => ITEMS.has(id)).slice(0, 200),
        prep: Math.min(180, Math.max(1, Math.floor(Number(f.prep)) || 12)), note: clean(f.note, 120), ts
      }, { merge: true }));
    }
    if (f.k === 'clr') return clearBoard(ts);
    throw new Error('Unknown action');
  }

  function applyCfgDoc(d) {
    const clr = Number(d.clr) || 0;
    if (clr > lastClr) { lastClr = clr; emit('clear', { ts: clr }); }
    const ts = Number(d.ts) || 0;
    if (d.open === undefined || ts < cfg.ts) return;
    cfg = {
      open: !!d.open, oos: (Array.isArray(d.oos) ? d.oos : []).filter((id) => ITEMS.has(id)).slice(0, 200),
      prep: Math.min(180, Math.max(1, Math.floor(Number(d.prep)) || 12)), note: clean(d.note, 120), ts
    };
    store.set('cfg', cfg);
    emit('cfg', cfg);
  }

  function emitStatus(id, d) {
    if (typeof d.s === 'string' && STATUS[d.s]) {
      finalStatus.set(id, d.s === 'completed' || d.s === 'rejected');
      emit('status', { id, s: d.s, r: clean(d.r, 80), ts: Number(d.ts) || 0 });
    }
    if (typeof d.v === 'boolean') emit('pay', { id, v: d.v, ts: Number(d.pts) || 0 });
  }

  /* ---------- Streams ---------- */
  const streams = {};
  function connect(name) {
    if (streams[name]) return;
    streams[name] = true;
    const up = (v) => { if (relayState[name] !== v) { relayState[name] = v; emitRelay(); } };
    const fail = (e) => { up(false); console.warn(`LH ${name} stream`, e && e.code ? e.code : e); };
    (async () => {
      try {
        const FB = window.LH_FB;
        if (name === 'ops') {
          FB.onSnapshot(FB.doc(firebase().db, 'config', 'store'), (snap) => {
            up(!snap.metadata.fromCache);
            if (snap.exists()) applyCfgDoc(snap.data());
          }, fail);
          return;
        }
        if (!(await adminUser())) throw new Error('Console is locked');
        const { db } = firebase();
        FB.onSnapshot(FB.query(FB.collection(db, 'orders'), FB.orderBy('at', 'desc'), FB.limit(500)), (snap) => {
          up(!snap.metadata.fromCache);
          snap.docChanges().forEach((ch) => {
            if (ch.type !== 'added') return;
            const o = fromDoc({ ...ch.doc.data({ serverTimestamps: 'estimate' }), id: ch.doc.id });
            if (o) emit('order', o);
          });
        }, fail);
        FB.onSnapshot(FB.query(FB.collection(db, 'status'), FB.where('u', '>', now() - 3 * 86400000)), (snap) => {
          snap.docChanges().forEach((ch) => { if (ch.type !== 'removed') emitStatus(ch.doc.id, ch.doc.data()); });
        }, fail);
      } catch (e) { streams[name] = false; fail(e); }
    })();
  }

  /* Customers follow the status of their own orders by id (readable by id only, never listable). */
  const watchers = new Map();
  function watch(ids) {
    const wanted = new Set((ids || []).filter(validId).slice(0, 20));
    watchers.forEach((off, id) => { if (!wanted.has(id)) { off(); watchers.delete(id); } });
    wanted.forEach((id) => {
      if (watchers.has(id)) return;
      watchers.set(id, () => {});
      ensureUser().then(() => {
        if (!watchers.has(id)) return;
        const FB = window.LH_FB;
        watchers.set(id, FB.onSnapshot(FB.doc(firebase().db, 'status', id), (snap) => { if (snap.exists()) emitStatus(id, snap.data()); }, () => {}));
      }).catch(() => watchers.delete(id));
    });
  }

  async function flush() {
    try {
      const FB = window.LH_FB;
      const { db } = firebase();
      await FB.disableNetwork(db);
      await FB.enableNetwork(db);
    } catch (e) { /* not connected yet */ }
    emitRelay();
  }

  function init(app) {
    prefix = `lh.${app}.`;
    cfg = { ...cfg, ...store.get('cfg', {}) };
    window.addEventListener('online', flush);
  }

  window.LH = {
    UPI, MENU, ITEMS, STATUS, NEXT,
    fmt, esc, clean, slug, randomString, newOrderId, validId, priceLines, validateOrder,
    store, now, on, emit, init, connect, watch, flush,
    publishOrder, publishAdmin, admin: adminAuth,
    getCfg: () => cfg,
    getRelay: () => ({ ...relayState, queued: inflight })
  };
})();
