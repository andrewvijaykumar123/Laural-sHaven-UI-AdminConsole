/* Laural's Haven admin console */
(() => {
  'use strict';
  const LH = window.LH;
  const { MENU, ITEMS, STATUS, NEXT, fmt, esc, store } = LH;
  LH.init('admin');

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const IDLE_MS = 90 * 60 * 1000;
  let lastTouch = 0;
  const touch = (force) => { const n = Date.now(); if (force || n - lastTouch > 10000) { lastTouch = n; store.set('lastActive', n); } };
  const idleLeft = () => Number(store.get('lastActive', 0)) + IDLE_MS - Date.now();

  /* ---------- Theme ---------- */
  const setTheme = (t) => { document.documentElement.dataset.theme = t; store.set('theme', t); };
  setTheme(store.get('theme', 'dark'));
  $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  /* ---------- Toasts and modal ---------- */
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 3800);
  }
  const openModal = (html) => { $('#modalCard').innerHTML = html; $('#modal').hidden = false; const b = $('#modalCard button'); if (b) b.focus(); };
  const closeModal = () => { $('#modal').hidden = true; };
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-modal-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  /* ---------- Login (Firebase Authentication) ---------- */
  const lockMsg = (t) => { $('#lockMsg').textContent = t; };
  $('#pwToggle').addEventListener('click', () => { const i = $('#pw'); i.type = i.type === 'password' ? 'text' : 'password'; });
  const AUTH_ERRORS = {
    'auth/invalid-credential': 'Incorrect email or password.', 'auth/wrong-password': 'Incorrect email or password.', 'auth/user-not-found': 'Incorrect email or password.',
    'auth/invalid-email': 'Enter a valid email address.', 'auth/too-many-requests': 'Too many attempts. Try again later.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.', 'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase.',
    'auth/unauthorized-domain': 'This site is not an authorized domain in Firebase.'
  };

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const until = Number(store.get('lockUntil', 0));
    if (Date.now() < until) { lockMsg(`Too many attempts. Try again in ${Math.ceil((until - Date.now()) / 1000)}s.`); return; }
    const btn = $('#loginBtn');
    btn.disabled = true; btn.textContent = 'Signing in...'; lockMsg('');
    try {
      await LH.admin.signIn($('#email').value.trim(), $('#pw').value);
      $('#pw').value = '';
      store.del('fails');
      touch(true);
      start();
    } catch (err) {
      const fails = Number(store.get('fails', 0)) + 1;
      store.set('fails', fails);
      if (fails >= 5) { store.set('lockUntil', Date.now() + 30000 * Math.min(8, fails - 4)); lockMsg('Too many attempts. Locked for a short while.'); }
      else lockMsg(AUTH_ERRORS[err && err.code] || `Sign-in failed${err && err.code ? ` (${err.code})` : ''}.`);
      const card = $('.lock-card'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });

  async function lock() {
    try { await LH.admin.signOut(); } catch (e) { /* ignore */ }
    store.del('lastActive');
    store.del('orders');
    location.reload();
  }
  $('#lockBtn').addEventListener('click', lock);
  $('#lockBtn2').addEventListener('click', lock);

  (async () => {
    try {
      const user = await LH.admin.current();
      if (user && idleLeft() > 0) { touch(true); start(); return; }
      if (user) await LH.admin.signOut();
    } catch (e) { /* not signed in */ }
    $('#lock').hidden = false;
    $('#email').focus();
  })();
  /* ---------- Data ---------- */
  let orders = new Map();
  let meta = {};
  let clearTs = 0;
  let started = false;
  let soundOn = store.get('sound', true);
  let draft = null;
  let draftTimer = null;
  const fresh = new Set();

  const saveOrders = () => store.set('orders', [...orders.values()].sort((a, b) => b.ts - a.ts).slice(0, 1500));
  const saveMeta = () => store.set('meta', meta);
  const statusOf = (id) => (meta[id] && meta[id].s) || 'pending';
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const money = (arr) => arr.reduce((s, o) => s + o.total, 0);

  function start() {
    if (started) return;
    started = true;
    $('#lock').hidden = true;
    $('#app').hidden = false;
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((ev) => window.addEventListener(ev, () => touch(), { passive: true, capture: true }));
    const checkIdle = () => { if (idleLeft() <= 0) lock(); };
    setInterval(checkIdle, 15000);
    document.addEventListener('visibilitychange', checkIdle);

    clearTs = Number(store.get('clearTs', 0)) || 0;
    meta = store.get('meta', {});
    store.get('orders', []).forEach((o) => { const v = LH.validateOrder(o); if (v && v.ts > clearTs) orders.set(v.id, v); });
    draft = readDraft();

    buildMenuAdmin();
    wireUI();
    renderAll();
    ensureWatch();
    renderRide();
    setInterval(rideTick, 5000);
    LH.connect('orders');
    LH.connect('ops');
    setInterval(() => { if (!document.hidden) renderBoard(); }, 30000);
  }

  const readDraft = () => { const c = LH.getCfg(); return { open: c.open, oos: new Set(c.oos), prep: c.prep, note: c.note, del: !!c.del }; };

  /* ---------- Realtime events ---------- */
  LH.on('order', (o) => {
    if (o.ts <= clearTs || orders.has(o.id)) return;
    orders.set(o.id, o);
    saveOrders();
    const live = Date.now() - o.ts < 3 * 60 * 1000;
    if (live) { fresh.add(o.id); announce(o); }
    scheduleRender();
  });
  LH.on('status', ({ id, s, r, ts }) => {
    const m = meta[id] || (meta[id] = {});
    if (ts < (m.sts || 0)) return;
    m.s = s; m.r = r; m.sts = ts;
    if (s !== 'out') delete m.loc;
    saveMeta(); pruneRide(); scheduleRender();
    if (mapId === id) drawMap();
  });
  LH.on('loc', ({ id, lat, lng, acc, lts }) => {
    const m = meta[id] || (meta[id] = {});
    if (m.s && m.s !== 'out') return;
    if (m.loc && m.loc.lts > lts) return;
    m.loc = { lat, lng, acc, lts: lts || Date.now() };
    saveMeta();
    if (mapId === id) drawMap();
    scheduleRender();
  });
  LH.on('pay', ({ id, v, ts }) => {
    const m = meta[id] || (meta[id] = {});
    if (ts < (m.pts || 0)) return;
    m.v = v; m.pts = ts; saveMeta(); scheduleRender();
  });
  LH.on('clear', ({ ts }) => {
    if (ts <= clearTs) return;
    clearTs = ts; store.set('clearTs', ts);
    [...orders.values()].forEach((o) => { if (o.ts <= ts) { orders.delete(o.id); delete meta[o.id]; } });
    saveOrders(); saveMeta(); scheduleRender();
  });
  LH.on('cfg', () => { if (!draftTimer) { draft = readDraft(); renderConfig(); } });
  LH.on('relay', renderConn);

  let renderQueued = false;
  function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAll(); }); }

  /* ---------- Alerts ---------- */
  let audio = null;
  function chime() {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [[880, 0], [1175, 0.16], [1568, 0.32]].forEach(([f, t]) => {
        const o = audio.createOscillator(); const g = audio.createGain();
        o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
        const at = audio.currentTime + t;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
        o.start(at); o.stop(at + 0.3);
      });
    } catch (e) { /* audio unavailable */ }
  }
  const baseTitle = document.title;
  function announce(o) {
    chime();
    toast(`New order ${o.id} · ${o.n} · ${fmt(o.total)}`, 'new');
    if (document.hidden) {
      document.title = `(New) ${baseTitle}`;
      if ('Notification' in window && Notification.permission === 'granted') { try { new Notification(`New order ${o.id}`, { body: `${o.n} · ${fmt(o.total)}` }); } catch (e) { /* ignore */ } }
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = baseTitle; });

  /* ---------- Actions ---------- */
  async function setStatus(id, s, reason = '') {
    const o = orders.get(id);
    if (!o || !LH.nextFor(o, statusOf(id)).includes(s)) return;
    try {
      await LH.publishAdmin({ k: 'st', id, s, r: reason });
      fresh.delete(id);
      if (s === 'out') {
        // Phones start sharing at once; on a desktop the rider's phone taps "Share location" instead.
        if (isMobileDevice()) startRide(id); else toast('Out for delivery. On the rider\'s phone, open this console and tap "Share location".', 'ok');
      }
      if (s === 'completed' || s === 'rejected') stopRide(id);
      if (['accepted', 'rejected', 'ready', 'out', 'completed'].includes(s)) kickMailer();
    } catch (e) { toast('Could not update the order.', 'bad'); }
  }

  /* Emails are sent by GitHub Actions. The relay (worker/relay.js) starts a run for any signed-in admin device; without it a per-device GitHub token is used, else a 15-minute schedule picks changes up. */
  const MAIL_RELAY = 'https://lauralshaven.andrewvijaykumar123.workers.dev';
  const GH_REPO = 'andrewvijaykumar123/Laural-sHaven-UI-AdminConsole';
  let kickTimer = null;
  let mailErr = '';
  async function dispatchWorkflow(file, inputs) {
    mailErr = '';
    if (MAIL_RELAY) {
      const u = await LH.admin.current();
      if (!u) { mailErr = 'not signed in'; return false; }
      const r = await fetch(MAIL_RELAY, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await u.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: file, ...(inputs || {}) })
      });
      if (!r.ok) mailErr = `${r.status} ${(await r.text()).slice(0, 160)}`;
      return r.ok;
    }
    const tok = store.get('ghToken', '');
    if (!tok) return null;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${file}/dispatches`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tok}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', ...(inputs ? { inputs } : {}) })
    });
    return r.status === 204;
  }
  function kickMailer() {
    if (!MAIL_RELAY && !store.get('ghToken', '')) return;
    clearTimeout(kickTimer);
    kickTimer = setTimeout(async () => {
      let ok = false;
      try { ok = await dispatchWorkflow('mailer.yml'); } catch (e) { mailErr = 'network or CORS error'; }
      if (!ok) toast(`Could not start the email service now${mailErr ? ` (${mailErr})` : ''}. Emails will go out within 15 minutes.`, 'bad');
    }, 2500);
  }
  function renderMail() {
    const on = !!MAIL_RELAY || !!store.get('ghToken', '');
    $('#mailState').textContent = on ? 'Instant emails are on for this device.' : 'Instant emails are off. Emails go out within about 15 minutes.';
    $('#ghClear').hidden = !on || !!MAIL_RELAY; $('#mailNow').hidden = !on; $('#reportNow').hidden = !on;
    if (MAIL_RELAY) { $('#ghToken').style.display = 'none'; $('#ghSave').hidden = true; }
  }
  async function runNow(btn, file, inputs, okMsg) {
    btn.disabled = true;
    try { const ok = await dispatchWorkflow(file, inputs); toast(ok ? okMsg : (MAIL_RELAY ? `Could not start it (${mailErr}).` : 'GitHub refused the request. Check the token.'), ok ? 'ok' : 'bad'); }
    catch (e) { toast(MAIL_RELAY ? 'Could not reach the email relay.' : 'Could not reach GitHub.', 'bad'); }
    btn.disabled = false;
  }
  async function togglePay(id) {
    try { await LH.publishAdmin({ k: 'pv', id, v: !(meta[id] && meta[id].v) }); } catch (e) { toast('Could not update payment.', 'bad'); }
  }
  function pushConfig() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
      draftTimer = null;
      try { await LH.publishAdmin({ k: 'cfg', open: draft.open, oos: [...draft.oos], prep: draft.prep, note: draft.note, del: draft.del }); toast('Storefront updated', 'ok'); }
      catch (e) { toast('Could not publish the change.', 'bad'); }
    }, 500);
  }

  function askReject(id) {
    const reasons = ['Item out of stock', 'Kitchen is too busy', 'Closing soon', 'Payment not received', 'Unable to fulfil this order'];
    openModal(`<h3>Reject order ${esc(id)}</h3><div class="reason-list">${reasons.map((r) => `<button data-reject="${esc(r)}">${esc(r)}</button>`).join('')}</div><button class="btn ghost" data-modal-close style="width:100%">Cancel</button>`);
    $('#modalCard').onclick = (e) => {
      const b = e.target.closest('[data-reject]');
      if (b) { closeModal(); setStatus(id, 'rejected', b.dataset.reject); }
    };
  }

  function printTicket(o) {
    const lines = o.it.map(([id, q]) => `${q} x ${esc(ITEMS.get(id).name)}  ${fmt(ITEMS.get(id).price * q)}`).join('<br>');
    $('#printArea').innerHTML = `<h3>Laural's Haven</h3><p>${esc(o.id)} · ${new Date(o.ts).toLocaleString()}</p><hr>${lines}<hr><b>TOTAL ${fmt(o.total)}</b><p>${esc(o.n)} · ${esc(o.p)}<br>${o.svc === 'take' ? 'TAKEAWAY' : o.svc === 'deliver' ? `DELIVERY<br>${esc(o.addr)}<br>${LH.fromShopKm(o.lat, o.lng).toFixed(1)} km` : `DINE-IN ${esc(o.tbl)}`}<br>${o.pay === 'upi' ? 'UPI' : o.svc === 'deliver' ? 'CASH ON DELIVERY' : 'PAY AT COUNTER'}${o.nt ? `<br>NOTE: ${esc(o.nt)}` : ''}</p>`;
    window.print();
  }

  /* ---------- Delivery: rider location sharing and the live map ---------- */
  const isMobileDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || !!(navigator.userAgentData && navigator.userAgentData.mobile);
  const ride = { ids: new Set(store.get('rideIds', []).filter(LH.validId)), watch: null, wake: null, fix: null, sent: null, sentAt: 0, busy: false, err: '' };
  const saveRide = () => store.set('rideIds', [...ride.ids]);

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !ride.wake && !document.hidden) {
        ride.wake = await navigator.wakeLock.request('screen');
        ride.wake.addEventListener('release', () => { ride.wake = null; });
      }
    } catch (e) { /* the screen may sleep; sharing continues while the page is visible */ }
  }
  function stopWatch() {
    if (ride.watch !== null) { navigator.geolocation.clearWatch(ride.watch); ride.watch = null; }
    if (ride.wake) { ride.wake.release().catch(() => {}); ride.wake = null; }
    ride.fix = null; ride.sent = null; ride.sentAt = 0; ride.err = '';
  }
  function ensureWatch() {
    if (!ride.ids.size) { stopWatch(); return; }
    if (ride.watch !== null) return;
    if (!navigator.geolocation) { ride.err = 'This device cannot share its location.'; return; }
    ride.err = '';
    ride.watch = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    keepAwake();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ride.ids.size) keepAwake(); });

  function onFix(pos) {
    const c = pos.coords;
    ride.err = '';
    ride.fix = { lat: c.latitude, lng: c.longitude, acc: Math.round(c.accuracy || 0), t: Date.now() };
    touch(true); // the console stays unlocked while a delivery is being tracked
    const since = Date.now() - ride.sentAt;
    const moved = ride.sent ? LH.distKm(ride.sent, ride.fix) * 1000 : Infinity;
    if (!ride.busy && ((moved >= 15 && since >= 8000) || since >= 30000)) sendFix();
    if (mapId) drawMap();
    renderRide();
  }
  function onFixError(err) {
    if (err && err.code === 1) {
      ride.err = 'Location permission is blocked. Allow it in the browser settings so customers can follow the delivery.';
      if (ride.watch !== null) { navigator.geolocation.clearWatch(ride.watch); ride.watch = null; }
    } else ride.err = err && err.code === 3 ? 'GPS is slow to respond. Move to an open area.' : 'GPS signal unavailable right now.';
    renderRide();
  }
  async function sendFix() {
    const f = ride.fix;
    if (!f || !ride.ids.size || ride.busy) return;
    ride.busy = true;
    try {
      await LH.publishAdmin({ k: 'loc', ids: [...ride.ids], lat: f.lat, lng: f.lng, acc: f.acc });
      ride.sent = { lat: f.lat, lng: f.lng }; ride.sentAt = Date.now();
    } catch (e) { ride.err = 'Could not send the location. Retrying...'; }
    ride.busy = false;
    renderRide();
  }
  // Heartbeat: a rider standing still still counts as "live", but a lost GPS fix is not re-sent.
  function rideTick() {
    if (!ride.ids.size) return;
    if (ride.watch === null && !ride.err.startsWith('Location permission')) ensureWatch();
    if (ride.fix && Date.now() - ride.fix.t < 120000 && Date.now() - ride.sentAt >= 30000) sendFix();
    renderRide();
  }
  function startRide(id) {
    ride.ids.add(id); saveRide(); ensureWatch();
    if (ride.fix) sendFix();
    renderRide(); renderBoard();
  }
  function stopRide(id) {
    if (!ride.ids.delete(id)) return;
    saveRide(); ensureWatch(); renderRide(); renderBoard();
  }
  // Orders that are no longer "out for delivery" stop sharing automatically.
  function pruneRide() {
    let changed = false;
    [...ride.ids].forEach((id) => { const m = meta[id]; if (m && m.s && m.s !== 'out') { ride.ids.delete(id); changed = true; } });
    if (changed) { saveRide(); ensureWatch(); renderRide(); }
  }
  function renderRide() {
    const bar = $('#rideBar');
    if (!bar) return;
    const n = ride.ids.size;
    bar.hidden = !n;
    if (!n) return;
    const f = ride.fix;
    const sent = ride.sentAt ? `${Math.round((Date.now() - ride.sentAt) / 1000)} s ago` : 'not yet';
    const line = ride.err ? `<span class="ride-err">${esc(ride.err)}</span>` : f ? `GPS accuracy about ${f.acc} m · last sent ${sent}` : 'Waiting for GPS...';
    bar.innerHTML = `<div><b>📡 Sharing live location</b> for ${n} delivery order${n > 1 ? 's' : ''}<br><span class="muted">${line} · Keep this screen on and the console open.</span></div><button class="btn danger sm" data-ride-stop>Stop sharing</button>`;
  }

  let mapId = null, mapCtl = null, mapToken = 0, mapUserMoved = false, mapFocus = null;
  function riderPos(id) {
    if (ride.ids.has(id) && ride.fix) return { lat: ride.fix.lat, lng: ride.fix.lng, lts: ride.fix.t, mine: true };
    const m = meta[id];
    return m && m.loc && statusOf(id) === 'out' ? { ...m.loc } : null;
  }
  function drawMap() {
    const o = orders.get(mapId);
    if (!o || $('#mapView').hidden) return;
    const s = statusOf(o.id);
    const p = riderPos(o.id);
    if (mapCtl) {
      if (p) mapCtl.setRider(p.lat, p.lng); else mapCtl.clearRider();
      if (!mapUserMoved) mapCtl.fit();
    }
    const km = p ? LH.distKm(p, o) : null;
    $('#mvSub').textContent = `${LH.statusLabel(o, s)}${p ? ` · ${km.toFixed(1)} km from customer · about ${LH.etaMin(km)} min` : ''}`;
    $('#mvInfo').innerHTML = `<div>${p ? `🛵 ${p.mine ? 'Your location' : 'Rider'} updated ${ago(p.lts)}` : s === 'out' ? 'No rider location shared yet. Tap Share location on the rider\'s phone.' : 'Rider location appears once the order is out for delivery.'}</div><div class="muted">📍 ${esc(o.addr)}</div>`;
  }
  async function openMap(id) {
    const o = orders.get(id);
    if (!o || o.svc !== 'deliver') return;
    mapId = id; mapUserMoved = false; mapFocus = document.activeElement;
    $('#mapView').hidden = false;
    $('#mvTitle').textContent = `${o.id} · ${o.n}`;
    $('#mvNav').href = window.LHMap.navUrl(o.lat, o.lng);
    drawMap();
    $('#mvClose').focus();
    const token = ++mapToken;
    try {
      const ctl = await window.LHMap.create($('#mvMap'), { pan: true });
      if (token !== mapToken) { ctl.destroy(); return; }
      mapCtl = ctl;
      ctl.map.on('dragstart', () => { mapUserMoved = true; });
      ctl.setDest(o.lat, o.lng);
      drawMap();
      ctl.fit();
    } catch (e) { $('#mvMap').innerHTML = '<p class="muted" style="padding:24px;text-align:center">The map could not load. Use the Navigate link instead.</p>'; }
  }
  function closeMap() {
    if ($('#mapView').hidden) return;
    mapToken++; mapId = null;
    if (mapCtl) { try { mapCtl.destroy(); } catch (e) { /* already gone */ } mapCtl = null; }
    $('#mvMap').innerHTML = '';
    $('#mapView').hidden = true;
    if (mapFocus && mapFocus.focus) mapFocus.focus();
  }

  /* ---------- Board ---------- */
  const COLS = ['pending', 'accepted', 'cooking', 'ready', 'out', 'completed'];
  const COL_TITLE = { pending: 'New', accepted: 'Accepted', cooking: 'Cooking', ready: 'Ready', out: 'On the way', completed: 'Completed today' };
  const ago = (ts) => { const m = Math.max(0, Math.floor((LH.now() - ts) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
  const ACTION = {
    pending: [['accepted', 'Accept', ''], ['reject', 'Reject', 'bad']],
    accepted: [['cooking', 'Start cooking', ''], ['reject', 'Reject', 'bad']],
    cooking: [['ready', 'Mark ready', '']],
    ready: [['completed', 'Complete', '']]
  };
  function actionsFor(o, s) {
    if (o.svc === 'deliver') {
      if (s === 'ready') return [['out', 'Out for delivery', '']];
      if (s === 'out') return [['completed', 'Delivered', ''], ['ride', ride.ids.has(o.id) ? '⏹ Stop sharing' : '📡 Share location', 'sec']];
    }
    return ACTION[s] || [];
  }

  function cardHTML(o) {
    const s = statusOf(o.id);
    const m = meta[o.id] || {};
    const late = s === 'pending' && Date.now() - o.ts > 5 * 60000;
    const del = o.svc === 'deliver';
    const svcChip = o.svc === 'take' ? 'Takeaway' : del ? `🛵 Delivery · ${LH.fromShopKm(o.lat, o.lng).toFixed(1)} km · ${o.fee ? `${fmt(o.fee)} fee` : 'free'}` : `Dine-in${o.tbl ? ` · T${esc(o.tbl)}` : ''}`;
    const where = del ? `<div class="oc-addr">📍 ${esc(o.addr)}<div class="oc-links"><a href="${window.LHMap.osmUrl(o.lat, o.lng)}" target="_blank" rel="noopener noreferrer">🗺 Map</a><a href="${window.LHMap.navUrl(o.lat, o.lng)}" target="_blank" rel="noopener noreferrer">🧭 Navigate</a><button type="button" data-act="map">📡 Live map</button></div>${s === 'out' ? `<small class="muted">${m.loc ? `Rider location updated ${ago(m.loc.lts)}` : 'No rider location shared yet'}</small>` : ''}</div>` : '';
    return `<article class="ocard ${fresh.has(o.id) ? 'fresh' : ''}" draggable="${LH.nextFor(o, s).length ? 'true' : 'false'}" data-id="${esc(o.id)}" style="--c:${STATUS[s].color}">
      <div class="oc-top"><span class="oid">${esc(o.id)}</span><span class="age ${late ? 'late' : ''}">${ago(o.ts)}</span></div>
      <div class="oc-cust"><b>${esc(o.n)}</b><a href="tel:${esc(o.p)}">${esc(o.p)}</a></div>
      <div class="chips"><span class="chip ${del ? 'del' : ''}">${svcChip}</span>
        <span class="chip ${o.pay === 'upi' ? (m.v ? 'ok' : 'warn') : ''}">${o.pay === 'upi' ? (m.v ? 'UPI paid' : 'UPI unverified') : del ? 'Cash on delivery' : 'Pay at counter'}</span>${o.em ? '<span class="chip ok" title="Customer gets email updates">✉ Email</span>' : ''}</div>
      ${where}
      <ul class="oc-items">${o.it.map(([id, q]) => `<li><b>${q}×</b>${esc(ITEMS.get(id).name)}</li>`).join('')}</ul>
      ${o.nt ? `<div class="note">📝 ${esc(o.nt)}</div>` : ''}
      <div class="oc-foot"><strong>${fmt(o.total)}</strong><div class="acts">${actionsFor(o, s).map(([to, label, cls]) => `<button class="act ${cls}" data-act="${to}">${label}</button>`).join('')}<button class="act sec" data-act="print" title="Print ticket">🖨</button></div></div>
      ${o.pay === 'upi' && !['rejected'].includes(s) ? `<button class="pay-btn" data-act="pay">${m.v ? 'Undo payment verified' : 'Mark payment verified'}</button>` : ''}
    </article>`;
  }

  function renderBoard() {
    const today = startOfToday();
    const all = [...orders.values()].sort((a, b) => a.ts - b.ts);
    // The "On the way" column only appears once delivery is on or has been used.
    const cols = COLS.filter((s) => s !== 'out' || (draft && draft.del) || all.some((o) => o.svc === 'deliver'));
    $('#board').innerHTML = cols.map((s) => {
      let list = all.filter((o) => statusOf(o.id) === s);
      if (s === 'completed') list = list.filter((o) => o.ts >= today).reverse().slice(0, 25);
      return `<section class="col" data-status="${s}" style="--c:${STATUS[s].color}"><header><i></i>${COL_TITLE[s]}<em>${list.length}</em></header>
        <div class="col-body">${list.length ? list.map(cardHTML).join('') : '<div class="col-empty">Nothing here</div>'}</div></section>`;
    }).join('');
  }

  $('#board').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.ocard').dataset.id;
    const act = btn.dataset.act;
    if (act === 'reject') askReject(id);
    else if (act === 'print') printTicket(orders.get(id));
    else if (act === 'pay') togglePay(id);
    else if (act === 'map') openMap(id);
    else if (act === 'ride') { if (ride.ids.has(id)) stopRide(id); else startRide(id); }
    else setStatus(id, act);
  });
  $('#board').addEventListener('dragstart', (e) => {
    const c = e.target.closest('.ocard');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
  });
  $('#board').addEventListener('dragend', (e) => { const c = e.target.closest('.ocard'); if (c) c.classList.remove('dragging'); $$('.col.over').forEach((x) => x.classList.remove('over')); });
  $('#board').addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (col) { e.preventDefault(); $$('.col.over').forEach((x) => x.classList.remove('over')); col.classList.add('over'); } });
  $('#board').addEventListener('drop', (e) => {
    const col = e.target.closest('.col');
    if (!col) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (orders.has(id)) {
      if (LH.nextFor(orders.get(id), statusOf(id)).includes(col.dataset.status)) setStatus(id, col.dataset.status);
      else toast('Move orders forward one step at a time.', 'bad');
    }
    renderBoard();
  });

  /* ---------- KPIs and analytics ---------- */
  const kpi = (label, value, sub, color) => `<div class="kpi" style="--c:${color}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;

  function renderKpis() {
    const today = startOfToday();
    const all = [...orders.values()];
    const t = all.filter((o) => o.ts >= today && statusOf(o.id) !== 'rejected');
    const count = (s) => all.filter((o) => statusOf(o.id) === s).length;
    $('#kpis').innerHTML = [
      kpi('New', count('pending'), 'awaiting action', '#fbbf24'),
      kpi('In kitchen', count('accepted') + count('cooking'), 'accepted + cooking', '#fb923c'),
      kpi('Ready', count('ready'), 'waiting for pickup', '#34d399'),
      kpi('Orders today', t.length, 'excluding rejected', '#60a5fa'),
      kpi('Sales today', fmt(money(t)), `avg ${fmt(t.length ? Math.round(money(t) / t.length) : 0)}`, '#a78bfa')
    ].join('');
    const n = count('pending');
    const nc = $('#navCount'); nc.hidden = !n; nc.textContent = n;
  }

  function rank(rows, fmtVal) {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows.length ? `<div class="rank">${rows.map(([l, v]) => `<div class="rank-row"><span>${esc(l)}</span><b>${fmtVal(v)}</b><div class="meter"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`).join('')}</div>` : '<p class="muted">No data yet.</p>';
  }

  function renderAnalytics() {
    const all = [...orders.values()];
    const valid = all.filter((o) => statusOf(o.id) !== 'rejected');
    const revenue = money(valid);
    const phones = {}; valid.forEach((o) => { const k = o.p.replace(/\D/g, '').slice(-10); phones[k] = (phones[k] || 0) + 1; });
    const customers = Object.keys(phones).length;
    const repeat = Object.values(phones).filter((n) => n > 1).length;
    const done = all.filter((o) => statusOf(o.id) === 'completed').length;
    $('#aKpis').innerHTML = [
      kpi('Orders', all.length, 'stored on this device', '#60a5fa'),
      kpi('Revenue', fmt(revenue), 'excluding rejected', '#34d399'),
      kpi('Avg ticket', fmt(valid.length ? Math.round(revenue / valid.length) : 0), 'per order', '#a78bfa'),
      kpi('Completion', all.length ? `${Math.round(done / all.length * 100)}%` : '–', `${done} completed`, '#fb923c'),
      kpi('Customers', customers, `${repeat} repeat`, '#f472b6')
    ].join('');

    const hours = Array(24).fill(0);
    valid.forEach((o) => { hours[new Date(o.ts).getHours()]++; });
    const hm = Math.max(1, ...hours);
    $('#hourChart').innerHTML = hours.map((n, h) => `<div class="bar-col"><div style="height:${(n / hm * 100).toFixed(1)}%">${n ? `<em>${n}</em>` : ''}</div><span>${h % 3 === 0 ? `${h}h` : ''}</span></div>`).join('');

    const qty = {}; const cat = {};
    valid.forEach((o) => o.it.forEach(([id, q]) => { const it = ITEMS.get(id); qty[it.name] = (qty[it.name] || 0) + q; const c = MENU.find((x) => x.id === it.cat).name; cat[c] = (cat[c] || 0) + it.price * q; }));
    $('#topItems').innerHTML = rank(Object.entries(qty).sort((a, b) => b[1] - a[1]).slice(0, 8), (v) => `${v}×`);
    $('#catSplit').innerHTML = rank(Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 8), fmt);
    const mix = {}; all.forEach((o) => { const l = LH.statusLabel(o, statusOf(o.id)); mix[l] = (mix[l] || 0) + 1; });
    $('#statusMix').innerHTML = rank(Object.entries(mix).sort((a, b) => b[1] - a[1]), (v) => v);
    const sv = { 'Dine-in': 0, Takeaway: 0, Delivery: 0, 'UPI': 0, 'Cash / counter': 0 };
    all.forEach((o) => { sv[o.svc === 'take' ? 'Takeaway' : o.svc === 'deliver' ? 'Delivery' : 'Dine-in']++; sv[o.pay === 'upi' ? 'UPI' : 'Cash / counter']++; });
    $('#svcMix').innerHTML = rank(Object.entries(sv), (v) => v);
  }

  /* ---------- History ---------- */
  function renderHistory() {
    const q = $('#histSearch').value.trim().toLowerCase();
    const st = $('#histStatus').value;
    const rows = [...orders.values()].sort((a, b) => b.ts - a.ts)
      .filter((o) => (!st || statusOf(o.id) === st) && (!q || `${o.id} ${o.n} ${o.p} ${o.em} ${o.addr || ''}`.toLowerCase().includes(q))).slice(0, 300);
    $('#histBody').innerHTML = rows.length ? rows.map((o) => {
      const s = statusOf(o.id); const m = meta[o.id] || {};
      return `<tr><td class="oid">${esc(o.id)}</td><td>${new Date(o.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${esc(o.n)}<br><span class="muted">${esc(o.p)}${o.em ? ` · ${esc(o.em)}` : ''}</span>${o.svc === 'deliver' ? `<br><span class="muted">🛵 ${esc(o.addr)}</span>` : ''}</td>
        <td>${o.it.map(([id, n]) => `${n}× ${esc(ITEMS.get(id).name)}`).join(', ')}${o.nt ? `<br><span class="muted">📝 ${esc(o.nt)}</span>` : ''}</td>
        <td><b>${fmt(o.total)}</b></td><td>${o.pay === 'upi' ? (m.v ? 'UPI · verified' : 'UPI · pending') : o.svc === 'deliver' ? 'Cash on delivery' : 'Counter'}</td>
        <td><span class="badge" style="background:${STATUS[s].color}">${esc(LH.statusLabel(o, s))}</span>${m.r ? `<br><span class="muted">${esc(m.r)}</span>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="muted" style="padding:30px;text-align:center">No orders found.</td></tr>';
  }

  const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  function exportCsv() {
    const head = ['Order', 'Time', 'Name', 'Phone', 'Email', 'Service', 'Table', 'Items', 'Total', 'Payment', 'Payment verified', 'Status', 'Note', 'Address', 'Latitude', 'Longitude', 'Delivery fee'];
    const rows = [...orders.values()].sort((a, b) => a.ts - b.ts).map((o) => [o.id, new Date(o.ts).toISOString(), o.n, o.p, o.em, o.svc, o.tbl, o.it.map(([id, q]) => `${q}x ${ITEMS.get(id).name}`).join('; '), o.total, o.pay, (meta[o.id] || {}).v ? 'yes' : 'no', statusOf(o.id), o.nt, o.addr || '', o.lat ?? '', o.lng ?? '', o.fee ?? '']);
    const blob = new Blob([[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `lauralshaven-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- Menu and store settings ---------- */
  function buildMenuAdmin() {
    $('#menuAdmin').innerHTML = MENU.map((c) => `<section class="mcat" data-cat="${c.id}"><header><span style="font-size:1.5rem">${c.icon}</span><h3>${esc(c.name)}</h3>
      <button class="btn ghost sm" data-cat-out="${c.id}">Toggle all</button></header>
      <div class="mgrid">${c.items.map((it) => `<div class="mitem" data-id="${it.id}"><div class="nm">${it.icon} ${esc(it.name)}<small>${fmt(it.price)}</small></div>
        <label class="switch" title="Available"><input type="checkbox" data-item="${it.id}"><span class="track"></span></label></div>`).join('')}</div></section>`).join('');
  }

  function renderConfig() {
    $('#openToggle').checked = draft.open;
    $('#openLbl').textContent = draft.open ? 'Open' : 'Closed';
    $('#prepVal').textContent = draft.prep;
    $('#delToggle').checked = draft.del;
    $('#delLbl').textContent = draft.del ? 'On' : 'Off';
    if (document.activeElement !== $('#noteInput')) $('#noteInput').value = draft.note;
    $$('[data-item]').forEach((cb) => { cb.checked = !draft.oos.has(cb.dataset.item); $(`.mitem[data-id="${cb.dataset.item}"]`).classList.toggle('out', draft.oos.has(cb.dataset.item)); });
    $('#oosCount').textContent = draft.oos.size ? `${draft.oos.size} item(s) sold out` : 'Everything is available';
    $('#soundToggle').checked = soundOn;
    $('#soundBtn').classList.toggle('off', !soundOn);
    filterMenuAdmin();
  }

  function filterMenuAdmin() {
    const q = $('#menuSearch').value.trim().toLowerCase();
    $$('.mitem').forEach((el) => { el.hidden = !!q && !ITEMS.get(el.dataset.id).name.toLowerCase().includes(q); });
    $$('.mcat').forEach((s) => { s.hidden = !$$('.mitem:not([hidden])', s).length; });
  }

  function renderConn(info) {
    const i = info || LH.getRelay();
    const pill = $('#livePill');
    const up = i.orders && i.ops;
    pill.classList.toggle('up', up); pill.classList.toggle('down', !up);
    $('span', pill).textContent = up ? 'Live' : (i.orders || i.ops ? 'Partially connected' : 'Reconnecting');
    const row = (l, v) => `<div class="conn-row"><span>${l}</span><b>${v}</b></div>`;
    $('#connInfo').innerHTML = row('Orders channel', i.orders ? '🟢 connected' : '🟠 reconnecting') + row('Status channel', i.ops ? '🟢 connected' : '🟠 reconnecting') + row('Queued messages', i.queued || 0) + row('Orders stored', orders.size);
  }

  function renderAll() { renderKpis(); renderBoard(); renderConfig(); renderConn(); if ($('#tab-analytics').classList.contains('on')) renderAnalytics(); if ($('#tab-history').classList.contains('on')) renderHistory(); }

  /* ---------- UI wiring ---------- */
  const TABS = { orders: ['Live orders', 'Real-time kitchen board'], analytics: ['Analytics', 'Sales and performance insights'], menu: ['Menu & stock', 'Control availability on the storefront instantly'], history: ['Order history', 'Search, filter and export'], settings: ['Settings', 'Alerts, connection and data'] };
  function showTab(name) {
    if (!TABS[name]) name = 'orders';
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('on', t.id === `tab-${name}`));
    $('#tabTitle').textContent = TABS[name][0]; $('#tabSub').textContent = TABS[name][1];
    if (name === 'analytics') renderAnalytics();
    if (name === 'history') renderHistory();
    history.replaceState(null, '', `#${name}`);
    if (started) scrollTo({ top: 0, behavior: 'auto' });
  }

  function wireUI() {
    $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
    showTab(location.hash.slice(1));
    $('#histStatus').insertAdjacentHTML('beforeend', Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join(''));
    $('#histSearch').addEventListener('input', renderHistory);
    $('#histStatus').addEventListener('change', renderHistory);
    $('#menuSearch').addEventListener('input', filterMenuAdmin);
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#exportCsv2').addEventListener('click', exportCsv);

    $('#openToggle').addEventListener('change', (e) => { draft.open = e.target.checked; renderConfig(); pushConfig(); });
    $('#delToggle').addEventListener('change', (e) => { draft.del = e.target.checked; renderConfig(); renderBoard(); pushConfig(); });
    $('#mvClose').addEventListener('click', closeMap);
    $('#mvFit').addEventListener('click', () => { mapUserMoved = false; if (mapCtl) mapCtl.fit(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMap(); });
    $('#rideBar').addEventListener('click', (e) => { if (e.target.closest('[data-ride-stop]')) { ride.ids.clear(); saveRide(); ensureWatch(); renderRide(); renderBoard(); } });
    $('#prepDec').addEventListener('click', () => { draft.prep = Math.max(1, draft.prep - 1); renderConfig(); pushConfig(); });
    $('#prepInc').addEventListener('click', () => { draft.prep = Math.min(180, draft.prep + 1); renderConfig(); pushConfig(); });
    $('#noteInput').addEventListener('input', (e) => { draft.note = LH.clean(e.target.value, 120); pushConfig(); });
    $('#menuAdmin').addEventListener('change', (e) => {
      const id = e.target.dataset.item;
      if (!id) return;
      if (e.target.checked) draft.oos.delete(id); else draft.oos.add(id);
      renderConfig(); pushConfig();
    });
    $('#menuAdmin').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat-out]');
      if (!b) return;
      const ids = MENU.find((c) => c.id === b.dataset.catOut).items.map((i) => i.id);
      const allOut = ids.every((id) => draft.oos.has(id));
      ids.forEach((id) => (allOut ? draft.oos.delete(id) : draft.oos.add(id)));
      renderConfig(); pushConfig();
    });
    $('#restockAll').addEventListener('click', () => { draft.oos.clear(); renderConfig(); pushConfig(); });

    const toggleSound = () => { soundOn = !soundOn; store.set('sound', soundOn); if (soundOn) chime(); renderConfig(); };
    $('#soundBtn').addEventListener('click', toggleSound);
    $('#soundToggle').addEventListener('change', toggleSound);
    $('#testSound').addEventListener('click', chime);
    $('#notifyBtn').addEventListener('click', async () => {
      if (!('Notification' in window)) { toast('Notifications are not supported here.', 'bad'); return; }
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'Desktop notifications enabled' : 'Notifications blocked in the browser', p === 'granted' ? 'ok' : 'bad');
    });
    $('#retrySend').addEventListener('click', () => { LH.flush(); toast('Retrying...'); });
    $('#ghSave').addEventListener('click', () => {
      const v = $('#ghToken').value.trim();
      if (!/^[A-Za-z0-9_]{20,255}$/.test(v)) { toast('That does not look like a GitHub token.', 'bad'); return; }
      store.set('ghToken', v); $('#ghToken').value = ''; renderMail(); toast('Token saved on this device', 'ok');
    });
    $('#ghClear').addEventListener('click', () => { store.del('ghToken'); renderMail(); toast('Token removed', 'ok'); });
    $('#mailNow').addEventListener('click', (e) => runNow(e.currentTarget, 'mailer.yml', null, 'Email service started'));
    $('#reportNow').addEventListener('click', (e) => runNow(e.currentTarget, 'daily-report.yml', null, 'Report on its way'));
    renderMail();
    $('#clearBoard').addEventListener('click', () => {
      openModal('<h3>Clear the board?</h3><p class="muted" style="margin-bottom:16px">All current orders are removed from every admin device. The nightly email report only covers orders still on the board, so clear it after 23:59. Customers keep their own order history.</p><div class="reason-list"><button id="confirmClear" style="color:var(--red)">Yes, clear everything</button></div><button class="btn ghost" data-modal-close style="width:100%">Cancel</button>');
      $('#modalCard').onclick = async (e) => {
        if (!e.target.closest('#confirmClear')) return;
        closeModal();
        try { await LH.publishAdmin({ k: 'clr' }); toast('Board cleared', 'ok'); } catch (err) { toast('Could not clear the board.', 'bad'); }
      };
    });
  }
})();
