'use strict';
/* Order emails and the daily report. Pure logic: Firestore and SMTP are injected so it can be tested offline. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const IST_MS = 330 * 60000;
const SHOP = "Laural's Haven";
const MAX_FAILS = 3;
const WINDOW_MS = 48 * 3600000;

/* The real menu, prices and statuses come from the site's own core.js so they never drift. */
function loadCore() {
  const win = { addEventListener() {} };
  win.top = win; win.self = win;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8'), {
    window: win, document: { documentElement: { style: {} } }, crypto: require('crypto').webcrypto, console
  });
  return win.LH;
}

/* ---------- Orders ---------- */
function toOrder(LH, id, d, tsMs) {
  const it = (Array.isArray(d.it) ? d.it : []).map((s) => { const i = String(s).lastIndexOf(':'); return [String(s).slice(0, i), Number(String(s).slice(i + 1))]; });
  const o = LH.validateOrder({ id, ts: tsMs, n: d.n, p: d.p, em: d.em, nt: d.nt, pay: d.pay, svc: d.svc, tbl: d.tbl, addr: d.addr, lat: d.lat, lng: d.lng, it });
  if (o && Number.isInteger(d.total) && d.total > 0) o.total = d.total;
  return o;
}

/* ---------- Email layout ---------- */
const BRAND = '#b45309';
function shell(LH, title, inner) {
  return `<!doctype html><html><body style="margin:0;background:#f6f1ea;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:${BRAND};color:#ffffff;padding:20px 24px"><div style="font-size:20px;font-weight:700">${LH.esc(SHOP)}</div><div style="font-size:13px;opacity:.9">${LH.esc(title)}</div></td></tr>
<tr><td style="padding:24px">${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#faf7f2;color:#6b7280;font-size:12px">You received this because an email address was entered when this order was placed. If that was not you, please ignore this message.</td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(LH, o) {
  const rows = o.it.map(([id, q]) => {
    const it = LH.ITEMS.get(id);
    return `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${q} &times; ${LH.esc(it.name)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #eee">${LH.esc(LH.fmt(it.price * q))}</td></tr>`;
  }).join('');
  const feeRow = o.svc === 'deliver' ? `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">Delivery</td><td align="right" style="padding:6px 0;border-bottom:1px solid #eee">${o.fee ? LH.esc(LH.fmt(o.fee)) : 'Free'}</td></tr>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}${feeRow}
<tr><td style="padding-top:10px;font-weight:700">Total</td><td align="right" style="padding-top:10px;font-weight:700">${LH.esc(LH.fmt(o.total))}</td></tr></table>`;
}

const where = (o) => (o.svc === 'take' ? 'Takeaway' : o.svc === 'deliver' ? `Delivery to ${o.addr}` : `Dine-in${o.tbl ? `, table ${o.tbl}` : ''}`);
const payLine = (o, paid) => (o.pay === 'upi' ? (paid ? 'Paid by UPI' : 'UPI (we confirm payment at the counter)') : o.svc === 'deliver' ? 'Cash on delivery' : 'Pay at the counter');
const textItems = (LH, o) => [...o.it.map(([id, q]) => `${q} x ${LH.ITEMS.get(id).name}  ${LH.fmt(LH.ITEMS.get(id).price * q)}`), ...(o.svc === 'deliver' ? [`Delivery  ${o.fee ? LH.fmt(o.fee) : 'Free'}`] : [])].join('\n');

function confirmEmail(LH, o, ctx = {}) {
  const prep = Number(ctx.prep) > 0 ? ` It should be ready in about ${Number(ctx.prep)} minutes.` : '';
  const subject = `Order ${o.id} confirmed - ${SHOP}`;
  const html = shell(LH, `Order confirmed and bill`, `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is confirmed.${LH.esc(prep)}</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(where(o))}<br>${LH.esc(payLine(o, ctx.paid))}<br>Placed ${LH.esc(new Date(o.ts + IST_MS).toISOString().slice(0, 16).replace('T', ' '))} IST</p>
${o.nt ? `<p style="margin:12px 0 0;font-size:13px;color:#4b5563">Your note: ${LH.esc(o.nt)}</p>` : ''}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${o.svc === 'deliver' ? 'We will email you when it is on the way. You can also follow the rider live on our website.' : 'We will email you again when it is ready.'}</p>`);
  const text = `Hi ${o.n}, your order ${o.id} is confirmed.${prep}\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\n${where(o)}\n${payLine(o, ctx.paid)}\n\n${o.svc === 'deliver' ? 'We will email you when it is on the way.' : 'We will email you again when it is ready.'}\n- ${SHOP}`;
  return { subject, html, text };
}

