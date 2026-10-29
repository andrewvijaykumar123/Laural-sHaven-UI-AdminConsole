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
  /* Printed on every invoice. There is no GST on the bill today; change TAX_NOTE if that changes. */
  const CAFE = { name: "Laural's Haven Cafe", phone: '9962419353', map: 'https://maps.app.goo.gl/XeqJJUZKzVbcAqjM8', mapLabel: 'maps.app.goo.gl/XeqJJUZKzVbcAqjM8' };
  const TAX_NOTE = 'Not applicable';

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

  /* The 4-digit code a delivery customer gives the delivery partner; the admin console closes the order when it matches. */
  function otpHtml(LH, o) {
    if (o.svc !== 'deliver' || !LH.validOtp(o.otp)) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0"><tr><td align="center" style="background:#fff7ed;border:1px dashed ${BRAND};border-radius:10px;padding:14px"><div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Your delivery code</div><div style="font-size:34px;font-weight:800;letter-spacing:.3em;color:${BRAND};padding-left:.3em">${LH.esc(o.otp)}</div><div style="font-size:12px;color:#4b5563">Give this code to the delivery partner only when you receive your order. It is also shown in your order on our website.</div></td></tr></table>`;
  }
  const otpText = (LH, o) => (o.svc === 'deliver' && LH.validOtp(o.otp) ? `Your delivery code: ${o.otp}\nGive it to the delivery partner only when you receive your order.\n\n` : '');

  const where = (o) => (o.svc === 'take' ? 'Takeaway' : o.svc === 'deliver' ? `Delivery to ${o.addr}` : `Dine-in${o.tbl ? `, table ${o.tbl}` : ''}`);
  const payLine = (o, paid) => (o.pay === 'upi' ? (paid ? 'Paid by UPI' : 'UPI (we confirm payment at the counter)') : o.svc === 'deliver' ? 'Cash on delivery' : 'Pay at the counter');
  const textItems = (LH, o) => [...o.it.map(([id, q]) => `${q} x ${LH.ITEMS.get(id).name}  ${LH.fmt(LH.ITEMS.get(id).price * q)}`), ...(o.svc === 'deliver' ? [`Delivery  ${o.fee ? LH.fmt(o.fee) : 'Free'}`] : [])].join('\n');
  const placedAt = (o) => new Date(o.ts + IST_MS).toISOString().slice(0, 16).replace('T', ' ');

  /* ---- Invoice (no GST). One layout for the printed bill and the emailed copy; inline styles only so it survives mail clients. ---- */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  const three = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', n % 100 ? two(n % 100) : ''].filter(Boolean).join(' ');
  function rupeesInWords(n) {
    n = Math.round(Number(n)) || 0;
    if (n <= 0) return 'Zero Rupees Only';
    const parts = [[Math.floor(n / 1e7), 'Crore'], [Math.floor(n / 1e5) % 100, 'Lakh'], [Math.floor(n / 1e3) % 100, 'Thousand']]
      .filter(([v]) => v).map(([v, u]) => `${three(v)} ${u}`);
    if (n % 1000) parts.push(three(n % 1000));
    return `${parts.join(' ')} Rupees Only`;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function invoiceDate(ts) {
    const d = new Date(ts + IST_MS);
    const h = d.getUTCHours();
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(h % 12 || 12).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} IST`;
  }
  const payMethod = (o) => (o.pay === 'upi' ? 'UPI' : o.svc === 'deliver' ? 'Cash on delivery' : 'Cash at counter');

  /* ctx.paid: the bill is settled. */
  function invoiceHtml(LH, o, ctx = {}) {
    const e = LH.esc; const f = (n) => e(LH.fmt(n));
    const del = o.svc === 'deliver';
    const fee = del ? (o.fee || 0) : 0;
    const th = 'padding:8px 6px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #1f2937';
    const td = 'padding:9px 6px;border-bottom:1px solid #e5e7eb;font-size:13px';
    const rows = o.it.map(([id, q], i) => {
      const it = LH.ITEMS.get(id);
      return `<tr><td style="${td};color:#6b7280">${i + 1}</td><td style="${td}">${e(it.name)}</td><td align="center" style="${td}">${q}</td><td align="right" style="${td}">${f(it.price)}</td><td align="right" style="${td}">${f(it.price * q)}</td></tr>`;
    }).join('');
    const sum = (label, val, strong) => `<tr><td style="padding:5px 6px;font-size:${strong ? 15 : 13}px;${strong ? 'font-weight:700;border-top:2px solid #1f2937;' : 'color:#4b5563;'}">${label}</td><td align="right" style="padding:5px 6px;font-size:${strong ? 15 : 13}px;${strong ? 'font-weight:700;border-top:2px solid #1f2937;' : ''}">${val}</td></tr>`;
    const serve = o.svc === 'take' ? 'Takeaway' : del ? 'Home delivery' : `Dine-in${o.tbl ? `, table ${o.tbl}` : ''}`;
    const status = ctx.paid ? ['PAID', '#15803d'] : o.pay === 'upi' ? ['UPI PAYMENT PENDING', '#b45309'] : ['PAYMENT DUE', '#b45309'];
    const lbl = 'font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#6b7280;padding-bottom:3px';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;border-collapse:collapse">
<tr><td style="padding:0 0 14px;border-bottom:3px solid ${BRAND}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top"><div style="font-size:22px;font-weight:800;color:${BRAND}">${e(CAFE.name)}</div>
<div style="font-size:12px;color:#4b5563;line-height:1.6;margin-top:4px">Phone: ${e(CAFE.phone)}<br>Google Maps: <a href="${e(CAFE.map)}" style="color:#4b5563">${e(CAFE.mapLabel)}</a></div></td>
<td valign="top" align="right"><div style="font-size:24px;font-weight:800;letter-spacing:.08em;color:#1f2937">INVOICE</div>
<div style="display:inline-block;margin-top:6px;padding:3px 10px;border:1.5px solid ${status[1]};border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.06em;color:${status[1]}">${status[0]}</div></td></tr></table></td></tr>
<tr><td style="padding:14px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top" width="50%" style="font-size:13px;line-height:1.55"><div style="${lbl}">Billed to</div><b>${e(o.n)}</b><br>${e(o.p)}${o.em ? `<br>${e(o.em)}` : ''}${del ? `<br>${e(o.addr)}` : ''}</td>
<td valign="top" width="50%" align="right" style="font-size:13px;line-height:1.55"><div style="${lbl}">Invoice details</div>Invoice no: <b>${e(o.id)}</b><br>Date: ${e(invoiceDate(o.ts))}<br>Service: ${e(serve)}<br>Payment: ${e(payMethod(o))}</td></tr></table></td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><th align="left" style="${th}">#</th><th align="left" style="${th}">Item</th><th align="center" style="${th}">Qty</th><th align="right" style="${th}">Rate</th><th align="right" style="${th}">Amount</th></tr>${rows}</table></td></tr>
<tr><td align="right" style="padding-top:10px"><table role="presentation" cellpadding="0" cellspacing="0" style="min-width:240px;border-collapse:collapse">${sum('Subtotal', f(o.total - fee))}${del ? sum('Delivery charge', o.fee ? f(o.fee) : 'Free') : ''}${sum('GST', e(TAX_NOTE))}${sum('Total', f(o.total), true)}</table></td></tr>
<tr><td style="padding-top:10px;font-size:12px;color:#4b5563"><b>Amount in words:</b> ${e(rupeesInWords(o.total))}${o.nt ? `<br><b>Note:</b> ${e(o.nt)}` : ''}</td></tr>
<tr><td style="padding-top:18px;border-top:1px solid #e5e7eb;margin-top:14px;font-size:12px;color:#6b7280;text-align:center;line-height:1.6"><div style="padding-top:12px"><b style="color:#1f2937">Thank you for dining with ${e(CAFE.name)}. We look forward to serving you again.</b><br>This is a computer-generated invoice and does not need a signature.<br>${e(CAFE.phone)} &middot; <a href="${e(CAFE.map)}" style="color:#6b7280">${e(CAFE.mapLabel)}</a></div></td></tr></table>`;
  }

  function invoiceText(LH, o, ctx = {}) {
    const del = o.svc === 'deliver';
    const fee = del ? (o.fee || 0) : 0;
    const lines = o.it.map(([id, q], i) => `${i + 1}. ${LH.ITEMS.get(id).name}  ${q} x ${LH.fmt(LH.ITEMS.get(id).price)} = ${LH.fmt(LH.ITEMS.get(id).price * q)}`);
    return [`INVOICE - ${CAFE.name}`, `Phone: ${CAFE.phone}`, `Google Maps: ${CAFE.map}`, '',
      `Invoice no: ${o.id}`, `Date: ${invoiceDate(o.ts)}`, `Billed to: ${o.n}, ${o.p}`, del ? `Delivery address: ${o.addr}` : where(o), `Payment: ${payMethod(o)} (${ctx.paid ? 'paid' : 'payment due'})`, '',
      ...lines, '', `Subtotal  ${LH.fmt(o.total - fee)}`, ...(del ? [`Delivery charge  ${o.fee ? LH.fmt(o.fee) : 'Free'}`] : []), `GST: ${TAX_NOTE}`, `TOTAL  ${LH.fmt(o.total)}`, rupeesInWords(o.total), ''].join('\n');
  }

  /* Sent the moment the order reaches the kitchen. */
  function receivedEmail(LH, o) {
    const subject = `We received your order ${o.id} - ${SHOP}`;
    const next = o.pay === 'upi' ? 'Please complete the UPI payment if you have not already; we confirm it before the order is served.' : 'We will confirm it in a moment.';
    const html = shell(LH, 'Order received', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, thank you! We have received your order <b>${LH.esc(o.id)}</b>.</p>
${itemsTable(LH, o)}${otpHtml(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(where(o))}<br>${LH.esc(payLine(o, false))}<br>Placed ${LH.esc(placedAt(o))} IST</p>
${o.nt ? `<p style="margin:12px 0 0;font-size:13px;color:#4b5563">Your note: ${LH.esc(o.nt)}</p>` : ''}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(next)} You can follow its progress on our website, on the device you ordered from.</p>`, `We received your order ${o.id}.`);
    const text = `Hi ${o.n}, thank you! We have received your order ${o.id}.\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\n${where(o)}\n${payLine(o, false)}\n\n${next}\n\n${otpText(LH, o)}- ${SHOP}`;
    return { subject, html, text };
  }

  function confirmEmail(LH, o, ctx = {}) {
    const prep = Number(ctx.prep) > 0 ? ` It should be ready in about ${Number(ctx.prep)} minutes.` : '';
    const subject = `Order ${o.id} confirmed - ${SHOP}`;
    const html = shell(LH, 'Order confirmed and bill', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is confirmed.${LH.esc(prep)}</p>
${itemsTable(LH, o)}${otpHtml(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(where(o))}<br>${LH.esc(payLine(o, ctx.paid))}<br>Placed ${LH.esc(placedAt(o))} IST</p>
${o.nt ? `<p style="margin:12px 0 0;font-size:13px;color:#4b5563">Your note: ${LH.esc(o.nt)}</p>` : ''}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${o.svc === 'deliver' ? 'We will email you when it is on the way. You can also follow the rider live on our website.' : 'We will email you again when it is ready.'}</p>`, `Order ${o.id} is confirmed.`);
    const text = `Hi ${o.n}, your order ${o.id} is confirmed.${prep}\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n\n${where(o)}\n${payLine(o, ctx.paid)}\n\n${o.svc === 'deliver' ? 'We will email you when it is on the way.' : 'We will email you again when it is ready.'}\n\n${otpText(LH, o)}- ${SHOP}`;
    return { subject, html, text };
  }

  function outEmail(LH, o) {
    const subject = `Order ${o.id} is on the way - ${SHOP}`;
    const html = shell(LH, 'Out for delivery', `<p style="margin:0 0 12px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is out for delivery to ${LH.esc(o.addr)}.</p>
${itemsTable(LH, o)}${otpHtml(LH, o)}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563">${LH.esc(payLine(o, false))}. Open our website on the device you ordered from to follow the rider live on the map.</p>`, `Order ${o.id} is on the way.`);
    const text = `Hi ${o.n}, your order ${o.id} is out for delivery to ${o.addr}.\n\n${textItems(LH, o)}\nTotal ${LH.fmt(o.total)}\n${payLine(o, false)}\n\nOpen our website on the device you ordered from to follow the rider live.\n\n${otpText(LH, o)}- ${SHOP}`;
    return { subject, html, text };
  }

  function readyEmail(LH, o, ctx = {}) {
    const how = o.svc === 'take' ? 'Please collect it at the counter.' : `We will bring it to ${o.tbl ? `table ${o.tbl}` : 'your table'}.`;
    const subject = `Order ${o.id} is ready - ${SHOP}`;
    const html = shell(LH, 'Your order is ready', `<p style="margin:0 0 18px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is ready. ${LH.esc(how)} Your invoice is below.</p>
${invoiceHtml(LH, o, { paid: !!ctx.paid })}`, `Order ${o.id} is ready. Invoice enclosed.`);
    const text = `Hi ${o.n}, your order ${o.id} is ready. ${how}\n\n${invoiceText(LH, o, { paid: !!ctx.paid })}\nThank you for choosing ${SHOP}.`;
    return { subject, html, text };
  }

  function doneEmail(LH, o) {
    const del = o.svc === 'deliver';
    const subject = `Order ${o.id} is ${del ? 'delivered' : 'complete'} - ${SHOP}`;
    const html = shell(LH, del ? 'Your order was delivered' : 'Your order is complete', `<p style="margin:0 0 18px;font-size:16px">Hi ${LH.esc(o.n)}, your order <b>${LH.esc(o.id)}</b> is ${del ? 'delivered' : 'complete'}. We hope you enjoyed it. Your invoice is below.</p>
${invoiceHtml(LH, o, { paid: true })}`, `Order ${o.id} is ${del ? 'delivered' : 'complete'}. Invoice enclosed.`);
    const text = `Hi ${o.n}, your order ${o.id} is ${del ? 'delivered' : 'complete'}. We hope you enjoyed it.\n\n${invoiceText(LH, o, { paid: true })}\nThank you for choosing ${SHOP}.`;
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
    if (needR && s === 'ready' && !del) jobs.push(['r', readyEmail(LH, o, { paid: !!st.v })]);
    if (needR && s === 'completed') jobs.push(['r', doneEmail(LH, o)]);
    return jobs;
  }

  return { SHOP, BRAND, CAFE, IST_MS, shell, itemsTable, invoiceHtml, invoiceText, rupeesInWords, receivedEmail, confirmEmail, outEmail, readyEmail, doneEmail, rejectEmail, plan };
});
