# Conesoft — TODO

Open work from the pre-release audit. Ordered by priority. Items already fixed in the
audit pass are listed at the bottom for context.

---

## ✅ `tokens_used` refactor — IMPLEMENTED (2026-06-03)

Replaced the derived weighted-score quota with an explicit, stored **`tokens_used`**
counter. Per-category counts kept for analytics/bonuses. Decouples the quota *currency*
from *what was converted*, and locks historical pricing so changing weights later doesn't
re-price the past.

**Shipped:** costs image **1** / document **5** / video **8** / audio **6**;
`TRIAL_TOKEN_LIMIT=100`, `DAILY_TOKEN_LIMIT=50`. `spendTokens()` helper; token-based
gate/flip/UsageCard; sync carries `tokens_used` (max-merge). **Spend spills trial→daily**:
a conversion drains remaining trial first, then the overflow lands in the daily bucket (so
93/100 + an 8-token video = 7 trial + 1 daily → daily 1/50), and `tokens_used` **caps at 100**.
Migration `20260603120000_add_tokens_used.sql` (backfill at OLD 1/5/5/5 so existing standing
is kept). The limited→trial reset moved **server-side**: trigger `reset_plan_on_low_tokens`
(`20260603130000`), keeping the `subscription_end IS NULL` churned-subscriber guard.
Client-side `reconcilePlanWithCounts` removed.

> **Apply both migrations** (column first, then trigger) before running signed-in.

**⚠️ Known limitation (accepted — option A):** sign-in still `max`-merges `tokens_used`, so
an admin reset of `tokens_used` only sticks while the user's app is **running** (the realtime
event overwrites local verbatim). If reset while the app is closed, the next sign-in
re-inflates local via `max` and the plan can bounce back to limited. Operational workaround:
tell the customer to keep the app open during a reset. Proper fix if it ever becomes
frequent: **recency-based merge** on sign-in (trust whichever side changed most recently —
server `updated_at` vs last local write — instead of blindly taking `max`).

### Final model (authoritative description: CLAUDE.md → "Conversion Counting & Plans")
- Three meters: **`tokens_used`** (trial budget consumed, **caps at 100**; DB column + local) ·
  **daily tokens** (50/day; local, 24h reset) · **per-category counts** (analytics, decoupled).
- Costs: image **1** / document **5** / video **8** / audio **6**. Existing rows backfilled at
  the OLD flat 1/5/5/5 so standing is preserved; new costs apply going forward.
- **Spend = trial-first, then spill into daily** via the single `spendTokens(engine, plan)`
  helper — one conversion can straddle the boundary (93/100 + 8-token video → 7 trial + 1
  daily, daily 1/50, `tokens_used` lands on 100). Reserve up front; `refund()` reverses the
  exact split on failure. Paid plans ungated.
- Migrations: `20260603120000_add_tokens_used` (column + backfill),
  `20260603130000_reset_plan_on_low_tokens` (server-side limited→trial reset, `subscription_end IS NULL` guard).

> Pairs naturally with item #1 below — once `spendTokens` is the single entry point,
> routing bulk/favicon/compression through it (if you decide they should count) is trivial.

---

## 🔴 Decisions needed / must-do before release

### 1. Conversion counting only fires on the homepage
**The big one.** Counts are incremented solely in `conversionService.convertFile`
(`incrementLocalCount`). The shared `onConversionSuccess` in `src/main.tsx` only syncs to
the server — it never increments. So these paths **bypass counting AND trial/daily limits**:
- Bulk converter — `src/components/bulk-converter/use-bulk-converter.ts` (`startConvert`, watch)
- Favicon generator — `src/pages/favicons.tsx`
- Image compression — `src/pages/image-compression.tsx` (direct `window.electron.convert`)

**Decision:** which of these should count against limits vs. stay free? (You said you'd
decide.) Then:
- If they should count: route them through a shared increment/limit helper (reserve →
  refund-on-failure, mirroring `convertFile`), and add `isAtLimit` gating UI to the bulk,
  favicon, and compression pages.
- If they stay free: document it explicitly and leave as-is.

Note: bulk conversion happens in the main process (`electron/bulk-convert.js`) with no
limit awareness, so enforcing limits there means checking/reserving in the renderer
before invoking, or returning counts from the handler to reserve after.

