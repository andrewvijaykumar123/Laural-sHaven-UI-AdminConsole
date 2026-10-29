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

  await scenario('second admin signs in with a username', async () => {
    const h = await world.open('admin', { viewport: DESKTOP });
    const p = h.page;
    await p.waitForSelector('#lock:not([hidden])');
    await p.fill('#email', 'LauralsHavenAdmin');
    await p.fill('#pw', world.ADMIN2_PASSWORD);
    await p.click('#loginBtn');
    check('username sign-in opens the console', !!(await until(() => p.isVisible('#app'), 6000)));
    check('second admin sees the orders board', await p.isVisible('#nav'));
    await h.ctx.close();
    world.pages.splice(world.pages.indexOf(h), 1);
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
    check('UPI QR is shown', await s.page.isVisible('#qrImg') && !!(await until(() => s.page.evaluate(() => { const i = document.querySelector('#qrImg'); return i && i.complete && i.naturalWidth === 1039 && /payment-upi\.jpeg$/.test(i.src); }))));
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
    const code = db.docs.get(`orders/${o.id}`).otp;
    check('delivery order carries a 4-digit code', /^[0-9]{4}$/.test(code), String(code));
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
    await A.page.waitForSelector('#otpIn');
    await A.page.fill('#otpIn', code);
    await A.page.click('#otpGo');
    const ld = await nextEmail(em, /delivered/, t);
    check('"delivered" email within a few seconds', ld > 0 && ld < 4500, `${ld} ms`);
    check('delivery closed by the code', (db.docs.get(`status/${o.id}`) || {}).how === 'otp');
    check('track view reflects delivery', !!(await until(async () => /delivered/i.test(await s.page.textContent('#tvSub')), 5000)));
    await s.page.click('#tvClose');
  });

  /* ---------------- Delivery code (OTP) and manual close ---------------- */
  const toOut = async (o) => { for (const to of ['accepted', 'cooking', 'ready', 'out']) await act(A, o.id, to); };
  const dStatus = (id) => db.docs.get(`status/${id}`) || {};
  const invoiceIn = (m, ...parts) => !!m && parts.every((p) => m.html.includes(p));
  const otpMsg = async () => (await A.page.textContent('#otpMsg')).trim();
  const tryCode = async (code) => { await A.page.fill('#otpIn', code); await A.page.click('#otpGo'); };

  await scenario('delivery code: shown, emailed, wrong codes, lockout, manual close', async () => {
    const em = 'otp1@example.com';
    const s = await newShop({ geo: geoAt(2) });
    const o = await place(s, { items: [5], svc: 'deliver', pay: 'counter', em });
    const code = db.docs.get(`orders/${o.id}`).otp;
    check('code is 4 digits and stored on the order', /^[0-9]{4}$/.test(code), String(code));
    check('code is not on the public status doc', !JSON.stringify(dStatus(o.id)).includes('otp'));
    check('success screen shows the code', (await s.page.textContent('#modalCard .otp-box')).includes(code));
    const m1 = await until(() => has(em, /received/), 8000);
    check('"received" email contains the code', !!m1 && m1.text.includes(code) && m1.html.includes(code));
    await closeModal(s);
    await s.page.click('#ordersBtn');
    check('My orders shows the code', (await s.page.textContent('#ordersBody')).includes(code));
    await s.page.evaluate(() => document.querySelector('[data-track]').click());
    await s.page.waitForSelector('#trackView:not([hidden])');
    check('track view shows the code', (await s.page.textContent('#tvInfo')).includes(code));
    await s.page.click('#tvClose');
    await card(A, o.id).waitFor();
    check('admin card flags that a code exists', /Code/.test(await card(A, o.id).textContent()));
    await act(A, o.id, 'accepted');
    check('"confirmed" email contains the code', !!(await until(() => { const e = has(em, /confirmed|accepted/i); return e && e.text.includes(code); }, 8000)));
    await act(A, o.id, 'cooking'); await act(A, o.id, 'ready');
    check('ready to completed is blocked for delivery', (await card(A, o.id).locator('[data-act="completed"]').count()) === 0);
    await act(A, o.id, 'out');
    check('"on the way" email contains the code', !!(await until(() => { const e = has(em, /on the way/); return e && e.text.includes(code); }, 8000)));
    check('out card offers code entry and manual close', (await card(A, o.id).locator('[data-act="completed"]').count()) === 1 && (await card(A, o.id).locator('[data-act="manual"]').count()) === 1);
    const wrong = code === '0000' ? '1111' : '0000';
    await act(A, o.id, 'completed');
    await A.page.waitForSelector('#otpIn');
    await tryCode('12');
    check('short code is rejected', /4-digit/.test(await otpMsg()));
    await tryCode(wrong);
    check('wrong code refused with attempts left', /4 attempts left/.test(await otpMsg()), await otpMsg());
    check('order stays out for delivery after a wrong code', (await shopStatus(s, o.id)) === 'out' && dStatus(o.id).s === 'out');
    for (let i = 0; i < 4; i++) await tryCode(wrong);
    check('5 wrong codes lock the entry', (await A.page.locator('#otpIn').isDisabled()) && /Too many/.test(await otpMsg()), await otpMsg());
    check('still not delivered while locked', dStatus(o.id).s === 'out');
    await A.page.click('#manualOpen');
    await A.page.click('#manualBack');
    check('lock persists when reopening the code view', await A.page.locator('#otpIn').isDisabled());
    await A.page.click('#manualOpen');
    await A.page.click('#manualYes');
    check('manual close completes the order', !!(await until(async () => (await shopStatus(s, o.id)) === 'completed', 5000)) && dStatus(o.id).how === 'manual');
    check('card shows closed manually', !!(await until(async () => /Closed manually/.test(await card(A, o.id).textContent()), 4000)));
    check('delivered email sent', !!(await until(() => has(em, /delivered/), 8000)));
    check('customer no longer sees the code', !(await s.page.evaluate(() => JSON.stringify(window.__lh.orders)).then((j) => j.includes(`"otp":"${code}"`))));
    check('delivered email does not repeat the code', !(has(em, /delivered/).text || '').includes(code));
  });

  await scenario('delivery code: correct code closes the order', async () => {
    const em = 'otp2@example.com';
    const s = await newShop({ geo: geoAt(2) });
    const o = await place(s, { items: [5], svc: 'deliver', pay: 'counter', em });
    const code = db.docs.get(`orders/${o.id}`).otp;
    await closeModal(s);
    await card(A, o.id).waitFor();
    await toOut(o);
    const t = await act(A, o.id, 'completed');
    await A.page.waitForSelector('#otpIn');
    await tryCode(code);
    check('customer sees delivered', !!(await until(async () => (await shopStatus(s, o.id)) === 'completed', 5000)));
    check('closed by code, recorded as such', dStatus(o.id).how === 'otp');
    check('card shows code verified', !!(await until(async () => /Code verified/.test(await card(A, o.id).textContent()), 4000)));
    check('delivered email arrives', (await nextEmail(em, /delivered/, t)) > 0);
    const dm = has(em, /delivered/);
    check('delivered email carries a paid invoice with the address and delivery charge', invoiceIn(dm, 'INVOICE', 'PAID', 'Delivery charge', '12 Lake View Road', '9962419353'));
    await s.page.click('#ordersBtn');
    check('code hidden after delivery', !(await s.page.locator('#ordersBody .otp-box').count()));
  });

  await scenario('delivery code: order without a code (old rules) closes manually only', async () => {
    const em = 'otp3@example.com';
    db.noOtpRules = true;
    const s = await newShop({ geo: geoAt(2) });
    let o;
    try { o = await place(s, { items: [5], svc: 'deliver', pay: 'counter', em }); } finally { db.noOtpRules = false; }
    check('order is still placed when rules reject the code', !!o && !!db.docs.get(`orders/${o.id}`));
    check('order has no code', db.docs.get(`orders/${o.id}`).otp === undefined);
    check('customer sees no code', !(await s.page.locator('#modalCard .otp-box').count()));
    await closeModal(s);
    await card(A, o.id).waitFor();
    check('admin card says no code', /No code/.test(await card(A, o.id).textContent()));
    await toOut(o);
    await act(A, o.id, 'completed');
    await A.page.waitForSelector('#manualYes');
    check('only manual close is offered', (await A.page.locator('#otpIn').count()) === 0 && /no delivery code/i.test(await A.page.textContent('#modalCard')));
    await A.page.click('#manualYes');
    check('closed manually', !!(await until(async () => (await shopStatus(s, o.id)) === 'completed', 5000)) && dStatus(o.id).how === 'manual');
  });

  await scenario('delivery code: not used for dine-in or takeaway', async () => {
    check('dine-in order has no code', db.docs.get(`orders/${placed.dine}`).otp === undefined);
    check('takeaway order has no code', db.docs.get(`orders/${placed.upi}`).otp === undefined);
    const dineMails = world.emails.filter((x) => x.subject.includes(placed.dine) || x.subject.includes(placed.upi));
    check('no delivery code in dine-in or takeaway emails', dineMails.length > 0 && !dineMails.some((x) => /delivery code/i.test(`${x.text} ${x.html}`)));
  });

  /* ---------------- Invoice ---------------- */
  await scenario('invoice: printable from admin and storefront, emailed on completion', async () => {
    const em = 'inv@example.com';
    const stubPrint = (h) => h.page.evaluate(() => { window.__inv = ''; window.print = () => { window.__inv = document.querySelector('#printArea').innerHTML; }; });
    const invHas = (html, ...parts) => parts.every((p) => html.includes(p));
    const s = await newShop();
    const o = await place(s, { items: [0, 1], svc: 'take', pay: 'counter', em, name: 'Meera' });
    await closeModal(s);
    await card(A, o.id).waitFor();
    await stubPrint(A);
    await card(A, o.id).locator('[data-act="invoice"]').click();
    let html = await A.page.evaluate(() => window.__inv);
    check('admin invoice shows cafe name, phone and map link', invHas(html, "Laural's Haven Cafe", '9962419353', 'https://maps.app.goo.gl/XeqJJUZKzVbcAqjM8'));
    check('invoice shows number, customer and total', invHas(html, 'INVOICE', o.id, 'Meera', LH.fmt(db.docs.get(`orders/${o.id}`).total)));
    check('invoice states there is no GST', invHas(html, 'GST', 'Not applicable'));
    check('open order invoice is marked due', html.includes('PAYMENT DUE'));
    check('print area switches to the invoice layout', (await A.page.evaluate(() => document.querySelector('#printArea').className)) === 'inv');
    await card(A, o.id).locator('[data-act="print"]').click();
    check('kitchen ticket still prints in ticket layout', (await A.page.evaluate(() => document.querySelector('#printArea').className)) === '');
    for (const to of ['accepted', 'cooking']) await act(A, o.id, to);
    const t = await act(A, o.id, 'ready');
    const mail = await until(() => world.emails.find((x) => x.to === em && x.t >= t && /ready/.test(x.subject)), 8000);
    check('ready email carries the invoice, payment due at the counter', !!mail && invHas(mail.html, 'INVOICE', 'PAYMENT DUE', '9962419353', 'maps.app.goo.gl') && mail.text.includes(`Invoice no: ${o.id}`));
    await act(A, o.id, 'completed');
    await A.page.click('#nav [data-tab="history"]');
    await A.page.fill('#histSearch', o.id);
    await A.page.locator(`[data-inv="${o.id}"]`).click();
    html = await A.page.evaluate(() => window.__inv);
    check('history invoice for a finished order is marked paid', invHas(html, 'PAID', o.id));
    await A.page.fill('#histSearch', '');
    await A.page.click('#nav [data-tab="orders"]');
    await stubPrint(s);
    await s.page.click('#ordersBtn');
    await s.page.locator(`[data-invoice="${o.id}"]`).click();
    html = await s.page.evaluate(() => window.__inv);
    check('customer can print the invoice from My orders', invHas(html, 'INVOICE', "Laural's Haven Cafe", '9962419353', 'PAID'));
    check('invoice never includes a delivery code', !/delivery code/i.test(html));
  });

  /* ---------------- Feedback ---------------- */
  await scenario('feedback: star ratings from the storefront, captured in the admin console', async () => {
    const finish = async (id) => { for (const to of ['accepted', 'cooking', 'ready', 'completed']) await act(A, id, to); };
    const rateTry = (s, id) => s.page.evaluate((x) => { const ord = window.__lh.orders.find((y) => y.id === x); return window.LH.publishFeedback(ord, { sr: 5, ir: [] }).then(() => 'sent', (e) => e.code || e.message); }, id);
    const fillRate = async (s, { sr, items = {}, text = '' }) => {
      if (sr) await s.page.click(`#modalCard .stars[data-key="sr"] [data-n="${sr}"]`);
      for (const [item, n] of Object.entries(items)) await s.page.click(`#modalCard .stars[data-key="it:${item}"] [data-n="${n}"]`);
      if (text) await s.page.fill('#fbText', text);
    };
    const openRate = async (s, id) => { await s.page.locator(`[data-rate="${id}"]`).click(); await s.page.waitForSelector('#modal:not([hidden]) #fbSend'); };

    const s = await newShop();
    const o = await place(s, { items: [0, 1], svc: 'take', name: 'Ravi' });
    await closeModal(s);
    await s.page.click('#ordersBtn');
    check('no rating button before the order is completed', (await s.page.locator('[data-rate]').count()) === 0);
    const early = await rateTry(s, o.id);
    check('rules refuse feedback before completion', early === 'permission-denied' && !db.docs.has(`feedback/${o.id}`), String(early));
    await card(A, o.id).waitFor();
    await finish(o.id);
    await s.page.waitForSelector(`[data-rate="${o.id}"]`);
    await openRate(s, o.id);
    check('rating form has stars for the service and each product', (await s.page.locator('#modalCard .stars').count()) === 3);
    await s.page.click('#fbSend');
    check('service rating is required', (await s.page.textContent('#fbMsg')).includes('rate our service') && !db.docs.has(`feedback/${o.id}`));
    await fillRate(s, { sr: 4, items: { [I(0)]: 5, [I(1)]: 2 }, text: 'Tasty, but slow <b>service</b>' });
    check('chosen stars are marked', (await s.page.locator('#modalCard .stars[data-key="sr"] button.on').count()) === 4 && (await s.page.getAttribute(`#modalCard .stars[data-key="it:${I(0)}"] [data-n="5"]`, 'aria-checked')) === 'true');
    await s.page.click('#fbSend');
    const doc = await until(() => db.docs.get(`feedback/${o.id}`));
    check('feedback is stored with service and product ratings', !!doc && doc.sr === 4 && doc.ir.includes(`${I(0)}:5`) && doc.ir.includes(`${I(1)}:2`) && doc.n === 'Ravi' && doc.svc === 'take');
    check('comment is stored without markup', !!doc && doc.c.startsWith('Tasty, but slow') && !/[<>]/.test(doc.c));
    check('customer sees thanks and no rating button', !!(await until(() => s.page.locator(`.order-card[data-id="${o.id}"] .fb-done`).count())) && (await s.page.locator(`[data-rate="${o.id}"]`).count()) === 0 && (await s.page.isHidden('#modal')));
    check('feedback cannot be sent twice for an order', (await rateTry(s, o.id)) === 'permission-denied');

    await A.page.waitForSelector('#navFb:not([hidden])');
    check('admin nav shows one new feedback', (await A.page.textContent('#navFb')).trim() === '1');
    await A.page.click('#nav [data-tab="feedback"]');
    const kp = await A.page.textContent('#fbKpis');
    check('admin summary shows service and product averages', kp.includes('4.0 \u2605') && kp.includes('3.5 \u2605'), kp.replace(/\s+/g, ' ').slice(0, 120));
    const list = await A.page.textContent('#fbList');
    check('admin sees the order, customer, comment and product ratings', list.includes(o.id) && list.includes('Ravi') && list.includes('Tasty, but slow') && list.includes(`${LH.ITEMS.get(I(0)).name}`) && list.includes('5\u2605') && list.includes('2\u2605'));
    check('product ranking lists both products', (await A.page.locator('#fbItems .rank-row').count()) === 2);
    check('opening the tab clears the new badge', await A.page.isHidden('#navFb'));
    await A.page.selectOption('#fbRating', '5');
    check('rating filter hides other ratings', (await A.page.locator('#fbList .fbcard').count()) === 0);
    await A.page.selectOption('#fbRating', '4');
    check('rating filter shows matching feedback', (await A.page.locator('#fbList .fbcard').count()) === 1);
    await A.page.selectOption('#fbRating', '');

    const s2 = await newShop();
    const o2 = await place(s2, { items: [2], svc: 'dine', name: 'Divya' });
    await closeModal(s2);
    await s2.page.click('#ordersBtn');
    await A.page.click('#nav [data-tab="orders"]');
    await card(A, o2.id).waitFor();
    await finish(o2.id);
    await A.page.click('#nav [data-tab="feedback"]');
    await s2.page.waitForSelector(`[data-rate="${o2.id}"]`);
    await openRate(s2, o2.id);
    db.noFeedbackRules = true;
    await fillRate(s2, { sr: 2, text: 'Cold and late' });
    await s2.page.click('#fbSend');
    check('unpublished rules show a clear message and keep the form', !!(await until(async () => /could not save/i.test(await s2.page.textContent('#fbMsg')), 5000)) && !db.docs.has(`feedback/${o2.id}`));
    db.noFeedbackRules = false;
    await s2.page.click('#fbSend');
    check('feedback can be resent once the rules allow it', !!(await until(() => db.docs.get(`feedback/${o2.id}`))));
    check('low rating is flagged for attention in admin', !!(await until(() => A.page.locator('#fbList .fbcard.low').count())));
    const kp2 = (await A.page.textContent('#fbKpis')).replace(/\s+/g, '');
    check('admin summary updates live', kp2.includes('Servicerating3.0\u2605') && kp2.includes('Needsattention1'), kp2.slice(0, 140));
    await A.page.selectOption('#fbRating', 'low');
    check('needs-attention filter shows only the low rating', (await A.page.locator('#fbList .fbcard').count()) === 1 && (await A.page.textContent('#fbList')).includes('Divya'));
    await A.page.selectOption('#fbRating', '');
    await A.page.selectOption('#fbSvc', 'take');
    check('service filter works', (await A.page.locator('#fbList .fbcard').count()) === 1 && (await A.page.textContent('#fbList')).includes('Ravi'));
    await A.page.selectOption('#fbSvc', '');
    await A.page.fill('#fbSearch', 'cold and');
    check('search finds a comment', (await A.page.locator('#fbList .fbcard').count()) === 1);
    await A.page.fill('#fbSearch', '');
    await A.page.reload();
    await A.page.waitForSelector('#app:not([hidden])');
    await A.page.click('#nav [data-tab="feedback"]');
    check('feedback survives an admin reload', !!(await until(async () => (await A.page.locator('#fbList .fbcard').count()) === 2, 5000)));
    await A.page.click('#nav [data-tab="orders"]');
  });

  /* ---------------- Event bookings ---------------- */
  await scenario('events: booking, confirmation, clash protection and live availability', async () => {
    const dayKey = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return LH.dateKey(d); };
    const D1 = dayKey(5); const D2 = dayKey(6);
    const evCount = () => [...db.docs.keys()].filter((k) => k.startsWith('events/')).length;
    const evStatus = (id) => (db.docs.get(`evstatus/${id}`) || {}).s;
    const busyOf = (d) => ((db.docs.get('config/events') || {}).busy || {})[d];
    const bookTry = (h, ev) => h.page.evaluate((x) => window.LH.publishEvent(x).then(() => 'sent', (e) => e.code || e.message), ev);
    const localStatus = (h, id) => h.page.evaluate((x) => { const e = window.__lh.events.find((y) => y.id === x); return e && e.status; }, id);
    const openBook = async (h) => { await h.page.click('#eventsBtn'); await h.page.click('#eventsBody [data-evv="book"]'); await h.page.waitForSelector('#evForm'); };
    const fillEv = async (h, o) => {
      const p = h.page;
      await p.selectOption('#evType', o.ty || 'bday');
      await p.fill('#evDate', o.d);
      await p.selectOption('#evStart', String(o.st));
      await p.selectOption('#evHours', String(o.h));
      await p.fill('#evGuests', String(o.g || 10));
      await p.fill('#evName', o.n ?? 'Meera');
      await p.fill('#evPhone', o.p ?? '9876501234');
      await p.fill('#evNote', o.nt || '');
      await p.setChecked('#evDecor', !!o.dec);
    };
    const send = async (h) => { await h.page.click('#evSend'); await h.page.waitForSelector('#modal:not([hidden]) #modalCard .oid', { timeout: 8000 }); return (await h.page.textContent('#modalCard .oid')).trim(); };
    const evCard = (id) => A.page.locator(`.evcard[data-ev="${id}"]`);

    const s = await newShop();
    check('event buttons are hidden while bookings are off', (await s.page.isHidden('#eventsBtn')) && (await s.page.isHidden('#heroEvents')));
    const early = await bookTry(s, { ty: 'bday', d: D1, st: 1080, h: 3, g: 20, dec: true, n: 'Meera', p: '9876501234' });
    check('rules refuse bookings while Events are off', early === 'permission-denied' && evCount() === 0, String(early));

    await A.page.click('#nav [data-tab="events"]');
    check('admin Events tab starts with bookings off', (await A.page.textContent('#evLbl')).trim() === 'Off');
    await setSwitch(A, '#evToggle', true);
    check('turning bookings on is published', !!(await until(() => (db.docs.get('config/events') || {}).on === true)));
    check('storefront shows the event buttons live', !!(await until(async () => (await s.page.isVisible('#eventsBtn')) && (await s.page.isVisible('#heroEvents')))));

    await openBook(s);
    check('booking form lists the event types', (await s.page.locator('#evType option').count()) === LH.EVENT_TYPES.length);
    check('default price is hours plus cleaning', (await s.page.textContent('#evTotal')).trim() === fmt(3500), await s.page.textContent('#evTotal'));
    await s.page.setChecked('#evDecor', true);
    check('basic decoration adds Rs 500', (await s.page.textContent('#evTotal')).trim() === fmt(4000) && /cleaning/i.test(await s.page.textContent('#evQuote')) && /decoration/i.test(await s.page.textContent('#evQuote')));
    await s.page.selectOption('#evStart', '1380');
    check('duration is limited so the event ends by midnight', (await s.page.locator('#evHours option').count()) === 1);
    await s.page.selectOption('#evStart', '1080');
    await s.page.selectOption('#evHours', '5');
    check('price follows the duration', (await s.page.textContent('#evTotal')).trim() === fmt(6000));

    await fillEv(s, { d: D1, st: 1080, h: 3, g: 20, dec: true, n: '', p: '12', nt: 'Cake at 7 <b>pm</b>' });
    await s.page.click('#evSend');
    check('name and phone are validated', (await s.page.locator('#fEvName.err').count()) === 1 && (await s.page.locator('#fEvPhone.err').count()) === 1 && evCount() === 0);
    await s.page.fill('#evName', 'Meera'); await s.page.fill('#evPhone', '9876501234');
    await s.page.fill('#evDate', dayKey(400));
    await s.page.click('#evSend');
    check('a date too far ahead is refused', (await s.page.locator('#fEvDate.err').count()) === 1 && evCount() === 0);
    await s.page.fill('#evGuests', '500'); await s.page.fill('#evDate', D1);
    await s.page.click('#evSend');
    check('guest count is limited', (await s.page.locator('#fEvGuests.err').count()) === 1 && evCount() === 0);
    await s.page.fill('#evGuests', '20');
    const id1 = await send(s);
    const d1 = db.docs.get(`events/${id1}`);
    check('booking is stored with the right price and slot', !!d1 && d1.total === 4000 && d1.h === 3 && d1.st === 1080 && d1.d === D1 && d1.dec === true && d1.ty === 'bday' && d1.g === 20 && d1.n === 'Meera', JSON.stringify(d1));
    check('note is stored without markup', !!d1 && !/[<>]/.test(d1.nt || '') && /Cake at 7/.test(d1.nt || ''));
    check('new booking starts as pending', evStatus(id1) === undefined && (await localStatus(s, id1)) === 'pending');
    await closeModal(s);
    await s.page.click('#eventsBtn');
    check('My bookings lists the request', /Awaiting confirmation/.test(await s.page.textContent(`.ev-card[data-ev="${id1}"]`)));
    await s.page.click('#eventsDrawer [data-close]');

    await A.page.waitForSelector('#navEv:not([hidden])');
    check('admin nav shows one booking to handle', (await A.page.textContent('#navEv')).trim() === '1');
    await evCard(id1).waitFor();
    const ct = await evCard(id1).textContent();
    check('admin sees customer, slot, extras and total', ct.includes('Meera') && ct.includes('9876501234') && ct.includes('Birthday Party') && ct.includes('6:00 PM - 9:00 PM') && ct.includes('20 guests') && ct.includes(fmt(4000)));
    await evCard(id1).locator('[data-evact="confirmed"]').click();
    check('confirming is published', !!(await until(() => evStatus(id1) === 'confirmed')));
    check('confirmed slot is published for other customers', !!(await until(() => (busyOf(D1) || []).includes('1080-1260'))), JSON.stringify(busyOf(D1)));
    check('customer sees the booking confirmed live', !!(await until(async () => (await localStatus(s, id1)) === 'confirmed')));
    check('admin badge clears after confirming', await A.page.isHidden('#navEv'));

    const s2 = await newShop();
    await openBook(s2);
    await fillEv(s2, { d: D1, st: 1140, h: 2 });
    check('overlapping time is flagged and cannot be sent', !!(await until(() => s2.page.locator('#evAvail .ev-bad').count())) && (await s2.page.isDisabled('#evSend')));
    await s2.page.selectOption('#evStart', '1260');
    check('a free time after the booking is accepted', !!(await until(() => s2.page.locator('#evAvail .ev-ok').count())) && !(await s2.page.isDisabled('#evSend')) && /6:00 PM - 9:00 PM/.test(await s2.page.textContent('#evAvail')));
    await s2.page.selectOption('#evStart', '1140');

    const clashId = LH.newEventId();
    const clashRes = await bookTry(s, { id: clashId, ty: 'anniv', d: D1, st: 1140, h: 2, g: 8, dec: false, n: 'Karan', p: '9123456780' });
    check('an overlapping request can still be sent', clashRes === 'sent' && db.docs.has(`events/${clashId}`));
    await evCard(clashId).waitFor();
    check('admin sees which booking it overlaps', (await evCard(clashId).textContent()).includes(`Overlaps ${id1}`));
    await evCard(clashId).locator('[data-evact="confirmed"]').click();
    check('confirming an overlapping booking is blocked', !!(await until(async () => /Overlaps confirmed booking/.test(await A.page.textContent('#toasts')))) && evStatus(clashId) === undefined);
    await evCard(clashId).locator('[data-evact="declined"]').click();
    await A.page.click('#modalCard [data-evreason]');
    check('declining records the reason', !!(await until(() => evStatus(clashId) === 'declined' && (db.docs.get(`evstatus/${clashId}`).r || '').length > 0)));

    await fillEv(s2, { d: D2, st: 600, h: 2, g: 6, ty: 'success', n: 'Divya', p: '9000011111' });
    const id2 = await send(s2);
    check('a second customer books another day', db.docs.get(`events/${id2}`).total === 2500 && db.docs.get(`events/${id2}`).ty === 'success');
    await closeModal(s2);
    await evCard(id2).waitFor();
    await evCard(id2).locator('[data-evact="confirmed"]').click();
    await until(() => evStatus(id2) === 'confirmed');
    await evCard(id2).locator('[data-evact="completed"]').click();
    check('marking completed is published', !!(await until(() => evStatus(id2) === 'completed')));
    check('a completed event frees the shared slot', !!(await until(() => !busyOf(D2))));
    check('customer sees Completed live', !!(await until(async () => (await localStatus(s2, id2)) === 'completed')));

    await evCard(id1).locator('[data-evact="cancelled"]').click();
    await A.page.click('#modalCard [data-evreason]');
    check('cancelling a confirmed booking is published', !!(await until(() => evStatus(id1) === 'cancelled')));
    check('cancelled slot is released for everyone', !!(await until(() => !busyOf(D1))));
    check('customer sees Cancelled with the reason', !!(await until(async () => (await localStatus(s, id1)) === 'cancelled')) && !!(await until(async () => { await s.page.click('#eventsBtn'); const t = await s.page.textContent(`.ev-card[data-ev="${id1}"]`); await s.page.click('#eventsDrawer [data-close]'); return /cancelled/i.test(t) && /at the customer/.test(t); })));
    await openBook(s2);
    await fillEv(s2, { d: D1, st: 1140, h: 2 });
    check('availability updates live for a customer already on the form', !!(await until(async () => (await s2.page.locator('#evAvail .ev-bad').count()) === 0 && !(await s2.page.isDisabled('#evSend')))));
    await s2.page.click('#eventsDrawer [data-close]');

    const s3 = await newShop();
    await openBook(s3);
    await fillEv(s3, { d: D2, st: 990, h: 2 });
    db.noEventRules = true;
    await s3.page.click('#evSend');
    check('unpublished rules show a clear message and nothing is stored', !!(await until(async () => /not available/i.test(await s3.page.textContent('#toasts')), 5000)) && evCount() === 3);
    db.noEventRules = false;

    await A.page.selectOption('#evFilter', 'closed');
    check('admin Closed filter lists finished bookings', (await A.page.locator('#evList .evcard').count()) === 3);
    await A.page.selectOption('#evFilter', 'active');
    check('admin active filter is empty now', (await A.page.locator('#evList .evcard').count()) === 0);
    await A.page.selectOption('#evFilter', 'all');
    await A.page.fill('#evSearch', 'Divya');
    check('admin search finds a customer', (await A.page.locator('#evList .evcard').count()) === 1);
    await A.page.fill('#evSearch', '');
    const kp = (await A.page.textContent('#evKpis')).replace(/\s+/g, '');
    check('admin summary counts the bookings', kp.includes('Allbookings3'), kp.slice(0, 120));

    await A.page.reload();
    await A.page.waitForSelector('#app:not([hidden])');
    await A.page.waitForSelector('#livePill.up');
    await A.page.click('#nav [data-tab="events"]');
    await A.page.selectOption('#evFilter', 'all');
    check('bookings survive an admin reload', !!(await until(async () => (await A.page.locator('#evList .evcard').count()) === 3, 5000)));
    await s.page.reload();
    await s.page.waitForSelector('#menuRoot .card');
    check('customer bookings survive a reload', (await s.page.evaluate(() => window.__lh.events.length)) === 1 && !!(await until(() => s.page.isVisible('#eventsBtn'))));

    const sn = await newShop({ viewport: { width: 360, height: 740 } });
    check('event buttons fit a 360px phone without overflow', !!(await until(() => sn.page.isVisible('#eventsBtn'))) && (await overflow(sn)) <= 1, String(await overflow(sn)));
    await sn.page.click('#eventsBtn');
    await sn.page.click('#eventsBody [data-evv="book"]');
    check('booking form fits a 360px phone without overflow', (await sn.page.evaluate(() => { const d = document.querySelector('#eventsDrawer'); return d.scrollWidth - d.clientWidth; })) <= 1);
    await setSwitch(A, '#evToggle', false);
    check('turning bookings off is published', !!(await until(() => (db.docs.get('config/events') || {}).on === false)));
    const s4 = await newShop();
    check('event buttons disappear when bookings are off', !!(await until(async () => (await s4.page.isHidden('#eventsBtn')) && (await s4.page.isHidden('#heroEvents')))));
    check('customers who booked can still see their bookings', !!(await until(() => s.page.isVisible('#eventsBtn'))) && (await s.page.isHidden('#heroEvents')));
    await A.page.click('#nav [data-tab="orders"]');
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
      for (const tab of ['orders', 'deliveries', 'events', 'analytics', 'menu', 'history', 'feedback', 'settings']) {
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
    check('clear board asks for the owner password', await A.page.isVisible('#ownerPw'));
    await A.page.fill('#ownerPw', 'wrong-password');
    await A.page.click('#confirmClear');
    await A.page.waitForSelector('#clearMsg:not(:empty)');
    check('wrong owner password is refused', /not the owner/.test(await A.page.textContent('#clearMsg')));
    check('board is untouched after a wrong password', (await A.page.locator('.ocard').count()) >= 1);
    await A.page.fill('#ownerPw', world.OWNER_PASSWORD);
    await A.page.click('#confirmClear');
    check('owner account was the one checked', world.ownerChecks.length === 2 && world.ownerChecks.every((e) => e === 'andrewvijaykumar123@gmail.com'));
    await A.page.click('#nav [data-tab="orders"]');
    check('clear board empties every card', !!(await until(async () => (await A.page.locator('.ocard').count()) === 0, 5000)));
    await A.page.click('#lockBtn2');
    await A.page.waitForSelector('#lock:not([hidden])');
    check('lock returns to the sign-in form', await A.page.isVisible('#lock'));
  });

  /* ---------------- Clear all storefront data ---------------- */
  await scenario('clear all storefront data needs the owner password and empties every device', async () => {
    const WIPED = ['orders/', 'feedback/', 'events/', 'evstatus/', 'status/', 'mail/', 'mailq/'];
    const left = () => [...db.docs.keys()].filter((k) => WIPED.some((p) => k.startsWith(p))).length;
    const ad = await newAdmin();
    const s = await newShop();
    const o = await place(s, { items: [0], svc: 'take', name: 'Meena', em: 'meena@example.com' });
    await closeModal(s);
    await card(ad, o.id).waitFor();
    await s.page.click('#ordersBtn');
    check('customer has a saved order before the wipe', (await s.page.locator('.order-card').count()) === 1);
    check('storefront data exists before the wipe', left() >= 1);
    await ad.page.click('#nav [data-tab="settings"]');
    await ad.page.click('#wipeStore');
    check('clearing storefront data asks for the owner password', await ad.page.isVisible('#ownerPw'));
    await ad.page.fill('#ownerPw', 'wrong-password');
    await ad.page.click('#confirmClear');
    await ad.page.waitForSelector('#clearMsg:not(:empty)');
    check('wrong owner password is refused for the wipe', /not the owner/.test(await ad.page.textContent('#clearMsg')));
    const before = left();
    await sleep(300);
    check('nothing is deleted after a wrong password', left() >= before && before >= 1 && db.docs.has(`orders/${o.id}`));
    await ad.page.fill('#ownerPw', world.OWNER_PASSWORD);
    await ad.page.click('#confirmClear');
    check('every storefront collection is emptied', !!(await until(() => left() === 0, 8000)), String(left()));
    check('customer device forgets its saved orders', !!(await until(() => s.page.evaluate(() => window.__lh.orders.length === 0), 8000)));
    check('customer order list shows nothing', !!(await until(async () => (await s.page.locator('.order-card').count()) === 0, 5000)));
    await ad.page.click('#nav [data-tab="feedback"]');
    check('admin feedback list is empty', (await ad.page.locator('#fbList .fbcard').count()) === 0);
    await ad.page.click('#nav [data-tab="orders"]');
    check('admin board is empty', (await ad.page.locator('.ocard').count()) === 0);
    const s2 = await newShop();
    const o2 = await place(s2, { items: [1], svc: 'take', name: 'Meena' });
    await closeModal(s2);
    check('new orders still work after the wipe', !!(await until(() => db.docs.get(`orders/${o2.id}`))) && !!(await until(() => card(ad, o2.id).count(), 5000)));
    await ad.ctx.close().catch(() => {}); world.pages.splice(world.pages.indexOf(ad), 1);
    for (const h of [s, s2]) { await h.ctx.close().catch(() => {}); world.pages.splice(world.pages.indexOf(h), 1); }
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

  /* ---------------- Reschedule an event booking ---------------- */
  await scenario('events: the owner reschedules a booking', async () => {
    const dayKey = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return LH.dateKey(d); };
    const D1 = dayKey(9); const D2 = dayKey(10); const D3 = dayKey(11);
    const evStatusDoc = (id) => db.docs.get(`evstatus/${id}`) || {};
    const busyOf = (d) => ((db.docs.get('config/events') || {}).busy || {})[d];
    const book = (h, ev) => h.page.evaluate((x) => window.LH.publishEvent(x).then(() => 'sent', (e) => e.code || e.message), ev);
    const evCard = (a, id) => a.page.locator(`.evcard[data-ev="${id}"]`);
    const localEv = (h, id) => h.page.evaluate((x) => { const e = window.__lh.events.find((y) => y.id === x); return e && { d: e.d, st: e.st, h: e.h, total: e.total, status: e.status }; }, id);

    for (const h of world.pages.filter((x) => x.kind === 'admin')) { await h.ctx.close().catch(() => {}); world.pages.splice(world.pages.indexOf(h), 1); }
    const a = await newAdmin();
    await a.page.click('#nav [data-tab="events"]');
    await setSwitch(a, '#evToggle', true);
    await until(() => (db.docs.get('config/events') || {}).on === true);
    const s = await newShop();
    const s2 = await newShop();
    const idB = LH.newEventId();
    await s.page.click('#eventsBtn'); await s.page.click('#eventsBody [data-evv="book"]'); await s.page.waitForSelector('#evForm');
    await s.page.selectOption('#evType', 'bday'); await s.page.fill('#evDate', D1); await s.page.selectOption('#evStart', '1080'); await s.page.selectOption('#evHours', '3'); await s.page.fill('#evGuests', '20'); await s.page.fill('#evName', 'Meera'); await s.page.fill('#evPhone', '9876501234');
    await s.page.click('#evSend'); await s.page.waitForSelector('#modal:not([hidden]) #modalCard .oid', { timeout: 8000 });
    const idA = (await s.page.textContent('#modalCard .oid')).trim();
    await s.page.keyboard.press('Escape'); await s.page.click('#eventsDrawer [data-close]', { timeout: 1500 }).catch(() => {});
    check('customer sends a booking', !!db.docs.get(`events/${idA}`));
    check('another customer books the next day', (await book(s2, { id: idB, ty: 'anniv', d: D2, st: 1080, h: 2, g: 8, dec: false, n: 'Karan', p: '9123456780' })) === 'sent');
    await evCard(a, idA).waitFor();
    await evCard(a, idB).waitFor();
    check('pending and confirmed bookings offer Reschedule', (await evCard(a, idA).locator('[data-evact="move"]').count()) === 1);
    await evCard(a, idA).locator('[data-evact="confirmed"]').click();
    await until(() => evStatusDoc(idA).s === 'confirmed');
    await evCard(a, idB).locator('[data-evact="confirmed"]').click();
    await until(() => evStatusDoc(idB).s === 'confirmed');
    check('both slots are published as busy', !!(await until(() => busyOf(D1) && busyOf(D2))));

    await evCard(a, idA).locator('[data-evact="move"]').click();
    await a.page.waitForSelector('#mvDate');
    check('modal starts on the current time and refuses a no-op', (await a.page.inputValue('#mvDate')) === D1 && (await a.page.isDisabled('#mvSave')) && /different/i.test(await a.page.textContent('#mvNote')));
    await a.page.fill('#mvDate', D2);
    check('moving onto another confirmed booking is flagged', !!(await until(async () => /Overlaps confirmed booking/.test(await a.page.textContent('#mvNote')))) && (await a.page.isDisabled('#mvSave')));
    await a.page.fill('#mvDate', dayKey(400));
    check('a date too far ahead is refused', !!(await until(async () => /within the next/.test(await a.page.textContent('#mvNote')))) && (await a.page.isDisabled('#mvSave')));
    await a.page.fill('#mvDate', D3);
    await a.page.selectOption('#mvHours', '4');
    check('the new total is shown', !!(await until(async () => (await a.page.textContent('#mvNote')).includes(fmt(4500)))) && !(await a.page.isDisabled('#mvSave')), await a.page.textContent('#mvNote'));
    await a.page.click('#mvSave');
    check('reschedule is published on the booking status', !!(await until(() => { const m = evStatusDoc(idA).mv; return m && m.d === D3 && m.st === 1080 && m.h === 4 && m.od === D1 && m.oh === 3; })), JSON.stringify(evStatusDoc(idA)));
    check('status stays confirmed', evStatusDoc(idA).s === 'confirmed');
    check('old slot is released and the new one published', !!(await until(() => !busyOf(D1) && (busyOf(D3) || []).includes('1080-1320'))), JSON.stringify((db.docs.get('config/events') || {}).busy));
    const ct = await evCard(a, idA).textContent();
    check('admin card shows the new time and where it was', ct.includes('6:00 PM - 10:00 PM') && /Rescheduled/.test(ct) && ct.includes(fmt(4500)));
    check('customer sees the new time and price live', !!(await until(async () => { const e = await localEv(s, idA); return e && e.d === D3 && e.h === 4 && e.total === 4500 && e.status === 'confirmed'; })));
    await s.page.click('#eventsBtn');
    const mine = await s.page.textContent(`.ev-card[data-ev="${idA}"]`);
    check('customer booking list says it was rescheduled', /Rescheduled from/.test(mine) && mine.includes('6:00 PM - 10:00 PM'), mine.slice(0, 160));
    await s.page.click('#eventsDrawer [data-close]');
    const s3 = await newShop();
    await s3.page.click('#eventsBtn'); await s3.page.click('#eventsBody [data-evv="book"]'); await s3.page.waitForSelector('#evForm');
    await s3.page.fill('#evDate', D1); await s3.page.selectOption('#evStart', '1080');
    check('the old date is open for other customers again', !!(await until(async () => (await s3.page.locator('#evAvail .ev-bad').count()) === 0)));
    await s3.page.fill('#evDate', D3);
    check('the new date is shown as taken', !!(await until(async () => (await s3.page.locator('#evAvail .ev-bad').count()) === 1)));

    await evCard(a, idB).locator('[data-evact="move"]').click();
    await a.page.fill('#mvDate', D3);
    check('moving onto the rescheduled booking is flagged too', !!(await until(async () => /Overlaps confirmed booking/.test(await a.page.textContent('#mvNote')))));
    await a.page.keyboard.press('Escape');

    const a2 = await newAdmin();
    await a2.page.click('#nav [data-tab="events"]');
    await a2.page.selectOption('#evFilter', 'all');
    await evCard(a2, idA).waitFor();
    const c2 = await evCard(a2, idA).textContent();
    check('a second admin device shows the rescheduled time', !!(await until(async () => { const t = await evCard(a2, idA).textContent(); return t.includes('6:00 PM - 10:00 PM') && /Rescheduled/.test(t); })), c2.slice(0, 200));

    await evCard(a, idA).locator('[data-evact="cancelled"]').click();
    await a.page.click('#modalCard [data-evreason]');
    await until(() => evStatusDoc(idA).s === 'cancelled');
    check('a cancelled booking keeps its history but cannot be moved', !!evStatusDoc(idA).mv && (await evCard(a, idA).locator('[data-evact="move"]').count()) === 0);
    await setSwitch(a, '#evToggle', false);
  });

  /* ---------------- Owner edits the menu ---------------- */
  await scenario('menu: the owner changes prices and adds products and categories', async () => {
    for (const h of world.pages.filter((x) => x.kind === 'admin')) { await h.ctx.close().catch(() => {}); world.pages.splice(world.pages.indexOf(h), 1); }
    const a = await newAdmin();
    const s1 = await newShop();
    const base = items[0].price;
    const o1 = await place(s1, { items: [0], svc: 'take' });
    await closeModal(s1);
    check('order placed at the original price', db.docs.get(`orders/${o1.id}`).total === base);
    await card(a, o1.id).waitFor();

    await a.page.click('#nav [data-tab="menu"]');
    await a.page.click(`[data-edit-item="${I(0)}"]`);
    await a.page.fill('#miPrice', '0');
    await a.page.click('#miSave');
    check('a zero price is refused', !!(await until(async () => /between 1 and 9999/.test(await a.page.textContent('#toasts'))) ) && !db.docs.has('config/menu'));
    await a.page.fill('#miPrice', '77');
    await a.page.click('#miSave');
    const menuDoc = () => db.docs.get('config/menu') || {};
    check('new price is saved with the old one kept in the history', !!(await until(() => (menuDoc().px || {})[I(0)])) && menuDoc().px[I(0)][0] === `0:${base}` && /:77$/.test(menuDoc().px[I(0)].slice(-1)[0]), JSON.stringify(menuDoc().px));
    check('storefront shows the new price live', !!(await until(async () => (await s1.page.textContent(`.card[data-id="${I(0)}"] .price`)).includes('77'))));
    check('admin menu shows the new price', (await a.page.textContent(`.mitem[data-id="${I(0)}"] small`)).includes('77'));
    const s2 = await newShop();
    const o2 = await place(s2, { items: [0], svc: 'take' });
    await closeModal(s2);
    check('a new order is priced at the new rate', db.docs.get(`orders/${o2.id}`).total === 77);
    await a.page.click('#nav [data-tab="orders"]');
    await card(a, o2.id).waitFor();
    check('the older order keeps its original total on the board', (await card(a, o1.id).textContent()).includes(fmt(base)) && (await card(a, o2.id).textContent()).includes(fmt(77)));

    await a.page.click('#nav [data-tab="menu"]');
    await a.page.click('#addCategory');
    await a.page.fill('#acName', 'Desserts');
    await a.page.fill('#acIcon', '🍰');
    await a.page.click('#acSave');
    check('a new category is saved', !!(await until(() => (menuDoc().cats || []).some((c) => c.id === 'desserts' && c.name === 'Desserts'))));
    await a.page.waitForSelector('#apName');
    await a.page.fill('#apName', 'Rasmalai Cup');
    await a.page.fill('#apPrice', '120');
    check('the category is preselected for the new product', (await a.page.inputValue('#apCat')) === 'desserts');
    await a.page.click('#apSave');
    check('a new product is saved with its price', !!(await until(() => (menuDoc().items || []).some((i) => i.id === 'rasmalai-cup' && i.cat === 'desserts'))) && /:120$/.test(((menuDoc().px || {})['rasmalai-cup'] || [''])[0]), JSON.stringify(menuDoc().items));
    check('admin lists the new product in its category', !!(await until(() => a.page.locator('.mcat[data-cat="desserts"] .mitem[data-id="rasmalai-cup"]').count())));
    check('storefront shows the new category and product live', !!(await until(async () => (await s1.page.locator('#cat-desserts .card[data-id="rasmalai-cup"]').count()) === 1 && (await s1.page.locator('.chip[data-cat="desserts"]').count()) === 1)));
    check('storefront counts follow the menu', (await s1.page.textContent('#menuCount')).trim() === String(items.length + 1), await s1.page.textContent('#menuCount'));

    const s3 = await newShop();
    check('a brand-new visitor gets the owner menu', !!(await until(async () => (await s3.page.locator('#cat-desserts .card[data-id="rasmalai-cup"]').count()) === 1)));
    items.push({ id: 'rasmalai-cup', name: 'Rasmalai Cup', price: 120 });
    const o3 = await place(s3, { items: [items.length - 1, 0], svc: 'take' });
    await closeModal(s3);
    check('an order with the new product is priced correctly', db.docs.get(`orders/${o3.id}`).total === 120 + 77 && db.docs.get(`orders/${o3.id}`).it.includes('rasmalai-cup:1'), JSON.stringify(db.docs.get(`orders/${o3.id}`)));
    await a.page.click('#nav [data-tab="orders"]');
    await card(a, o3.id).waitFor();
    check('admin shows the product by name', (await card(a, o3.id).textContent()).includes('Rasmalai Cup'));

    await a.page.click('#nav [data-tab="menu"]');
    await a.page.click(`[data-edit-item="${I(0)}"]`);
    await a.page.click('#miHide');
    check('hiding removes the item from the storefront', !!(await until(async () => (await s1.page.locator(`.card[data-id="${I(0)}"]`).count()) === 0)));
    check('hidden items are listed so they can be restored', !!(await until(() => a.page.locator(`[data-show-item="${I(0)}"]`).count())));
    await a.page.click('#nav [data-tab="orders"]');
    check('old orders with a hidden item still read correctly', (await card(a, o1.id).textContent()).includes(fmt(base)));
    await a.page.reload();
    await a.page.waitForSelector('#app:not([hidden])');
    await a.page.waitForSelector('#livePill.up');
    await a.page.click('#nav [data-tab="orders"]');
    check('after a reload old orders keep their original totals', !!(await until(async () => (await a.page.locator(`.ocard[data-id="${o1.id}"]`).count()) === 1 && (await card(a, o1.id).textContent()).includes(fmt(base)) && (await card(a, o2.id).textContent()).includes(fmt(77)), 6000)));
    await a.page.click('#nav [data-tab="menu"]');
    await a.page.click(`[data-show-item="${I(0)}"]`);
    check('showing it again restores it', !!(await until(async () => (await s1.page.locator(`.card[data-id="${I(0)}"]`).count()) === 1)));

    await a.page.click(`[data-edit-item="rasmalai-cup"]`);
    await a.page.fill('#miName', 'Rasmalai Bowl');
    await a.page.fill('#miPrice', '135');
    await a.page.click('#miSave');
    check('a product you added can be renamed and repriced', !!(await until(() => (menuDoc().items || []).some((i) => i.name === 'Rasmalai Bowl') && /:135$/.test(menuDoc().px['rasmalai-cup'].slice(-1)[0]))));
    check('the rename reaches the storefront', !!(await until(async () => /Rasmalai Bowl/.test(await s1.page.textContent('#cat-desserts')))));
    await setSwitch(a, '[data-item="rasmalai-cup"]', false);
    check('a new product can be marked sold out', !!(await until(async () => (await s1.page.locator('.card[data-id="rasmalai-cup"].sold').count()) === 1, 5000)));
    await setSwitch(a, '[data-item="rasmalai-cup"]', true);
    await sleep(300);
  });

  /* ---------------- Hostile or corrupted browser storage ---------------- */
  await scenario('storage: malformed saved data cannot break the storefront', async () => {
    const bad = () => {
      localStorage.setItem('lh.shop.orders', JSON.stringify([null, 5, { id: '<img src=x onerror=1>', it: [] }, { id: 'LH-ABC234', it: 'x', total: 1 }, { id: 'LH-ABC235', it: [['masala-tea', 1]], total: 49, status: 'completed', fb: { sr: 1e9 }, n: 'A', svc: 'take', ts: Date.now() }]));
      localStorage.setItem('lh.shop.cart', 'null');
      localStorage.setItem('lh.shop.profile', 'null');
      localStorage.setItem('lh.shop.pay', JSON.stringify('<x>'));
      localStorage.setItem('lh.shop.menu', JSON.stringify({ cats: 'x', items: [null, 1], px: [], hid: 7 }));
      localStorage.setItem('lh.shop.cfg', JSON.stringify({ open: 'yes', oos: 'x', prep: 'zz' }));
    };
    const s = await newShop({ init: bad });
    check('the menu still renders', (await s.page.locator('.card').count()) > 10);
    await s.page.evaluate(() => document.querySelector('#ordersBtn').click());
    check('only the one well-formed saved order is kept', (await s.page.locator('#ordersBody .order-card').count()) === 1, String(await s.page.locator('#ordersBody .order-card').count()));
    check('no markup came from the saved data', (await s.page.locator('.order-card img, #ordersBody img').count()) === 0);
  });

  const errs = world.errors;
  check('no uncaught page errors or CSP violations', errs.length === 0, errs.slice(0, 5).join(' | '));
  console.log(`\n${passed} passed, ${failed} failed`);
  await world.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
