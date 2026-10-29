'use strict';
/* One-time helper: signs in as the sender account and prints an OAuth 2.0 refresh token (scope gmail.send only).
   Run:  $env:GMAIL_CLIENT_ID='...'; $env:GMAIL_CLIENT_SECRET='...'; node authorize.js
   Needs a Google Cloud OAuth client of type "Desktop app". The token is printed once, to this terminal only. */
const http = require('http');
const crypto = require('crypto');
const { SENDER } = require('./io');

const id = process.env.GMAIL_CLIENT_ID;
const secret = process.env.GMAIL_CLIENT_SECRET;
if (!id || !secret) { console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first.'); process.exit(1); }

const verifier = crypto.randomBytes(32).toString('base64url');
const state = crypto.randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname !== '/') { res.writeHead(404).end(); return; }
  const done = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(msg); setTimeout(() => process.exit(code === 200 ? 0 : 1), 200); };
  if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) return done(400, `Sign-in failed: ${u.searchParams.get('error') || 'invalid response'}`);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, code: u.searchParams.get('code'), code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${server.address().port}` })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.refresh_token) { console.error('No refresh token returned:', j.error || r.status); return done(500, 'No refresh token returned. See the terminal.'); }
  console.log(`\nGMAIL_REFRESH_TOKEN (keep it secret, add it as a secret, never commit it):\n${j.refresh_token}\n`);
  return done(200, 'Done. You can close this tab and go back to the terminal.');
});

server.listen(0, '127.0.0.1', () => {
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: `http://127.0.0.1:${server.address().port}`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    login_hint: SENDER,
    state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256'
  });
  console.log(`Open this link and sign in as ${SENDER}:\n\nhttps://accounts.google.com/o/oauth2/v2/auth?${q}\n`);
});
