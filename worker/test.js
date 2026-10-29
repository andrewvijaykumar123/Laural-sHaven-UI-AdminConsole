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
    .replace('export default worker;', 'export { worker, smtpSend, handleSend, buildMessage };');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lhworker-')), 'relay.mjs');
  fs.writeFileSync(tmp, src);
  const { worker, smtpSend, handleSend } = await import(pathToFileURL(tmp).href);

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
  assert.strictEqual(srv.log.cmds[1], `AUTH PLAIN ${Buffer.from('\0lauralshavensupport@gmail.com\0xyz').toString('base64')}`, 'spaces in the app password are removed');
  srv.server.close();

  // OAuth 2.0 through the Gmail API: no app password, no SMTP socket
  const oenv = { GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'csecret', GMAIL_REFRESH_TOKEN: 'rtoken' };
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
  };
  const noSocket = () => { throw new Error('SMTP must not be used with OAuth'); };
  assert.strictEqual((await handleSend({ to: 'A@B.co', subject: 'Hello\r\nBcc: evil@x.com', text: 't', html: '<p>\u20b9119</p>' }, oenv, noSocket, fakeFetch))[0], 204);
  const tok = calls.find((c) => c.url.includes('oauth2.googleapis.com'));
  assert.ok(String(tok.init.body).includes('grant_type=refresh_token') && String(tok.init.body).includes('refresh_token=rtoken'));
  const send = calls.find((c) => c.url.includes('gmail.googleapis.com'));
  assert.strictEqual(send.init.headers.Authorization, 'Bearer at-1');
  const raw = Buffer.from(JSON.parse(send.init.body).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(raw, /^From: "?Laural's Haven"? <lauralshavensupport@gmail\.com>/m);
  assert.match(raw, /^To: <a@b\.co>/m);
  assert.ok(!/^Bcc:/mi.test(raw), 'header injection is neutralised');
  assert.strictEqual(decodeBody(raw, 'text/html'), '<p>\u20b9119</p>');
  // the access token is reused until it expires
  await handleSend({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }, oenv, noSocket, fakeFetch);
  assert.strictEqual(calls.filter((c) => c.url.includes('oauth2.googleapis.com')).length, 1);
  // Google refusing the refresh token surfaces a clear error without leaking secrets
  const badAuth = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  const fresh = await import(pathToFileURL(tmp).href + '?fresh');
  const denied = await fresh.handleSend({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }, oenv, noSocket, badAuth);
  assert.strictEqual(denied[0], 502);
  assert.ok(/invalid_grant/.test(denied[1]) && !denied[1].includes('csecret') && !denied[1].includes('rtoken'));
  // Gmail API rejecting the message
  const rejecting = async (url) => (url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'at-2', expires_in: 3600 }), { status: 200 }) : new Response(JSON.stringify({ error: { message: 'Invalid To header' } }), { status: 400 }));
  const fresh2 = await import(pathToFileURL(tmp).href + '?fresh2');
  const refused = await fresh2.handleSend({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }, oenv, noSocket, rejecting);
  assert.strictEqual(refused[0], 502);
  assert.match(refused[1], /Gmail API 400: Invalid To header/);

  // HTTP layer: no token, preflight
  const res = await worker.fetch(new Request('https://relay.test/send', { method: 'POST', body: '{}' }), env);
  assert.strictEqual(res.status, 401);
  assert.strictEqual((await worker.fetch(new Request('https://relay.test/send', { method: 'OPTIONS' }), env)).status, 204);
  assert.strictEqual((await worker.fetch(new Request('https://relay.test/send'), env)).status, 405);

  console.log('worker tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
