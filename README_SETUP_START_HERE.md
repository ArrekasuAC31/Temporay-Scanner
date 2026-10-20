# J&A Mobile Camera Scan-Out → Google Sheets (Emergency v1)

**Goal:** Phone camera scan → confirmed record in existing Google Sheet `SCAN LOG` with Philippine timestamp, duplicate blocked, never automatically deduct stock. No Supabase or paid subscriptions. This is a **separate Vercel project** so it cannot break existing J&A / SulitMarket production apps.

## System design

```
Phone browser (Vercel HTTPS) → /api/scan (Vercel serverless)
  → [secret server-to-server only] Google Apps Script doPost
  → EXISTING private Google Sheet → SCAN LOG
```

The Google Apps Script HTMLService sandbox currently restricts camera permission on some browsers, so the **camera page is hosted on Vercel**, not inside Apps Script.

### Before beginning

- Use the EXISTING native Google Sheet converted from `JA_Temporary_Scan_Out_Google_Sheets_Template.xlsx`. Do not create a new sheet / import the template twice.
- The `SCAN LOG` tab must retain its 14 columns (timestamp, waybill, movement, shop, operator, courier, POS ID, product, quantity, supplies, reconciliation status, notes, event ID, reconciled at).
- Never publish the Google Sheet; this app only requires access to it via a bound Apps Script with a strong secret.
- The Vercel project and Apps Script deployment are not yet created. They require **your account login and explicit deployments**.

## Step 1 — Update the script attached to your current Google Sheet

1. Open the existing Sheet → **Extensions → Apps Script**.
2. **Keep a copy** of your old code locally. Then **replace the entire contents** of `Code.gs` with `google-apps-script/Code.gs` from this ZIP. The new file includes both the original `onEdit` desktop scanner function **and** the new `doPost` endpoint.
3. Save. In **Project Settings → Script properties**, add **BRIDGE_SECRET** with a newly generated, unique, random secret of **at least 32 characters**. Don't share this in chat and never paste it into client/browser JS.
4. If the script is not attached to the existing Sheet, also add `SPREADSHEET_ID` (the long ID between `/d/` and `/edit` in your Sheet URL). For a bound script, this property is optional.
5. In Apps Script **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. The endpoint is public but checks BRIDGE_SECRET on every write, while the Vercel scanner also requires a separate operator password. Keep the URL private.
6. Approve Google permissions after reviewing them. Copy the **Web app URL ending `/exec`** to a private local note. If you later edit Code.gs, choose **Deploy → Manage deployments → Edit → New version**; saving code alone won't update an existing `/exec` deployment.

**Security warning:** If you cannot configure a strong secret or you're not comfortable exposing an Apps Script endpoint as `Anyone`, do not deploy. The sheet must remain private; the bridge restricts writes via a separate secret. Google account sign-in is not a substitute for the bridge secret.

## Step 2 — Deploy the standalone scanner to Vercel

1. Create a **NEW private GitHub repository**, e.g. `ja-temporary-scanout`. Do NOT put this project in `ja-management-web` or `sulitmarket-chat`; the existing production apps are untouched.
2. Upload the files from **this folder** to the repository ROOT: `index.html`, `api/scan.js`, `package.json`. Do NOT publish `README` with actual values, or any secrets. (`google-apps-script/Code.gs` has no secrets and may remain in repo or can be excluded.)
3. In Vercel, **Add New → Project → Import** this repo. Framework Preset: **Other**; Build Command: blank; Output Directory: blank/default. This project serves `/` and `/api/scan`.
4. Before deploying, configure **Production environment variables** (PRIVATE server-side, *no* `NEXT_PUBLIC_` prefix):

   | Key | Value |
   | --- | --- |
   | `GOOGLE_SHEETS_WEB_APP_URL` | Full Apps Script URL ending `/exec` |
   | `SHEETS_BRIDGE_SECRET` | EXACT same BRIDGE_SECRET configured in Apps Script script properties |
   | `SCAN_OPERATOR_PASSWORD` | Different strong operator password of at least 12 chars (recommend 16+ random/passphrase) |

   **Both passwords must be different.** The bridge secret goes only in Vercel server settings and Apps Script properties, NEVER in front-end code or chat. Do not share environment-variable screenshots that expose values.
