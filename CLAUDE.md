# Conesoft - Project Reference

Reference for AI-assisted development sessions. Reflects the **actual code**. When in doubt,
trust the code over this file and update this file when you learn something non-obvious.

Current version: **1.10.0** (`package.json`)

---

## What is Conesoft

A **local-first Electron desktop app** for file conversion and media tooling. All
processing runs on-device - no uploads, no server. macOS + Windows.

The conversion engines run in the **Electron main process** (Sharp, FFmpeg, pdf-lib,
Playwright). The renderer (React) calls them over IPC. Some browser-only work (SVGO,
background removal via ONNX, JSZip) runs in the renderer.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Electron 41 |
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | Tailwind CSS v4 + shadcn/ui (Base UI primitives, `@base-ui/react`) |
| State | Zustand 5 - slices + `persist` middleware; plus standalone stores |
| Image processing | Sharp (libvips) + `heic-convert` for HEIC/HEIF decode |
| Video/audio | FFmpeg (`ffmpeg-static` + `fluent-ffmpeg`) |
| PDF | `pdf-lib`, `pdfkit`, `pdf-parse`, `mammoth`, `docx`, `pdfjs-dist` (render) |
| Browser automation | `playwright-core` (screenshot, website→PDF, Lighthouse engine) |
| Background removal | `@imgly/background-removal` (ONNX runtime, in renderer) |
| SVG | `svgo` (import from `svgo/browser`), CodeMirror 6 |
| Auth + DB | Supabase (`@supabase/supabase-js`) |
| Payments | Paddle (Billing) via Supabase Edge Functions |
| Routing | React Router DOM v7 (`HashRouter`) |
| Package manager | pnpm |
| Build/distribution | electron-builder |

---

## App Structure

```
main.js                - Electron main process entry (root, NOT electron/main.js)
electron/
  preload.js           - contextBridge: window.electron.* IPC bindings
  convert.js           - image (Sharp), document, favicon, VIDEO + AUDIO (FFmpeg) handlers
  bulk-convert.js      - bulk folder conversion + fs.watch watch mode
  pdf-tools.js         - PDF merge
  pdf-editor.js        - PDF page ops, watermark, form fill, burn annotations
  website-pdf.js       - Playwright website→PDF (shares browser w/ screenshot)
  screenshot.js        - Playwright screenshot + owns the shared browser instance
  lighthouse.js        - Lighthouse runner (bundled dep; forks lighthouse-worker.js)
  lighthouse-worker.js - runs one audit in a utilityProcess (lighthouse Node API +
                         chrome-launcher against the bundled Playwright Chromium)
  batch-rename.js      - folder scan + rename rules
  file-save.js         - pick folder / save buffer to disk (auto-download)

src/
  main.tsx             - App root: providers, ConversionCountContext wiring
  router.tsx           - React.lazy routes under one top-level <Suspense>
  pages/               - one file per route
  components/          - grouped by feature (files, bulk-converter, image-editor,
                         pdf-editor, svg-editor, favicons, settings, profile, ui, …)
  engines/             - ConversionEngine interface + image/video/audio/document + registry
  services/            - conversionService.ts (orchestrates homepage conversions)
  store/
    useConvertStore.ts - persisted Zustand store (file + conversion + settings slices)
    useAuthStore.ts    - auth/plan/subscriptionEnd (standalone, localStorage-backed)
    slices/            - fileSlice, conversionSlice, settingsSlice
  lib/                 - supabase, useAuth (re-export of useAuthStore), useSettingsSync,
                         useConversionCount, ConversionCountContext, pdf-worker
  types/               - index.ts (shared interfaces), electron.d.ts (window.electron API)
  utils/               - fileUtils (fileKey, getExtension, formatBytes), estimateSize

supabase/
  functions/paddle-webhook/      - Paddle webhook (transaction.completed, subscription.canceled)
  functions/cancel-subscription/ - authenticated cancel via Paddle API
  migrations/                    - schema, plan-default fix, paddle fields

scripts/install-browser.mjs      - installs Chromium into ./ms-playwright for bundling
build/                           - app icons (icon.ico/icns/png, tray*) + appx/ Store tiles
```

> **Stale-doc traps:** there is no `electron/main.js` (entry is root `main.js`) and no
> `video-tools.js` (video/audio handlers live in `electron/convert.js`).

