/* Cloudflare Worker: lets the signed-in admin start the mailer workflows without a GitHub token on the device.
   Secret required: GH_TOKEN (fine-grained token, this repo only, Actions: read and write). */
const PROJECT_ID = 'laural-shavencafe';
const ADMIN_UID = '4FSqW048fSdUFMQZJ1OJVp7GLob2';
const REPO = 'andrewvijaykumar123/Laural-sHaven-UI-AdminConsole';
const ORIGIN = 'https://andrewvijaykumar123.github.io';
const WORKFLOWS = ['mailer.yml', 'daily-report.yml'];
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

async function verifyAdmin(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return false;
  const header = json(b64(parts[0]));
  const claims = json(b64(parts[1]));
  if (header.alg !== 'RS256') return false;
  const { keys } = await (await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]), signed))) return false;
  const now = Date.now() / 1000;
  return claims.aud === PROJECT_ID
    && claims.iss === `https://securetoken.google.com/${PROJECT_ID}`
    && claims.exp > now && claims.iat <= now + 60
    && claims.sub === ADMIN_UID
    && claims.firebase && claims.firebase.sign_in_provider === 'password';
}

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin'
    };
    const reply = (status, text) => new Response(text || null, { status, headers: cors });
    if (req.method === 'OPTIONS') return reply(204);
    if (req.method !== 'POST') return reply(405, 'Method not allowed');

    let ok = false;
    try { ok = await verifyAdmin((req.headers.get('Authorization') || '').replace(/^Bearer /, '')); } catch (e) { ok = false; }
    if (!ok) return reply(401, 'Unauthorized');

    let body;
    try { body = await req.json(); } catch (e) { return reply(400, 'Bad request'); }
    if (!WORKFLOWS.includes(body.workflow)) return reply(400, 'Unknown workflow');
    const inputs = body.workflow === 'daily-report.yml' && /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? { date: body.date } : undefined;

    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${body.workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'laurals-haven-relay',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main', ...(inputs ? { inputs } : {}) })
    });
    return reply(r.status === 204 ? 204 : 502, r.status === 204 ? null : 'GitHub refused');
  }
};
