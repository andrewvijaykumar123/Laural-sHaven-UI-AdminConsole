/* Laural's Haven order emails: layout, wording and the "which email is due" rules.
   Runs in the admin console (instant sending) and in Node (mailer/lib.js, the scheduled fallback), so both always agree. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LHMail = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHOP = "Laural's Haven";
  const BRAND = '#b45309';
  const IST_MS = 330 * 60000;

  function shell(LH, title, inner, preheader) {
    return `<!doctype html><html><body style="margin:0;background:#f6f1ea;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${LH.esc(preheader)}</div>` : ''}
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
  const placedAt = (o) => new Date(o.ts + IST_MS).toISOString().slice(0, 16).replace('T', ' ');

  /* Sent the moment the order reaches the kitchen. */
  function receivedEmail(LH, o) {
    const subject = `We received your order ${o.id} - ${SHOP}`;
    const next = o.pay === 'upi' ? 'Please complete the UPI payment if you have not already; we confirm it before the order is served.' : 'We will confirm it in a moment.';
    const html = shell(LH, 'Order received', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, thank you! We have received your order <b>${LH.esc(o.id)}</b>.</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(where(o))}<br>${LH.esc(payLine(o, false))}<br>Placed ${LH.esc(placedAt(o))} IST</p>
${o.nt ? `<p style="margin:12px 0 0;font-size:13px;color:#4b5563">Your note: ${LH.esc(o.nt)}</p>` : ''}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(next)} You can follow its progress on our website, on the device you ordered from.</p>`, `We received your order ${o.id}.`);
    const text = `Hi ${o.n}, thank you! We have received your order ${o.id}.\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\n${where(o)}\n${payLine(o, false)}\n\n${next}\n- ${SHOP}`;
    return { subject, html, text };
  }

  function confirmEmail(LH, o, ctx = {}) {
    const prep = Number(ctx.prep) > 0 ? ` It should be ready in about ${Number(ctx.prep)} minutes.` : '';
    const subject = `Order ${o.id} confirmed - ${SHOP}`;
    const html = shell(LH, 'Order confirmed and bill', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is confirmed.${LH.esc(prep)}</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(where(o))}<br>${LH.esc(payLine(o, ctx.paid))}<br>Placed ${LH.esc(placedAt(o))} IST</p>
${o.nt ? `<p style="margin:12px 0 0;font-size:13px;color:#4b5563">Your note: ${LH.esc(o.nt)}</p>` : ''}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${o.svc === 'deliver' ? 'We will email you when it is on the way. You can also follow the rider live on our website.' : 'We will email you again when it is ready.'}</p>`, `Order ${o.id} is confirmed.`);
    const text = `Hi ${o.n}, your order ${o.id} is confirmed.${prep}\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\n${where(o)}\n${payLine(o, ctx.paid)}\n\n${o.svc === 'deliver' ? 'We will email you when it is on the way.' : 'We will email you again when it is ready.'}\n- ${SHOP}`;
    return { subject, html, text };
  }

  function outEmail(LH, o) {
    const subject = `Order ${o.id} is on the way - ${SHOP}`;
    const html = shell(LH, 'Out for delivery', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is out for delivery to ${LH.esc(o.addr)}.</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(payLine(o, false))}. Open our website on the device you ordered from to follow the rider live on the map.</p>`, `Order ${o.id} is on the way.`);
    const text = `Hi ${o.n}, your order ${o.id} is out for delivery to ${o.addr}.\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n${payLine(o, false)}\n\nOpen our website on the device you ordered from to follow the rider live.\n- ${SHOP}`;
    return { subject, html, text };
  }

  function readyEmail(LH, o) {
    const how = o.svc === 'take' ? 'Please collect it at the counter.' : `We will bring it to ${o.tbl ? `table ${o.tbl}` : 'your table'}.`;
    const subject = `Order ${o.id} is ready - ${SHOP}`;
    const html = shell(LH, 'Your order is ready', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is ready. ${LH.esc(how)}</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">Thank you for choosing ${LH.esc(SHOP)}.</p>`, `Order ${o.id} is ready.`);
    const text = `Hi ${o.n}, your order ${o.id} is ready. ${how}\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\nThank you for choosing ${SHOP}.`;
    return { subject, html, text };
  }

  function doneEmail(LH, o) {
    const del = o.svc === 'deliver';
    const subject = `Order ${o.id} is ${del ? 'delivered' : 'complete'} - ${SHOP}`;
    const html = shell(LH, del ? 'Your order was delivered' : 'Your order is complete', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is ${del ? 'delivered' : 'complete'}. We hope you enjoyed it.</p>
${itemsTable(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">Thank you for choosing ${LH.esc(SHOP)}. We look forward to seeing you again.</p>`, `Order ${o.id} is ${del ? 'delivered' : 'complete'}.`);
    const text = `Hi ${o.n}, your order ${o.id} is ${del ? 'delivered' : 'complete'}. We hope you enjoyed it.\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\nThank you for choosing ${SHOP}.`;
    return { subject, html, text };
  }

  function rejectEmail(LH, o, reason) {
    const why = reason ? ` Reason: ${reason}.` : '';
    const subject = `Order ${o.id} could not be accepted - ${SHOP}`;
    const html = shell(LH, 'Order update', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, we are sorry, we could not accept your order <b>${LH.esc(o.id)}</b>.${LH.esc(why)}</p>
<p style="margin:0;font-size:13px;color:#4b5563">If you have paid, please speak to our staff and we will make it right. You are welcome to order again.</p>`, `We could not accept order ${o.id}.`);
    const text = `Hi ${o.n}, we are sorry, we could not accept your order ${o.id}.${why}\nIf you have paid, please speak to our staff. You are welcome to order again.\n- ${SHOP}`;
    return { subject, html, text };
  }

  /* Which emails are due for an order in status st = { s, r, v }, given the markers already stored in mail
     (p received, c confirmed, o out, r ready/complete, x rejected; -1 = skipped). Returns [[key, message], ...] in sending order. */
  function plan(LH, o, st, mail, ctx = {}) {
    const s = LH.STATUS[st.s] ? st.s : 'pending';
    const jobs = [];
    if (!o.em) return jobs;
    if (s === 'rejected') {
      if (!mail.x) jobs.push(['x', rejectEmail(LH, o, st.r)]);
      return jobs;
    }
    if (!mail.p && s === 'pending') jobs.push(['p', receivedEmail(LH, o)]);
    if (!mail.c && s !== 'pending') jobs.push(['c', confirmEmail(LH, o, { prep: ctx.prep, paid: !!st.v })]);
    const del = o.svc === 'deliver';
    const needR = !mail.r || mail.r === -1;
    if (del && !mail.o && s === 'out') jobs.push(['o', outEmail(LH, o)]);
    if (needR && s === 'ready' && !del) jobs.push(['r', readyEmail(LH, o)]);
    if (needR && s === 'completed') jobs.push(['r', doneEmail(LH, o)]);
    return jobs;
  }

  return { SHOP, BRAND, IST_MS, shell, itemsTable, receivedEmail, confirmEmail, outEmail, readyEmail, doneEmail, rejectEmail, plan };
});