---

## Conversion Engines

Each engine implements `ConversionEngine` (`src/engines/ConversionEngine.ts`):
`convert(file, targetFormat, options) => Promise<Blob>`. The registry
(`engineRegistry.ts`) maps file extension → engine (first engine to claim an extension
wins) and exposes output formats, including a `LIMITED_OUTPUT_FORMATS` subset used to
gate certain formats.

| Engine | Inputs | Outputs | Quality used? | Notes |
|---|---|---|---|---|
| image | jpg, jpeg, jfif, png, webp, avif, heic, heif, gif, tiff, tif, svg | webp, png, jpg, avif, gif, tiff | Yes (`imageQuality`) | HEIC/HEIF decoded via `heic-convert` first; SVG rasterized at 300 dpi; **no bmp** (not in this libvips build) |
| video | mp4, mov, avi, mkv, webm | mp4, webm, gif | No | re-encode; resize via complexFilter; GIF forces fps 15 / 640px |
| audio | aac, ac3, aif/aiff/aifc, amr, au, caf, dss, flac, m4a/m4b, mp3, oga, voc, wav, weba, wma | mp3, aac, flac, wav, ogg, aiff, m4a, ac3, au, weba | No | WMA/DSS decode-only; ffmpeg fmt aliases (m4a→ipod, weba→webm) |
| document | pdf, docx, txt | txt, docx, pdf | No | extract text (pdf-parse/mammoth) → pdfkit/docx; **formatting is lost** (text-only) |

**IPC contract:** engine reads `file.arrayBuffer()` → `window.electron.convert*` →
handler returns a Node `Buffer` → arrives in the renderer as a `Uint8Array<ArrayBuffer>`
→ wrap with **`new Blob([result])`** (not `result.buffer` - that can include bytes
outside the view). Types live in `src/types/electron.d.ts`.

