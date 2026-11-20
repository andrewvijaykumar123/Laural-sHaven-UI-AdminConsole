'use strict';
/* Offline test of the Worker's SMTP client against a fake SMTP server. Run: node worker/test.js */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { Readable, Writable } = require('stream');
const { pathToFileURL } = require('url');

function fakeServer(script) {
  const log = { cmds: [], data: '' };
  const server = net.createServer((sock) => {
    let inData = false, buf = '';
    sock.write('220 smtp.test ESMTP ready\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          log.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          sock.write(script.dataReply || '250 2.0.0 OK queued\r\n');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        log.cmds.push(line);
        if (/^EHLO/.test(line)) sock.write('250-smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (/^AUTH PLAIN/.test(line)) sock.write(script.auth || '235 2.7.0 Accepted\r\n');
        else if (/^MAIL FROM/.test(line)) sock.write('250 OK\r\n');
        else if (/^RCPT TO/.test(line)) sock.write(script.rcpt || '250 OK\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go ahead\r\n'); }
        else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, log })));
}

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'relay.js'), 'utf8')
    .replace(/^import .*cloudflare:sockets.*$/m, 'const connect = () => { throw new Error("no sockets in tests"); };')
    .replace('export default worker;', 'export { worker, smtpSend, handleSend, buildMessage, encryptPayload };');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lhworker-')), 'relay.mjs');
  fs.writeFileSync(tmp, src);
  const { worker, smtpSend, handleSend, encryptPayload } = await import(pathToFileURL(tmp).href);

  const opener = (port) => () => {
    const s = net.connect(port, '127.0.0.1');
    return { readable: Readable.toWeb(s), writable: Writable.toWeb(s), close: async () => { s.destroy(); } };
  };
  const decodeBody = (data, type) => {
    const part = data.split(/--lh_[^\r\n]+/).find((p) => p.includes(`Content-Type: ${type}`));
    return Buffer.from(part.split('\r\n\r\n')[1].replace(/\s+/g, ''), 'base64').toString('utf8');
  };

  // happy path, with non-ASCII text and a subject that needs encoding
  let srv = await fakeServer({});
  const html = `<p>Total ₹119</p>\r\n${'x'.repeat(300)}\r\n.dot line`;
  await smtpSend({ open: opener(srv.port), user: 'cafe@example.com', pass: 'secret pass', to: 'anita@example.com', subject: 'Order LH-AAAAAA confirmed - ₹119', text: 'Hi Anita ₹119', html });
  assert.deepStrictEqual(srv.log.cmds.slice(0, 5).map((c) => c.split(' ')[0]), ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA']);
  assert.strictEqual(srv.log.cmds[1], `AUTH PLAIN ${Buffer.from('\0cafe@example.com\0secret pass').toString('base64')}`);
  assert.strictEqual(srv.log.cmds[2], 'MAIL FROM:<cafe@example.com>');
  assert.strictEqual(srv.log.cmds[3], 'RCPT TO:<anita@example.com>');
  assert.match(srv.log.data, /^From: "?Laural's Haven"? <cafe@example\.com>/m);
  assert.match(srv.log.data, /^To: <anita@example\.com>/m);
  assert.match(srv.log.data, /^Subject: =\?UTF-8\?B\?/m);
  assert.strictEqual(decodeBody(srv.log.data, 'text/html'), html);
  assert.strictEqual(decodeBody(srv.log.data, 'text/plain'), 'Hi Anita ₹119');
  assert.ok(srv.log.data.split('\r\n').every((l) => l.length <= 998), 'line length limit');
  srv.server.close();

  // wrong password: clear error, no secrets leaked
  srv = await fakeServer({ auth: '535-5.7.8 Username and Password not accepted\r\n535 5.7.8 Learn more\r\n' });
  await assert.rejects(smtpSend({ open: opener(srv.port), user: 'cafe@example.com', pass: 'SUPERSECRET', to: 'a@b.co', subject: 's', text: 't', html: 'h' }), (e) => /AUTH failed: 535/.test(e.message) && !e.message.includes('SUPERSECRET'));
  srv.server.close();

  // rejected recipient
  srv = await fakeServer({ rcpt: '550 5.1.1 no such user\r\n' });
  await assert.rejects(smtpSend({ open: opener(srv.port), user: 'cafe@example.com', pass: 'p', to: 'a@b.co', subject: 's', text: 't', html: 'h' }), /RCPT failed: 550/);
  srv.server.close();

  // silent server times out instead of hanging
  const silent = net.createServer(() => {});
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  await assert.rejects(smtpSend({ open: opener(silent.address().port), user: 'u', pass: 'p', to: 'a@b.co', subject: 's', text: 't', html: 'h', timeoutMs: 200 }), /timed out/);
  silent.close();

  // request validation
  const env = { GMAIL_APP_PASSWORD: 'x y z' };
  assert.deepStrictEqual((await handleSend({}, {}, () => {}))[0], 501);
  assert.strictEqual((await handleSend({ to: 'bad', subject: 's', text: 't', html: 'h' }, env, () => {}))[0], 400);
  assert.strictEqual((await handleSend({ to: 'a@b.co\r\nBcc: x@y.zz', subject: 's', text: 't', html: 'h' }, env, () => {}))[0], 400);
  assert.strictEqual((await handleSend({ to: 'a@b.co', subject: '', text: 't', html: 'h' }, env, () => {}))[0], 400);
  srv = await fakeServer({});
  const ok = await handleSend({ to: 'A@B.co', subject: 'Hello\r\nBcc: evil@x.com', text: 't', html: 'h' }, env, opener(srv.port));
  assert.strictEqual(ok[0], 204);
  assert.ok(!/^Bcc:/mi.test(srv.log.data), 'header injection is neutralised');
  assert.strictEqual(srv.log.cmds[1], `AUTH PLAIN ${Buffer.from('\0andrewvijaykumar123@gmail.com\0xyz').toString('base64')}`, 'spaces in the app password are removed');
  srv.server.close();

  // one address cannot be mailed more than a handful of times per window
  srv = await fakeServer({});
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await handleSend({ to: 'victim@example.com', subject: 's', text: 't', html: 'h' }, env, opener(srv.port)))[0]);
  assert.strictEqual(codes.filter((c) => c === 204).length, 8);
  assert.strictEqual(codes[9], 429);
  srv.server.close();

  // HTTP layer: no token, preflight
  const res = await worker.fetch(new Request('https://relay.test/send', { method: 'POST', body: '{}' }), env);
  assert.strictEqual(res.status, 401);
  assert.strictEqual((await worker.fetch(new Request('https://relay.test/send', { method: 'OPTIONS' }), env)).status, 204);
  assert.strictEqual((await worker.fetch(new Request('https://relay.test/send'), env)).status, 405);

  await pushTests({ worker, encryptPayload });

  console.log('worker tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

/* ---------- Web Push ---------- */
async function pushTests({ worker, encryptPayload }) {
  const nodeCrypto = require('crypto');
  const subtle = globalThis.crypto.subtle;
  const u8 = (b64u) => new Uint8Array(Buffer.from(b64u, 'base64url'));
  const b64u = (bytes) => Buffer.from(bytes).toString('base64url');

  // RFC 8291 section 5: the published example must come out byte for byte.
  {
    const asPub = u8('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u(asPub.slice(1, 33)), y: b64u(asPub.slice(33)) };
    const eph = {
      privateKey: await subtle.importKey('jwk', { ...jwk, d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' }, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
      publicKey: await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
    };
    const body = await encryptPayload(
      { keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } },
      new TextEncoder().encode('When I grow up, I want to be a watermelon'), { eph, salt: u8('DGv6ra1nlYgDCS1FRnbzlw') }
    );
    assert.strictEqual(b64u(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  }

  // A browser's side of Web Push, written independently with Node's crypto, to read what the Worker sends.
  const makeDevice = (host = 'fcm.googleapis.com') => {
    const ecdh = nodeCrypto.createECDH('prime256v1');
    const pub = ecdh.generateKeys();
    const auth = nodeCrypto.randomBytes(16);
    const dev = { ecdh, pub, auth, sub: { endpoint: `https://${host}/fcm/send/${nodeCrypto.randomBytes(6).toString('hex')}`, keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
    dev.read = (req) => {
      const body = Buffer.from(req.body);
      const salt = body.subarray(0, 16);
      const idlen = body[20];
      const asPub = body.subarray(21, 21 + idlen);
      const secret = ecdh.computeSecret(asPub);
      const prk = Buffer.from(nodeCrypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), pub, asPub]), 32));
      const cek = Buffer.from(nodeCrypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(nodeCrypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const ct = body.subarray(21 + idlen);
      const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      assert.strictEqual(plain[plain.length - 1], 2, 'padding delimiter');
      return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
    };
    return dev;
  };

  // Fake Firebase tokens, Firestore, push services and KV.
  const rsa = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const rsaJwk = { ...(await subtle.exportKey('jwk', rsa.publicKey)), kid: 'k1' };
  const token = async (sub, provider = 'anonymous') => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })));
    const claims = b64u(Buffer.from(JSON.stringify({ aud: 'laural-shavencafe', iss: 'https://securetoken.google.com/laural-shavencafe', sub, iat: now - 5, exp: now + 3600, firebase: { sign_in_provider: provider } })));
    const sig = await subtle.sign('RSASSA-PKCS1-v1_5', rsa.privateKey, new TextEncoder().encode(`${head}.${claims}`));
    return `${head}.${claims}.${b64u(new Uint8Array(sig))}`;
  };
  const ADMIN = '4FSqW048fSdUFMQZJ1OJVp7GLob2';
  const adminTok = await token(ADMIN, 'password');
  const cust1 = await token('cust-1');
  const cust2 = await token('cust-2');

  const vapid = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const kv = new Map();
  const KV = {
    async get(k, type) { const v = kv.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); },
    async list({ prefix, limit }) { return { keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })) }; }
  };
  const env = { PUSH: KV, VAPID_PRIVATE_JWK: JSON.stringify(await subtle.exportKey('jwk', vapid.privateKey)) };

  const docs = {
    'orders/LH-AAAAAA': { owner: 'cust-1', age: 5000, fields: { total: { integerValue: '197' }, svc: { stringValue: 'take' }, n: { stringValue: 'Anita' } } },
    'orders/LH-OLDOLD': { owner: 'cust-1', age: 3600000, fields: { total: { integerValue: '50' }, svc: { stringValue: 'dine' } } },
    'events/EV-AAAAAA': { owner: 'cust-1', age: 5000, fields: { g: { integerValue: '20' }, d: { stringValue: '2026-12-01' } } },
    'status/LH-CANCEL1': { owner: null, age: 5000, fields: { s: { stringValue: 'rejected' }, r: { stringValue: 'Cancelled by customer' } } }
  };
  const pushed = [];
  const gone = new Set();
  const subOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://www.googleapis.com/service_accounts')) return Response.json({ keys: [rsaJwk] });
    const m = /\/documents\/(.+)$/.exec(u);
    if (u.startsWith('https://firestore.googleapis.com/') && m) {
      const d = docs[m[1]];
      const uid = subOf(String(init.headers.Authorization).replace('Bearer ', ''));
      const own = d && (d.owner === null || d.owner === uid || uid === ADMIN);
      if (!own) return new Response('{}', { status: 403 });
      const t = new Date(Date.now() - d.age).toISOString();
      return Response.json({ name: m[1], fields: d.fields, createTime: t, updateTime: t });
    }
    pushed.push({ url: u, headers: init.headers, body: init.body });
    return new Response(null, { status: gone.has(u) ? 410 : 201 });
  };

  const call = async (p, tok, body, e = env) => worker.fetch(new Request(`https://relay.test${p}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), e);
  const adminDev = makeDevice();
  const custDev = makeDevice('updates.push.services.mozilla.com');

  assert.strictEqual((await call('/push/sub', adminTok, { role: 'admin', sub: adminDev.sub }, {})).status, 501, 'not configured');
  assert.strictEqual((await call('/push/sub', cust1, { role: 'admin', sub: adminDev.sub })).status, 401, 'a customer cannot register as the admin');
  assert.strictEqual((await call('/push/sub', adminTok, { role: 'admin', sub: { ...adminDev.sub, endpoint: 'https://evil.example.com/x' } })).status, 400, 'unknown push host');
  assert.strictEqual((await call('/push/sub', adminTok, { role: 'admin', sub: { ...adminDev.sub, endpoint: adminDev.sub.endpoint.replace('https', 'http') } })).status, 400, 'plain http');
  assert.strictEqual((await call('/push/sub', adminTok, { role: 'admin', sub: { ...adminDev.sub, keys: { p256dh: 'AAAA', auth: 'AAAA' } } })).status, 400, 'bad keys');
  assert.strictEqual((await call('/push/sub', adminTok, { role: 'admin', sub: adminDev.sub })).status, 204);
  assert.strictEqual([...kv.keys()].filter((k) => k.startsWith('a:')).length, 1);

  assert.strictEqual((await call('/push/sub', cust1, { role: 'shop', id: 'LH-AAAAAA', sub: custDev.sub })).status, 204);
  assert.strictEqual((await call('/push/sub', cust2, { role: 'shop', id: 'LH-AAAAAA', sub: custDev.sub })).status, 403, 'only the owner of an order can follow it');
  assert.strictEqual((await call('/push/sub', cust1, { role: 'shop', id: 'nope', sub: custDev.sub })).status, 400);

  // a new order alerts the admin device, once
  assert.strictEqual((await call('/push/notify', cust1, { k: 'order', id: 'LH-AAAAAA' })).status, 204);
  assert.strictEqual(pushed.length, 1);
  assert.strictEqual(pushed[0].url, adminDev.sub.endpoint);
  assert.strictEqual(pushed[0].headers['Content-Encoding'], 'aes128gcm');
  assert.strictEqual(pushed[0].headers.Urgency, 'high');
  const note = adminDev.read(pushed[0]);
  assert.deepStrictEqual(note, { t: 'New order', b: 'LH-AAAAAA \u00b7 \u20b9197 \u00b7 Takeaway', g: 'order-LH-AAAAAA', h: '#orders' });
  assert.ok(!JSON.stringify(note).includes('Anita'), 'no customer name in the notification');
  // the VAPID header is a valid ES256 JWT for the push service
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(pushed[0].headers.Authorization);
  assert.ok(m, 'vapid header shape');
  assert.strictEqual(JSON.parse(Buffer.from(m[2], 'base64url')).aud, 'https://fcm.googleapis.com');
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.publicKey, u8(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`)), 'vapid signature');
  assert.strictEqual(m[4], b64u(new Uint8Array(await subtle.exportKey('raw', vapid.publicKey))), 'application server key');
  assert.strictEqual((await call('/push/notify', cust1, { k: 'order', id: 'LH-AAAAAA' })).status, 204);
  assert.strictEqual(pushed.length, 1, 'a repeat report is ignored');

  assert.strictEqual((await call('/push/notify', cust2, { k: 'order', id: 'LH-AAAAAA' })).status, 403, 'cannot report someone else\'s order');
  assert.strictEqual((await call('/push/notify', cust1, { k: 'order', id: 'LH-OLDOLD' })).status, 409, 'old orders do not alert');
  assert.strictEqual((await call('/push/notify', cust1, { k: 'order', id: 'LH-NOSUCH1' })).status, 403, 'unknown order');
  assert.strictEqual((await call('/push/notify', cust1, { k: 'event', id: 'EV-AAAAAA' })).status, 204);
  assert.deepStrictEqual(adminDev.read(pushed[1]), { t: 'New event request', b: 'EV-AAAAAA \u00b7 20 guests \u00b7 2026-12-01', g: 'event-EV-AAAAAA', h: '#events' });
  assert.strictEqual((await call('/push/notify', cust2, { k: 'cancel', id: 'LH-CANCEL1' })).status, 204);
  assert.strictEqual(adminDev.read(pushed[2]).t, 'Order cancelled');

  // status changes reach the customer's device; only the admin may send them
  assert.strictEqual((await call('/push/status', cust1, { k: 'order', id: 'LH-AAAAAA', s: 'accepted' })).status, 401);
  assert.strictEqual((await call('/push/status', adminTok, { k: 'order', id: 'LH-AAAAAA', s: 'bogus' })).status, 400);
  assert.strictEqual((await call('/push/status', adminTok, { k: 'order', id: 'LH-AAAAAA', s: 'rejected', r: 'Out of stock\r\nX' })).status, 204);
  assert.strictEqual(pushed[3].url, custDev.sub.endpoint);
  assert.deepStrictEqual(custDev.read(pushed[3]), { t: 'Order not accepted', b: 'Order LH-AAAAAA could not be accepted. Reason: Out of stock X', g: 'LH-AAAAAA', h: '#orders' });
  assert.strictEqual((await call('/push/status', adminTok, { k: 'order', id: 'LH-ZZZZZZ', s: 'ready' })).status, 204, 'no device registered is not an error');
  assert.strictEqual(pushed.length, 4);

  // a test message goes to the device that asks for it
  assert.strictEqual((await call('/push/test', adminTok, { sub: adminDev.sub })).status, 204);
  assert.strictEqual(adminDev.read(pushed[4]).g, 'test');
  assert.strictEqual((await call('/push/test', cust1, { sub: adminDev.sub })).status, 401);

  // dead subscriptions are forgotten
  gone.add(custDev.sub.endpoint);
  await call('/push/status', adminTok, { k: 'order', id: 'LH-AAAAAA', s: 'ready' });
  assert.strictEqual(await KV.get('o:LH-AAAAAA'), null, 'a 410 removes the customer device');
  gone.add(adminDev.sub.endpoint);
  await call('/push/notify', cust1, { k: 'order', id: 'LH-OLDOLD' });
  docs['orders/LH-BBBBBB'] = { owner: 'cust-1', age: 1000, fields: { total: { integerValue: '9' }, svc: { stringValue: 'dine' } } };
  await call('/push/notify', cust1, { k: 'order', id: 'LH-BBBBBB' });
  assert.strictEqual([...kv.keys()].filter((k) => k.startsWith('a:')).length, 0, 'a 410 removes the admin device');

  // forgetting an admin device
  assert.strictEqual((await call('/push/sub', adminTok, { role: 'admin', sub: adminDev.sub })).status, 204);
  assert.strictEqual((await call('/push/unsub', cust1, { endpoint: adminDev.sub.endpoint })).status, 401);
  assert.strictEqual((await call('/push/unsub', adminTok, { endpoint: adminDev.sub.endpoint })).status, 204);
  assert.strictEqual([...kv.keys()].filter((k) => k.startsWith('a:')).length, 0);

  // customers still cannot use the email or workflow routes
  assert.strictEqual((await call('/send', cust1, { to: 'a@b.co', subject: 's', text: 't', html: 'h' })).status, 401);
  assert.strictEqual((await call('/', cust1, { workflow: 'mailer.yml' })).status, 401);
}
