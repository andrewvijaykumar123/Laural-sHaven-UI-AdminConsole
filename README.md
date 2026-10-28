# Laural's Haven - Admin Console

Kitchen dashboard protected by Firebase sign-in, hosted on GitHub Pages: https://andrewvijaykumar123.github.io/Laural-sHaven-UI-AdminConsole/

Features: live kanban board with drag and drop, accept/reject with reasons, payment verification, sales analytics, order history with CSV export, sold-out and open/closed controls, prep-time and announcement banner for the storefront, sound and desktop alerts, ticket printing, 12-hour auto sign-out.

## Security model

The admin signs in with an Email/Password account from Firebase Authentication. `firestore.rules` allows only that account (matched by its Firebase User UID) to read orders or change status/config; customers (anonymous users) can only create valid orders while the store is open. The password lives only in Firebase; change it in Firebase Console, Authentication.

## Firestore rules

Set the admin User UID in `firestore.rules` (`REPLACE_WITH_ADMIN_UID`; copy it from Firebase Console, Authentication, Users), then publish with `firebase deploy --only firestore:rules` or paste the file into Firebase Console, Firestore, Rules.

## Home delivery and live tracking

1. Publish the updated `firestore.rules` first (delivery orders are rejected until you do).
2. Menu & stock, turn on **Home delivery**. Customers up to 15 km from the cafe (straight line) can then order delivery; everyone else sees a polite "not available yet" message. Delivery is free within 5 km, then ₹15 per km from 5 to 10 km and ₹20 per km beyond 10 km (rounded to whole rupees, added to the bill). Payment is cash on delivery or UPI. The rates live in `core.js` (`DELIVERY_KM`, `FREE_KM`, `MID_KM`, `RATE_MID`, `RATE_FAR`) and in `firestore.rules` (`shopKm`, `minFee`, 15.1 limit); change both together.
3. Rider: sign in on the phone, mark the order **Out for delivery** and tap **Share location** (allow location, keep the screen on). Customers follow the rider on an OpenStreetMap map.
4. The **Deliveries** tab lists every home delivery and shows the customer's location, the rider and the cafe on one OpenStreetMap map (tap **Track** on any delivery card to jump to it). The Live orders board can be filtered to home deliveries, and **Analytics** and **Order history** have a Home delivery view; Analytics also has a separate delivery section (orders, fees, distance bands). The nightly email report has a Home delivery section.

The rider's location is stored on the order's `status/{id}` document, which anyone holding the order id can read, and is erased when the order completes. `map.js`, `map.css` and `vendor/leaflet/` are copies of the storefront files and must stay identical. Map tiles come from the public OpenStreetMap servers; keep traffic light or switch to a tile provider for heavy use.

## Rebuild the Firebase bundle

```powershell
cd tools/fb
npm install
npm run build   # writes fb.js; copy it to the root of both repos
```

## Deploy

Push to `main`; the GitHub Actions workflow publishes the site. `core.js` is a copy of the storefront's `core.js` and must stay identical.
