# Formlee Apply Agent — browser extension (V1.2)

A Manifest V3 Chrome extension that pairs with the Formlee workspace and fills
examination application forms **only after you review and approve the plan**.
It never submits, never pays, and never touches passwords, OTPs, CAPTCHAs,
payments, declarations or file uploads.

> **JEE Main 2027 (Session 1) is Beta.** The adapter is backed by the official
> NTA Information Bulletin and public notices, but the live application form
> sits behind registration/login and has **not** been inspected end to end.
> Only documentation-backed labels can be mapped; everything else is left to
> the student. The synthetic local fixtures are clearly labelled and are not
> official NTA pages.

## What it does

1. Pairs with your Formlee workspace using a one-time 15-minute code shown on
   `/apply/agent` — the httpOnly Formlee cookie never becomes visible to this
   extension; pairing only yields a short-lived, workspace-scoped agent
   session that the server can revoke.
2. On your request ("Inspect this page"), reads **metadata** of visible form
   fields — labels, input kinds, required flags, dropdown/radio options, and
   accessible group context. It never reads what you typed into any field.
3. Sends those labels to the Formlee server. On the generic demo the server maps
   them with deterministic rules (a locally-configured Ollama model is consulted
   only for labels the rules cannot classify — labels/option text only, never
   your actual answers). On a supported JEE Main 2027 page the local model is
   **never** used; only the documented adapter labels are mapped.
4. Shows you the proposed fill plan. You check the fields you approve
   (model-suggested mappings start unchecked) and press **Fill approved
   fields**. Nothing is filled without that explicit click.
5. Re-scans the page and refuses to fill if the structure changed after your
   preview. After writing, it reads each control back and reports a field it
   could not verify instead of claiming success.
6. Reports every field it could not fill and why (no saved value, no matching
   dropdown option, page changed, refused for safety …).
7. Stops there. Submission, payment, CAPTCHA, OTP, declarations and document
   uploads stay yours.

## Install (unpacked, Chrome / Edge)

1. Start the Formlee server (from the repo root):

   ```
   npm run dev
   ```

   and open `http://localhost:3000/apply/agent`.

2. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the folder
   `extensions/formlee-apply-agent` (the folder containing `manifest.json`).
5. Pin the "Formlee Apply Agent" icon from the extensions (puzzle) menu.

## First run

1. On `/apply/agent`, press **Generate pairing code** (valid 15 minutes,
   single use). Each new connection needs a fresh code.
2. Click the extension icon, paste the code (e.g. `ABCDE-FGHJK-MNPQR`),
   press **Pair**. The popup shows "Connected" with a countdown (30-minute
   session; you can revoke it any time with "Cancel agent connection" on the
   Formlee page or "Disconnect here" in the popup).
3. Try the safe demonstration form at
   `http://localhost:3000/apply/agent/demo-form` — press **Inspect this
   page**, review the plan (including the deliberately ambiguous and unsafe
   probes), approve fields, press **Fill approved fields**.

## Where the extension works

Declared host permissions are deliberately limited to:

- `http://localhost:3000/*` and `http://127.0.0.1:3000/*` — the Formlee app,
  the existing demonstration form, and the synthetic JEE/VITEEE fixtures;
  these local origins appear only in development packages.
- `https://examinationservices.nic.in/JeeMaink2027/*` — the exact official
  application origin and path prefix published from the NTA site. The worker
  independently re-checks the origin and path before injecting anything, so
  lookalike domains, other NTA hosts and unrelated sites are rejected even if
  Chrome grants broader access.
- `https://viteee.vit.ac.in/*` — the exact VITEEE origin; its adapter remains
  documentation-backed/demo only and has not been verified on the live portal.

The extension inspects the active page only after you press **Scan this form**
in the Side Panel (or **Inspect this page** in the popup fallback). It does not
run as a content script on every page and holds no global "read every website"
permission.

## JEE Main 2027 pages

The adapter supports **Personal Details** and **Qualification Details** only.
It can propose: candidate name, date of birth (single date control or verified
day/month/year group), gender, category, email, mobile, Class 10/12 board,
passing year and roll number, each only when the saved profile value matches
the portal control. It leaves confirmation fields, parent names, nationality,
State of Eligibility, address, exam choices, PwD/certificate data, identity
numbers, uploads, declarations, payment and submission untouched.

The synthetic fixtures at `/apply/agent/jee-main-2027-demo` and
`/apply/agent/jee-main-2027-demo/qualification` reuse documented labels only.
They are not official pages and never submit or upload anything.

