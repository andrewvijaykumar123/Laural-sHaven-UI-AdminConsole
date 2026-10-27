# Laural's Haven - Admin Console

Kitchen dashboard protected by Firebase sign-in, hosted on GitHub Pages: https://andrewvijaykumar123.github.io/Laural-sHaven-UI-AdminConsole/

Features: live kanban board with drag and drop, accept/reject with reasons, payment verification, sales analytics, order history with CSV export, sold-out and open/closed controls, prep-time and announcement banner for the storefront, sound and desktop alerts, ticket printing, 12-hour auto sign-out.

## Security model

The admin signs in with an Email/Password account from Firebase Authentication. `firestore.rules` allows only that email to read orders or change status/config; customers (anonymous users) can only create valid orders. The password lives only in Firebase; change it in Firebase Console, Authentication.

## Firestore rules

Set the admin email in `firestore.rules` (`REPLACE_WITH_ADMIN_EMAIL`), then publish with `firebase deploy --only firestore:rules` or paste the file into Firebase Console, Firestore, Rules.

## Rebuild the Firebase bundle

```powershell
cd tools/fb
npm install
npm run build   # writes fb.js; copy it to the root of both repos
```

## Deploy

Push to `main`; the GitHub Actions workflow publishes the site. `core.js` is a copy of the storefront's `core.js` and must stay identical.
