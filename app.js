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
    LH.connect('orders');
    LH.connect('ops');
    setInterval(() => { if (!document.hidden) renderBoard(); }, 30000);
  }

  const readDraft = () => { const c = LH.getCfg(); return { open: c.open, oos: new Set(c.oos), prep: c.prep, note: c.note }; };

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
    m.s = s; m.r = r; m.sts = ts; saveMeta(); scheduleRender();
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
    if (!NEXT[statusOf(id)].includes(s)) return;
    try { await LH.publishAdmin({ k: 'st', id, s, r: reason }); fresh.delete(id); if (['accepted', 'rejected', 'ready', 'completed'].includes(s)) kickMailer(); }
    catch (e) { toast('Could not update the order.', 'bad'); }
  }

  /* Emails are sent by GitHub Actions. A saved token lets this console start the run at once; otherwise a 15-minute schedule picks changes up. */
  const GH_REPO = 'andrewvijaykumar123/Laural-sHaven-UI-AdminConsole';
  let kickTimer = null;
  async function dispatchWorkflow(file, inputs) {
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
    if (!store.get('ghToken', '')) return;
    clearTimeout(kickTimer);
    kickTimer = setTimeout(async () => {
      let ok = false;
      try { ok = await dispatchWorkflow('mailer.yml'); } catch (e) { /* offline */ }
      if (!ok) toast('Could not start the email service now. Emails will go out within 15 minutes.', 'bad');
    }, 2500);
  }
  function renderMail() {
    const on = !!store.get('ghToken', '');
    $('#mailState').textContent = on ? 'Instant emails are on for this device.' : 'Instant emails are off. Emails go out within about 15 minutes.';
    $('#ghClear').hidden = !on; $('#mailNow').hidden = !on; $('#reportNow').hidden = !on;
  }
  async function runNow(btn, file, inputs, okMsg) {
    btn.disabled = true;
    try { toast((await dispatchWorkflow(file, inputs)) ? okMsg : 'GitHub refused the request. Check the token.', 'ok'); }
    catch (e) { toast('Could not reach GitHub.', 'bad'); }
    btn.disabled = false;
  }
  async function togglePay(id) {
    try { await LH.publishAdmin({ k: 'pv', id, v: !(meta[id] && meta[id].v) }); } catch (e) { toast('Could not update payment.', 'bad'); }
  }
  function pushConfig() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
      draftTimer = null;
      try { await LH.publishAdmin({ k: 'cfg', open: draft.open, oos: [...draft.oos], prep: draft.prep, note: draft.note }); toast('Storefront updated', 'ok'); }
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
    $('#printArea').innerHTML = `<h3>Laural's Haven</h3><p>${esc(o.id)} · ${new Date(o.ts).toLocaleString()}</p><hr>${lines}<hr><b>TOTAL ${fmt(o.total)}</b><p>${esc(o.n)} · ${esc(o.p)}<br>${o.svc === 'take' ? 'TAKEAWAY' : `DINE-IN ${esc(o.tbl)}`}<br>${o.pay === 'upi' ? 'UPI' : 'PAY AT COUNTER'}${o.nt ? `<br>NOTE: ${esc(o.nt)}` : ''}</p>`;
    window.print();
  }

  /* ---------- Board ---------- */
  const COLS = ['pending', 'accepted', 'cooking', 'ready', 'completed'];
  const COL_TITLE = { pending: 'New', accepted: 'Accepted', cooking: 'Cooking', ready: 'Ready', completed: 'Completed today' };
  const ago = (ts) => { const m = Math.max(0, Math.floor((LH.now() - ts) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
  const ACTION = {
    pending: [['accepted', 'Accept', ''], ['reject', 'Reject', 'bad']],
    accepted: [['cooking', 'Start cooking', ''], ['reject', 'Reject', 'bad']],
    cooking: [['ready', 'Mark ready', '']],
    ready: [['completed', 'Complete', '']]
  };

  function cardHTML(o) {
    const s = statusOf(o.id);
    const m = meta[o.id] || {};
    const late = s === 'pending' && Date.now() - o.ts > 5 * 60000;
    return `<article class="ocard ${fresh.has(o.id) ? 'fresh' : ''}" draggable="${NEXT[s].length ? 'true' : 'false'}" data-id="${esc(o.id)}" style="--c:${STATUS[s].color}">
      <div class="oc-top"><span class="oid">${esc(o.id)}</span><span class="age ${late ? 'late' : ''}">${ago(o.ts)}</span></div>
      <div class="oc-cust"><b>${esc(o.n)}</b><a href="tel:${esc(o.p)}">${esc(o.p)}</a></div>
      <div class="chips"><span class="chip">${o.svc === 'take' ? 'Takeaway' : `Dine-in${o.tbl ? ` · T${esc(o.tbl)}` : ''}`}</span>
        <span class="chip ${o.pay === 'upi' ? (m.v ? 'ok' : 'warn') : ''}">${o.pay === 'upi' ? (m.v ? 'UPI paid' : 'UPI unverified') : 'Pay at counter'}</span>${o.em ? '<span class="chip ok" title="Customer gets email updates">✉ Email</span>' : ''}</div>
      <ul class="oc-items">${o.it.map(([id, q]) => `<li><b>${q}×</b>${esc(ITEMS.get(id).name)}</li>`).join('')}</ul>
      ${o.nt ? `<div class="note">📝 ${esc(o.nt)}</div>` : ''}
      <div class="oc-foot"><strong>${fmt(o.total)}</strong><div class="acts">${(ACTION[s] || []).map(([to, label, cls]) => `<button class="act ${cls}" data-act="${to}">${label}</button>`).join('')}<button class="act sec" data-act="print" title="Print ticket">🖨</button></div></div>
      ${o.pay === 'upi' && !['rejected'].includes(s) ? `<button class="pay-btn" data-act="pay">${m.v ? 'Undo payment verified' : 'Mark payment verified'}</button>` : ''}
    </article>`;
  }

  function renderBoard() {
    const today = startOfToday();
    const all = [...orders.values()].sort((a, b) => a.ts - b.ts);
    $('#board').innerHTML = COLS.map((s) => {
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
      if (NEXT[statusOf(id)].includes(col.dataset.status)) setStatus(id, col.dataset.status);
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
    const mix = {}; all.forEach((o) => { const l = STATUS[statusOf(o.id)].label; mix[l] = (mix[l] || 0) + 1; });
    $('#statusMix').innerHTML = rank(Object.entries(mix).sort((a, b) => b[1] - a[1]), (v) => v);
    const sv = { 'Dine-in': 0, Takeaway: 0, 'UPI': 0, 'Pay at counter': 0 };
    all.forEach((o) => { sv[o.svc === 'take' ? 'Takeaway' : 'Dine-in']++; sv[o.pay === 'upi' ? 'UPI' : 'Pay at counter']++; });
    $('#svcMix').innerHTML = rank(Object.entries(sv), (v) => v);
  }

  /* ---------- History ---------- */
  function renderHistory() {
    const q = $('#histSearch').value.trim().toLowerCase();
    const st = $('#histStatus').value;
    const rows = [...orders.values()].sort((a, b) => b.ts - a.ts)
      .filter((o) => (!st || statusOf(o.id) === st) && (!q || `${o.id} ${o.n} ${o.p} ${o.em}`.toLowerCase().includes(q))).slice(0, 300);
    $('#histBody').innerHTML = rows.length ? rows.map((o) => {
      const s = statusOf(o.id); const m = meta[o.id] || {};
      return `<tr><td class="oid">${esc(o.id)}</td><td>${new Date(o.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${esc(o.n)}<br><span class="muted">${esc(o.p)}${o.em ? ` · ${esc(o.em)}` : ''}</span></td>
        <td>${o.it.map(([id, n]) => `${n}× ${esc(ITEMS.get(id).name)}`).join(', ')}${o.nt ? `<br><span class="muted">📝 ${esc(o.nt)}</span>` : ''}</td>
        <td><b>${fmt(o.total)}</b></td><td>${o.pay === 'upi' ? (m.v ? 'UPI · verified' : 'UPI · pending') : 'Counter'}</td>
        <td><span class="badge" style="background:${STATUS[s].color}">${STATUS[s].label}</span>${m.r ? `<br><span class="muted">${esc(m.r)}</span>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="muted" style="padding:30px;text-align:center">No orders found.</td></tr>';
  }

  const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  function exportCsv() {
    const head = ['Order', 'Time', 'Name', 'Phone', 'Email', 'Service', 'Table', 'Items', 'Total', 'Payment', 'Payment verified', 'Status', 'Note'];
    const rows = [...orders.values()].sort((a, b) => a.ts - b.ts).map((o) => [o.id, new Date(o.ts).toISOString(), o.n, o.p, o.em, o.svc, o.tbl, o.it.map(([id, q]) => `${q}x ${ITEMS.get(id).name}`).join('; '), o.total, o.pay, (meta[o.id] || {}).v ? 'yes' : 'no', statusOf(o.id), o.nt]);
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