### 2. ✅ Lighthouse npm-install design — REPLACED with bundled engine (2026-06-11)
The packaged Mac app crashed with `spawn npm ENOENT` (GUI apps don't get the shell PATH).
Implemented option (a): `lighthouse` + `chrome-launcher` are now real dependencies;
`electron/lighthouse-worker.js` runs each audit in a **utilityProcess** (keeps the main
process responsive, desktop+mobile stay parallel) against the bundled Playwright Chromium.
Removed: runtime npm install, registry update check, all install UI (lighthouse page +
sidebar `requiresDownload` flow), `lighthouse-install`/`lighthouse-check-update` IPC.
Lighthouse now updates with app releases (bump the dep when cutting a release).
Old userData `lighthouse-cli` dir is cleaned up on startup.
Smoke-tested in dev (real audit through chrome-launcher + Playwright Chromium). ⚠️ Verify
in a packaged build (see #3) — relies on Electron's ESM-in-asar support for the dynamic
`import('lighthouse')` inside the utility process.

### 3. Verify Playwright Chromium bundling on a clean machine
Audit wired bundling (`extraResources: ms-playwright`, `scripts/install-browser.mjs`,
runtime `PLAYWRIGHT_BROWSERS_PATH`). **Not yet verified with a real packaged build.**
- Run `pnpm package:mac` / `pnpm package:win`.
- Install on a machine with **no** `~/Library/Caches/ms-playwright` (or Windows equiv).
- Confirm Website PDF, Website Screenshot, and Lighthouse all launch the bundled browser.
- Lighthouse specifically: confirms the utilityProcess can ESM-import `lighthouse` from
  inside the asar (Electron supports ESM-in-asar; this is the packaged proof).
- Confirm installer size increase (~150 MB Chromium + ~30 MB lighthouse) is acceptable.

### 4. Verify PDF editor rendering at runtime
`pdfjs-dist` v5 changed `page.render()` to require a `canvas` field (audit added it in
`page-manager.tsx` + `annotation-editor.tsx`). Open a real PDF and confirm thumbnails +
page view render correctly (this was previously a type error that shipped silently).

---

## 🟠 Should do

### 5. Paddle webhook idempotency
`supabase/functions/paddle-webhook/index.ts` has no event dedup — a redelivered
`transaction.completed` re-applies the update. Add a `processed_events` table (event id
PK) and short-circuit already-seen events. (Signature is now constant-time + has a
freshness window.)

### 6. Confirm `subscription.canceled` timing
Webhook sets `plan: 'limited'` immediately and `subscription_end` to the current period
end. With `effective_from: next_billing_period` on cancel, Paddle should fire the event
at period end — verify the user keeps Pro access until then and isn't downgraded early.

### 7. Align bulk converter inputs with the image engine
`electron/bulk-convert.js` can't decode HEIC/HEIF (it calls Sharp directly, no
`heic-convert` path) even though the homepage engine can. Either add the heic-convert
path to bulk or document the gap. (`.bmp` already removed; `.jfif` added.)

### 8. Distribution: Microsoft Store first, signed macOS later
Decided 2026-06-11. (Pricing note: staying at $8/mo / $110 lifetime for now — a sale is
planned instead of a price change.)
- **Windows / Microsoft Store** (current focus): needs an `appx` target + Partner Center
  identity values ($19 one-time individual account). **appx can only be built on Windows**
  — use a Windows machine/VM or GitHub Actions windows runner. The Store signs packages
  (no cert purchase, no SmartScreen) and **handles auto-updates itself** — no
  electron-updater for this channel. electron-builder appx runs full-trust, so
  Sharp/FFmpeg/Chromium/fs.watch behave like normal Win32.
- **macOS** (later): Apple Developer ($99/yr) + Developer ID signing + notarization —
  required for Gatekeeper-clean distribution AND for auto-update (Squirrel.Mac rejects
  unsigned updates). Once signed, add `electron-updater` (~30 lines + static file hosting;
  zip target already exists) for the direct-download channel.

---

## 🟢 Low priority / cleanup

- **Two `formatBytes` implementations** — `src/utils/fileUtils.ts` vs
  `src/components/bulk-converter/format-bytes.ts`. Consolidate.
- **`URL.revokeObjectURL` immediately after `a.click()`** in `converted.tsx` — works in
  Chromium but brittle; consider revoking after a tick.
- **UsageCard daily bars are non-reactive** — `getDailyCounts()` is read at render and not
  in a reactive store, so "Usage today" can show stale numbers until another re-render.
  Move daily counts into a reactive store if it matters.
- **PDF main-process singletons** (`editorBuffer`, `mergedBuffer`) hold full PDFs in memory
  until reset/replace — fine for single-window, revisit if multi-window ever happens.
- **`screenshot-browser-status` says "downloading"** when it's actually launching (nothing
  downloads). Minor label fix (would touch the status type + UI).

---

## ✅ Fixed in the audit pass (for reference)

- Churned/expired subscriber no longer reset to `trial` (and DB no longer overwritten) —
  `reconcilePlanWithCounts` now bails when `subscriptionEnd` is set.
- Playwright Chromium bundling wired (runtime path + build script + extraResources). *(verify — #3)*
- Lighthouse Windows `spawn` EINVAL fixed (`shell:true`) + missing-npm hang fixed (`error` handler).
- `tsc --noEmit` added as a gate to all `package*` scripts; 3 standing type errors fixed.
- Bulk scanner no longer lists `.bmp` (Sharp can't decode it); added `.jfif`.
- Paddle webhook: constant-time signature compare + 5-min freshness window.
- IPC results typed `Uint8Array<ArrayBuffer>`; engines use `new Blob([result])` (no byteOffset risk).
- AVIF no longer misrouted into the HEVC-only `heic-convert` path.
- Removed dead `incrementDailyCount`.
