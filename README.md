# Laural's Haven - Admin Console

Kitchen dashboard protected by Firebase sign-in, hosted on GitHub Pages: https://andrewvijaykumar123.github.io/Laural-sHaven-UI-AdminConsole/

Features: live kanban board with drag and drop, accept/reject with reasons, payment verification, sales analytics, order history with CSV export, sold-out and open/closed controls, prep-time and announcement banner for the storefront, sound and desktop alerts, ticket printing, 12-hour auto sign-out.

## Security model

The admin signs in with an Email/Password account from Firebase Authentication. `firestore.rules` allows only that account (matched by its Firebase User UID) to read orders or change status/config; customers (anonymous users) can only create valid orders while the store is open. The password lives only in Firebase; change it in Firebase Console, Authentication.

## Firestore rules

Set the admin User UID in `firestore.rules` (`REPLACE_WITH_ADMIN_UID`; copy it from Firebase Console, Authentication, Users), then publish with `firebase deploy --only firestore:rules` or paste the file into Firebase Console, Firestore, Rules.

## Home delivery and live tracking

1. Publish the updated `firestore.rules` first (delivery orders are rejected until you do).
2. Menu & stock, turn on **Home delivery**. Customers within 5 km (straight line from the cafe) can then order delivery; everyone else sees a polite "not available yet" message. Delivery is free and paid in cash on delivery or by UPI.
3. Rider: sign in on the phone, mark the order **Out for delivery** and tap **Share location** (allow location, keep the screen on). Customers follow the rider on an OpenStreetMap map.

The rider's location is stored on the order's `status/{id}` document, which anyone holding the order id can read, and is erased when the order completes. `map.js`, `map.css` and `vendor/leaflet/` are copies of the storefront files and must stay identical. Map tiles come from the public OpenStreetMap servers; keep traffic light or switch to a tile provider for heavy use.

## Rebuild the Firebase bundle

```powershell
cd tools/fb
npm install
npm run build   # writes fb.js; copy it to the root of both repos
```

## Deploy

Push to `main`; the GitHub Actions workflow publishes the site. `core.js` is a copy of the storefront's `core.js` and must stay identical.
