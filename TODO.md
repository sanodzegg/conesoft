# Conesoft — TODO

Open work from the pre-release audit. Ordered by priority. Items already fixed in the
audit pass are listed at the bottom for context.

---

## 🎯 Tomorrow's focus — `tokens_used` refactor (spec)

Replace the derived weighted-score quota with an explicit, stored **`tokens_used`**
counter. Keep per-category counts for analytics/bonuses. Decouples the quota *currency*
from *what was converted*, and locks historical pricing so changing weights later doesn't
re-price the past.

### Model
- **`tokens_used`** — lifetime, monotonic (only ever increments). Source of truth for the
  trial gate + a "total ever" stat.
  - **DB:** new column `conversion_counts.tokens_used int not null default 0` (NOT on `users`).
  - **Local:** add `tokens_used` to the `localStorage` counts object — authoritative offline/signed-out.
- **`daily_tokens`** — limited-tier daily allowance. **Local only**, resets every 24h
  (reuse the existing `conesoft_daily_counts` + `resetAt` mechanism). A lifetime
  `tokens_used` can't express "used today," so the daily tier needs its own counter.
- **Per-category counts** (`image/document/video/audio_count`) — keep in DB + local,
  **for analytics/bonuses only**. After this change they are NOT arithmetically linked to
  `tokens_used` (a bonus/promo can make them diverge). `tokens_used` is the quota authority.

### Token costs (integer, replaces fractional weights)
- image = **1**, document = **5**, video = **5**, audio = **5** (mirrors today's "credits").
- **`TRIAL_TOKEN_LIMIT = 100`** (was score threshold 1.0 × TOKEN_TOTAL 100).
- **`DAILY_TOKEN_LIMIT`** — ⚠️ product decision. Today's per-category daily limits
  (img 20 / doc 20 / vid 10 / aud 10) don't map to one number; pick a single daily token
  budget (suggest **20**/day = 20 images or 4 docs). Set this before building.

### Spend path
Centralize into **one helper** (e.g. `spendTokens(engine, plan)`) so every conversion
path uses identical logic — and so wiring bulk/favicon/compression later (item #1) is a
one-line change.
1. **Reserve** before converting: trial → `tokens_used + cost <= TRIAL_TOKEN_LIMIT`;
   limited → `daily_tokens + cost <= DAILY_TOKEN_LIMIT`. Return `[refund, reserved]`.
2. **On success:** `tokens_used += cost` AND `counts[engine] += 1` (local), debounced-sync both.
   Increment by the cost **at spend time** — never recompute from counts (that's the point).
3. **On failure:** `refund()` reverses exactly what was reserved.

### Flip / reconcile (unchanged semantics)
- `plan === 'trial' && tokens_used >= TRIAL_TOKEN_LIMIT` → flip to `limited` (`onPlanExhausted`).
- Reconcile `limited → trial` still requires `tokens_used < limit` **and** `!subscriptionEnd`
  (keeps the audit fix protecting churned subscribers).

### Sync (reuses existing machinery)
- Add `tokens_used` to the `conversion_counts` upsert + the sign-in **max-merge**
  (`Math.max(local, server)` — safe because it's monotonic) + the Realtime handler.
- All guarded by `if (!user || !navigator.onLine)` → offline/signed-out untouched.

### Migration
- `ALTER TABLE conversion_counts ADD COLUMN tokens_used int not null default 0;`
- Backfill once: `tokens_used = image_count*1 + document_count*5 + video_count*5 + audio_count*5`.

### Files to touch
- `src/lib/useConversionCount.ts` — drop `getTrialScore`-from-counts as the gate; add
  `tokens_used` local state + `spendTokens` helper; extend merge/sync/Realtime.
- `src/services/conversionService.ts` — reserve/refund via `spendTokens`.
- `src/components/profile/UsageCard.tsx` — read `tokens_used` directly (no recompute).
- `src/types` if a counts interface gains `tokens_used`.
- `supabase/migrations/` — new migration (column + backfill).

### Open decisions before coding
- [ ] `DAILY_TOKEN_LIMIT` value (suggest 20/day).
- [ ] Confirm token costs (1 / 5 / 5 / 5) are final.

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

### 2. Lighthouse installs `lighthouse` via npm at runtime
`electron/lighthouse.js` runs `npm install lighthouse@latest` into userData on first use.
End users (designers/creators) usually don't have Node/npm on PATH, so the feature fails
for them. (Audit already fixed the Windows `spawn` crash + the missing-npm hang, but the
fundamental design remains.)
**Options:**
- (a) Bundle `lighthouse` as a real dependency and run it via its Node API against the
  bundled Chromium (no npm needed). Preferred but adds significant size.
- (b) Keep on-demand install but ship a bundled Node/npm, or detect-and-disable the
  feature with a clear message when npm is absent.
- (c) Drop the feature for v1 if it can't be made reliable in time.

### 3. Verify Playwright Chromium bundling on a clean machine
Audit wired bundling (`extraResources: ms-playwright`, `scripts/install-browser.mjs`,
runtime `PLAYWRIGHT_BROWSERS_PATH`). **Not yet verified with a real packaged build.**
- Run `pnpm package:mac` / `pnpm package:win`.
- Install on a machine with **no** `~/Library/Caches/ms-playwright` (or Windows equiv).
- Confirm Website PDF, Website Screenshot, and Lighthouse all launch the bundled browser.
- Confirm installer size increase (~150 MB) is acceptable.

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
