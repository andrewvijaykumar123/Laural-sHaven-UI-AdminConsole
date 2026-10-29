'use strict';
/* Offline tests: no network, no Gmail, no Firestore. Run with `npm test`. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const LH = lib.loadCore();
const T0 = Date.parse('2026-10-28T10:00:00Z'); // 15:30 IST
const doc = (id, extra = {}) => ({ id, n: 'Anita <b>', p: '9876543210', em: 'anita@example.com', it: ['masala-tea:2', 'veg-momos:1'], total: 119, pay: 'upi', svc: 'dine', tbl: '4', nt: '', ...extra });

function fake(orders, statuses = {}, mails = {}) {
  return {
    config: async () => ({ prep: 12 }),
    recentOrders: async () => orders,
    ordersBetween: async (a, b) => orders.filter((o) => o.ts >= a && o.ts < b),
    status: async (id) => statuses[id] || null,
    mail: async (id) => mails[id] || null,
    setMail: async (id, p) => { mails[id] = { ...(mails[id] || {}), ...p }; }
  };
}
const outbox = [];
const send = async (m) => { outbox.push(m); };

(async () => {
  // validation: email accepted, bad email dropped
  assert.strictEqual(LH.validateOrder({ id: 'LH-ABC234', n: 'A', p: '9876543210', em: 'A@B.CO', it: [['masala-tea', 1]] }).em, 'a@b.co');
  assert.strictEqual(LH.validateOrder({ id: 'LH-ABC234', n: 'A', p: '9876543210', em: 'nope', it: [['masala-tea', 1]] }).em, '');

  // event bookings: Rs 1000/hour + Rs 500 cleaning + optional Rs 500 decoration
  assert.strictEqual(LH.eventQuote(3, true).total, 4000);
  assert.strictEqual(LH.eventQuote(3, false).total, 3500);
  assert.strictEqual(LH.eventQuote(1, false).total, 1500);
  const tomorrow = LH.dateKey(new Date(Date.now() + 86400000));
  const ev = (x = {}) => LH.validateEvent({ id: 'EV-ABC234', n: 'Meera <b>', p: '98765 01234', ty: 'bday', g: 20, d: tomorrow, st: 1080, h: 3, dec: true, nt: 'Cake <i>', total: 1, ...x });
  assert.strictEqual(ev().total, 4000, 'the total is recomputed, never trusted');
  assert.ok(!/[<>]/.test(ev().n + ev().nt), 'markup is stripped');
  assert.strictEqual(ev({ st: 1260, h: 4 }), null, 'must end by midnight');
  assert.strictEqual(ev({ st: 1090 }), null, 'start is on a half hour');
  assert.strictEqual(ev({ st: 420 }), null, 'not before opening');
  assert.strictEqual(ev({ h: 13 }), null); assert.strictEqual(ev({ h: 0 }), null);
  assert.strictEqual(ev({ g: 101 }), null); assert.strictEqual(ev({ p: '123' }), null);
  assert.strictEqual(ev({ ty: 'nope' }), null); assert.strictEqual(ev({ d: '2026-13-40' }), null);
  assert.strictEqual(ev({ id: 'LH-ABC234' }), null);
  assert.ok(LH.inEventWindow(tomorrow) && !LH.inEventWindow('2001-01-01'));
  assert.ok(LH.slotsClash(1140, 2, [[1080, 1260]]) && !LH.slotsClash(1260, 2, [[1080, 1260]]) && !LH.slotsClash(960, 2, [[1080, 1260]]));
  assert.strictEqual(LH.eventRange(1080, 3), '6:00 PM - 9:00 PM');
  const mv = LH.validMove({ d: tomorrow, st: 1140, h: 2, od: tomorrow, os: 1080, oh: 3 });
  assert.ok(mv && mv.os === 1080 && LH.moveEvent(ev(), mv).total === 3000, 'a moved booking is requoted');
  assert.strictEqual(LH.validMove({ d: tomorrow, st: 1260, h: 4 }), null, 'a move must still end by midnight');

  // menu changes: an order keeps the price it was placed at; hidden and added items work
  const T1 = Date.parse('2026-10-20T10:00:00Z'); const T2 = Date.parse('2026-10-25T10:00:00Z');
  const base = LH.ITEMS.get('masala-tea').price;
  LH.applyMenu({ ts: T2, px: { 'masala-tea': [`0:${base}`, `${T2}:99`], 'rasmalai-cup': [`${T2}:120`] }, hid: ['veg-momos'], cats: [{ id: 'desserts', name: 'Desserts', icon: '🍰', hue: 300, tagline: 'Sweet' }], items: [{ id: 'rasmalai-cup', name: 'Rasmalai Cup', cat: 'desserts', diet: 'v', icon: '' }] });
  assert.strictEqual(LH.priceAt('masala-tea', T1), base, 'before the change');
  assert.strictEqual(LH.priceAt('masala-tea', T2 + 1), 99, 'after the change');
  assert.strictEqual(LH.validateOrder({ id: 'LH-ABC234', n: 'A', p: '9876543210', ts: T1, it: [['masala-tea', 2]] }).total, base * 2);
  assert.strictEqual(LH.validateOrder({ id: 'LH-ABC234', n: 'A', p: '9876543210', ts: T2 + 5, it: [['masala-tea', 2], ['rasmalai-cup', 1]] }).total, 198 + 120);
  assert.ok(LH.ITEMS.get('veg-momos').hide && !LH.MENU.some((c) => c.items.some((i) => i.id === 'veg-momos')) && LH.HIDDEN.length === 1, 'hidden items stay readable but are off the menu');
  assert.strictEqual(LH.MENU.find((c) => c.id === 'desserts').items[0].price, 120);
  LH.applyMenu({ px: { 'masala-tea': ['0:0', 'x:y', '5:-3'], 'ghost': ['0:50'] }, items: [{ id: 'masala-tea', name: 'dup', cat: 'desserts' }, { id: 'no-cat', name: 'x', cat: 'nope' }], hid: ['ghost'] });
  assert.strictEqual(LH.ITEMS.get('masala-tea').price, base, 'invalid price history is ignored');
  assert.ok(!LH.ITEMS.has('ghost') && !LH.ITEMS.has('no-cat'), 'unknown or invalid entries are ignored');
  LH.applyMenu({ ts: 1, px: { 'evil-item': ['1:50'] }, cats: [{ id: 'evil', name: 'Evil', icon: '<img src=x onerror=1>"\'`=&🍰', hue: 10, tagline: 'x' }], items: [{ id: 'evil-item', name: 'E', cat: 'evil', diet: 'v', icon: '"onmouseover="x' }] });
  assert.ok(!/[<>"'`=&]/.test(LH.MENU.find((c) => c.id === 'evil').icon + LH.ITEMS.get('evil-item').icon), 'menu icons cannot carry markup or attribute breakers');
  LH.applyMenu(null);
  assert.strictEqual(LH.HIDDEN.length, 0);

  // pending: received; accepted: confirm; ready: ready; repeat: nothing
  const orders = [{ id: 'LH-AAAAAA', data: doc('LH-AAAAAA'), ts: T0 - 600000 }];
  const statuses = {}; const mails = {};
  const run = () => lib.sweep({ store: fake(orders, statuses, mails), send, LH, now: T0, log: () => {} });
  await run(); assert.strictEqual(outbox.length, 1, 'pending sends the received email'); assert.match(outbox[0].subject, /received/);
  await run(); assert.strictEqual(outbox.length, 1, 'received is sent once');
  statuses['LH-AAAAAA'] = { s: 'accepted' };
  await run(); assert.strictEqual(outbox.length, 2); assert.match(outbox[1].subject, /confirmed/);
  assert.ok(!outbox[1].html.includes('<b>Anita') && !outbox[1].html.includes('Anita <b>'), 'markup in names is neutralised');
  await run(); assert.strictEqual(outbox.length, 2, 'no duplicate confirmation');
  statuses['LH-AAAAAA'] = { s: 'cooking' };
  await run(); assert.strictEqual(outbox.length, 2);
  statuses['LH-AAAAAA'] = { s: 'ready' };
  await run(); assert.strictEqual(outbox.length, 3); assert.match(outbox[2].subject, /ready/);
  statuses['LH-AAAAAA'] = { s: 'completed' };
  await run(); assert.strictEqual(outbox.length, 3, 'three emails per dine-in order at most');

  // an email another device is already sending (claimed) is left alone
  outbox.length = 0;
  const claimedStore = { ...fake([{ id: 'LH-GGGGGG', data: doc('LH-GGGGGG'), ts: T0 }], { 'LH-GGGGGG': { s: 'accepted' } }, {}), claimed: async () => true };
  const cs = await lib.sweep({ store: claimedStore, send, LH, now: T0, log: () => {} });
  assert.strictEqual(outbox.length, 0); assert.strictEqual(cs.skipped, 1);

  // the shared planner (also used by the admin console) never repeats an email
  const po = lib.toOrder(LH, 'LH-HHHHHH', doc('LH-HHHHHH'), T0);
  assert.deepStrictEqual(lib.plan(LH, po, { s: 'pending' }, {}).map((j) => j[0]), ['p']);
  assert.deepStrictEqual(lib.plan(LH, po, { s: 'pending' }, { p: 1 }).map((j) => j[0]), []);
  assert.deepStrictEqual(lib.plan(LH, po, { s: 'accepted' }, { p: 1 }).map((j) => j[0]), ['c']);
  assert.deepStrictEqual(lib.plan(LH, po, { s: 'completed' }, { p: 1, c: 1 }).map((j) => j[0]), ['r']);
  assert.deepStrictEqual(lib.plan(LH, po, { s: 'rejected', r: 'x' }, { p: 1 }).map((j) => j[0]), ['x']);
  assert.deepStrictEqual(lib.plan(LH, { ...po, em: '' }, { s: 'accepted' }, {}), []);
  outbox.length = 0;
  // jumped straight to ready: both emails, in order
  outbox.length = 0;
  const o2 = [{ id: 'LH-BBBBBB', data: doc('LH-BBBBBB'), ts: T0 }];
  await lib.sweep({ store: fake(o2, { 'LH-BBBBBB': { s: 'ready' } }, {}), send, LH, now: T0, log: () => {} });
  assert.deepStrictEqual(outbox.map((m) => /ready/.test(m.subject)), [false, true]);

  // completed without ever being seen as ready: confirmation plus a completion email, once
  outbox.length = 0;
  const m3 = {};
  const s3 = fake([{ id: 'LH-CCCCCC', data: doc('LH-CCCCCC'), ts: T0 }], { 'LH-CCCCCC': { s: 'completed' } }, m3);
  await lib.sweep({ store: s3, send, LH, now: T0, log: () => {} });
  assert.strictEqual(outbox.length, 2); assert.match(outbox[1].subject, /complete/); assert.ok(m3['LH-CCCCCC'].r > 0);
  await lib.sweep({ store: s3, send, LH, now: T0, log: () => {} });
  assert.strictEqual(outbox.length, 2, 'no repeat');

  // earlier skip marker (r = -1) on a completed order is retried once
  outbox.length = 0;
  const m3b = { 'LH-EEEEEE': { c: T0, r: -1 } };
  await lib.sweep({ store: fake([{ id: 'LH-EEEEEE', data: doc('LH-EEEEEE'), ts: T0 }], { 'LH-EEEEEE': { s: 'completed' } }, m3b), send, LH, now: T0, log: () => {} });
  assert.strictEqual(outbox.length, 1); assert.match(outbox[0].subject, /complete/);

  // rejected: one apology, reason included, no confirmation
  outbox.length = 0;
  await lib.sweep({ store: fake([{ id: 'LH-DDDDDD', data: doc('LH-DDDDDD'), ts: T0 }], { 'LH-DDDDDD': { s: 'rejected', r: 'Item out of stock' } }, {}), send, LH, now: T0, log: () => {} });
  assert.strictEqual(outbox.length, 1); assert.ok(outbox[0].html.includes('Item out of stock'));

  // orders without an email are ignored; failures stop after 3 tries
  outbox.length = 0;
  const noMail = doc('LH-EEEEEE'); delete noMail.em;
  await lib.sweep({ store: fake([{ id: 'LH-EEEEEE', data: noMail, ts: T0 }], { 'LH-EEEEEE': { s: 'accepted' } }, {}), send, LH, now: T0, log: () => {} });
  assert.strictEqual(outbox.length, 0);
  let tries = 0; const m5 = {};
  const bad = async () => { tries++; throw Object.assign(new Error('x'), { code: 'EAUTH' }); };
  for (let i = 0; i < 6; i++) await lib.sweep({ store: fake([{ id: 'LH-FFFFFF', data: doc('LH-FFFFFF'), ts: T0 }], { 'LH-FFFFFF': { s: 'accepted' } }, m5), send: bad, LH, now: T0, log: () => {} });
  assert.strictEqual(tries, 3, 'gives up after 3 failures');

  // daily report
  assert.strictEqual(lib.targetDay(Date.parse('2026-10-28T18:29:00Z')), '2026-10-28'); // 23:59 IST
  assert.strictEqual(lib.targetDay(Date.parse('2026-10-28T19:10:00Z')), '2026-10-28'); // 00:40 IST next day: delayed run => still the day just ended
  const day = '2026-10-28'; const { start } = lib.dayBounds(day);
  const rep = [
    { id: 'LH-R00001', data: doc('LH-R00001', { it: ['masala-tea:2'], total: 50 }), ts: start + 3600000 * 9 },
    { id: 'LH-R00002', data: doc('LH-R00002', { it: ['veg-momos:3'], total: 207, pay: 'counter', svc: 'take', p: '9000000001', em: undefined }), ts: start + 3600000 * 13 },
    { id: 'LH-R00003', data: doc('LH-R00003', { it: ['mango:1'], total: 149 }), ts: start + 3600000 * 13 },
    { id: 'LH-R00004', data: doc('LH-R00004', { it: ['mango:1'], total: 149, p: '9000000002' }), ts: start + 3600000 * 20 }
  ];
  delete rep[1].data.em;
  const st = { 'LH-R00001': { s: 'completed', v: true }, 'LH-R00002': { s: 'completed' }, 'LH-R00003': { s: 'rejected', r: 'Kitchen is too busy' }, 'LH-R00004': { s: 'cooking' } };
  outbox.length = 0;
  const stats = await lib.dailyReport({ store: fake(rep, st), send, LH, to: 'owner@example.com', day, log: () => {} });
  assert.strictEqual(stats.placed, 4); assert.strictEqual(stats.rejected, 1); assert.strictEqual(stats.completed, 2);
  assert.strictEqual(stats.sales, 50 + 207 + 149); assert.strictEqual(stats.validCount, 3);
  assert.strictEqual(stats.upiUnverified.length, 1); assert.strictEqual(stats.open.length, 1);
  assert.strictEqual(stats.hours[9], 1); assert.strictEqual(stats.hours[13], 1);
  assert.strictEqual(outbox[0].to, 'owner@example.com'); assert.ok(outbox[0].attachments[0].content.includes('LH-R00001'));

  // delivery: confirm -> on the way -> delivered (no "ready" email), address carried through, bad ones rejected
  const dd = (id, extra = {}) => doc(id, { svc: 'deliver', tbl: '', pay: 'counter', addr: '12 Test Street, Kelambakkam', lat: 12.8475, lng: 80.1964, ...extra });
  outbox.length = 0;
  const dOrders = [{ id: 'LH-DELIV1', data: dd('LH-DELIV1'), ts: T0 }];
  const dSt = { 'LH-DELIV1': { s: 'accepted' } }; const dMail = {};
  const dRun = () => lib.sweep({ store: fake(dOrders, dSt, dMail), send, LH, now: T0, log: () => {} });
  await dRun(); assert.strictEqual(outbox.length, 1); assert.match(outbox[0].text, /Delivery to 12 Test Street/); assert.match(outbox[0].text, /Cash on delivery/);
  dSt['LH-DELIV1'] = { s: 'ready' };
  await dRun(); assert.strictEqual(outbox.length, 1, 'no ready email for delivery');
  dSt['LH-DELIV1'] = { s: 'out' };
  await dRun(); assert.strictEqual(outbox.length, 2); assert.match(outbox[1].subject, /on the way/);
  await dRun(); assert.strictEqual(outbox.length, 2, 'on the way sent once');
  dSt['LH-DELIV1'] = { s: 'completed' };
  await dRun(); assert.strictEqual(outbox.length, 3); assert.match(outbox[2].subject, /delivered/);
  await dRun(); assert.strictEqual(outbox.length, 3, 'delivered sent once');
  assert.strictEqual(lib.toOrder(LH, 'LH-DELIV2', dd('LH-DELIV2', { lat: 13.5, lng: 80.2 }), T0), null, 'out of range rejected');
  // fee: free to 5 km, Rs 15/km to 10 km, Rs 20/km beyond; nothing past 15 km
  assert.deepStrictEqual([0, 4.9, 5, 6, 7.5, 10, 12, 15].map(LH.deliveryFee), [0, 0, 0, 15, 38, 75, 115, 175]);
  const at = (km) => dd('LH-DELIV6', { lat: 12.847503 + km / 110.57, lng: 80.196458 });
  const o7 = lib.toOrder(LH, 'LH-DELIV6', at(7.5), T0);
  assert.ok(o7 && o7.fee >= 36 && o7.fee <= 39, 'fee added for 7.5 km');
  const v7 = LH.validateOrder({ ...at(7.5), ts: T0, it: [['masala-tea', 2], ['veg-momos', 1]] }), v0 = LH.validateOrder({ ...dd('LH-DELIV6'), ts: T0, it: [['masala-tea', 2], ['veg-momos', 1]] });
  assert.strictEqual(v7.total - v0.total, v7.fee, 'fee is added to the total');
  assert.match(lib.confirmEmail(LH, o7).text, new RegExp(`Delivery  ₹${o7.fee}`));
  assert.ok(lib.toOrder(LH, 'LH-DELIV7', at(14.5), T0), '14.5 km accepted');
  assert.strictEqual(lib.toOrder(LH, 'LH-DELIV8', at(16), T0), null, '16 km rejected');
  assert.match(lib.confirmEmail(LH, lib.toOrder(LH, 'LH-DELIV1', dd('LH-DELIV1'), T0)).text, /Delivery  Free/);
  assert.strictEqual(lib.toOrder(LH, 'LH-DELIV3', dd('LH-DELIV3', { addr: 'x' }), T0), null, 'short address rejected');
  assert.strictEqual(lib.toOrder(LH, 'LH-DELIV4', dd('LH-DELIV4', { lat: undefined }), T0), null, 'missing coordinates rejected');
  assert.strictEqual(lib.toOrder(LH, 'LH-DELIV5', dd('LH-DELIV5', { p: '12345' }), T0), null, 'short phone rejected for delivery');
  const dRows = [{ o: lib.toOrder(LH, 'LH-DELIV1', dOrders[0].data, T0), s: 'completed', v: false, r: '' }];
  const dRep = lib.buildReport(LH, dRows);
  assert.strictEqual(dRep.deliver, 1); assert.strictEqual(dRep.take, 0); assert.strictEqual(dRep.dine, 0);
  assert.ok(lib.reportEmail(LH, day, dRows, null).attachments[0].content.includes('12 Test Street'));
  // deliveries are reported separately: fees, distance bands, rejected ones excluded from sales
  const mixed = [...dRows, { o: o7, s: 'completed', v: false, r: '' }, { o: lib.toOrder(LH, 'LH-DELIV9', at(12), T0), s: 'rejected', v: false, r: 'x' }];
  const ds = LH.deliveryStats(mixed);
  assert.strictEqual(ds.n, 2); assert.strictEqual(ds.rejected, 1); assert.strictEqual(ds.fees, o7.fee);
  assert.strictEqual(ds.bands.free.n, 1); assert.strictEqual(ds.bands.mid.n, 1); assert.strictEqual(ds.bands.far.n, 0);
  assert.strictEqual(ds.sales, dRows[0].o.total + o7.total);
  const dm = lib.reportEmail(LH, day, mixed, null);
  assert.match(dm.html, /Home delivery/); assert.match(dm.text, /Home delivery 2 orders/);
  assert.match(lib.reportEmail(LH, day, [], null).html, /No home deliveries/);

  // delivery code: generated as 4 digits, kept only on delivery orders, shown in the received, confirmed and on-the-way emails, never after delivery
  for (let i = 0; i < 200; i++) assert.match(LH.newOtp(), /^\d{4}$/);
  assert.ok(LH.validOtp('0042') && !LH.validOtp('42') && !LH.validOtp('12345') && !LH.validOtp('12a4') && !LH.validOtp(1234) && !LH.validOtp(undefined));
  const withCode = lib.toOrder(LH, 'LH-DELIV1', dd('LH-DELIV1', { otp: '4827' }), T0);
  assert.strictEqual(withCode.otp, '4827', 'code is carried from the stored order');
  assert.strictEqual(lib.toOrder(LH, 'LH-DELIV1', dd('LH-DELIV1', { otp: '48x7' }), T0).otp, undefined, 'malformed code is dropped');
  assert.strictEqual(lib.toOrder(LH, 'LH-DELIV1', dd('LH-DELIV1'), T0).otp, undefined, 'older orders have no code');
  assert.strictEqual(lib.toOrder(LH, 'LH-TAKE01', doc('LH-TAKE01', { otp: '4827' }), T0).otp, undefined, 'non-delivery orders never carry a code');
  for (const [name, fn] of [['received', lib.receivedEmail], ['confirmed', lib.confirmEmail], ['on the way', lib.outEmail]]) {
    const m = fn(LH, withCode, {});
    assert.ok(m.html.includes('4827') && m.text.includes('Your delivery code: 4827'), `${name} email shows the code`);
  }
  for (const [name, fn] of [['ready', lib.readyEmail], ['delivered', lib.doneEmail]]) assert.ok(!fn(LH, withCode, {}).html.includes('4827') && !fn(LH, withCode, {}).text.includes('4827'), `${name} email does not repeat the code`);
  assert.ok(!lib.confirmEmail(LH, lib.toOrder(LH, 'LH-DELIV1', dd('LH-DELIV1'), T0), {}).html.includes('delivery code'), 'no code block without a code');
  assert.ok(!lib.confirmEmail(LH, lib.toOrder(LH, 'LH-TAKE01', doc('LH-TAKE01'), T0), {}).html.includes('delivery code'), 'no code block for takeaway');
  // the scheduled mailer includes the code too
  outbox.length = 0;
  await lib.sweep({ store: fake([{ id: 'LH-DELIV1', data: dd('LH-DELIV1', { otp: '4827' }), ts: T0 }], { 'LH-DELIV1': { s: 'pending' } }, {}), send, LH, now: T0, log: () => {} });
  assert.strictEqual(outbox.length, 1); assert.match(outbox[0].subject, /received/); assert.ok(outbox[0].text.includes('4827'), 'fallback mailer sends the code with the first email');
  // the daily report CSV never contains the code
  const csvMail = lib.reportEmail(LH, day, [{ o: withCode, s: 'completed', v: false, r: '' }], null);
  assert.ok(!csvMail.attachments[0].content.includes('4827') && !csvMail.html.includes('4827'), 'report has no code');
  // a delivery can only be closed from "out"; other services are unchanged
  assert.deepStrictEqual([...LH.nextFor({ svc: 'deliver' }, 'ready')], ['out']);
  assert.deepStrictEqual([...LH.nextFor({ svc: 'deliver' }, 'out')], ['completed']);
  assert.deepStrictEqual([...LH.nextFor({ svc: 'take' }, 'ready')], ['completed']);

  // invoice: cafe details, no GST, arithmetic, words, escaping
  const tpl = require('../mailtpl');
  assert.strictEqual(tpl.rupeesInWords(0), 'Zero Rupees Only');
  assert.strictEqual(tpl.rupeesInWords(45), 'Forty Five Rupees Only');
  assert.strictEqual(tpl.rupeesInWords(1250), 'One Thousand Two Hundred Fifty Rupees Only');
  assert.strictEqual(tpl.rupeesInWords(100000), 'One Lakh Rupees Only');
  assert.strictEqual(tpl.rupeesInWords(123456), 'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only');
  const inv = lib.toOrder(LH, 'LH-AAAAAA', doc('LH-AAAAAA'), T0);
  const ih = tpl.invoiceHtml(LH, inv, { paid: true });
  for (const s of ["Laural's Haven Cafe".replace("'", '&#39;'), '9962419353', 'https://maps.app.goo.gl/XeqJJUZKzVbcAqjM8', 'INVOICE', 'GST', 'Not applicable', 'PAID', 'LH-AAAAAA', 'Amount in words']) {
    assert.ok(ih.includes(s) || ih.includes(s.replace('&#39;', "'")), `invoice html has ${s}`);
  }
  assert.ok(ih.includes(LH.fmt(inv.total)), 'invoice shows the total');
  assert.ok(!/delivery code|GSTIN/i.test(ih), 'no delivery code or GSTIN on the invoice');
  assert.ok(tpl.invoiceHtml(LH, inv, { paid: false }).includes('PAYMENT PENDING') || tpl.invoiceHtml(LH, inv, { paid: false }).includes('PAYMENT DUE'));
  const xs = tpl.invoiceHtml(LH, { ...inv, n: '<img src=x onerror=1>', nt: '<b>hi</b>' }, {});
  assert.ok(!xs.includes('<img') && !xs.includes('<b>hi</b>'), 'invoice escapes customer text');
  const it = tpl.invoiceText(LH, inv, { paid: true });
  assert.ok(/9962419353/.test(it) && /maps\.app\.goo\.gl/.test(it) && /GST: Not applicable/.test(it) && it.includes(LH.fmt(inv.total)));
  const done = lib.doneEmail(LH, inv);
  assert.ok(done.html.includes('INVOICE') && done.text.includes('Invoice no: LH-AAAAAA'), 'completed email carries the invoice');
  const dinv = { ...inv, svc: 'deliver', addr: '12 Lake View Road, near the temple', fee: 30, total: inv.total + 30 };
  const dh = tpl.invoiceHtml(LH, dinv, { paid: false });
  assert.ok(dh.includes('Delivery charge') && dh.includes('12 Lake View Road'), 'delivery invoice lists the charge and address');

  // Customer feedback: ratings are clamped to whole 1-5 stars, unknown items and duplicates are dropped, comments are cleaned.
  const item0 = LH.MENU[0].items[0].id, item1 = LH.MENU[0].items[1].id;
  const fb = LH.validateFeedback({ id: 'LH-AAAAAA', n: 'Ravi', svc: 'take', sr: 4, ir: [[item0, 5], [item1, 9], ['nope', 3], [item0, 1]], c: '  Great <b>food</b>\n' });
  assert.ok(fb && fb.sr === 4 && fb.ir.length === 1 && fb.ir[0][0] === item0 && fb.ir[0][1] === 5, 'feedback keeps valid product ratings only');
  assert.ok(!/[<>\n]/.test(fb.c) && fb.c.startsWith('Great'), 'feedback comment is cleaned');
  assert.strictEqual(LH.validateFeedback({ id: 'LH-AAAAAA', sr: 0, ir: [] }), null, 'a service rating is required');
  assert.strictEqual(LH.validateFeedback({ id: 'bad', sr: 5, ir: [] }), null, 'feedback needs a valid order id');

  // write samples for a visual check
  const dir = path.join(__dirname, 'out'); fs.mkdirSync(dir, { recursive: true });
  const o = lib.toOrder(LH, 'LH-AAAAAA', doc('LH-AAAAAA'), T0);
  fs.writeFileSync(path.join(dir, 'invoice.html'), tpl.shell(LH, 'Invoice', tpl.invoiceHtml(LH, dinv, { paid: true })));
  fs.writeFileSync(path.join(dir, 'confirm.html'), lib.confirmEmail(LH, o, { prep: 12 }).html);
  fs.writeFileSync(path.join(dir, 'ready.html'), lib.readyEmail(LH, o).html);
  fs.writeFileSync(path.join(dir, 'report.html'), outbox[0].html);
  console.log('all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