> **Video/audio don't buffer the source.** Instead of `arrayBuffer()`, the video/audio engines
> resolve the File's real disk path via `window.electron.getPathForFile(file)` (Electron 32+
> removed `File.path`; `webUtils.getPathForFile` is exposed in `preload.js`) and pass **the path**
> to `convertVideo`/`convertAudio` so ffmpeg reads straight from disk - a multi-GB video never
> enters the renderer heap. They fall back to an `arrayBuffer` only for in-memory Files with no
> path. The handler's first arg is therefore `string | ArrayBuffer`. They also take a **`jobId`**
> (the renderer's `fileKey`) for cancellation and **resolve `null`** when the user cancelled -
> the engine turns that into a thrown `'canceled'`. `getPathForFile` is also how the PDF-editor
> drag-drop resolves its path.

**Image conversion gotchas (`electron/convert.js`):**
- `normalizeFormat`: jfif→jpeg, tif→tiff, heic/heif→heif.
- `sharpFormatOptions`: PNG ignores quality (maps to compressionLevel); WebP at q100 → lossless; GIF ignores quality.
- HEIC sniffing reads the `ftyp` box; an **AVIF guard** prevents AVIF (which can share the `mif1` brand) from being routed to the HEVC-only `heic-convert`. This lives in the exported `decodeHeic(buf)` helper (returns the buffer untouched when it isn't HEVC-HEIC), shared by the homepage handler **and** `bulk-convert.js` so both decode HEIC identically.
- Video/audio write the **output** to a temp file in `os.tmpdir()` (`randomUUID`), cleaned in `finally`. The **input** is the user's real path when available (see IPC contract above), so only the buffer-fallback path writes an input temp file - the `finally` deletes the input temp file **only if we created it** (never the user's source). All I/O is async `fs.promises` (no `*Sync` on the main thread).

**Reliability guards (all in `electron/convert.js` unless noted, added in the 1.10.0 pass):**
- **Content-sniff mismatch guards:** `sniffContainer(buf)` (magic bytes) catches a file whose extension lies - a `.pdf` that's really a docx fails with a clear "looks like a …" message instead of a pdf-parse/mammoth stack trace; a document mislabeled as an image is bounced to the Document converter. (Sharp already auto-detects genuine image-vs-image mislabels, so those just convert.)
- **Friendly ffmpeg errors:** `makeMediaError` logs full stderr to the console but rejects with a short human message (mapping missing-file / unsupported-codec / corrupt-data signatures). Never surface raw stderr.
- **Empty-output validation:** image/video/audio throw if the result buffer is `length === 0`, so a zero-byte "success" fails cleanly and its token is refunded (never counted). Document is exempt (a text-layer-less PDF legitimately extracts to empty text).
- **ffmpeg stall watchdog:** `runFfmpeg(cmd, kind, jobId)` kills the process after `STALL_TIMEOUT_MS` (90s) of **no activity** (start/progress/stderr) - based on time-since-last-progress, so a slow-but-advancing large job is never killed, only a stuck one. Active jobs live in `activeJobs` (keyed by `jobId`) so a user cancel can kill them.
- **Cancellation:** batch + per-file conversions are cancelable. `conversionService.ts` owns the run's `AbortController` at **module scope** (not a component ref) and exposes `cancelActiveConversions()`, so **every** entry point (Convert All **and** the per-file button, both routed through `convertAll`) is cancelable via the one Cancel button. On cancel the in-flight ffmpeg is killed (`cancel-conversion` IPC → `cmd._canceled` → quiet `resolve('canceled')`, no scary rejected-handler log), reserved tokens are **refunded**, and files settle as "Canceled" so the batch counter always completes. Sharp (images) can't be aborted - in-flight images finish, but no new files dispatch after cancel.
- **Auto-download never overwrites:** `save-converted-file` (`electron/file-save.js`) auto-suffixes `name (1).ext`, … via an atomic `wx`-flag write, so colliding output names can't silently clobber each other.

---

## Conversion Counting & Plans  ⚠️ read carefully

This is the most intricate subsystem. Source of truth:
`src/lib/useConversionCount.ts`, `src/services/conversionService.ts`,
`src/store/useAuthStore.ts`, `src/main.tsx`.

### Plans
`trial | limited | monthly | annual | lifetime` (enforced by a DB CHECK constraint).

- **trial** - one-time **token budget** (100 tokens; see below). When exhausted → flips to `limited`.
- **limited** - daily **token budget** (50/day). Means **either** an exhausted trial **or** a
  churned/expired subscription. The two are disambiguated by `subscriptionEnd`:
  non-null ⇒ former subscriber (never resurrect to trial).
- **monthly / annual** - unlimited while active. `effectivePlan()` downgrades them to
  `limited` once `subscriptionEnd` is in the past.
- **lifetime** - unlimited forever.

`useAuthStore` holds `user`, `plan`, `subscriptionEnd`, `loading`. Plan is mirrored to
`localStorage` and kept live via a Supabase Realtime subscription on `users` (so manual
DB edits / webhook updates propagate). `useAuth` is just a re-export of `useAuthStore`.

### Token model (the quota currency)
Usage is metered in **tokens**, stored explicitly (not derived). Three meters, each with one
job (`src/lib/useConversionCount.ts`):
- **`tokens_used`** - lifetime trial budget consumed, **caps at `TRIAL_TOKEN_LIMIT` (100)**.
  Drives the trial gate + the server-side reset. DB column `conversion_counts.tokens_used`,
  mirrored to `localStorage` (`conesoft_conversion_counts`).
- **daily tokens** - the limited tier's allowance, `DAILY_TOKEN_LIMIT` (**50/day**). Local
  only (`conesoft_daily_counts` with a `resetAt`, auto-resets after 24h) - never synced.
- **per-category counts** (`image/document/video/audio_count`) - every conversion ever, for
  analytics/bonuses. **Decoupled** from tokens (a bonus/promo can make them diverge).

**Token costs per conversion:** image **1**, document **5**, video **8**, audio **6**
(`TOKEN_COSTS`). So the 100-token trial ≈ 100 images, or 20 docs, or ~12 videos, or any mix.

**Image *creative tools* surcharge:** the five image-tool downloads (editor export, compression,
favicon set, palette, SVG) do **not** use the flat `TOKEN_COSTS.image`. They bill via
`imageToolCost(plan)` (`useConversionCount.ts`): **1 on trial, 5 on `limited`** (paid ungated).
The homepage converter keeps the flat image cost (1) for every plan. `isAtLimit(engine, plan,
cost?)` takes an optional cost override so a tool's download gate matches its actual charge.

### Spend = trial-first, then spill into daily
`spendTokens(engine, plan)` is the single reservation primitive (replaced the old
`incrementLocalCount`). Free tiers (trial **and** limited) draw from the remaining trial
budget first, then **spill** the remainder into the daily allowance - so one conversion can
straddle the boundary (at 93/100 an 8-token video = 7 trial + 1 daily → daily `1/50`, and
`tokens_used` lands on exactly 100). Returns `[refund, reserved]`; `reserved=false` ⇒ the
combined trial+daily budget can't cover it. Paid plans are ungated (count only). `refund()`
reverses the exact split. Reservation is a synchronous localStorage RMW, so image concurrency
(4) is parallel-safe.

- `convertFile` reserves via `spendTokens` before converting, refunds on failure. **Reservations
  are per-file at task start** (NOT all upfront), so the in-flight exposure is only ≤4 images +
  1 non-image at any moment. Each live reservation is mirrored in a module-level `inFlightRefunds`
  map and reversed on `beforeunload` (`conversionService.ts`), so a **mid-batch page reload refunds
  the in-flight files** instead of leaking their tokens (the `try/catch` refund can't run once the
  JS context is torn down). `refund()`/`commit()` are guarded by a `settled` flag so the unload
  sweep and the failure path never double-reverse; `commit()` drops a succeeded file from the map
  without reversing. ⚠️ Covers reload/close, **not** hard crashes/force-kill; and a refund that
  lands after the 800 ms server sync already pushed can be re-inflated on next sign-in (same
  accepted `max`-merge caveat as the reset trigger). Bulletproofing = a localStorage write-ahead
  ledger reconciled on startup (not built).
- `convertAll` pre-flights the same spill simulation to skip files the budget can't cover (one
  toast), then dispatches images at concurrency 4 / non-images sequentially. The pre-flight is a
  **simulation only** (no spend); the real reservation happens in `convertFile`.
