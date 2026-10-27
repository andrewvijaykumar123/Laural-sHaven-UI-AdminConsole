# Laural's Haven - Admin Console

Password-protected kitchen dashboard, hosted on GitHub Pages: https://andrewvijaykumar123.github.io/Laural-sHaven-UI-AdminConsole/

Features: live kanban board with drag and drop, encrypted order inbox, accept/reject with reasons, payment verification, sales analytics, order history with CSV export, sold-out and open/closed controls, prep-time and announcement banner for the storefront, sound and desktop alerts, ticket printing, 90-minute auto-lock.

## Security model

The password unlocks private keys stored in `keys.js` in encrypted form (PBKDF2-SHA256, 310k iterations, AES-GCM). Orders are decrypted only in the admin browser. Use a long, unique password.

## Rotate the password

```powershell
$env:LH_ADMIN_PASSWORD = 'a long new passphrase'
node tools/gen-keys.mjs . ..\Laural-sHaven-UI
```

Commit and push `keys.js` in BOTH repos. Old orders on the relay become unreadable after rotation.

## Deploy

Push to `main`; the GitHub Actions workflow publishes the site. `core.js` is a copy of the storefront's `core.js` and must stay identical.
