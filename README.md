# Laural's Haven - Admin Console

Kitchen dashboard protected by Firebase sign-in, hosted on GitHub Pages: https://andrewvijaykumar123.github.io/Laural-sHaven-UI-AdminConsole/

Features: live kanban board with drag and drop, accept/reject with reasons, payment verification, sales analytics, order history with CSV export, sold-out and open/closed controls, prep-time and announcement banner for the storefront, sound and desktop alerts, ticket printing, 12-hour auto sign-out.

## Security model

The admin signs in with an Email/Password account from Firebase Authentication. `firestore.rules` allows only the listed accounts (matched by their Firebase User UIDs) to read orders or change status/config; customers (anonymous users) can only create valid orders while the store is open. The passwords live only in Firebase; change them in Firebase Console, Authentication.

The sign-in box also accepts a plain username: `lauralshavenadmin` signs in as `lauralshavenadmin@laurals-haven.invalid` (a reserved domain that cannot receive mail, so that account has no password-reset email).

## Firestore rules

List the admin User UIDs in `isAdmin()` in `firestore.rules` and in `ADMIN_UIDS` in `worker/relay.js` (copy them from Firebase Console, Authentication, Users), then publish with `firebase deploy --only firestore:rules` or paste the file into Firebase Console, Firestore, Rules, and redeploy the Worker.

## Home delivery and live tracking

1. Publish the updated `firestore.rules` first (delivery orders are rejected until you do).
2. Menu & stock, turn on **Home delivery**. Customers up to 15 km from the cafe (straight line) can then order delivery; everyone else sees a polite "not available yet" message. Delivery is free within 5 km, then ₹15 per km from 5 to 10 km and ₹20 per km beyond 10 km (rounded to whole rupees, added to the bill). Payment is cash on delivery or UPI. The rates live in `core.js` (`DELIVERY_KM`, `FREE_KM`, `MID_KM`, `RATE_MID`, `RATE_FAR`) and in `firestore.rules` (`shopKm`, `minFee`, 15.1 limit); change both together.
3. Rider: sign in on the phone, mark the order **Out for delivery** and tap **Share location** (allow location, keep the screen on). Customers follow the rider on an OpenStreetMap map.
4. The **Deliveries** tab lists every home delivery and shows the customer's location, the rider and the cafe on one OpenStreetMap map (tap **Track** on any delivery card to jump to it). The Live orders board can be filtered to home deliveries, and **Analytics** and **Order history** have a Home delivery view; Analytics also has a separate delivery section (orders, fees, distance bands). The nightly email report has a Home delivery section.
5. **Delivery code (OTP).** Each home delivery order gets a 4-digit code that the customer sees in the app (order confirmation, My orders, tracking) and in the received, confirmed and on-the-way emails. The rider asks for it at the door. On the Live orders board, an order that is out for delivery shows **Enter code**: a correct code closes the order as delivered (`Code verified`). Five wrong codes lock the entry for 5 minutes. **Close manually** is always available (recorded as `Closed manually`), and is the only option for orders placed without a code (for example before the rules were republished). The code is stored only on the private order document, never on the public status, and is not shown in the admin console, CSV, print or reports. Republish `firestore.rules` so new orders can carry the code; until then orders are still accepted, just without one.

The rider's location is stored on the order's `status/{id}` document, which anyone holding the order id can read, and is erased when the order completes. `map.js`, `map.css` and `vendor/leaflet/` are copies of the storefront files and must stay identical. Map tiles come from the public OpenStreetMap servers; keep traffic light or switch to a tile provider for heavy use.

## Invoices

Every order that was not rejected has a professional invoice for Laural's Haven Cafe (phone and Google Maps link, invoice number = order id, itemised bill, delivery charge, amount in words; no GST). Staff print it with the receipt button on an order card, the Deliveries panel or Order history; customers print or save it as PDF from **My orders**, and it is included in the delivered/complete email. The layout lives in `mailtpl.js` (`invoiceHtml`); the cafe details and GST note are the `CAFE` and `TAX_NOTE` constants at the top. `mailtpl.js` must be identical in both repos.