- The trial→limited flip fires from `onConversionSuccess` (`main.tsx`) once `tokens_used` hits
  the cap (plus an upfront flip if already exhausted entering the batch).

### Server sync + the reset
- `useConversionCount(user)`: on sign-in **max-merges** server vs local (counts **and**
  `tokens_used` - all monotonic) and pushes back. Realtime `UPDATE` on `conversion_counts`
  applies admin edits verbatim; our own echoes are skipped via `ownPushTimestamps`.
  `syncCountToServer()` debounced 800 ms. `useCountsStore` exposes `counts`, `tokensUsed`,
  `dailyTokens` reactively.
- **limited → trial reset is server-side**: DB trigger `reset_plan_on_low_tokens` on
  `conversion_counts` sets `plan='trial'` when `tokens_used < 100` **and**
  `subscription_end IS NULL` (churned-subscriber guard). It reaches the app via the
  `users`-table Realtime subscription in `useAuthStore`. The old client-side
  `reconcilePlanWithCounts` is gone. ⚠️ Caveat: sign-in still `max`-merges `tokens_used`, so
  an admin reset only "sticks" while the user's app is **running**; reset while it's closed
  can be re-inflated on next sign-in. **Accepted limitation** (operational workaround: keep the
  app open during a reset). Proper fix if it ever matters: recency-based merge on sign-in (trust
  whichever side changed most recently - server `updated_at` vs last local write - not blind `max`).

### ⚠️ Where metering is wired (and where it ISN'T)
Tokens are spent via `spendTokens` (reserve up front, `refund()` on failure) in these places:
- `conversionService.convertFile` (homepage) - per-engine cost.
- **Image creative tools** (editor export, compression, favicon set), charged on the **actual saved
  download** (not the button click), at `imageToolCost(plan)` (**1 trial / 5 limited**) and **all
  `countCategory:false`** - they spend tokens but are **not** counted as image *conversions* (that
  per-category tally is reserved for the homepage converter). All save through the native dialog via
  `window.electron.saveImageBuffer` (handler in `electron/file-save.js`, returns `{ canceled,
  filePath }`) so a **canceled save refunds** the reserved tokens; the live preview / editing is
  always free. The on-screen `metered` callout (`!isPaidPlan(plan)`) renders the live cost
  (`{cost} token{s}`) so trial shows "1 token" and limited "5 tokens":
  - `image-compression.tsx` `download` - reserves, encodes, saves; refund on cancel or encode error.
    Gates the Download button with `isAtLimit('image', plan, cost)` → "Upgrade to Pro".
  - `favicons.tsx` - generation is **free** (just a preview). The tokens are charged in
    `favicon-results.tsx` on the **first download of a generated set** (ICO / PNG / "Download All"
    zip); every later download of the same set is free (`chargedRef`, resets on remount = new set).
    The dropzone still gates with `isAtLimit('image', plan, cost)`.
  - **Image editor** export (`crop-editor.tsx` → `exportCanvas` returns `'saved' | 'canceled' |
    'failed'`) - reserves before export, refunds on cancel (silent) or failure (toast). **Open to
    all plans**, so trial **and** limited are metered (paid ungated).