function outEmail(LH, o) {
  const subject = `Order ${o.id} is on the way - ${SHOP}`;
  const html = shell(LH, 'Out for delivery', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is out for delivery to ${LH.esc(o.addr)}.</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(payLine(o, false))}. Open our website on the device you ordered from to follow the rider live on the map.</p>`);
  const text = `Hi ${o.n}, your order ${o.id} is out for delivery to ${o.addr}.\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n${payLine(o, false)}\n\nOpen our website on the device you ordered from to follow the rider live.\n- ${SHOP}`;
  return { subject, html, text };
}

function readyEmail(LH, o) {
  const how = o.svc === 'take' ? 'Please collect it at the counter.' : `We will bring it to ${o.tbl ? `table ${o.tbl}` : 'your table'}.`;
  const subject = `Order ${o.id} is ready - ${SHOP}`;
  const html = shell(LH, 'Your order is ready', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is ready. ${LH.esc(how)}</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">Thank you for choosing ${LH.esc(SHOP)}.</p>`);
  const text = `Hi ${o.n}, your order ${o.id} is ready. ${how}\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\nThank you for choosing ${SHOP}.`;
  return { subject, html, text };
}

function doneEmail(LH, o) {
  const del = o.svc === 'deliver';
  const subject = `Order ${o.id} is ${del ? 'delivered' : 'complete'} - ${SHOP}`;
  const html = shell(LH, del ? 'Your order was delivered' : 'Your order is complete', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is ${del ? 'delivered' : 'complete'}. We hope you enjoyed it.</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">Thank you for choosing ${LH.esc(SHOP)}. We look forward to seeing you again.</p>`);
  const text = `Hi ${o.n}, your order ${o.id} is ${del ? 'delivered' : 'complete'}. We hope you enjoyed it.\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\nThank you for choosing ${SHOP}.`;
  return { subject, html, text };
}

function rejectEmail(LH, o, reason) {
  const why = reason ? ` Reason: ${reason}.` : '';
  const subject = `Order ${o.id} could not be accepted - ${SHOP}`;
  const html = shell(LH, 'Order update', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, we are sorry, we could not accept your order <b>${LH.esc(o.id)}</b>.${LH.esc(why)}</p>
<p style="margin:0;font-size:13px;color:#4b5563">If you have paid, please speak to our staff and we will make it right. You are welcome to order again.</p>`);
  const text = `Hi ${o.n}, we are sorry, we could not accept your order ${o.id}.${why}\nIf you have paid, please speak to our staff. You are welcome to order again.\n- ${SHOP}`;
  return { subject, html, text };
}

/* ---------- Per-order sweep (idempotent; state lives in the mail/{id} documents) ---------- */
async function sweep({ store, send, LH, now = Date.now(), maxSends = 60, log = console.log }) {
  const cfg = (await store.config()) || {};
  const recent = await store.recentOrders(now - WINDOW_MS);
  const stats = { checked: 0, sent: 0, failed: 0, skipped: 0 };
  for (const raw of recent) {
    if (!raw.data.em) continue;
    const o = toOrder(LH, raw.id, raw.data, raw.ts);
    if (!o || !o.em) continue;
    stats.checked++;
    const st = (await store.status(o.id)) || {};
    const s = LH.STATUS[st.s] ? st.s : 'pending';
    const mail = (await store.mail(o.id)) || {};
    (stats.orders = stats.orders || []).push(`${o.id}:${s}:c${mail.c ? 1 : 0}r${mail.r ? 1 : 0}x${mail.x ? 1 : 0}f${mail.f || 0}`);
    if ((mail.f || 0) >= MAX_FAILS) continue;

    const jobs = [];
    if (s === 'rejected') { if (!mail.x) jobs.push(['x', rejectEmail(LH, o, st.r)]); }
    else {
      if (!mail.c && s !== 'pending') jobs.push(['c', confirmEmail(LH, o, { prep: cfg.prep, paid: !!st.v })]);
      const del = o.svc === 'deliver';
      const needR = !mail.r || mail.r === -1;
      if (del && !mail.o && s === 'out') jobs.push(['o', outEmail(LH, o)]);
      if (needR && s === 'ready' && !del) jobs.push(['r', readyEmail(LH, o)]);
      if (needR && s === 'completed') jobs.push(['r', doneEmail(LH, o)]);
    }

    for (const [key, msg] of jobs) {
      if (stats.sent >= maxSends) return stats;
      try {
        await send({ to: o.em, ...msg });
        const patch = { [key]: now };
        if (key === 'x' && !mail.c) patch.c = -1;
        await store.setMail(o.id, patch);
        Object.assign(mail, patch);
        stats.sent++;
        log(`sent ${key} for ${o.id}`);
      } catch (e) {
        stats.failed++;
        mail.f = (mail.f || 0) + 1;
        await store.setMail(o.id, { f: mail.f });
        log(`::warning title=mailer::failed ${key} for ${o.id}: ${e && (e.code || e.responseCode) || 'error'}`);
        break;
      }
    }
  }
  return stats;
}

/* ---------- Daily report ---------- */
const pad = (n) => String(n).padStart(2, '0');
const istDate = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
function targetDay(now) {
  const ist = new Date(now + IST_MS);
  return ist.getUTCHours() < 6 ? istDate(now - 86400000) : istDate(now);
}
function dayBounds(day) {
  const start = Date.parse(`${day}T00:00:00Z`) - IST_MS;
  return { start, end: start + 86400000 };
}
const prettyDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'long', timeZone: 'UTC' });

function buildReport(LH, rows) {
  const valid = rows.filter((r) => r.s !== 'rejected');
  const sum = (a) => a.reduce((t, r) => t + r.o.total, 0);
  const count = (s) => rows.filter((r) => r.s === s).length;
  const r = {
    placed: rows.length, sales: sum(valid), validCount: valid.length,
    completed: count('completed'), rejected: count('rejected'),
    open: rows.filter((x) => !['completed', 'rejected'].includes(x.s)),
    avg: valid.length ? Math.round(sum(valid) / valid.length) : 0
  };
  const upi = valid.filter((x) => x.o.pay === 'upi');
  r.upiPaid = sum(upi.filter((x) => x.v)); r.upiPaidN = upi.filter((x) => x.v).length;
  r.upiUnverified = upi.filter((x) => !x.v);
  const ctr = valid.filter((x) => x.o.pay === 'counter');
  r.counterN = ctr.length; r.counterAmt = sum(ctr);
  r.dine = valid.filter((x) => x.o.svc === 'dine').length;
  r.deliver = valid.filter((x) => x.o.svc === 'deliver').length;
  r.take = valid.length - r.dine - r.deliver;
  const qty = {}; const rev = {}; const cat = {};
  valid.forEach(({ o }) => o.it.forEach(([id, q]) => {
    const it = LH.ITEMS.get(id);
    qty[it.name] = (qty[it.name] || 0) + q; rev[it.name] = (rev[it.name] || 0) + it.price * q;
    const c = LH.MENU.find((m) => m.id === it.cat).name; cat[c] = (cat[c] || 0) + it.price * q;
  }));
  r.top = Object.entries(qty).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, q]) => [n, q, rev[n]]);
  r.cats = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  r.hours = Array(24).fill(0);
  valid.forEach(({ o }) => { r.hours[new Date(o.ts + IST_MS).getUTCHours()]++; });
  const peak = Math.max(...r.hours); r.peak = peak ? r.hours.indexOf(peak) : -1;
  const reasons = {}; rows.filter((x) => x.s === 'rejected').forEach((x) => { const k = x.r || 'No reason given'; reasons[k] = (reasons[k] || 0) + 1; });
  r.reasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const phones = {}; valid.forEach(({ o }) => { const k = o.p.replace(/\D/g, '').slice(-10); phones[k] = (phones[k] || 0) + 1; });
  r.customers = Object.keys(phones).length; r.repeat = Object.values(phones).filter((n) => n > 1).length;
  r.del = LH.deliveryStats(rows);
  return r;
}

const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
function reportCsv(LH, rows) {
  const head = ['Order', 'Time (IST)', 'Name', 'Phone', 'Email', 'Service', 'Table', 'Items', 'Total', 'Payment', 'Payment verified', 'Status', 'Reason', 'Note', 'Address', 'Latitude', 'Longitude', 'Delivery fee'];
  const body = [...rows].sort((a, b) => a.o.ts - b.o.ts).map(({ o, s, v, r }) => [
    o.id, new Date(o.ts + IST_MS).toISOString().slice(0, 16).replace('T', ' '), o.n, o.p, o.em, o.svc, o.tbl,
    o.it.map(([id, q]) => `${q}x ${LH.ITEMS.get(id).name}`).join('; '), o.total, o.pay, v ? 'yes' : 'no', s, r || '', o.nt, o.addr || '', o.lat ?? '', o.lng ?? '', o.fee ?? ''  ]);
  return [head, ...body].map((l) => l.map(csvCell).join(',')).join('\r\n');
}

function reportEmail(LH, day, rows, prev) {
  const r = buildReport(LH, rows);
  const f = LH.fmt; const e = LH.esc;
  const card = (label, value, sub) => `<td style="padding:10px;background:#faf7f2;border-radius:10px;text-align:center"><div style="font-size:11px;color:#6b7280;text-transform:uppercase">${e(label)}</div><div style="font-size:20px;font-weight:700">${e(value)}</div><div style="font-size:11px;color:#6b7280">${e(sub)}</div></td>`;
  const h = (t) => `<h3 style="margin:22px 0 8px;font-size:14px;color:${BRAND};text-transform:uppercase;letter-spacing:.04em">${e(t)}</h3>`;
  const table = (list, cols) => (list.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${list.map((x) => `<tr>${x.map((c, i) => `<td${cols[i] === 'r' ? ' align="right"' : ''} style="padding:4px 0;border-bottom:1px solid #eee">${e(c)}</td>`).join('')}</tr>`).join('')}</table>` : '<p style="margin:0;font-size:13px;color:#6b7280">None</p>');
  const maxH = Math.max(1, ...r.hours);
  const hourRows = r.hours.map((n, hr) => (n ? `<tr><td style="padding:2px 8px 2px 0;font-size:12px;width:56px">${pad(hr)}:00</td><td style="padding:2px 0"><div style="background:${BRAND};height:10px;width:${Math.max(4, Math.round(n / maxH * 100))}%;border-radius:5px"></div></td><td style="padding:2px 0 2px 8px;font-size:12px;width:30px" align="right">${n}</td></tr>` : '')).join('');
  let delta = '';
  if (prev && prev.sales > 0) { const p = Math.round((r.sales - prev.sales) / prev.sales * 100); delta = ` (${p >= 0 ? '+' : ''}${p}% vs previous day)`; }

  const inner = `<table role="presentation" width="100%" cellpadding="6" cellspacing="6"><tr>${card('Sales', f(r.sales), `${r.validCount} orders${delta}`)}${card('Avg ticket', f(r.avg), 'per order')}</tr><tr>${card('Completed', r.completed, `of ${r.placed} placed`)}${card('Rejected', r.rejected, 'not served')}</tr></table>
${h('Payments')}${table([['UPI verified', `${r.upiPaidN} orders`, f(r.upiPaid)], ['UPI not yet verified', `${r.upiUnverified.length} orders`, f(r.upiUnverified.reduce((t, x) => t + x.o.total, 0))], ['Pay at counter', `${r.counterN} orders`, f(r.counterAmt)]], ['l', 'r', 'r'])}
${r.upiUnverified.length ? `${h('UPI payments to verify')}${table(r.upiUnverified.map((x) => [x.o.id, x.o.n, x.o.p, f(x.o.total)]), ['l', 'l', 'l', 'r'])}` : ''}
${h('Service')}${table([['Dine-in', `${r.dine} orders`], ['Takeaway', `${r.take} orders`], ['Delivery', `${r.deliver} orders`]], ['l', 'r'])}
${h('Home delivery')}${r.del.placed ? table([['Orders', `${r.del.n} orders`, f(r.del.sales)], ['Food sales', '', f(r.del.food)], ['Delivery fees', '', f(r.del.fees)], ['Average ticket', '', f(r.del.avg)], ['Average distance', '', `${r.del.avgKm.toFixed(1)} km`], [`Free zone, up to ${LH.FREE_KM} km`, `${r.del.bands.free.n} orders`, f(r.del.bands.free.sales)], [`${LH.FREE_KM} to ${LH.MID_KM} km`, `${r.del.bands.mid.n} orders`, f(r.del.bands.mid.fees)], [`${LH.MID_KM} to ${LH.DELIVERY_KM} km`, `${r.del.bands.far.n} orders`, f(r.del.bands.far.fees)], ['Delivered', `${r.del.completed} of ${r.del.n}`, ''], ['UPI / cash on delivery', `${r.del.upi} / ${r.del.cod}`, ''], ['Rejected', `${r.del.rejected}`, '']], ['l', 'r', 'r']) + `<p style="margin:6px 0 0;font-size:11px;color:#6b7280">Fee rows show delivery fees collected; the free zone row shows order value.</p>` : '<p style="margin:0;font-size:13px;color:#6b7280">No home deliveries</p>'}
${h('Top sellers')}${table(r.top.map(([n, q, v]) => [n, `${q}x`, f(v)]), ['l', 'r', 'r'])}
${h('Revenue by category')}${table(r.cats.map(([n, v]) => [n, f(v)]), ['l', 'r'])}
${h('Orders by hour (IST)')}${hourRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${hourRows}</table>${r.peak >= 0 ? `<p style="margin:6px 0 0;font-size:12px;color:#6b7280">Busiest hour: ${pad(r.peak)}:00</p>` : ''}` : '<p style="margin:0;font-size:13px;color:#6b7280">No orders</p>'}
${h('Customers')}<p style="margin:0;font-size:13px">${r.customers} customers, ${r.repeat} ordered more than once today.</p>
${r.reasons.length ? `${h('Rejections')}${table(r.reasons.map(([k, n]) => [k, n]), ['l', 'r'])}` : ''}
${r.open.length ? `${h('Not finished at close')}${table(r.open.map((x) => [x.o.id, x.o.n, x.s, f(x.o.total)]), ['l', 'l', 'l', 'r'])}` : ''}
<p style="margin:20px 0 0;font-size:12px;color:#6b7280">The full list of orders is attached as a CSV file.</p>`;

  const subject = `Daily report ${day} - ${f(r.sales)} from ${r.validCount} orders`;
  const text = `${SHOP} daily report, ${prettyDay(day)}\nSales ${f(r.sales)} from ${r.validCount} orders${delta}\nAverage ticket ${f(r.avg)}\nCompleted ${r.completed} of ${r.placed}, rejected ${r.rejected}\nUPI verified ${f(r.upiPaid)}, UPI to verify ${r.upiUnverified.length}, counter ${f(r.counterAmt)}\nHome delivery ${r.del.n} orders, ${f(r.del.sales)} (fees ${f(r.del.fees)})\nTop: ${r.top.slice(0, 3).map(([n, q]) => `${n} x${q}`).join(', ') || 'none'}\nFull list attached.`;
  return { subject, html: shell(LH, `Daily report - ${prettyDay(day)}`, inner), text, attachments: [{ filename: `lauralshaven-${day}.csv`, content: `\ufeff${reportCsv(LH, rows)}`, contentType: 'text/csv; charset=utf-8' }], stats: r };
}

async function dailyReport({ store, send, LH, to, day, log = console.log }) {
  const { start, end } = dayBounds(day);
  const load = async (a, b) => {
    const raw = await store.ordersBetween(a, b);
    const rows = [];
    for (const x of raw) {
      const o = toOrder(LH, x.id, x.data, x.ts);
      if (!o) continue;
      const st = (await store.status(o.id)) || {};
      rows.push({ o, s: LH.STATUS[st.s] ? st.s : 'pending', v: !!st.v, r: st.r || '' });
    }
    return rows;
  };
  const rows = await load(start, end);
  const prevRows = await load(start - 86400000, start);
  const prev = buildReport(LH, prevRows);
  const msg = reportEmail(LH, day, rows, prev);
  await send({ to, ...msg });
  log(`report sent for ${day}: ${rows.length} orders`);
  return msg.stats;
}

module.exports = { loadCore, toOrder, confirmEmail, outEmail, readyEmail, doneEmail, rejectEmail, sweep, targetDay, dayBounds, buildReport, reportEmail, dailyReport, istDate, SHOP };
