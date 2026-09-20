# Elite Frame Finder (prototype)

Scan a customer's face on a tablet and get a frame recommendation: face shape, shapes to choose and avoid,
sheet (acetate) vs metal, thin vs broad rim, rim type, frame size in mm, colour family, nose-bridge advice, and
the frames in stock that match. Face analysis runs entirely on the tablet (Google MediaPipe Face Landmarker,
478 points, iris used as an 11.7 mm ruler). No photo leaves the device.

## Run it

```bash
npm install
npm start
```

Or double-click **Start Frame Finder.cmd** in this folder: it keeps the server running (and restarts it if it
crashes) for as long as the window is open. The console prints the address to open on the tablet, e.g.
`http://192.168.1.31:4100` (same Wi-Fi). The PC's Wi-Fi address can change after a restart; if the tablet stops
seeing updates, check the address in that window. To make it permanent, reserve the PC's IP in the router (DHCP
reservation), or use `http://<PC-name>.local:4100` if the tablet resolves it.
On the tablet: open the address in Chrome, then menu > "Add to Home screen". It opens full-screen like an app and
keeps working offline after the first load (the model files are cached).

**Camera note.** Browsers only allow a live camera preview on HTTPS or localhost. Over plain HTTP the app hides
"Start camera" and uses "Take / choose photo", which opens the tablet's camera app and works everywhere.
To get the live preview on the tablet, either:

- run `npm run make-cert` once (uses the OpenSSL that ships with Git for Windows), restart, open the `https://` address and accept the one-time certificate warning; or
- deploy the folder to Railway (or any HTTPS host) like the Elite software app.

## Deploying to Railway (stable HTTPS address for the tablets)

1. Push this folder to a GitHub repository (e.g. `hemantgupta121/elite-frame-finder`).
2. In Railway: New Project → Deploy from GitHub repo → pick it. Railway reads `railway.json` and runs `node server.js`.
3. Variables (Settings → Variables): `APP_PASSWORD` = a staff password (required on a public URL; user name is
   `elite` unless you set `APP_USER`), `DATA_DIR` = `/data/customers`, optionally `ANTHROPIC_API_KEY`.
   Until `APP_PASSWORD` is set, the Railway copy shows a "setup required" page instead of the app, so customer
   records are never exposed. With it set, staff get a sign-in page; the session is remembered for 90 days on
   that device and there is a Sign out button in the header. Eight wrong passwords from one address block that
   address for 15 minutes. On the shop LAN with no `APP_PASSWORD`, there is no sign-in.
4. Add a Volume (right-click the service → Add Volume) mounted at `/data`, so customer records survive redeploys.
5. Settings → Networking → Generate Domain. Open that `https://…railway.app` address on the tablet, enter the
   staff login once, then Add to Home screen. Live camera works because the address is HTTPS.

Each later `git push` to `main` redeploys automatically. `PORT` is set by Railway; the self-signed certificate is
not used there.

## Measurement accuracy

- **Distance PD.** The customer looks at the tablet, so the eyes converge and the pupils sit 2–3 mm closer than a
  PD ruler reads at distance. The app estimates camera distance from the iris size and adds the convergence back.
  It shows both: "PD (distance) 64 · near 61 · at 45 cm". Ask the customer to look at the camera lens.
- **Burst scanning.** With the live camera, "Scan face" grabs 7 frames and uses the median, with a majority vote on
  face shape. A warning appears if the frames disagree by more than 2 mm.
- **Ruler calibration.** After a scan, type the PD you measured with a ruler and tap Apply. The tablet stores the
  ratio (last 10 readings averaged) and scales every mm value from then on. Do this for 3–5 customers once per
  tablet; it corrects for the camera's field of view and the local average iris size.

## Face-shape confidence and learning

Confidence is the margin by which the winning shape beats the others (Clear / Fairly clear / Borderline). After each
customer, tap **✓ Correct** or the right shape chip; the tablet stores the face proportions with your label. From 8
labelled faces it blends a nearest-neighbour vote over your labels with the built-in rules, so the boundaries move
towards your customers. Samples live in the tablet's local storage (`eff.shapes.v1`), capped at 300.

**AI second opinion (optional, cloud).** With `ANTHROPIC_API_KEY` set, the results card shows "Ask AI second
opinion": the photo goes to Claude, which returns a shape, runner-up, reasoning and frame advice. Tap "Use" to
adopt it (this also records a learning sample). The face photo leaves the device only for this step.

## Frame on face: HBOX / VBOX / DBL / fitting height