- **PDF editor + merge saves** - **document tokens only**, via the `usePdfSaveMeter` hook.
  `spendTokens` takes an options arg `{ cost?, countCategory? }`; PDF saves pass
  `countCategory:false`, so they spend tokens but do **not** bump the per-category "Documents"
  analytics count (that tally is for actual document *conversions* only). Both tools are
  **session-priced**: the **first save of a session = 5**,
  **every later save = 2**, regardless of how much was edited or re-merged in between. Two separate
  module-level flags (`editorSavedOnce` / `mergeSavedOnce`) so the tools don't affect each other.
  *Editor:* `reserveEditorSave()` / `markEditorSaved()`; `resetEditorSaveSession()` fires when a
  file is opened/closed (`pdf-editor.tsx`). *Merge:* `reserveMergeSave()` / `markMergeSaved()`;
  `resetMergeSaveSession()` fires on page mount and on Reset (`pdf-merge.tsx`) - so re-merging
  different files in the same visit still bills as a re-save (2). Reserve happens *before* the edit
  op so an out-of-budget user is blocked before any work; refund on op failure or a canceled save
  dialog. Both PDF tools are `proOnly` (nav-locked for limited + `ProRoute`), so in practice only
  trial users are metered here; paid is ungated.
- **Web tools** (all `countCategory:false`, so no per-category count - not conversions):
  - **Screenshot** (`use-screenshot.ts` `save`) and **Website PDF** (`website-pdf.tsx` `save`) charge
    on **download**, not capture/generate (preview is free), and are **session-priced per page visit**
    (like merge): screenshot **3 then 2**, PDF **5 then 2**. A local `savedOnce` flag (NOT `savedPath`)
    drives this - it's reset on Reset / remount only, **not** on re-capture/re-generate, so tweaking a
    setting and re-downloading bills as a re-save (2), not a fresh artifact. Refund on a canceled save
    dialog.
  - **Lighthouse** (`lighthouse.tsx` `runAudit`) charges **5 per audit** on the run itself, because
    there's no downloadable artifact - the on-screen report *is* the deliverable. One run = the
    desktop+mobile pair, billed once; refunded if both strategies error.
  These three are `proOnly` (nav-locked for limited), so in practice only trial users are metered;
  paid is ungated.
- **Palette extractor** (`palette-extractor.tsx` `handleExport`) and **SVG editor** (`svg-editor.tsx`
  `handleDownload`) charge `imageToolCost(plan)` (**1 trial / 5 limited**) per successful download
  (`countCategory:false` - not conversions), **not** session-priced: each saved file is its own
  charge, and extracting / editing / copying is always free. Both save through
  `window.electron.saveImageBuffer` (text via `TextEncoder`, PNG via base64 decode), so a **canceled
  save refunds**. Both are **open to all plans**, so trial **and** limited are metered (paid
  ungated). Both show the `metered` info callout (`!isPaidPlan(plan)`) rendering the live cost.

The shared `onConversionSuccess` in `main.tsx` only triggers server sync + the exhaustion flip -
**it does not spend.**

→ The **bulk converter + watch mode** and **batch rename** are **not metered** because they're
**Pro-only** (the whole "Batch Operations" nav group). Their work is unbounded per run and not
reliably trackable (a folder of N files = N operations), a poor fit for a 100-token trial, and
paid plans are ungated anyway. They're gated, not metered, via the **existing nav-lock pattern**:
the nav item carries `paidOnly` (stricter sibling of `proOnly`)
and renders locked (Lock icon, not clickable) for any non-paid plan; the route is guarded by
`PaidRoute` (`router.tsx`) which redirects non-paid plans to `/pricing`. `isChildLocked` in
`navigation-secondary.tsx` is the shared lock predicate: `(isLimited && proOnly) || (!isPaid &&
paidOnly)` - so `proOnly` locks only `limited` (trial still reaches those tools, e.g. the metered
web tools + PDF editor/merge), while `paidOnly` also locks `trial`. `isPaidPlan(plan)` (`useAuthStore`)
is the single source of truth for "paid".

