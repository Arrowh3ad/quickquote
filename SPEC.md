# QuickQuote — Spec

Measure a surface from a photo, price it, hand the client a branded PDF quote. On a phone, at the job site, offline.

## Users
Painters, flooring/drywall/concrete/fencing contractors. One person, one phone.

## Architecture (locked)
- Responsive web app, installable PWA, offline via service worker.
- Local-first: clients, quotes, photos in IndexedDB. No app data on any server.
- Billing gate: email + Stripe subscription (14-day trial). Server stores only `{email, subscription status}` — shipped as a Cloudflare Worker in `server/`, disabled until `BILLING_URL` is set in `app.js`.
- No AI. Geometry only: user-set scale + user-drawn polygon.

## Core flow
1. **Photo** — take/upload a photo containing a reference object of known size (8.5×11 sheet, door, tape measure).
2. **Scale** — two modes:
   - **Rectangle reference** (default): tap the 4 corners of a known rectangle (paper, door, custom W×H). Solves a 4-point homography → angled photos measure correctly for surfaces coplanar with the reference. Pure geometry, no AI.
   - **Line reference**: tap the two ends of a known length → feet-per-pixel. Straight-on photos only.
3. **Outline** — tap 3+ polygon corners around the surface (any shape, concave/L-shapes included) → square footage (shoelace formula). Subtract **cutouts** for windows/doors/mirrors: polygon or 3-tap ellipse (axis ends + rim point, sampled to a 64-gon so the same math applies). Cutouts are assumed to lie inside the outline — no polygon clipping.
4. **Estimate** — per-trade rate presets ($/sqft material + labor, user-editable) generate line items; items fully editable; add custom items.
5. **Quote** — branded doc (logo, business info, client, line items, total, notes) → print / save-as-PDF via the browser's native print. Quotes saved per client.

## Data model (IndexedDB)
- `clients`: `{id, name, phone, email, address}`
- `quotes`: `{id, clientId, created, measurements: [{label, sqft, photo(Blob), points, scalePoints, refFeet}], items: [{desc, qty, rate}], notes}`
- `kv`: `settings` `{business{name,phone,email}, logo(Blob), presets[{name,material,labor}]}`, `license` `{email, active}`

## Stated limitation
Rectangle mode corrects perspective only for surfaces **in the same plane as the reference** (paper taped to the wall → wall areas are exact; the floor is not). Accuracy degrades at extreme angles as tap error amplifies. Line mode assumes a straight-on photo. The quote editor says so.

## Non-goals (do not build)
AI/perspective correction, auto area detection, CRM, invoicing/payments, scheduling, cloud sync.

---

# Implementation plan

Vanilla JS ES modules, zero dependencies, no build step. Files:

1. `geometry.js` — pure functions (dist, unitsPerPixel, polygonAreaPx, realArea). **Decoupled**: no DOM, no storage — the reusable core for any "points on an image + reference length" tool. `test.mjs` covers it (run: `node test.mjs`).
2. `db.js` — ~30-line promise wrapper over IndexedDB (get/all/put/del).
3. `measure.js` — the photo→scale→outline overlay. Decoupled: takes a callback, returns a measurement record. Uses `geometry.js`.
4. `app.js` — hash router + views: Quotes list, Quote editor, Clients, Settings (business/branding, presets, backup export/import), Print view, Paywall (dormant until `BILLING_URL` set).
5. `index.html`, `app.css` — shell, mobile-first styles, print stylesheet (PDF = native print).
6. `sw.js`, `manifest.webmanifest`, icons — installable + offline.
7. `server/worker.js` — Cloudflare Worker: `POST /checkout` (Stripe Checkout session w/ trial), `GET /status?email`, `POST /webhook` (signature-verified, writes status to KV). Deploy later; app works without it.

PDF strategy: browser print-to-PDF with a print stylesheet — native, offline, zero libraries. (jsPDF only if print output proves insufficient.)
