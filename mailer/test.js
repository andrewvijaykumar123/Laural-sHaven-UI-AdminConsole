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

  // pending: nothing; accepted: confirm; ready: ready; repeat: nothing
  const orders = [{ id: 'LH-AAAAAA', data: doc('LH-AAAAAA'), ts: T0 - 600000 }];
  const statuses = {}; const mails = {};
  const run = () => lib.sweep({ store: fake(orders, statuses, mails), send, LH, now: T0, log: () => {} });
  await run(); assert.strictEqual(outbox.length, 0, 'pending sends nothing');
  statuses['LH-AAAAAA'] = { s: 'accepted' };
  await run(); assert.strictEqual(outbox.length, 1); assert.match(outbox[0].subject, /confirmed/);
  assert.ok(!outbox[0].html.includes('<b>Anita') && !outbox[0].html.includes('Anita <b>'), 'markup in names is neutralised');
  await run(); assert.strictEqual(outbox.length, 1, 'no duplicate confirmation');
  statuses['LH-AAAAAA'] = { s: 'cooking' };
  await run(); assert.strictEqual(outbox.length, 1);
  statuses['LH-AAAAAA'] = { s: 'ready' };
  await run(); assert.strictEqual(outbox.length, 2); assert.match(outbox[1].subject, /ready/);
  statuses['LH-AAAAAA'] = { s: 'completed' };
  await run(); assert.strictEqual(outbox.length, 2, 'two emails per order at most');

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

  // write samples for a visual check
  const dir = path.join(__dirname, 'out'); fs.mkdirSync(dir, { recursive: true });
  const o = lib.toOrder(LH, 'LH-AAAAAA', doc('LH-AAAAAA'), T0);
  fs.writeFileSync(path.join(dir, 'confirm.html'), lib.confirmEmail(LH, o, { prep: 12 }).html);
  fs.writeFileSync(path.join(dir, 'ready.html'), lib.readyEmail(LH, o).html);
  fs.writeFileSync(path.join(dir, 'report.html'), outbox[0].html);
  console.log('all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