---

## Features (verified)

- **Homepage file converter** - drag/drop, per-file format + settings (resize, quality,
  keep-metadata for images), estimated output size (images), Convert All, results with
  download / bulk ZIP, suspicious-savings tooltip, duplicate detection, optional
  **auto-download to folder**. Virtualized lists ≥20 items (`@tanstack/react-virtual`).
- **Bulk converter** (**Pro-only** - `paidOnly` nav lock + `PaidRoute`) - pick folder →
  recursive image scan → convert (alongside / subfolder / custom), delete-originals toggle,
  progress, **watch mode** (`fs.watch`, recursive - macOS/Windows only), per-file retry.
- **Image editor** - canvas editor: Adjust/Effects/Transform/Canvas/Overlay/Background-
  Remove, undo/redo, export dialog. Files can be sent from homepage.
- **Image compression** - live before/after comparison slider, quality, JPEG/WebP/AVIF.
- **Favicon generator** - `.ico` (multi-size) + PNGs (16…1024) + macOS icns set.
- **SVG editor** - CodeMirror, prettify/optimize (SVGO), preview, code export
  (React/Vue/Angular/HTML), data-URI variants.
- **PDF merge** (`proOnly` - nav-locked for limited + `ProRoute`) - drag-reorder, merge, save.
- **PDF editor** (`proOnly` - nav-locked for limited + `ProRoute`) - page reorder/rotate/delete,
  watermark (text/image), form fill, burn annotations (highlight/draw/arrow/text). Renders via
  `pdfjs-dist`.
- **Website PDF** / **Website Screenshot** - Playwright; share one browser instance;
  block trackers, scroll to trigger lazy media, replace videos, strip fixed/chat widgets.
- **Lighthouse** - performance/a11y/best-practices/SEO audit, desktop+mobile in parallel.
  `lighthouse` is a bundled dependency run via its Node API in a utilityProcess against
  the bundled Chromium (no runtime install; updates ship with app releases).
- **Batch rename** (**Pro-only** - `paidOnly` nav lock + `PaidRoute`) - find/replace,
  prefix/suffix, case, sequential numbering, dedupe preview.
- **Settings** - image-quality default, per-engine default formats, default output
  folder; synced to Supabase when signed in (conflict dialog on divergence).
- **Pricing / Account** - Paddle checkout, plan + renewal display, cancel flow.

---

## Auth + Payments

### Supabase (project `otdahhtxvwchkxwehvsq`)
- Client from `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env`, gitignored;
  anon key is safe to ship - Vite inlines it into the renderer bundle).
- Email/password auth; OAuth deep-link plumbing exists (`conesoft://` protocol,
  `open-url` / `second-instance`).

### Tables (all RLS-enabled)
- `users` - id, email, plan, paid_at, license_key, subscription_end, created_at,
  `paddle_customer_id`, `paddle_subscription_id`, `paddle_transaction_id`.
- `settings` - user_id, image_quality, default_*_format, default_output_folder, updated_at.
- `conversion_counts` - user_id, image_count, document_count, video_count,
  **audio_count**, updated_at.
- `processed_events` - `event_id` (PK), event_type, processed_at. Webhook idempotency ledger;
  RLS-on with **no policies** (only the service_role webhook touches it).
- Trigger `handle_new_user` inserts `users` (plan `trial`) + zeroed `conversion_counts` on signup.

### Paddle
- `paddle-webhook`: HMAC-SHA256 signature verify (constant-time + 5-min freshness
  window), maps price IDs → plan (`PRICE_TO_PLAN`), handles `transaction.completed`
  (sets plan, subscription_end, paddle ids) and `subscription.canceled` (→ limited).
  **Idempotent**: dedups on Paddle `event_id` via the `processed_events` ledger - checks at the
  top (skip already-seen → 200), records via `markProcessed` **only after a successful update** so
  failed attempts still retry. Keyed on event_id (not customer/transaction) so distinct purchases
  by one user still both apply; only true redeliveries are dropped.
