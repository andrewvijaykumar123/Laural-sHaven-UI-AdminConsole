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

  // completed without ever being ready: confirmation only, no ready mail
  outbox.length = 0;
  const m3 = {};
  await lib.sweep({ store: fake([{ id: 'LH-CCCCCC', data: doc('LH-CCCCCC'), ts: T0 }], { 'LH-CCCCCC': { s: 'completed' } }, m3), send, LH, now: T0, log: () => {} });
  assert.strictEqual(outbox.length, 1); assert.strictEqual(m3['LH-CCCCCC'].r, -1);

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

  // write samples for a visual check
  const dir = path.join(__dirname, 'out'); fs.mkdirSync(dir, { recursive: true });
  const o = lib.toOrder(LH, 'LH-AAAAAA', doc('LH-AAAAAA'), T0);
  fs.writeFileSync(path.join(dir, 'confirm.html'), lib.confirmEmail(LH, o, { prep: 12 }).html);
  fs.writeFileSync(path.join(dir, 'ready.html'), lib.readyEmail(LH, o).html);
  fs.writeFileSync(path.join(dir, 'report.html'), outbox[0].html);
  console.log('all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