5. Deploy. Wait for Vercel **Ready**. Open the new `https://your-project.vercel.app` link **directly in Chrome/Safari** on your phone, NOT inside an embedded iframe or Google Sheets mobile app.

## Step 3 — Test before using actual orders

1. Open the link on mobile. Enter `SCAN_OPERATOR_PASSWORD` and (optionally) operator name.
2. Tap **Start Camera**. Accept camera permission. Point it at a printed **test** Code-128/QR barcode representing `TESTSCAN20261019A` OR manually enter that exact test code. Camera works only on HTTPS and supported browser/device.
3. Wait for **SAVED — SCAN OUT** before taking another parcel. Check `SCAN LOG` for one row containing the exact test code and a Philippine timestamp.
4. Scan/enter the same code again. Must show **DUPLICATE — NOT SAVED**. Check Sheet: still only one row.
5. Remove ONLY the dummy `TESTSCAN20261019A` row from SCAN LOG (not headers or real scan-outs). Do not delete real orders. After this, test with one real parcel already physically handed over.
6. If the camera fails, enter the waybill manually. If it says **Save not confirmed**, check SCAN LOG before retrying (a network timeout can happen after an actual save).

## Production scanning

- Scan physical parcels **only after actual handover/sign-out**.
- One Google Sheet row per unique tracking number; duplicates are NOT re-added.
- If an order has an intentional reshipment/replacement under the same tracking ID, **manual review is required** (dedup is by waybill).
- If Google Sheets / internet / Vercel unavailable, stop scanning; no false success message should appear.
- All dates saved in `Asia/Manila`.
- **Only tracking number, operator, courier, and scan-out timestamp are captured.** Product/SKU, quantity, and supplies are blank until later matching to Pancake POS or manual verified entry.
- This is an evidence log, NOT a stock ledger. Inventory, order statuses, supplies, and live Supabase remain UNCHANGED.
- During Supabase recovery, cross-check each waybill against original JA scan-out history and POS; adjust **only missing verified physical movements**. Never replay all entries or do blind bulk deductions.
- Keep regular private exports of the Google Sheet. Never share the operator password or private Sheet URL with customers.

## Troubleshooting

- **`Incorrect scanner access password`**: Use the `SCAN_OPERATOR_PASSWORD` from the new Vercel project, not your Google password or BRIDGE_SECRET.
- **`Scanner not configured`**: Check all 3 Vercel env variables, their lengths, and redeploy.
- **`Save not confirmed`**: Check Sheet for the scanned waybill; verify Apps Script deployment uses newest version, Google authorization granted, and secret matches.
- **Camera permission denied**: Use direct HTTPS Vercel link in Safari/Chrome; allow camera permissions; avoid Messenger in-app browser or iframe.
- **Nothing written**: Verify Apps Script bound to the right Sheet and `SCAN LOG` tab name exactly; Apps Script Executions logs can help; remember `onEdit` does not trigger on API writes and is not needed for them.
- **Scanner library fails**: Check phone internet can load the pinned `html5-qrcode@2.3.8` script from unpkg. Manual entry works without camera library.
- **Multiple fast scans**: UI pauses scanning until explicit **Scan Next Parcel**. Apps Script server lock protects concurrent writes.

## Verified scope / limitations

- JavaScript syntax, error paths, duplicate handling, privacy/no-secrets-in-client, ZIP integrity can be tested offline.
- Live phone camera, Apps Script permission, Vercel deployment, and Google Sheets end-to-end saving must still be tested with your device/account before production use.
