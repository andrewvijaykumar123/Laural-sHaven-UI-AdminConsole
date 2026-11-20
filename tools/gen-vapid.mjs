// Makes the VAPID key pair for background notifications. Run once: node tools/gen-vapid.mjs
//   public key  -> key in window.LH_PUSH (fb-config.js, both repos)
//   private JWK -> Cloudflare Worker secret VAPID_PRIVATE_JWK (also saved to tools/vapid-private.json, which git ignores)
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./vapid-private.json', import.meta.url));
if (existsSync(out)) {
  console.error('tools/vapid-private.json already exists. Replacing the key would stop every registered device from receiving notifications; delete the file first if that is what you want.');
  process.exit(1);
}
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
writeFileSync(out, JSON.stringify(jwk));
console.log(`Public key (put in LH_PUSH.key):\n${pub}\n\nPrivate JWK saved to tools/vapid-private.json (Worker secret VAPID_PRIVATE_JWK).`);
