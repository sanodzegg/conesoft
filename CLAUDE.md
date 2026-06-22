# Conesoft - Project Reference

Reference for AI-assisted development sessions. Reflects the **actual code** as of the
last audit (see `TODO.md` for open work). When in doubt, trust the code over this file
and update this file when you learn something non-obvious.

Current version: **1.9.1** (`package.json`)

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

**Image conversion gotchas (`electron/convert.js`):**
- `normalizeFormat`: jfif→jpeg, tif→tiff, heic/heif→heif.
- `sharpFormatOptions`: PNG ignores quality (maps to compressionLevel); WebP at q100 → lossless; GIF ignores quality.
- HEIC sniffing reads the `ftyp` box; an **AVIF guard** prevents AVIF (which can share the `mif1` brand) from being routed to the HEVC-only `heic-convert`.
- Video/audio write temp files to `os.tmpdir()` with `randomUUID` and clean them in `finally`.

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

### Spend = trial-first, then spill into daily
`spendTokens(engine, plan)` is the single reservation primitive (replaced the old
`incrementLocalCount`). Free tiers (trial **and** limited) draw from the remaining trial
budget first, then **spill** the remainder into the daily allowance - so one conversion can
straddle the boundary (at 93/100 an 8-token video = 7 trial + 1 daily → daily `1/50`, and
`tokens_used` lands on exactly 100). Returns `[refund, reserved]`; `reserved=false` ⇒ the
combined trial+daily budget can't cover it. Paid plans are ungated (count only). `refund()`
reverses the exact split. Reservation is a synchronous localStorage RMW, so image concurrency
(4) is parallel-safe.

- `convertFile` reserves via `spendTokens` before converting, refunds on failure.
- `convertAll` pre-flights the same spill simulation to skip files the budget can't cover (one
  toast), then dispatches images at concurrency 4 / non-images sequentially.
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
  can be re-inflated on next sign-in (accepted - see `TODO.md`).

### ⚠️ Where metering is wired (and where it ISN'T)
Tokens are spent via `spendTokens` (reserve up front, `refund()` on failure) in these places:
- `conversionService.convertFile` (homepage) - per-engine cost.
- `favicons.tsx` `handleFile` and `image-compression.tsx` `download` - **image** (1); compression
  meters only the actual download (the live preview re-encodes freely). Both gate entry UI with
  `isAtLimit('image', plan)` → "Upgrade to Pro".
- **PDF editor + merge saves** - **document**, via the `usePdfSaveMeter` hook. `spendTokens` takes
  an optional `costOverride`: **first save of a document = 5**, **every later save of the same
  document = 2**. *Editor:* the hook keeps a module-level `editorSavedOnce` flag - the first save
  of an opened file is 5, all subsequent saves are 2 regardless of how much was edited between
  them (`reserveEditorSave()` / `markEditorSaved()`); `resetEditorSaveSession()` fires when a new
  file is opened/closed (`pdf-editor.tsx`), so the singleton is safe (editor is single-file).
  *Merge:* a fresh merge is dirty → first save 5; "Save again" is 2; a re-merge resets to dirty.
  Reserve happens *before* the edit op so an out-of-budget user is blocked before any work; refund
  on op failure or a canceled save dialog. PDF routes stay open to all plans (not gated) - they're
  metered, so a limited user spends daily tokens, trial spends trial tokens, paid is ungated.

The shared `onConversionSuccess` in `main.tsx` only triggers server sync + the exhaustion flip -
**it does not spend.**

→ The **bulk converter + watch mode** are **not metered** because they're **Pro-only** (decided
2026-06-12) - per-file metering of an unbounded folder against a 100-token trial was a poor fit
(a 50-image folder = 50 tokens), and paid plans are ungated anyway. It's gated, not metered, via
the **existing nav-lock pattern**: the nav item carries `paidOnly` (stricter sibling of `proOnly`)
and renders locked (Lock icon, not clickable) for any non-paid plan; the route is guarded by
`PaidRoute` (`router.tsx`) which redirects non-paid plans to `/pricing`. `isChildLocked` in
`navigation-secondary.tsx` is the shared lock predicate: `(isLimited && proOnly) || (!isPaid &&
paidOnly)` - so `proOnly` locks only `limited` (trial still reaches those tools, e.g. metered
compression), while `paidOnly` also locks `trial`. `isPaidPlan(plan)` (`useAuthStore`) is the
single source of truth for "paid". See `TODO.md` #1.

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
- **PDF merge** - drag-reorder, merge, save.
- **PDF editor** - page reorder/rotate/delete, watermark (text/image), form fill, burn
  annotations (highlight/draw/arrow/text). Renders via `pdfjs-dist`.
- **Website PDF** / **Website Screenshot** - Playwright; share one browser instance;
  block trackers, scroll to trigger lazy media, replace videos, strip fixed/chat widgets.
- **Lighthouse** - performance/a11y/best-practices/SEO audit, desktop+mobile in parallel.
  `lighthouse` is a bundled dependency run via its Node API in a utilityProcess against
  the bundled Chromium (no runtime install; updates ship with app releases).
- **Batch rename** - find/replace, prefix/suffix, case, sequential numbering, dedupe preview.
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
- Trigger `handle_new_user` inserts `users` (plan `trial`) + zeroed `conversion_counts` on signup.

### Paddle
- `paddle-webhook`: HMAC-SHA256 signature verify (constant-time + 5-min freshness
  window), maps price IDs → plan (`PRICE_TO_PLAN`), handles `transaction.completed`
  (sets plan, subscription_end, paddle ids) and `subscription.canceled` (→ limited).
  **No idempotency/event-dedup yet** (see TODO).
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
- **Chromium is bundled** via `extraResources: ms-playwright` + `scripts/install-browser.mjs`
  (run by `package*`). At runtime, packaged mode sets
  `PLAYWRIGHT_BROWSERS_PATH = resources/ms-playwright` **before** requiring
  `playwright-core` (`electron/screenshot.js`). Dev uses the developer's own browser cache.
  Adds ~150 MB per installer. **Verify on a clean machine after any packaging change.**
- `package*` scripts gate on `tsc --noEmit` (the plain `vite build` does NOT typecheck -
  esbuild strips types).
- Mac targets dmg+zip; Win target nsis. `postinstall` runs `electron-builder
  install-app-deps` + ffmpeg-static install.

### Lazy loading
- All routes lazy via `React.lazy` under one `<Suspense>` (`router.tsx`).
- Heavy pieces lazy/dynamic: `SvgCodeEditor`, `CropEditor`, `FaviconResults`,
  `ComparisonSlider`; `jszip` and `svgo` (`svgo/browser`!) dynamically imported at call site.
- Vite `manualChunks` splits supabase / ui-vendor / react-vendor.

---

## Dev conventions (keep these)

- **Commits:** single line, no body, no bullet points, no co-author trailer. Never stage
  or commit unless the user explicitly says "commit".
- **No responsive breakpoints** - desktop-only; no `sm:`/`md:`/`lg:` (only `2xl:` scale-ups appear).
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
- `pdfjs-dist` v5 `page.render(...)` requires a `canvas` field alongside `canvasContext`.
- `fileKey(file)` = `name-size-lastModified` - the identity used everywhere for dedupe/state.
- PDF main-process state (`editorBuffer`, `mergedBuffer`) is a module-level singleton (single-window assumption).
