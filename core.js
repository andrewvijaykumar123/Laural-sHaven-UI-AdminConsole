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
    out: { label: 'Out for delivery', short: 'On the way', color: '#8b5cf6', step: 4 },
    completed: { label: 'Completed', short: 'Done', color: '#22c55e', step: 5 },
    rejected: { label: 'Rejected', short: 'Rejected', color: '#ef4444', step: -1 }
  };
  const NEXT = { pending: ['accepted', 'rejected'], accepted: ['cooking', 'rejected'], cooking: ['ready'], ready: ['completed', 'out'], out: ['completed'], completed: [], rejected: [] };
  // 'Out for delivery' only exists for delivery orders, and a delivery can only be closed from 'out' (with the customer's code, or manually).
  const nextFor = (o, s) => {
    const del = !!(o && o.svc === 'deliver');
    return (NEXT[s] || []).filter((x) => (x === 'out' ? del : !(del && s === 'ready' && x === 'completed')));
  };
  const statusLabel = (o, s) => (o && o.svc === 'deliver' && s === 'completed' ? 'Delivered' : (STATUS[s] || STATUS.pending).label);

  /* ---------- Delivery area: straight-line distance from the cafe ---------- */
  const SHOP = { lat: 12.847503004009383, lng: 80.19645821775838 };
  const DELIVERY_KM = 15; // farthest we deliver
  // Delivery fee by straight-line km: free up to FREE_KM, Rs 15/km from 5 to 10 km, Rs 20/km beyond 10 km.
  const FREE_KM = 5, MID_KM = 10, RATE_MID = 15, RATE_FAR = 20;
  const validPoint = (lat, lng) => typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && Number.isFinite(lat) && Number.isFinite(lng);
  const distKm = (a, b) => {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const fromShopKm = (lat, lng) => distKm(SHOP, { lat, lng });
  const inRange = (lat, lng) => validPoint(lat, lng) && fromShopKm(lat, lng) <= DELIVERY_KM;
  const deliveryFee = (km) => {
    const k = Math.round(km * 10) / 10;
    return Math.round(RATE_MID * Math.max(0, Math.min(k, MID_KM) - FREE_KM) + RATE_FAR * Math.max(0, k - MID_KM));
  };
  // Rough ride time: roads are about 1.35x the straight line, at about 22 km/h through traffic.
  const etaMin = (km) => Math.max(1, Math.round((km * 1.35 / 22) * 60));
  // Home-delivery figures from [{ o, s }] rows (s = status). Rejected orders are not sales.
  const deliveryStats = (rows) => {
    const all = rows.filter((x) => x.o.svc === 'deliver');
    const ok = all.filter((x) => x.s !== 'rejected');
    const sum = (a, f) => a.reduce((t, x) => t + f(x.o), 0);
    const km = (x) => Math.round(fromShopKm(x.o.lat, x.o.lng) * 10) / 10;
    const band = (lo, hi) => { const b = ok.filter((x) => km(x) > lo && km(x) <= hi); return { n: b.length, fees: sum(b, (o) => o.fee || 0), sales: sum(b, (o) => o.total) }; };
    const sales = sum(ok, (o) => o.total), fees = sum(ok, (o) => o.fee || 0);
    return {
      placed: all.length, n: ok.length, rejected: all.length - ok.length,
      completed: ok.filter((x) => x.s === 'completed').length, active: ok.filter((x) => x.s !== 'completed'),
      sales, fees, food: sales - fees, avg: ok.length ? Math.round(sales / ok.length) : 0,
      avgKm: ok.length ? ok.reduce((t, x) => t + km(x), 0) / ok.length : 0,
      bands: { free: band(-1, FREE_KM), mid: band(FREE_KM, MID_KM), far: band(MID_KM, Infinity) },
      upi: ok.filter((x) => x.o.pay === 'upi').length, cod: ok.filter((x) => x.o.pay !== 'upi').length
    };
  };
  const r5 = (n) => Math.round(n * 1e5) / 1e5;

  /* ---------- Helpers ---------- */
  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomString = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => ALPHABET[x % ALPHABET.length]).join('');
  const newOrderId = () => `LH-${randomString(6)}`;
  const validId = (id) => typeof id === 'string' && /^LH-[A-Z0-9]{6,10}$/.test(id);
  // Delivery code: 4 digits the customer hands to the delivery partner, who types it into the admin console to close the order.
  const validOtp = (s) => typeof s === 'string' && /^\d{4}$/.test(s);
  const newOtp = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
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

  const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  function validateOrder(o) {
    if (!o || !validId(o.id)) return null;
    const { it, total } = priceLines(o.it);
    if (!it.length) return null;
    const name = clean(o.n, 40);
    const phone = String(o.p ?? '').replace(/[^\d+]/g, '').slice(0, 15);
    const svc = o.svc === 'take' ? 'take' : o.svc === 'deliver' ? 'deliver' : 'dine';
    if (!name || phone.replace(/\D/g, '').length < (svc === 'deliver' ? 10 : 7)) return null;
    let ts = Number(o.ts);
    if (!Number.isFinite(ts) || ts > now() + 86400000) ts = now();
    const em = clean(o.em, 80).toLowerCase();
    const out = {
      id: o.id, ts, n: name, p: phone, em: EMAIL_RE.test(em) ? em : '', nt: clean(o.nt, 140), it, total,
      pay: o.pay === 'counter' ? 'counter' : 'upi', svc, tbl: svc === 'dine' ? clean(o.tbl, 8) : ''
    };
    if (svc === 'deliver') {
      const addr = clean(o.addr, 200);
      if (addr.length < 8 || !inRange(o.lat, o.lng)) return null;
      Object.assign(out, { addr, lat: r5(o.lat), lng: r5(o.lng) });
      out.fee = deliveryFee(fromShopKm(out.lat, out.lng));
      out.total += out.fee;
      if (validOtp(o.otp)) out.otp = o.otp;
    }
    return out;
  }

  /* Customer feedback on a finished order: one service rating, optional per-item ratings (1 to 5 stars) and a comment. */
  const stars = (n) => { const v = Math.floor(Number(n)); return v >= 1 && v <= 5 ? v : 0; };
  function validateFeedback(f) {
    if (!f || !validId(f.id)) return null;
    const sr = stars(f.sr);
    if (!sr) return null;
    const seen = new Set();
    const ir = [];
    (Array.isArray(f.ir) ? f.ir : []).slice(0, 60).forEach((x) => {
      const id = Array.isArray(x) ? x[0] : x && x.id;
      const n = stars(Array.isArray(x) ? x[1] : x && x.n);
      if (ITEMS.has(id) && n && !seen.has(id)) { seen.add(id); ir.push([id, n]); }
    });
    let ts = Number(f.ts);
    if (!Number.isFinite(ts) || ts > now() + 86400000) ts = now();
    return { id: f.id, ts, n: clean(f.n, 40), svc: f.svc === 'take' ? 'take' : f.svc === 'deliver' ? 'deliver' : 'dine', sr, ir, c: clean(f.c, 300) };
  }

  /* ---------- Event bookings (parties, celebrations, meetups): Rs 1000 per hour + Rs 500 cleaning + optional Rs 500 basic decoration ---------- */
  // Times are minutes after midnight. The rules in firestore.rules repeat these limits and prices.
  const EVENT = { RATE: 1000, CLEAN: 500, DECOR: 500, MIN_H: 1, MAX_H: 12, OPEN: 480, LAST_START: 1380, CLOSE: 1440, STEP: 30, MAX_GUESTS: 100, DAYS: 180 };
  const EVENT_TYPES = [
    { id: 'bday', label: 'Birthday Party', icon: '🎂' },
    { id: 'anniv', label: 'Anniversary Celebration', icon: '💞' },
    { id: 'success', label: 'Success Meetup', icon: '🏆' },
    { id: 'together', label: 'Get-together / Reunion', icon: '🥂' },
    { id: 'shower', label: 'Baby Shower', icon: '🍼' },
    { id: 'corp', label: 'Corporate Meeting', icon: '💼' },
    { id: 'other', label: 'Other Celebration', icon: '🎉' }
  ];
  const EVENT_TYPE = new Map(EVENT_TYPES.map((t) => [t.id, t]));
  const EVENT_STATUS = {
    pending: { label: 'Awaiting confirmation', short: 'Pending', color: '#f59e0b' },
    confirmed: { label: 'Confirmed', short: 'Confirmed', color: '#22c55e' },
    declined: { label: 'Declined', short: 'Declined', color: '#ef4444' },
    cancelled: { label: 'Cancelled', short: 'Cancelled', color: '#9ca3af' },
    completed: { label: 'Completed', short: 'Done', color: '#3b82f6' }
  };
  const EVENT_NEXT = { pending: ['confirmed', 'declined'], confirmed: ['completed', 'cancelled'], declined: [], cancelled: [], completed: [] };
  const newEventId = () => `EV-${randomString(6)}`;
  const validEventId = (id) => typeof id === 'string' && /^EV-[A-Z0-9]{6,10}$/.test(id);
  const pad2 = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseDateKey = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const validDateKey = (s) => typeof s === 'string' && /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && dateKey(parseDateKey(s)) === s;
  // Today up to EVENT.DAYS ahead.
  const inEventWindow = (s) => {
    if (!validDateKey(s)) return false;
    const t = new Date(now()); t.setHours(0, 0, 0, 0);
    const days = Math.round((parseDateKey(s) - t) / 86400000);
    return days >= 0 && days <= EVENT.DAYS;
  };
  const clock = (min) => { const h = Math.floor(min / 60) % 24; return `${h % 12 || 12}:${pad2(min % 60)} ${h < 12 ? 'AM' : 'PM'}`; };
  const eventRange = (st, h) => `${clock(st)} - ${clock(st + 60 * h)}`;
  const eventQuote = (hours, decor) => {
    const h = Math.floor(Number(hours)) || 0;
    const rent = EVENT.RATE * h, dec = decor ? EVENT.DECOR : 0;
    return { hours: h, rent, clean: EVENT.CLEAN, decor: dec, total: rent + EVENT.CLEAN + dec };
  };
  const slotStr = (a, b) => `${a}-${b}`;
  const parseSlot = (s) => {
    const m = /^(\d{1,4})-(\d{1,4})$/.exec(String(s));
    const a = m ? Number(m[1]) : 0, b = m ? Number(m[2]) : 0;
    return m && a < b && b <= EVENT.CLOSE ? [a, b] : null;
  };
  const slotsClash = (st, h, slots) => (slots || []).find(([a, b]) => st < b && a < st + 60 * h) || null;

  function validateEvent(e) {
    if (!e || !validEventId(e.id)) return null;
    const name = clean(e.n, 40);
    const phone = String(e.p ?? '').replace(/[^\d+]/g, '').slice(0, 15);
    const h = Math.floor(Number(e.h)), st = Math.floor(Number(e.st)), g = Math.floor(Number(e.g));
    if (!name || phone.replace(/\D/g, '').length < 10 || !EVENT_TYPE.has(e.ty) || !validDateKey(e.d)) return null;
    if (!(h >= EVENT.MIN_H && h <= EVENT.MAX_H) || !(g >= 1 && g <= EVENT.MAX_GUESTS)) return null;
    if (!(st >= EVENT.OPEN && st <= EVENT.LAST_START && st % EVENT.STEP === 0 && st + 60 * h <= EVENT.CLOSE)) return null;
    let ts = Number(e.ts);
    if (!Number.isFinite(ts) || ts > now() + 86400000) ts = now();
    const dec = e.dec === true;
    return { id: e.id, ts, n: name, p: phone, ty: e.ty, g, d: e.d, st, h, dec, nt: clean(e.nt, 200), total: eventQuote(h, dec).total };
  }

  /* ---------- Config shared by the admin (store open, sold-out items, prep time) ---------- */
  let cfg = { open: true, oos: [], prep: 12, note: '', del: false, ts: 0 };
  let lastClr = 0;
  let lastWipe = 0;
  // Event bookings: the admin switches them on and publishes the time slots already taken (busy[date] = [[from, to], ...]).
  let evCfg = { on: false, busy: {}, ts: 0 };

  /* ---------- Firebase ---------- */
  const relayState = { orders: false, ops: false };
  let inflight = 0;
  const emitRelay = () => emit('relay', { ...relayState, queued: inflight });

  // Meta CSP cannot set frame-ancestors, so refuse to run inside another site's frame (clickjacking).
  if (window.top !== window.self) {
    document.documentElement.style.display = 'none';
    try { window.top.location = window.self.location; } catch (e) { /* cross-origin top */ }
    throw new Error('Framing is not allowed');
  }

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
    let auth;
    try { auth = FB.initializeAuth(app, { persistence: [FB.indexedDBLocalPersistence, FB.browserLocalPersistence] }); } catch (e) { auth = FB.getAuth(app); }
    fb = { app, db, auth };
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

  const toDoc = (o) => ({ id: o.id, n: o.n, p: o.p, ...(o.em ? { em: o.em } : {}), nt: o.nt, it: o.it.map(([id, q]) => `${id}:${q}`), total: o.total, pay: o.pay, svc: o.svc, tbl: o.tbl, ...(o.svc === 'deliver' ? { addr: o.addr, lat: o.lat, lng: o.lng, fee: o.fee, ...(o.otp ? { otp: o.otp } : {}) } : {}) });
  const fromDoc = (d) => validateOrder({
    id: d.id, ts: d.at && d.at.toMillis ? d.at.toMillis() : now(), n: d.n, p: d.p, em: d.em, nt: d.nt, pay: d.pay, svc: d.svc, tbl: d.tbl,
    addr: d.addr, lat: d.lat, lng: d.lng, otp: d.otp,
    it: (Array.isArray(d.it) ? d.it : []).map((s) => { const i = String(s).lastIndexOf(':'); return [String(s).slice(0, i), Number(String(s).slice(i + 1))]; })
  });

  async function publishOrder(draft) {
    const order = validateOrder({ ...draft, id: draft.id || newOrderId(), ts: now(), otp: draft.svc === 'deliver' ? (validOtp(draft.otp) ? draft.otp : newOtp()) : undefined });
    if (!order) throw new Error('Invalid order');
    const user = await ensureUser();
    const { db } = firebase();
    const send = () => write(window.LH_FB.setDoc(window.LH_FB.doc(db, 'orders', order.id), { ...toDoc(order), uid: user.uid, at: window.LH_FB.serverTimestamp() }));
    try { await send(); } catch (e) {
      if (!(order.otp && e && e.code === 'permission-denied')) throw e;
      // Rules published before delivery codes existed refuse the extra field: place the order without a code (closed manually) rather than lose it.
      delete order.otp;
      await send();
    }
    return order;
  }

  const fromFeedbackDoc = (d) => validateFeedback({
    id: d.id, ts: d.at && d.at.toMillis ? d.at.toMillis() : now(), n: d.n, svc: d.svc, sr: d.sr, c: d.c,
    ir: (Array.isArray(d.ir) ? d.ir : []).map((s) => { const i = String(s).lastIndexOf(':'); return [String(s).slice(0, i), Number(String(s).slice(i + 1))]; })
  });

  // One feedback per order (the rules refuse updates). The order must be the caller's own and already completed.
  async function publishFeedback(order, f) {
    const v = validateFeedback({ ...f, id: order && order.id, n: order && order.n, svc: order && order.svc });
    if (!v) throw new Error('Invalid feedback');
    const user = await ensureUser();
    const { db } = firebase();
    const FB = window.LH_FB;
    await write(FB.setDoc(FB.doc(db, 'feedback', v.id), {
      id: v.id, uid: user.uid, at: FB.serverTimestamp(), n: v.n, svc: v.svc, sr: v.sr, ir: v.ir.map(([id, n]) => `${id}:${n}`), ...(v.c ? { c: v.c } : {})
    }));
    return v;
  }

  const toEventDoc = (e) => ({ id: e.id, n: e.n, p: e.p, ty: e.ty, g: e.g, d: e.d, st: e.st, h: e.h, dec: e.dec, total: e.total, ...(e.nt ? { nt: e.nt } : {}) });
  const fromEventDoc = (d) => validateEvent({ ...d, ts: d.at && d.at.toMillis ? d.at.toMillis() : now() });

  // A booking is only a request until the admin confirms it. The rules check the price and the shape; the admin console checks clashes.
  async function publishEvent(draft) {
    const ev = validateEvent({ ...draft, id: draft.id || newEventId(), ts: now() });
    if (!ev || !inEventWindow(ev.d)) throw new Error('Invalid event booking');
    const user = await ensureUser();
    const { db } = firebase();
    const FB = window.LH_FB;
    await write(FB.setDoc(FB.doc(db, 'events', ev.id), { ...toEventDoc(ev), uid: user.uid, at: FB.serverTimestamp() }));
    return ev;
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

  // Deletes every order, rating, booking and email record, then tells all devices (config/store.wipe) to drop their saved copies.
  async function wipeStorefront(ts) {
    const FB = window.LH_FB;
    const { db } = firebase();
    await write(FB.setDoc(FB.doc(db, 'config', 'store'), { clr: ts, wipe: ts }, { merge: true }));
    for (const col of ['orders', 'feedback', 'events', 'evstatus', 'status', 'mail', 'mailq']) {
      for (;;) {
        const snap = await FB.getDocs(FB.query(FB.collection(db, col), FB.limit(200)));
        if (snap.empty) break;
        const batch = FB.writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        if (snap.size < 200) break;
      }
    }
  }

  async function publishAdmin(f) {
    const admin = await adminUser();
    if (!admin) throw new Error('Console is locked');
    const FB = window.LH_FB;
    const { db } = firebase();
    const ts = now();
    if (f.k === 'st') {
      if (!validId(f.id) || !STATUS[f.s]) throw new Error('Invalid status');
      // A finished order stops exposing the rider's position.
      const wipe = f.s === 'completed' || f.s === 'rejected' ? { lat: null, lng: null, acc: null, lts: null } : {};
      const how = f.s === 'completed' && (f.how === 'otp' || f.how === 'manual') ? { how: f.how } : {};
      return write(FB.setDoc(FB.doc(db, 'status', f.id), { s: f.s, r: clean(f.r, 80), ts, u: ts, ...how, ...wipe }, { merge: true }));
    }
    if (f.k === 'loc') {
      const ids = (Array.isArray(f.ids) ? f.ids : [f.id]).filter(validId).slice(0, 10);
      if (!ids.length || !validPoint(f.lat, f.lng)) throw new Error('Invalid location');
      const acc = Math.min(9999, Math.max(0, Math.round(Number(f.acc)) || 0));
      return write(Promise.all(ids.map((id) => FB.setDoc(FB.doc(db, 'status', id), { lat: r5(f.lat), lng: r5(f.lng), acc, lts: ts, u: ts }, { merge: true }))));
    }
    if (f.k === 'pv') {
      if (!validId(f.id)) throw new Error('Invalid order');
      return write(FB.setDoc(FB.doc(db, 'status', f.id), { v: !!f.v, pts: ts, u: ts }, { merge: true }));
    }
    if (f.k === 'cfg') {
      return write(FB.setDoc(FB.doc(db, 'config', 'store'), {
        open: !!f.open, oos: (Array.isArray(f.oos) ? f.oos : []).filter((id) => ITEMS.has(id)).slice(0, 200),
        prep: Math.min(180, Math.max(1, Math.floor(Number(f.prep)) || 12)), note: clean(f.note, 120), del: f.del === true, ts
      }, { merge: true }));
    }
    /* Instant emails. mailq/{id}_{key} is a create-only claim (the rules refuse updates), so when several admin devices are open
       only the first one to claim an email sends it. mail/{id} records what was sent; the scheduled mailer reads it. */
    if (f.k === 'mailclaim' || f.k === 'mailrel' || f.k === 'mail') {
      if (!validId(f.id) || !/^[pcorx]$/.test(f.key)) throw new Error('Invalid mail key');
      const claim = FB.doc(db, 'mailq', `${f.id}_${f.key}`);
      if (f.k === 'mailclaim') {
        // No local-cache shortcut here: wait for the server's verdict (8 s at most, then treat as not claimed).
        const verdict = FB.setDoc(claim, { o: f.id, k: f.key, at: FB.serverTimestamp(), by: admin.uid });
        verdict.catch(() => {});
        return Promise.race([verdict, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Claim timed out'), { code: 'deadline-exceeded' })), 8000))]);
      }
      if (f.k === 'mailrel') { const b = FB.writeBatch(db); b.delete(claim); return write(b.commit()); }
      return write(FB.setDoc(FB.doc(db, 'mail', f.id), { [f.key]: ts }, { merge: true }));
    }
    if (f.k === 'mailseen') {
      if (!validId(f.id)) throw new Error('Invalid order');
      const snap = await FB.getDocs(FB.query(FB.collection(db, 'mailq'), FB.where('o', '==', f.id)));
      return snap.docs.map((d) => d.data().k);
    }
    if (f.k === 'evst') {
      if (!validEventId(f.id) || !EVENT_STATUS[f.s]) throw new Error('Invalid event status');
      return write(FB.setDoc(FB.doc(db, 'evstatus', f.id), { s: f.s, r: clean(f.r, 80), ts, u: ts }, { merge: true }));
    }
    if (f.k === 'evcfg') {
      // Written whole (no merge) so dates that are no longer busy disappear.
      const busy = {};
      Object.entries(f.busy || {}).filter(([k]) => validDateKey(k)).slice(0, 400).forEach(([k, arr]) => {
        const a = (Array.isArray(arr) ? arr : []).filter((s) => parseSlot(s)).slice(0, 20);
        if (a.length) busy[k] = a;
      });
      return write(FB.setDoc(FB.doc(db, 'config', 'events'), { on: f.on === true, busy, ts }));
    }
    if (f.k === 'clr') return clearBoard(ts);
    if (f.k === 'wipe') return wipeStorefront(ts);
    throw new Error('Unknown action');
  }

  function applyCfgDoc(d) {
    const clr = Number(d.clr) || 0;
    if (clr > lastClr) { lastClr = clr; emit('clear', { ts: clr }); }
    const wipe = Number(d.wipe) || 0;
    if (wipe > lastWipe) { lastWipe = wipe; emit('wipe', { ts: wipe }); }
    const ts = Number(d.ts) || 0;
    if (d.open === undefined || ts < cfg.ts) return;
    cfg = {
      open: !!d.open, oos: (Array.isArray(d.oos) ? d.oos : []).filter((id) => ITEMS.has(id)).slice(0, 200),
      prep: Math.min(180, Math.max(1, Math.floor(Number(d.prep)) || 12)), note: clean(d.note, 120), del: d.del === true, ts
    };
    store.set('cfg', cfg);
    emit('cfg', cfg);
  }

  function applyEvDoc(d) {
    const ts = Number(d.ts) || 0;
    if (ts < evCfg.ts) return;
    const busy = {}, wire = {};
    if (d.busy && typeof d.busy === 'object') {
      Object.keys(d.busy).filter(validDateKey).slice(0, 400).forEach((k) => {
        const strs = (Array.isArray(d.busy[k]) ? d.busy[k] : []).filter((s) => parseSlot(s)).slice(0, 20);
        if (strs.length) { wire[k] = strs; busy[k] = strs.map(parseSlot); }
      });
    }
    evCfg = { on: d.on === true, busy, ts };
    store.set('evcfg', { on: evCfg.on, busy: wire, ts });
    emit('evcfg', evCfg);
  }

  function emitEvStatus(id, d) {
    if (typeof d.s === 'string' && EVENT_STATUS[d.s]) emit('evstatus', { id, s: d.s, r: clean(d.r, 80), ts: Number(d.ts) || 0 });
  }

  const lastStatus = new Map();
  function emitStatus(id, d) {
    if (typeof d.s === 'string' && STATUS[d.s]) {
      finalStatus.set(id, d.s === 'completed' || d.s === 'rejected');
      // Rider location updates rewrite the same document; only announce real status changes.
      const key = `${d.s}|${Number(d.ts) || 0}|${d.r || ''}`;
      if (lastStatus.get(id) !== key) {
        lastStatus.set(id, key);
        emit('status', { id, s: d.s, r: clean(d.r, 80), ts: Number(d.ts) || 0, how: d.s === 'completed' && (d.how === 'otp' || d.how === 'manual') ? d.how : '' });
      }
    }
    if (typeof d.v === 'boolean') emit('pay', { id, v: d.v, ts: Number(d.pts) || 0 });
    if (validPoint(d.lat, d.lng)) emit('loc', { id, lat: d.lat, lng: d.lng, acc: Number(d.acc) || 0, lts: Number(d.lts) || 0 });
  }

  /* ---------- Streams ---------- */
  const streams = {};
  function connect(name) {
    if (streams[name]) return;
    streams[name] = true;
    const live = {};
    const mark = (k, v) => {
      live[k] = v;
      const all = Object.values(live).every(Boolean);
      if (relayState[name] !== all) { relayState[name] = all; emitRelay(); }
    };
    const MD = { includeMetadataChanges: true };
    let delay = 3000, timer = null, offs = [];
    // Listener errors (rules, network, sign-in not ready) are retried with backoff instead of staying down until a reload.
    const retry = (k, e) => {
      mark(k, false);
      console.warn(`LH ${name} stream`, e && e.code ? e.code : e);
      if (name === 'feedback') emit('fbsync', { ok: false, code: e && e.code ? e.code : 'error' });
      if (name === 'events') emit('evsync', { ok: false, code: e && e.code ? e.code : 'error' });
      if (timer) return;
      timer = setTimeout(() => { timer = null; offs.splice(0).forEach((f) => { try { f(); } catch (x) { /* already closed */ } }); attach(); }, delay);
      delay = Math.min(delay * 2, 60000);
    };
    const synced = (k, snap) => { const ok = !snap.metadata.fromCache; mark(k, ok); if (ok) delay = 3000; };
    async function attach() {
      try {
        const FB = window.LH_FB;
        if (name === 'ops') {
          mark('cfg', false); mark('ev', false);
          offs.push(FB.onSnapshot(FB.doc(firebase().db, 'config', 'store'), MD, (snap) => {
            synced('cfg', snap);
            if (snap.exists()) applyCfgDoc(snap.data());
          }, (e) => retry('cfg', e)));
          offs.push(FB.onSnapshot(FB.doc(firebase().db, 'config', 'events'), MD, (snap) => {
            synced('ev', snap);
            if (snap.exists()) applyEvDoc(snap.data());
          }, (e) => retry('ev', e)));
          return;
        }
        if (name === 'events') {
          if (!(await adminUser())) throw new Error('Console is locked');
          const { db } = firebase();
          mark('events', false); mark('evs', false);
          offs.push(FB.onSnapshot(FB.query(FB.collection(db, 'events'), FB.orderBy('at', 'desc'), FB.limit(500)), MD, (snap) => {
            synced('events', snap);
            if (!snap.metadata.fromCache) emit('evsync', { ok: true });
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'removed') return;
              const e = fromEventDoc({ ...ch.doc.data({ serverTimestamps: 'estimate' }), id: ch.doc.id });
              if (e) emit('event', e);
            });
          }, (e) => retry('events', e)));
          offs.push(FB.onSnapshot(FB.query(FB.collection(db, 'evstatus'), FB.orderBy('u', 'desc'), FB.limit(500)), MD, (snap) => {
            synced('evs', snap);
            snap.docChanges().forEach((ch) => { if (ch.type !== 'removed') emitEvStatus(ch.doc.id, ch.doc.data()); });
          }, (e) => retry('evs', e)));
          return;
        }
        if (name === 'feedback') {
          if (!(await adminUser())) throw new Error('Console is locked');
          mark('fb', false);
          offs.push(FB.onSnapshot(FB.query(FB.collection(firebase().db, 'feedback'), FB.orderBy('at', 'desc'), FB.limit(500)), MD, (snap) => {
            synced('fb', snap);
            if (!snap.metadata.fromCache) emit('fbsync', { ok: true });
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'removed') return;
              const f = fromFeedbackDoc({ ...ch.doc.data({ serverTimestamps: 'estimate' }), id: ch.doc.id });
              if (f) emit('feedback', f);
            });
          }, (e) => retry('fb', e)));
          return;
        }
        if (!(await adminUser())) throw new Error('Console is locked');
        const { db } = firebase();
        mark('orders', false); mark('status', false);
        offs.push(FB.onSnapshot(FB.query(FB.collection(db, 'orders'), FB.orderBy('at', 'desc'), FB.limit(500)), MD, (snap) => {
          synced('orders', snap);
          snap.docChanges().forEach((ch) => {
            if (ch.type !== 'added') return;
            const o = fromDoc({ ...ch.doc.data({ serverTimestamps: 'estimate' }), id: ch.doc.id });
            if (o) emit('order', o);
          });
        }, (e) => retry('orders', e)));
        offs.push(FB.onSnapshot(FB.query(FB.collection(db, 'status'), FB.where('u', '>', now() - 3 * 86400000)), MD, (snap) => {
          synced('status', snap);
          snap.docChanges().forEach((ch) => { if (ch.type !== 'removed') emitStatus(ch.doc.id, ch.doc.data()); });
        }, (e) => retry('status', e)));
      } catch (e) { retry(name === 'ops' ? 'cfg' : name === 'feedback' ? 'fb' : name === 'events' ? 'events' : 'orders', e); }
    }
    attach();
  }

  /* Customers follow the status of their own orders by id (readable by id only, never listable). */
  function makeWatcher(col, valid, emitDoc) {
    const watchers = new Map();
    return (ids) => {
      const wanted = new Set((ids || []).filter(valid).slice(0, 20));
      watchers.forEach((off, id) => { if (!wanted.has(id)) { off(); watchers.delete(id); } });
      wanted.forEach((id) => {
        if (watchers.has(id)) return;
        watchers.set(id, () => {});
        ensureUser().then(() => {
          if (!watchers.has(id)) return;
          const FB = window.LH_FB;
          watchers.set(id, FB.onSnapshot(FB.doc(firebase().db, col, id), (snap) => { if (snap.exists()) emitDoc(id, snap.data()); }, () => {}));
        }).catch(() => watchers.delete(id));
      });
    };
  }
  const watch = makeWatcher('status', validId, emitStatus);
  const watchEv = makeWatcher('evstatus', validEventId, emitEvStatus);

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
    const ec = store.get('evcfg', null);
    if (ec && typeof ec === 'object') applyEvDoc(ec);
    window.addEventListener('online', flush);
  }

  window.LH = {
    UPI, MENU, ITEMS, STATUS, NEXT, nextFor, statusLabel,
    SHOP, DELIVERY_KM, FREE_KM, MID_KM, RATE_MID, RATE_FAR, deliveryFee, deliveryStats, distKm, fromShopKm, inRange, validPoint, etaMin,
    fmt, esc, clean, slug, randomString, newOrderId, validId, validOtp, newOtp, priceLines, validateOrder, validateFeedback,
    EVENT, EVENT_TYPES, EVENT_TYPE, EVENT_STATUS, EVENT_NEXT, eventQuote, newEventId, validEventId, validateEvent, inEventWindow,
    dateKey, parseDateKey, validDateKey, clock, eventRange, slotStr, parseSlot, slotsClash,
    store, now, on, emit, init, connect, watch, watchEv, flush,
    publishOrder, publishFeedback, publishEvent, publishAdmin, admin: adminAuth,
    getCfg: () => cfg,
    getEvCfg: () => evCfg,
    getRelay: () => ({ ...relayState, queued: inflight })
  };
})();