## Customer feedback

Once an order is completed, the customer sees **Rate your order** in My orders on the storefront: 1 to 5 stars for the service, optional stars for each product they ordered, and an optional comment (300 characters). The **Feedback** tab shows the average service and product ratings, how the service ratings are spread, every product ranked by average stars, and each response with the order, customer, comment and product ratings. Filter by rating, service type or comments, or search by order ID, name, phone or comment. Ratings of 1 or 2 stars are flagged as needing attention, and new feedback shows a badge and a toast.

Feedback is stored in `feedback/{orderId}` (one per order, created once by the customer who placed it, only after the order is completed; only the admin can read it). Republish `firestore.rules` for it to work; until then the customer sees a "could not save" message and the Feedback tab shows a note. Feedback is kept when you clear the board, but a customer can no longer rate an order once it has been cleared.

## Event bookings

Customers can request the cafe for birthday parties, anniversary celebrations, success meetups, get-togethers, baby showers, corporate meetings and other celebrations. Pricing: **Rs 1000 per hour + Rs 500 post-event cleaning + optional Rs 500 basic decoration**, paid at the cafe on the day. A booking is 1 to 12 hours, starts between 8:00 AM and 11:00 PM in 30-minute steps, ends by midnight, for 1 to 100 guests, from today up to 180 days ahead.

The **Events** tab has the on/off switch (**off by default**; the storefront shows the Events buttons only while it is on), a summary, and every request with Confirm / Decline, then Mark completed / Cancel booking. Declines and cancellations take a reason that the customer sees. New requests show a badge on the tab. Confirming is blocked when it overlaps another confirmed booking; confirmed slots are published to the storefront so customers cannot pick a taken time.

Data: `events/{EV-id}` (created by the customer while bookings are on; the rules recompute the price), `evstatus/{EV-id}` (admin only writes) and `config/events` (switch and taken slots). Republish `firestore.rules` for it to work; until then customers see "not available" and the Events tab shows a note.

Limits: no emails are sent for events, customers cannot cancel online (they are shown the cafe phone number), overlaps are enforced only when you confirm, and opening hours are assumed to be 8:00 AM to midnight (edit `EVENT` in `core.js` in both repos, plus the matching numbers in `firestore.rules`, to change this).

## Instant order emails

Customers get an email within a few seconds when their order is received, confirmed, ready (or out for delivery), delivered and when it cannot be accepted. The admin console that is open sends them: it plans the next email from the order status (mailtpl.js), claims it in Firestore (mailq/{order}_{key}, so two open consoles never send twice) and asks the Cloudflare Worker (worker/relay.js, POST /send) to deliver it through Gmail SMTP. If the Worker cannot send (not set up, offline, rules missing), the console falls back to the GitHub Actions mailer (mailer/, about a minute, plus a 15-minute schedule as a safety net) and the Settings tab says so.

One-time setup:

1. Republish `firestore.rules` (adds the mail and mailq collections).
2. In Cloudflare, redeploy the Worker with the contents of worker/relay.js and add the secret GMAIL_APP_PASSWORD (a Gmail app password for the sender account). The existing GH_TOKEN secret stays for the fallback.
3. Keep the admin console open on at least one device while the cafe takes orders; emails are sent from there.

## Tests

`powershell
node mailer/test.js    # email templates, planner and mailer
node worker/test.js    # relay SMTP client against a fake server
node e2e/run.js        # both web apps in Edge with a fake Firebase and relay (needs playwright-core; SHOP_DIR=..\Laural-sHaven-UI)
`

The end-to-end suite checks ordering, delivery tiers, live tracking, admin actions, email timing and de-duplication, fallbacks, analytics, CSV, layout and console errors. It replaces Firebase and SMTP with test doubles, so it cannot prove the real security rules or real mail delivery.
## Rebuild the Firebase bundle

```powershell
cd tools/fb
npm install
npm run build   # writes fb.js; copy it to the root of both repos
```

## Deploy

Push to `main`; the GitHub Actions workflow publishes the site. `core.js` is a copy of the storefront's `core.js` and must stay identical.