- `cancel-subscription`: authenticated; cancels via Paddle API `effective_from:
  next_billing_period` (user keeps access until period end; webhook fires at end).
- Edge-function env: `PADDLE_WEBHOOK_SECRET`, `PADDLE_API_KEY`, `PADDLE_SANDBOX`,
  `SUPABASE_*`.

---

## Packaging (electron-builder)

- `asar: true`; `asarUnpack` for sharp, `@img`, `detect-libc`, **semver**, ffmpeg-static,
  heic-convert, **heic-decode**, **jpeg-js**, **pngjs**, libheif-js (native/binary deps must
  run from disk). ⚠️ An **unpacked** module can't resolve a dependency that stays **packed**
  in the asar (Node walks the real `app.asar.unpacked` dir and never re-enters `app.asar`).
  So every runtime dep of an unpacked package must itself be unpacked: `semver` is sharp's
  (its `libvips.js` does `require('semver/functions/coerce')` at load - drop it and the app
  **won't launch**); `heic-decode`/`jpeg-js`/`pngjs` are heic-convert's.
- ⚠️ **Phantom deps in `package.json`** (`core-util-is`, `immediate`, `isarray`, `lie`,
  `pako`, `process-nextick-args`, `readable-stream`, `safe-buffer`, `setimmediate`) are
  **not used directly** - they're transitive deps of `jszip` (via `mammoth` → docx reading in
  the main process). electron-builder's pnpm collector reliably packs **direct** deps but
  **drops some nested transitive ones**, so they're declared direct to force inclusion.
  Versions are pinned to what the nested consumers need (e.g. `readable-stream@2`'s tree).
  **Do not "clean up" these as unused** - removing them breaks packaged builds. After any
  dependency change, re-verify the main-process require closure is fully present in the asar.
- ⚠️ **sharp's platform binary must be a direct dep too.** `@img/sharp-win32-x64` lives in
  `dependencies` for the same reason as the phantom deps above - electron-builder's collector
  **drops sharp's nested optional `@img/*` binary**, and without it `require('sharp')` throws at
  startup so the packaged app launches with **no window** (the throw is swallowed by `main.js`'s
  `uncaughtException` handler). On Windows that one package is self-contained (libvips DLLs inside);
  macOS needs the darwin binding **plus** a separate `@img/sharp-libvips-darwin-*` - see
  `MAC_BUILD.md` (not yet declared). Bump it in lockstep with `sharp` on upgrade.
- **Chromium is bundled** via `extraResources: ms-playwright` + `scripts/install-browser.mjs`
  (run by `package*`). At runtime, packaged mode sets
  `PLAYWRIGHT_BROWSERS_PATH = resources/ms-playwright` **before** requiring
  `playwright-core` (`electron/screenshot.js`). Dev uses the developer's own browser cache.
  Adds ~150 MB per installer. **Verify on a clean machine after any packaging change.**
- `package*` scripts gate on `tsc --noEmit` (the plain `vite build` does NOT typecheck -
  esbuild strips types).
- Mac targets dmg+zip; **Win targets `nsis` (standalone installer) + `appx` (Microsoft Store)**.
  `postinstall` runs `electron-builder install-app-deps` + ffmpeg-static install.

### Microsoft Store (appx)
- Store package = electron-builder's **`appx`** target (⚠️ **not** `msix` - not a valid eb
  target). A `--win` build emits `release/Conesoft <ver>.appx` beside the NSIS `.exe`.
- `build.appx`: `identityName: Conlab.ConeLab`, `publisher: CN=2F9FE4F3-…`, `publisherDisplayName:
  GS Works`, `applicationId: ConeLab`. The manifest **Publisher must exactly equal** the Partner
  Center reserved publisher or upload is rejected.
- eb **self-signs** the appx (cert subject = the publisher) so it can be **sideloaded** for local
  testing; **Partner Center re-signs** on upload - submit the file as-is, no signtool/cert config
  for the Store build.
