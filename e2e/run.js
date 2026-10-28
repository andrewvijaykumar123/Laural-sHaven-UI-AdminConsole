'use strict';
/* End-to-end suite for the storefront and the admin console.
   Run: node e2e/run.js   (SHOP_DIR=<path to Laural-sHaven-UI> if the storefront is not next to this repo; HEADED=1 to watch)
   Real Firebase, the real firestore.rules and real SMTP are replaced by test doubles; see e2e/world.js. */
const fs = require('fs');
const path = require('path');
const { createWorld } = require('./world');

const SHOP_DIR = path.resolve(process.env.SHOP_DIR || path.join(__dirname, '..', '..', 'Laural-sHaven-UI'));
const ADMIN_DIR = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failed = 0; let passed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  return ok;
}
async function until(fn, ms = 8000, step = 60) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

(async () => {
  const world = await createWorld({ shopDir: SHOP_DIR, adminDir: ADMIN_DIR, headed: !!process.env.HEADED });
  const { LH, db } = world;
  const items = LH.MENU.flatMap((c) => c.items);
  const I = (n) => items[n].id;
  const fmt = LH.fmt;
  const geoAt = (km) => ({ latitude: LH.SHOP.lat + km / 111.2, longitude: LH.SHOP.lng, accuracy: 20 });
  const DESKTOP = { width: 1360, height: 860 };
  const orderCount = () => [...db.docs.keys()].filter((k) => k.startsWith('orders/')).length;
  const emailsTo = (em) => world.emails.filter((e) => e.to === em);
  const has = (em, re) => world.emails.find((e) => e.to === em && re.test(e.subject));

  async function newShop(opts = {}) {
    const h = await world.open('shop', { mobile: true, ...opts });
    await h.page.waitForSelector('#menuRoot .card');
    await h.page.waitForSelector('#livePill.up', { timeout: 10000 });
    await sleep(120);
    return h;
  }
  async function newAdmin(opts = {}) {
    const h = await world.open('admin', { viewport: DESKTOP, geo: geoAt(1), ...opts });
    const ok = await world.login(h);
    if (!ok) throw new Error('admin login failed');
    await h.page.waitForSelector('#livePill.up', { timeout: 10000 });
    return h;
  }
  const setSwitch = async (h, sel, on) => {
    await h.page.evaluate(([s, v]) => { const el = document.querySelector(s); if (el.checked !== v) el.click(); }, [sel, on]);
  };

  /* Fill the checkout form and press "Place order". Returns the order id once the confirmation shows. */
  async function place(h, o) {
    const p = h.page;
    for (const n of o.items || [0]) await p.click(`.card[data-id="${I(n)}"] [data-act="inc"]`);
    await p.click('#cartBtn');
    await p.click('#toCheckout');
    await p.fill('#coName', o.name ?? 'Anita');
    await p.fill('#coPhone', o.phone ?? '9876543210');
    await p.fill('#coEmail', o.em ?? '');
    await p.click(`#svcSeg [data-v="${o.svc || 'take'}"]`);
    if (o.tbl) await p.fill('#coTable', o.tbl);
    if (o.svc === 'deliver') {
      await p.fill('#coAddr', o.addr ?? '12 Lake View Road, near the temple');
      await p.waitForSelector('#geoBox.ok, #geoBox.bad, #geoBox.warn', { timeout: 8000 });
    }
    if (o.note) await p.fill('#coNote', o.note);
    await p.click(`#paySeg [data-v="${o.pay || 'counter'}"]`);
    if (o.stop) return null;
    const t0 = Date.now();
    await p.click('#placeOrder');
    await p.waitForSelector('#modal:not([hidden]) #modalCard .oid', { timeout: 8000 });
    const id = (await p.textContent('#modalCard .oid')).trim();
    return { id, t0 };
  }
  const shopStatus = (h, id) => h.page.evaluate((x) => { const o = window.__lh.orders.find((y) => y.id === x); return o && o.status; }, id);
  const card = (a, id) => a.page.locator(`.ocard[data-id="${id}"]`);
  async function act(a, id, to) {
    await a.page.waitForSelector(`.ocard[data-id="${id}"]`);
    const t = Date.now();
    await card(a, id).locator(`[data-act="${to}"]`).click();
    return t;
  }
  const nextEmail = async (em, re, since, ms = 8000) => { const e = await until(() => world.emails.find((x) => x.to === em && x.t >= since && re.test(x.subject)), ms); return e ? e.t - since : -1; };
  const closeModal = (h) => h.page.evaluate(() => { const m = document.querySelector('#modal'); if (m) m.hidden = true; document.body.style.overflow = ''; });
  const overflow = (h) => h.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  async function scenario(name, fn) {
    const t = Date.now();
    try { await fn(); console.log(`----  ${name} (${Date.now() - t} ms)`); } catch (e) {
      failed++;
      console.log(`FAIL  ${name}  [exception: ${String(e.message).split('\n')[0]}]`);
      for (const h of world.pages.slice(-4)) { try { await h.page.screenshot({ path: path.join(OUT, `${name.replace(/\W+/g, '_')}-${h.kind}.png`) }); } catch (x) { /* page gone */ } }
    }
  }

  let A; let A2;
  const placed = {};

  /* ---------------- Storefront basics ---------------- */
  await scenario('storefront basics', async () => {
    const s = await newShop();
    const p = s.page;
    check('menu renders every item', (await p.locator('.card').count()) === items.length, `${items.length} items`);
    await p.fill('#search', 'burger');
    const shown = await p.locator('.card:not([hidden])').count();
    check('search filters the menu', shown > 0 && shown < items.length, `${shown} match`);
    await p.fill('#search', 'zzzzqq');
    check('empty search shows a message', await p.isVisible('#emptyMsg'));
    await p.fill('#search', '');
    await p.click('.diet [data-diet="v"]');
    const bad = await p.locator('.card:not([hidden]) .dd:not(.v)').count();
    check('veg filter shows only veg items', bad === 0);
    await p.click('.diet [data-diet="all"]');
    const theme0 = await p.getAttribute('html', 'data-theme');
    await p.click('#themeBtn');
    check('theme toggles', (await p.getAttribute('html', 'data-theme')) !== theme0);
    check('closed drawers are not focusable (inert)', await p.evaluate(() => document.querySelector('#cartDrawer').inert && document.querySelector('#ordersDrawer').inert));
    await p.click(`.card[data-id="${I(0)}"] [data-act="inc"]`);
    await p.click(`.card[data-id="${I(0)}"] [data-act="inc"]`);
    check('cart counts items', (await p.textContent('#cartCount')) === '2');
    await p.reload();
    await p.waitForSelector('#menuRoot .card');
    check('cart survives reload', (await p.textContent('#cartCount')) === '2');
    await p.click('#cartBtn');
    check('cart drawer opens', await p.isVisible('#cartDrawer.open'));
    await p.click('#cartDrawer .step [data-act="dec"]');
    await p.click('#cartDrawer .step [data-act="dec"]');
    check('empty cart shows empty state', await p.isVisible('.empty-cart'));
    check('no horizontal overflow on mobile', (await overflow(s)) <= 1, String(await overflow(s)));
  });

  /* ---------------- Admin login ---------------- */
  await scenario('admin login and lockout', async () => {
    const h = await world.open('admin', { viewport: DESKTOP });
    const p = h.page;
    await p.waitForSelector('#lock:not([hidden])');
    for (let i = 1; i <= 5; i++) {
      await p.fill('#email', world.ADMIN_EMAIL);
      await p.fill('#pw', `wrong-${i}`);
      await p.click('#loginBtn');
      await until(async () => (await p.textContent('#lockMsg')).length > 0 && !(await p.isDisabled('#loginBtn')));
      if (i === 1) check('wrong password is rejected politely', /Incorrect/.test(await p.textContent('#lockMsg')));
    }
    check('five failures lock the form', /Too many/.test(await p.textContent('#lockMsg')));
    await p.fill('#pw', world.ADMIN_PASSWORD);
    await p.click('#loginBtn');
    await sleep(300);
    check('locked form refuses even the right password', await p.isVisible('#lock') && !(await p.isVisible('#app')));
    await h.ctx.close();
    world.pages.splice(world.pages.indexOf(h), 1);
    A = await newAdmin();
    check('admin signs in', await A.page.isVisible('#app'));
  });

  /* ---------------- Store settings ---------------- */
  await scenario('admin settings reach the storefront', async () => {
    await A.page.click('#nav [data-tab="menu"]');
    await setSwitch(A, '#delToggle', true);
    await A.page.fill('#noteInput', 'Free dessert on orders above 500');
    check('delivery switch is published', !!(await until(() => db.docs.get('config/store') && db.docs.get('config/store').del === true)));
    const s = await newShop();
    check('announcement banner shows', /Free dessert/.test(await s.page.textContent('#banner')));
    check('delivery note shows on the hero', await s.page.isVisible('#delivNote'));
    await A.page.click('#prepInc');
    await until(() => db.docs.get('config/store').prep === LH.getCfg().prep + 1 || db.docs.get('config/store').prep > 12);
    check('prep time is published', db.docs.get('config/store').prep >= 13, String(db.docs.get('config/store').prep));
    await A.page.click('#nav [data-tab="orders"]');
  });

  /* ---------------- Checkout validation ---------------- */
  await scenario('checkout validation', async () => {
    const s = await newShop();
    const before = orderCount();
    await place(s, { name: '', phone: '123', em: 'not-an-email', stop: true });
    await s.page.click('#placeOrder');
    await sleep(200);
    check('name required', await s.page.locator('#fName.err').count() === 1);
    check('phone validated', await s.page.locator('#fPhone.err').count() === 1);
    check('email validated', await s.page.locator('#fEmail.err').count() === 1);
    check('nothing was sent', orderCount() === before);
  });

  /* ---------------- Dine-in order with instant emails ---------------- */
  await scenario('dine-in order and instant emails', async () => {
    const em = 'dine@example.com';
    const s = await newShop();
    const o = await place(s, { items: [0, 1], svc: 'dine', tbl: '4', em, name: 'Anita <img src=x onerror=window.__xss=1>', note: 'less spicy' });
    placed.dine = o.id;
    const tCard = await until(async () => (await card(A, o.id).count()) && Date.now() - o.t0);
    check('order reaches the admin board in about a second', !!tCard && tCard < 3000, `${tCard} ms`);
    const lat = await nextEmail(em, /We received your order/, o.t0);
    check('"received" email within a few seconds', lat > 0 && lat < 4500, `${lat} ms`);
    check('admin sanitised the customer name', (await A.page.evaluate(() => window.__xss)) === undefined && !/<img/i.test(await card(A, o.id).innerHTML()));
    let t = await act(A, o.id, 'accepted');
    const lc = await nextEmail(em, /confirmed/, t);
    check('"confirmed" email within a few seconds', lc > 0 && lc < 4500, `${lc} ms`);
    check('customer sees accepted live', !!(await until(async () => (await shopStatus(s, o.id)) === 'accepted', 4000)));
    await closeModal(s);
    t = await act(A, o.id, 'cooking');
    check('customer sees cooking live', !!(await until(async () => (await shopStatus(s, o.id)) === 'cooking', 4000)));
    t = await act(A, o.id, 'ready');
    const lr = await nextEmail(em, /is ready/, t);
    check('"ready" email within a few seconds', lr > 0 && lr < 4500, `${lr} ms`);
    t = await act(A, o.id, 'completed');
    check('customer sees completed live', !!(await until(async () => (await shopStatus(s, o.id)) === 'completed', 4000)));
    await sleep(2500);
    const got = emailsTo(em);
    check('no duplicate emails', new Set(got.map((e) => e.subject)).size === got.length, got.map((e) => e.subject.replace(/ - .*/, '')).join(' | '));
    check('email body carries order id and total', got.every((e) => e.html.includes(o.id)) && got.some((e) => e.html.includes(fmt(items[0].price + items[1].price))));
    check('email body does not contain raw customer HTML', got.every((e) => !/<img src=x/i.test(e.html)));
    check('relay got a plain-text part too', got.every((e) => e.text && e.text.length > 20));
  });

  /* ---------------- Takeaway with UPI ---------------- */
  await scenario('takeaway with UPI and payment verification', async () => {
    const s = await newShop();
    const o = await place(s, { items: [2], svc: 'take', pay: 'upi', name: "=SUM(1+1) O'Neil", em: 'upi@example.com' });
    placed.upi = o.id;
    check('UPI QR is shown', await s.page.isVisible('#qrImg') && !!(await s.page.getAttribute('#qrImg', 'src')));
    await card(A, o.id).waitFor();
    check('admin sees UPI unverified', /UPI unverified/.test(await card(A, o.id).textContent()));
    await card(A, o.id).locator('[data-act="pay"]').click();
    check('customer sees payment verified', !!(await until(() => s.page.evaluate((x) => window.__lh.orders.find((y) => y.id === x).payVerified === true, o.id), 4000)));
    await closeModal(s);
  });

  /* ---------------- Reject with a reason ---------------- */
  await scenario('reject with a reason', async () => {
    const em = 'reject@example.com';
    const s = await newShop();
    const o = await place(s, { items: [3], svc: 'dine', em });
    await closeModal(s);
    await card(A, o.id).waitFor();
    await card(A, o.id).locator('[data-act="reject"]').click();
    const t = Date.now();
    await A.page.click('[data-reject="Item out of stock"]');
    check('customer sees rejection and reason', !!(await until(() => s.page.evaluate((x) => { const r = window.__lh.orders.find((y) => y.id === x); return r.status === 'rejected' && r.reason === 'Item out of stock'; }, o.id), 5000)));
    const l = await nextEmail(em, /could not be accepted/, t - 4000);
    check('rejection email is sent', l >= 0);
    check('rejection email names the reason', /out of stock/i.test((has(em, /could not be accepted/) || {}).text || ''));
    await s.page.click('#ordersBtn');
    check('My orders shows the reason', /Item out of stock/.test(await s.page.textContent('#ordersBody')));
    await s.page.click('[data-again]');
    check('Order again refills the cart', !!(await until(async () => (await s.page.textContent('#cartCount')) === '1' && (await s.page.locator('#cartDrawer.open').count()) === 1, 3000)));
  });

  /* ---------------- Delivery fees and location ---------------- */
  await scenario('delivery: distance tiers and location handling', async () => {
    const near = await newShop({ geo: geoAt(1) });
    const o1 = await place(near, { items: [4], svc: 'deliver', pay: 'counter', em: 'near@example.com', stop: true });
    check('near address is free', /Free/.test(await near.page.textContent('#geoBox')) && /free/i.test(await near.page.textContent('#geoBox')));
    const r1 = await (async () => { const t0 = Date.now(); await near.page.click('#placeOrder'); await near.page.waitForSelector('#modalCard .oid'); return { id: (await near.page.textContent('#modalCard .oid')).trim(), t0 }; })();
    placed.near = r1.id;
    check('free delivery order stored with zero fee', db.docs.get(`orders/${r1.id}`).fee === 0);

    const mid = await newShop({ geo: geoAt(7) });
    await place(mid, { items: [4], svc: 'deliver', stop: true });
    const midFee = LH.deliveryFee(LH.fromShopKm(geoAt(7).latitude, geoAt(7).longitude));
    check('mid-range fee is quoted before ordering', (await mid.page.textContent('#feeRow')).includes(fmt(midFee)), `${midFee}`);
    await mid.page.click('#placeOrder');
    await mid.page.waitForSelector('#modalCard .oid');
    const mid1 = (await mid.page.textContent('#modalCard .oid')).trim();
    const doc = db.docs.get(`orders/${mid1}`);
    check('mid-range fee and total stored correctly', doc.fee === midFee && doc.total === items[4].price + midFee, `fee ${doc.fee} total ${doc.total}`);
    placed.mid = mid1;

    const far = await newShop({ geo: geoAt(20) });
    await place(far, { items: [4], svc: 'deliver', stop: true });
    check('far address is blocked', /don't offer online delivery/i.test(await far.page.textContent('#geoBox')) && await far.page.isDisabled('#placeOrder'));

    const denied = await newShop();
    await place(denied, { items: [4], svc: 'deliver', stop: true });
    const dText = await denied.page.textContent('#geoBox');
    check('denied location explains what to do', /location/i.test(dText) && await denied.page.isDisabled('#placeOrder'), dText.slice(0, 80));

    const guard = await near.page.evaluate(async () => { try { await window.LH.publishOrder({ n: 'Hack', p: '9876543210', em: '', nt: '', pay: 'counter', svc: 'deliver', tbl: '', it: [[window.LH.MENU[0].items[0].id, 1]], addr: 'Somewhere far away', lat: 13.5, lng: 80.5 }); return 'accepted'; } catch (e) { return 'rejected'; } });
    check('out-of-range delivery is refused even if the UI is bypassed', guard === 'rejected');
  });

  /* ---------------- Delivery lifecycle and live tracking ---------------- */
  await scenario('delivery lifecycle, live tracking and Deliveries tab', async () => {
    const em = 'ride@example.com';
    const s = await newShop({ geo: geoAt(2) });
    const o = await place(s, { items: [5], svc: 'deliver', pay: 'counter', em });
    await closeModal(s);
    await card(A, o.id).waitFor();
    check('admin card shows delivery chip', /Delivery/.test(await card(A, o.id).textContent()));
    await act(A, o.id, 'accepted');
    await act(A, o.id, 'cooking');
    let t = await act(A, o.id, 'ready');
    check('delivery has no early "Complete" action', (await card(A, o.id).locator('[data-act="completed"]').count()) === 0);
    t = await act(A, o.id, 'out');
    const lo = await nextEmail(em, /on the way/, t);
    check('"on the way" email within a few seconds', lo > 0 && lo < 4500, `${lo} ms`);
    await A.page.click('#nav [data-tab="deliveries"]');
    await A.page.waitForSelector(`#dvList [data-dv="${o.id}"]`);
    check('Deliveries tab lists the order and map loads', await A.page.locator('#dvMap .leaflet-container, #dvMap.leaflet-container').count() > 0 || !!(await until(() => A.page.locator('#dvMap .leaflet-container, #dvMap.leaflet-container').count(), 6000)));
    await A.page.click('#nav [data-tab="orders"]');
    await card(A, o.id).locator('[data-act="ride"]').click();
    await s.page.click('#ordersBtn');
    check('customer receives the rider location', !!(await until(() => s.page.evaluate(() => /min away/.test(document.querySelector('#ordersBody').innerText)), 6000)));
    await s.page.evaluate(() => document.querySelector('[data-track]').click());
    await s.page.waitForSelector('#trackView:not([hidden])');
    check('track view shows distance from the rider', !!(await until(async () => /km from you/.test(await s.page.textContent('#tvInfo')), 6000)));
    check('track map initialises', !!(await until(() => s.page.locator('#tvMap .leaflet-container, #tvMap.leaflet-container').count(), 6000)));
    t = await act(A, o.id, 'completed');
    const ld = await nextEmail(em, /delivered/, t);
    check('"delivered" email within a few seconds', ld > 0 && ld < 4500, `${ld} ms`);
    check('track view reflects delivery', !!(await until(async () => /delivered/i.test(await s.page.textContent('#tvSub')), 5000)));
    await s.page.click('#tvClose');
  });

  /* ---------------- Closed store ---------------- */
  await scenario('closed kitchen and sold-out items', async () => {
    const s = await newShop();
    await A.page.click('#nav [data-tab="menu"]');
    await A.page.fill('#menuSearch', items[6].name);
    await setSwitch(A, `[data-item="${I(6)}"]`, false);
    check('sold-out item is blocked on the storefront', !!(await until(() => s.page.locator(`.card[data-id="${I(6)}"].sold`).count(), 4000)));
    check('sold-out item cannot be added', (await s.page.locator(`.card[data-id="${I(6)}"] [data-act="inc"]`).count()) === 0);
    await A.page.click('#restockAll');
    check('restock brings it back', !!(await until(() => s.page.locator(`.card[data-id="${I(6)}"]:not(.sold) [data-act="inc"]`).count(), 4000)));
    await A.page.fill('#menuSearch', '');

    await setSwitch(A, '#openToggle', false);
    check('closed banner shows', !!(await until(async () => /closed/i.test(await s.page.textContent('#banner')), 4000)));
    const before = orderCount();
    await place(s, { items: [0], svc: 'take', stop: true });
    await s.page.click('#placeOrder');
    await sleep(400);
    check('closed kitchen refuses orders', orderCount() === before && /closed/i.test(await s.page.textContent('#toasts')));
    const bypass = await s.page.evaluate(async () => { try { await window.LH.publishOrder({ n: 'Late', p: '9876543210', em: '', nt: '', pay: 'counter', svc: 'take', tbl: '', it: [[window.LH.MENU[0].items[0].id, 1]] }); return 'accepted'; } catch (e) { return 'rejected'; } });
    check('server rules also refuse while closed', bypass === 'rejected' && orderCount() === before);
    await setSwitch(A, '#openToggle', true);
    check('reopening hides the banner', !!(await until(async () => !(await s.page.isVisible('#banner')) || !/closed/i.test(await s.page.textContent('#banner')), 4000)));
    await A.page.click('#nav [data-tab="orders"]');
  });

  /* ---------------- Two admin devices ---------------- */
  await scenario('two admin devices send each email once', async () => {
    A2 = await newAdmin();
    const em = 'twice@example.com';
    const s = await newShop();
    const o = await place(s, { items: [7], svc: 'take', em });
    await closeModal(s);
    await card(A2, o.id).waitFor();
    await sleep(3500);
    check('"received" email sent exactly once', emailsTo(em).filter((e) => /We received/.test(e.subject)).length === 1, String(emailsTo(em).length));
    await act(A2, o.id, 'accepted');
    await sleep(3500);
    check('"confirmed" email sent exactly once', emailsTo(em).filter((e) => /confirmed/.test(e.subject)).length === 1);
    check('claim documents exist for both emails', db.docs.has(`mailq/${o.id}_p`) && db.docs.has(`mailq/${o.id}_c`));
    check('both consoles show the new status', !!(await until(async () => /Accepted|Cooking/.test(await A.page.locator(`.col[data-status="accepted"]`).textContent()) && (await A.page.locator(`.col[data-status="accepted"] .ocard[data-id="${o.id}"]`).count()) === 1, 4000)));
    const writes = db.writes.filter((w) => w.path === `mailq/${o.id}_p`).length;
    check('claim was written once', writes === 1, String(writes));
    await A2.ctx.close();
    world.pages.splice(world.pages.indexOf(A2), 1);
  });

  /* ---------------- Analytics, history, CSV ---------------- */
  await scenario('analytics, history and CSV export', async () => {
    await A.page.click('#nav [data-tab="analytics"]');
    check('analytics KPIs render', (await A.page.locator('#aKpis .kpi').count()) >= 4 && (await A.page.locator('#dKpis .kpi').count()) >= 4);
    check('delivery analytics counts delivery orders', /[1-9]/.test(await A.page.locator('#dKpis .kpi').first().textContent()));
    await A.page.click('#anSvc [data-v="deliver"]');
    await A.page.click('#anSvc [data-v="all"]');
    await A.page.click('#nav [data-tab="history"]');
    const rows = await A.page.locator('#histBody tr').count();
    check('history lists the orders', rows >= 6, `${rows} rows`);
    await A.page.fill('#histSearch', placed.dine);
    check('history search by id', (await A.page.locator('#histBody tr').count()) === 1);
    await A.page.fill('#histSearch', '');
    await A.page.selectOption('#histSvc', 'deliver');
    const d = await A.page.locator('#histBody tr').count();
    check('history filters delivery orders', d >= 3 && d < rows, `${d} of ${rows}`);
    await A.page.selectOption('#histSvc', '');
    const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('#exportCsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    check('CSV has a header and one line per order', csv.startsWith('"Order","Time"') && csv.trim().split('\r\n').length >= 7, `${csv.trim().split('\r\n').length} lines`);
    check('CSV neutralises spreadsheet formulas', csv.includes(`"'=SUM(1+1)`) && !/,"=SUM/.test(csv));
    await A.page.click('#nav [data-tab="orders"]');
  });

  /* ---------------- Layout and accessibility ---------------- */
  await scenario('layout, accessibility and console cleanliness', async () => {
    for (const vp of [{ width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      const s = await newShop({ viewport: vp, mobile: vp.width < 700 });
      check(`storefront has no horizontal overflow at ${vp.width}px`, (await overflow(s)) <= 1, String(await overflow(s)));
      const unnamed = await s.page.evaluate(() => [...document.querySelectorAll('button, a[href], input, textarea, select')].filter((e) => !e.hidden && !(e.getAttribute('aria-label') || e.textContent.trim() || e.getAttribute('placeholder') || e.labels?.length || e.getAttribute('title'))).map((e) => e.outerHTML.slice(0, 80)));
      check(`storefront controls are named at ${vp.width}px`, unnamed.length === 0, unnamed.join(' ; '));
      const noAlt = await s.page.evaluate(() => document.querySelectorAll('img:not([alt])').length);
      check('images have alt text', noAlt === 0);
      await s.ctx.close(); world.pages.splice(world.pages.indexOf(s), 1);
    }
    for (const vp of [{ width: 390, height: 800, mobile: true }, { width: 1024, height: 768 }]) {
      const h = await world.open('admin', { viewport: { width: vp.width, height: vp.height }, mobile: vp.mobile, geo: geoAt(1) });
      await world.login(h);
      for (const tab of ['orders', 'deliveries', 'analytics', 'menu', 'history', 'settings']) {
        await h.page.evaluate((t) => document.querySelector(`#nav [data-tab="${t}"]`).click(), tab);
        await sleep(150);
        const ov = await overflow(h);
        check(`admin ${tab} tab has no horizontal overflow at ${vp.width}px`, ov <= 1, String(ov));
      }
      await h.ctx.close(); world.pages.splice(world.pages.indexOf(h), 1);
    }
  });

  /* ---------------- Reload persistence, clear board, lock ---------------- */
  await scenario('persistence, clear board and lock', async () => {
    const s = await newShop();
    const o = await place(s, { items: [8], svc: 'dine', em: 'persist@example.com' });
    await s.page.reload();
    await s.page.waitForSelector('#menuRoot .card');
    await s.page.click('#ordersBtn');
    check('customer order history survives reload', (await s.page.locator(`.order-card[data-id="${o.id}"]`).count()) === 1);
    await A.page.reload();
    await A.page.waitForSelector('#app:not([hidden])');
    check('admin stays signed in after reload', await A.page.isVisible('#app'));
    check('board restores after reload', !!(await until(() => card(A, o.id).count(), 5000)));
    await A.page.click('#nav [data-tab="settings"]');
    await A.page.click('#clearBoard');
    await A.page.click('#confirmClear');
    await A.page.click('#nav [data-tab="orders"]');
    check('clear board empties every card', !!(await until(async () => (await A.page.locator('.ocard').count()) === 0, 5000)));
    await A.page.click('#lockBtn2');
    await A.page.waitForSelector('#lock:not([hidden])');
    check('lock returns to the sign-in form', await A.page.isVisible('#lock'));
  });

  /* ---------------- Email fallbacks ---------------- */
  await scenario('fallback when Firestore rules are not published', async () => {
    for (const h of world.pages.filter((x) => x.kind === 'admin')) { await h.ctx.close().catch(() => {}); world.pages.splice(world.pages.indexOf(h), 1); }
    db.noMailRules = true;
    const em = 'norules@example.com';
    const a = await newAdmin();
    const s = await newShop();
    const d0 = world.dispatches.length;
    const o = await place(s, { items: [0], svc: 'take', em });
    await closeModal(s);
    await card(a, o.id).waitFor();
    check('GitHub mailer is kicked as the fallback', !!(await until(() => world.dispatches.length > d0, 5000)));
    check('no email went out through the relay', emailsTo(em).length === 0);
    await a.page.click('#nav [data-tab="settings"]');
    check('settings explain the fallback', /not available|rules/i.test(await a.page.textContent('#mailState')), (await a.page.textContent('#mailState')).slice(0, 100));
    db.noMailRules = false;
    await a.ctx.close(); world.pages.splice(world.pages.indexOf(a), 1);
  });

  await scenario('fallback when the relay has no SMTP secret', async () => {
    world.relay.mode = 'unset';
    const em = 'nosmtp@example.com';
    const a = await newAdmin();
    const s = await newShop();
    const d0 = world.dispatches.length;
    const o = await place(s, { items: [0], svc: 'take', em });
    await closeModal(s);
    await card(a, o.id).waitFor();
    check('GitHub mailer is kicked when SMTP is not configured', !!(await until(() => world.dispatches.length > d0, 5000)));
    check('failed claim is released for the fallback mailer', !!(await until(() => !db.docs.has(`mailq/${o.id}_p`), 4000)));
    await a.page.click('#nav [data-tab="settings"]');
    check('settings show the fallback state', /not available/i.test(await a.page.textContent('#mailState')));
    world.relay.mode = 'ok';
  });

  /* ---------------- Summary ---------------- */
  const errs = world.errors;
  check('no uncaught page errors or CSP violations', errs.length === 0, errs.slice(0, 5).join(' | '));
  console.log(`\n${passed} passed, ${failed} failed`);
  await world.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