## Files

- `manifest.json` — MV3 manifest (permissions: `storage`, `activeTab`,
  `scripting`, `sidePanel`; explicit host allowlist above).
- `shared/agent-core.js` — shared origin/URL, page-kind, fingerprint, plan
  freshness, approval and write-verification policy used by the worker, the
  tests and the page agent.
- `background.js` — service worker: pairing, allowlist gate, detection→mapping
  calls, value fetches, fill orchestration. Stores the short-lived agent
  session token and expiry, and a time-limited inspected plan in extension
  private storage.
- `popup.html` / `popup.css` / `popup.js` — the control surface: pairing,
  JEE page/banner, plan review, approve-fill, results. Page-derived text is
  rendered with `textContent` only.
- `content/agent.js` — in-page scanner/filler. Refuses password inputs,
  OTP/CAPTCHA/payment/identity/declaration/upload fields, dispatches
  `input`/`change` events after setting values via native prototypes, verifies
  read-back values, and never submits.

## Safety posture (V1.2)

- Single-use pairing code, expiring agent session, revocable from both sides.
- The extension can only list/fill fields the server's canonical allowlist
  accepts; model output is validated against the same allowlist. The local
  model is disabled on JEE pages.
- Attacker-influenced page labels cannot trigger a fill by themselves: fill
  requires the workspace-specific session **and** an explicit click in the
  popup, and every fill re-verifies the page fingerprint and each field's
  identity in the page.
- Query strings (including one-time portal tokens) are stripped before page
  context is stored or sent; plans contain labels/status only, not values.
- No CAPTCHA/OTP bypass, no payment automation, no submission, no uploads,
  no declaration ticking and no portal password storage.

## Development and production packages

Build clean unpacked folders from the repository root:

```sh
npm run extension:dev
npm run extension:production
```

The development package targets `http://localhost:3000` and includes the
existing local demo routes plus the two supported portal origins. The
production package takes its API origin from the public, non-secret
`FORMLEE_PRODUCTION_API_ORIGIN` environment variable and adds only that exact
HTTPS origin to the manifest. Production packages omit localhost permissions
and local demo content-script matches. The origin is compiled into the
package; it cannot be changed by extension storage or a runtime permission
prompt.

The Formlee production domain has not been confirmed. Until it is, the
production build uses `https://replace-with-confirmed-formlee-origin.invalid`
and refuses API requests. That placeholder package is loadable for a manifest
check, but it is not deployable or publishable. Once the real public app origin
is confirmed, set `FORMLEE_PRODUCTION_API_ORIGIN` in the build process and run
the production command again. Do not put credentials in that variable.

Build output is created under `dist/` (ignored by Git). Load the printed
production folder using Chrome's **Load unpacked**. The package excludes this
README, source maps, environment files and development-only artifacts. Chrome
114 or later is required for the Side Panel API.

Run extension packaging and policy tests with `npm run test:extension`; they
are also included in `npm run test:focused`.

## Authentication and local data

The extension exchanges a one-time Formlee pairing code for the existing
30-minute workspace-scoped agent session. Its token remains in extension
private `chrome.storage.local`; the website's httpOnly session cookie is never
read or copied into the extension. Expired and server-rejected sessions are
cleared. Extension Disconnect revokes the presented token on the server,
removes the local token and scanned plan, and clears profile values held in
supported-page Pet memory. Formlee web sign-out also revokes that workspace's
agent sessions. Pairing a different workspace while still connected is
blocked until Disconnect is used.

Persistent extension storage contains the short-lived agent token and expiry,
the inspected plan (field labels and status, not saved values), pending credit
finalization references, and non-sensitive Pet display preferences (position,
hidden/minimized state, and reduced motion). Saved student values are fetched
from the authorized Formlee workspace for the current operation and held in
the open extension/page JavaScript memory; they are not persisted to extension
storage. Values are sent to a supported form only after explicit approval.
Page field labels and metadata are sent to Formlee for mapping. Chat messages
are sent to the Formlee server; the deployed AI-provider and storage
configuration must be reflected in final public privacy and data-use terms.

## Chrome Web Store readiness

The manifest name, description and icons exist. A future listing still needs
final screenshots, a confirmed public support/contact address, a published
privacy policy, and disclosures reviewed against actual production hosting,
AI-provider and storage configuration. Do not publish until the placeholder
origin is replaced and those disclosures are complete. No Store listing or
privacy-policy URL has been created as part of this task.