- **Bump `version`** for every resubmission (can't re-upload the same `x.x.x.0`).
- Store tiles live in `build/appx/` (Square44/150, Wide310x150, StoreLogo); app icons in `build/`
  (`build.win.icon` / `build.mac.icon`, also `main.js`).
- `build.protocols` (`{name: Conesoft, schemes: [conesoft]}`) writes the `conesoft://` scheme into
  the appx manifest + macOS `CFBundleURLTypes`; under appx this **replaces** the runtime
  `setAsDefaultProtocolClient` in `main.js` (a no-op once packaged). See `MAC_BUILD.md` for the
  cross-platform build + the macOS sharp-binary gap.

### Lazy loading
- All routes lazy via `React.lazy` under one `<Suspense>` (`router.tsx`).
- Heavy pieces lazy/dynamic: `SvgCodeEditor`, `CropEditor`, `FaviconResults`,
  `ComparisonSlider`; `jszip` and `svgo` (`svgo/browser`!) dynamically imported at call site.
- Vite `manualChunks` splits supabase / ui-vendor / react-vendor.

---

## Dev conventions (keep these)

- **Commits:** single line, no body, no bullet points, no co-author trailer. Never stage
  or commit unless the user explicitly says "commit".
- **Desktop-only, graduated scale** - no `sm:` (no mobile); nothing below `md`, nothing past `2xl`.
  The standard for built-out pages is a graduated `md:`→`lg:`→`xl:`→`2xl:` ladder: base = compact
  desktop, multi-step values (paddings, container width, box sizes) get real `lg:`/`xl:` midpoints,
  and single-step type/icon sizes reach their comfortable size at `xl:`. Keep this ladder consistent
  when you touch a page. **Done so far:** homepage (`pages/homepage.tsx` + `components/files/*`),
  settings, pricing, account/auth (`pages/auth.tsx` + `components/profile/*`), and the Image tools
  (compression, favicons, palette, svg-editor + their dropzones/results, image-editor page shell).
  **Intentionally left compact:** the image-editor *canvas workspace* (`crop-editor`, the
  `image-editor/toolbar/*` panels) - it's a tool surface, not a content page.
- **Icon colors:** full opacity only - no `/40`-style opacity variants on icon colors.
- **shadcn:** never overwrite existing component files on install.
- `TooltipContent` must be a sibling of `TooltipTrigger`; add `flex-1 min-w-0` to
  `TooltipTrigger` (not a child) for truncation in flex rows.
- Run `pnpm typecheck` before considering work done - the build won't catch type errors otherwise.

---

## Known gotchas worth remembering

- Metering fires on the homepage, favicon, and image-compression paths; **bulk + watch are unmetered by design** (see the ⚠️ section above).
- `'limited'` is overloaded (exhausted trial vs churned sub); disambiguate via `subscriptionEnd`.
- IPC results are `Uint8Array<ArrayBuffer>` → use `new Blob([result])`.
- Packaged app launches but shows **no window** ⇒ a native dep didn't get collected into the asar
  (classically sharp's `@img/*` binary) - it must be a **direct** dep; the crash is swallowed by
  `main.js`'s `uncaughtException` handler. See Packaging.
- `pdfjs-dist` v5 `page.render(...)` requires a `canvas` field alongside `canvasContext`.
- `fileKey(file)` = `name-size-lastModified` - the identity used everywhere for dedupe/state.
- PDF main-process state (`editorBuffer`, `mergedBuffer`) is a module-level singleton (single-window assumption).

---

## Open cleanups (low priority, unblocked)

Small, non-urgent debt - none block release. (Pre-release verification gates and the Paddle
webhook deploy are all done; macOS distribution is deferred - not shipping Mac for now; the
Microsoft Store appx build is **shipped**.)

- **Two `formatBytes` implementations** - `src/utils/fileUtils.ts` vs
  `src/components/bulk-converter/format-bytes.ts`. Consolidate to one.
- **`URL.revokeObjectURL` immediately after `a.click()`** (`converted.tsx`) - works in Chromium
  but brittle; revoke after a tick instead.
- **UsageCard daily bars are non-reactive** - `getDailyCounts()` is read at render, not from a
  reactive store, so "Usage today" can show stale numbers until another re-render. Move daily
  counts into a reactive store if it matters. *(Touches the token/usage subsystem - tread carefully.)*
- **`screenshot-browser-status` says "downloading"** when it's actually launching (nothing
  downloads) - minor label fix (touches the status type + UI).