Scan the customer wearing the chosen frame, tap **Measure frame**, then tap the lens edges inside the rim:
top-left and bottom-right of the customer's right lens (left side of the photo), then the left lens. Arrows nudge
the last tap by one pixel; Undo removes it. The app reports HBOX (A), VBOX (B), DBL, frame front width, fitting
(segment) height per eye from the pupil centre to the box bottom, and monocular PDs from the nose centre line.
Scale comes from the iris ruler plus your calibration. High-power lenses magnify or shrink the eyes slightly behind
the frame, so confirm fitting height with a marker for strong prescriptions.

## Customer records

Below the recommendation is a **Customer record** card: name, phone, date of visit, gender, frame and lens wanted,
notes, and a mood chip (the same seven chips as the Elite software's Sale Invoice). Buttons:

- **Save** stores the photo, details, scan results and frame-fit numbers in the tablet's IndexedDB, and posts a copy
  to the server (`data/customers/<id>.json` + `<id>.jpg`). **Save as Draft** stores without validation.
- **Reset** clears the form and the scan.
- **Print (PDF)** builds an A4 PDF with the photo; **Print Detail (PDF)** the same without the photo. Both are stored
  with the record (and as `<id>-full.pdf` / `<id>-detail.pdf` on the server), then offered through the tablet's
  share sheet (WhatsApp, print, save) or downloaded.
- **WhatsApp details** opens WhatsApp to the customer's number with the recommendation text.

The **Customers** tab lists saved records with search; tap one to re-print, WhatsApp, open stored PDFs, edit in the
Scan tab, or delete. Photos and PDFs stay on the tablet and the shop's own server; nothing goes to the cloud.

**Quick photo (recommended for real per-frame pictures).** Tag frame tab → Start quick photo. On an Android tablet
the back camera reads the barcode sticker live and shows the item name in green; place the frame in view, tap
Snap, and the picture is attached to that item. Elsewhere type the code, then Snap. Tray photos taken with a
camera are usually too blurred for barcode reading, so those go through Split tray with typed codes.

Photos live with the catalog on the server you upload to: the Railway address for the tablets, or the PC's local
copy under `data/` when uploaded on localhost. They are not merged between the two.

## AI frame tagging (optional)

Copy `.env.example` to `.env`, add `ANTHROPIC_API_KEY`, restart. The **Tag frame** tab photographs a frame and
Claude fills shape / material / rim / weight / colour / brand / size for you to check and save. Without the key the
tab explains it is off and you add frames by hand. The server also picks up the key from the Elite software `.env`
if one is set there. Requests use `claude-opus-5` with Anthropic's server-side refusal fallback enabled, so a
declined image is retried on a fallback model automatically.

## Frames catalog

The catalog is shared by every tablet: it lives on the server (`<DATA_ROOT>/frames.json`, i.e. the Railway volume)
with an offline copy on each tablet. Frames are **attributes**: code, brand, model, category, shape, material, rim,
weight, colour, colour family, eye/bridge/temple, gender, price, qty, photo.

**Fill it from the Elite inventory.** `node tools/export-elite-frames.js` reads the Elite software's SQLite and
writes `elite-frames.csv` (Frame + Sunglass items with stock and price; shape/material/rim/colour/size/gender are
guessed from the item name, e.g. "ARMANI BRW FULL FR SHEET 52"). Import it with **Import CSV** in the Frames tab.
The Elite app's Item Stock Summary CSV also imports directly. Re-importing refreshes price and stock but keeps
attributes and photos you set by hand. Items whose name gives no shape show "shape?" and do not count as a shape
match until staff set it.

**Photos.** Frames tab → **Upload frame photos** (many at once; resized before upload, stored as
`frame-photos/<code>.jpg`). A file named by item code (e.g. `011158.jpg`) attaches automatically. Otherwise a
matching panel opens: type or pick the code. For a photo of a whole **display tray**, tap **Split tray**, tap the
tray's four corners, set columns × rows (3 × 4 by default) and the app cuts one picture per frame to assign.

## Updating the app on tablets

The service worker (`public/sw.js`) caches the app for offline use. Own files are fetched network-first, so an
online tablet gets changes on its next open; the cache is only used offline. Bump `VERSION` in `sw.js`
(e.g. `eff-v2`) when you want old cached files thrown away.

## Files

- `public/js/faceshape.js` — measurements, face-shape scoring, sizing, undertone, recommendation rules (edit the `RULES` table to change advice).
- `public/js/catalog.js` — catalog store, matching score, CSV, schematic SVG.
- `public/js/app.js` — camera, MediaPipe, screens.
- `server.js` — static host + `/api/tag`.
- `npm test` — unit tests for the classifier, sizing and catalog.
