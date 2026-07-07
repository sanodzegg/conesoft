# Conesoft Reliability Plan

Working doc for hardening the conversion funnels. Goal: make Conesoft the **most reliable
file converter on the market** — which is a claim about the *edges* (large files, malformed
files, interrupted jobs), not the happy path. The happy path is already good.

**How we work this doc:** one item at a time, top to bottom. Each item has a plan, edge
cases, and a verification step. Update the `Status` line as we go. Don't start an item until
the one above it is `DONE` (unless noted independent).

Status legend: `TODO` · `IN PROGRESS` · `DONE` · `WON'T FIX (why)`

---

## Verdict (2026-07-07 audit)

Conversion **correctness** is genuinely strong — the format-specific handling is careful:
HEIC/AVIF content-sniffing, per-format quality semantics, SAR/even-dimension video
normalization, temp-file cleanup in `finally`. Do not disturb that logic while fixing the
items below.

Conversion **robustness** is where the "most reliable" claim breaks down today: large files
go fully into memory, main-process I/O is synchronous (UI freezes), FFmpeg can hang forever
with no cancel, and auto-download can silently overwrite files. Those are the real gaps.

### What's solid — do not touch
- HEIC/AVIF disambiguation via `ftyp` box sniffing + AVIF guard — `electron/convert.js:114`
- Per-format quality semantics (PNG compressionLevel, WebP lossless@100, GIF ignores) — `electron/convert.js:129`
- Even-dimension / SAR normalization for video — `electron/convert.js:226`
- Temp-file cleanup in `finally` on ffmpeg paths — `electron/convert.js:243`, `275`
- Bulk-convert output-collision guard — `electron/bulk-convert.js:69`

---

## Item 1 — Large files go fully into memory (the hard ceiling)

**Status:** DONE (2026-07-08) — input path streaming shipped (preload `getPathForFile`,
video/audio handlers accept path|buffer, engines prefer path). Async I/O folded in for these
handlers. **Verified at runtime:** converting a 1.3 GB `.mkv` logged `disk path (fast)` — ffmpeg
read straight from disk, no bytes through the renderer heap. Return-trip still buffers the output
(async `readFile`) — acceptable first pass; full output streaming deferred. Image path left
untouched (smaller; later pass). Sidebar sub-task **DONE**: PDF-editor drag-drop now resolves
the path via `getPathForFile` (`src/pages/pdf-editor.tsx:50`) instead of the dead `file.path`.

**Priority:** Highest. This is the crash that most threatens the reliability claim.

**Problem.** For video/audio, the renderer reads the entire file into memory and ships every
byte over IPC, where the main process copies it again before writing a temp file. A ~1.5 GB
video means 3–4 full copies live simultaneously → renderer or main process OOMs and the app
dies mid-conversion.

**Where.**
- `src/engines/videoEngine.ts:19` — `await file.arrayBuffer()` (whole file into renderer heap)
- `src/engines/audioEngine.ts:47` — same pattern
- `electron/convert.js:201` — `fs.writeFileSync(inputPath, Buffer.from(buffer))` (copy #3, in main)
- `electron/convert.js:241` / `273` — `fs.readFileSync(outputPath)` returns the whole output over IPC (copy on the way back too)

**Key insight.** The main process *already writes a temp file*, so the arrayBuffer round-trip
is pure waste. We can hand ffmpeg the source path directly and never move bytes through the
renderer at all.

**⚠️ Getting the path on Electron 41.** `File.path` was **removed in Electron 32** — it is
`undefined` on this build. The correct API is `webUtils.getPathForFile(file)`, which must be
called in the preload and exposed via `contextBridge` (works under `sandbox: true` +
`contextIsolation: true`). Do **not** use `file.path`. (Discovered while planning: the PDF
editor's drag-and-drop open at `src/pages/pdf-editor.tsx:50` already relies on
`(file as any).path` and is therefore **broken on drop today** — the native picker still works.
Fix it with the same `getPathForFile` plumbing while we're in here.)

**Plan.**
1. Expose `getPathForFile(file)` in `electron/preload.js` via `webUtils.getPathForFile`.
2. Make the `convert-video` / `convert-audio` handlers accept **either** a string path **or** a
   buffer as the first arg (detect with `typeof === 'string'`). Path → point ffmpeg straight at
   it, no input temp write. Buffer → today's behavior (in-memory File fallback).
3. In `videoEngine.ts` / `audioEngine.ts`, call `getPathForFile(file)`; if it returns a non-empty
   path, pass the path, else fall back to `arrayBuffer()`.
3. In the main handler: when given a path, skip the input temp-file write and point ffmpeg at
   the real path (still write output to a temp file). When given a buffer, keep today's behavior.
4. For the **return** trip, avoid `readFileSync` of the whole output into an IPC buffer for large
   results. Options (pick during implementation): (a) write output next to a caller-provided
   destination and return the path, or (b) stream. Simplest first pass: still return a buffer but
   only after confirming the size is sane; full streaming can be a follow-up if outputs get huge.
5. This item pairs naturally with Item 2 (async I/O) — do the fs calls async while we're in here.

**Edge cases.**
- File with no path (in-memory File) → `getPathForFile` returns `''`; must still work via buffer fallback.
- Packaged vs dev: `webUtils.getPathForFile` works in both for real dropped/picked files.
- Source path with unusual characters / spaces → ffmpeg gets a real path, fluent-ffmpeg quotes it.
- `webUtils` must be `require`-able in the preload under sandbox — verify at runtime.
- Don't break the image path — images go through Sharp, a different handler; leave untouched for now
  (Sharp can also take a path; consider in a later pass, lower risk since images are smaller).

**Verification.**
- Convert a large real video (≥1 GB) and watch memory in Activity Monitor — should stay flat, not
  balloon to multiples of file size.
- Convert a small in-memory File (no path) to prove the fallback still works.
- Re-run a normal image + doc + audio + video conversion to confirm no regression.
- `pnpm typecheck`.

---

## Item 2 — Synchronous main-process I/O freezes the UI

**Status:** TODO (do together with Item 1 where they overlap)

**Problem.** The Electron main process is single-threaded. Every `fs.*Sync` call blocks it, and
the UI with it, for the duration of the read/write. On big files this reads as "the app hung."

**Where.**
- `electron/convert.js:201`, `241`, `273` — sync write/read of video & audio temp files
- `electron/file-save.js:17`, `32` — sync writes on save/auto-download
- `electron/bulk-convert.js:33` — recursive **synchronous** `readdirSync` folder scan (freezes on large trees)
- `electron/bulk-convert.js:73`, `89` — sync `statSync` per file
- `electron/bulk-convert.js` scans the folder **twice** (`bulk-scan-folder` then again in `bulk-convert-folder`)

**Plan.**
1. Convert the video/audio/file-save fs calls to `fs.promises` (`await fs.writeFile` / `readFile`).
   These handlers are already `async`, so this is mechanical.
2. Make `collectImages` async (`fs.promises.readdir` with `withFileTypes`), await the recursion.
3. Consider caching the scan result so `bulk-convert-folder` doesn't re-walk the tree the scan
   already walked (pass the list from renderer, or memoize by folderPath+mtime). Lower priority.

**Edge cases.**
- Ordering: don't change *when* temp files are cleaned up — keep the `finally` cleanup, just async.
- `fs.rmSync` in `finally` → `await fs.promises.rm(..., { force: true })`, still in `finally`.

**Verification.**
- Scan a folder with thousands of images — UI should stay responsive (spinner animates, window drags).
- Convert while interacting with the UI — no freeze.
- `pnpm typecheck`.

---

## Item 3 — FFmpeg can hang forever; no cancellation anywhere

**Status:** DONE (2026-07-08). Two parts:
- **Watchdog:** `runFfmpeg` (`electron/convert.js`) wraps every video/audio job and kills ffmpeg
  after `STALL_TIMEOUT_MS` (90s) of **no activity** (start/progress/stderr) - so a stuck job fails
  with "conversion stalled" instead of hanging forever, while a slow-but-progressing large job is
  never killed. Temp cleanup still runs via `finally`.
- **User cancel:** batch conversions thread an `AbortSignal` (`conversionService` → `convertFile`),
  a "Cancel" button replaces "Convert All" while converting (`components/files/list.tsx`), and
  in-flight video/audio ffmpeg is killed via `cancelConversion(jobId)` (jobId = `fileKey`,
  registered in `activeJobs`). Killed jobs reject with a quiet `'canceled'` (via `cmd._canceled`),
  refund their reserved tokens, and settle as "Canceled" - the batch counter always completes.
  Images (Sharp, not abortable) finish their ≤4 in-flight, but no new files dispatch after cancel.

**Runtime verification still needed:** (1) corrupt/truncated video → fails with the stall message
after ~90s rather than hanging; (2) start a large video convert, hit Cancel → stops promptly, token
refunded, file shows Canceled. Single-file convert (`convertSingle`) is intentionally not cancelable.

**Problem.** A malformed video can make ffmpeg block with no output. The promise in
`electron/convert.js:204` never settles → file stuck "converting" forever, reserved token
stuck. Separately, the user cannot **abort** a running batch (homepage `convertAll` or bulk).

**Where.**
- `electron/convert.js:204` (video), `262` (audio) — the ffmpeg promise has no timeout
- `src/services/conversionService.ts:137` `convertAll` — no abort signal threaded through
- `electron/bulk-convert.js:132` `bulk-convert-folder` — long loop, no cancel

**Plan.**
1. **Timeout / watchdog** on ffmpeg: track the process (`fluent-ffmpeg` exposes the child via
   `.on('start')` / `command.kill('SIGKILL')`). If no `progress`/`end` event within N seconds
   (or an absolute cap), kill it and reject with a clear "conversion timed out" error, then the
   existing `finally` cleans temp files.
2. **User cancellation (batch):** thread an `AbortSignal` through `convertAll` → `convertFile`.
   On abort: stop dispatching new files, and (stretch) send an IPC "cancel" that kills the
   in-flight ffmpeg child. Refund reserved tokens for cancelled files (the refund plumbing in
   `conversionService.ts` already exists — reuse it).
3. Bulk: add a `bulk-convert-cancel` channel that sets a flag the loop checks between files.

**Edge cases.**
- Timeout must not fire on a *legitimately slow but progressing* large conversion → base the
  watchdog on "time since last progress event," not total elapsed.
- Killing ffmpeg must still hit the `finally` temp cleanup.
- Abort mid-batch must leave already-succeeded files intact and refund only the unstarted/in-flight.

**Verification.**
- Feed a deliberately truncated/corrupt video → should fail with a clean timeout message, not hang.
- Start a big batch, hit cancel → stops promptly, succeeded files remain, tokens for the rest refunded.
- `pnpm typecheck`.

---

## Item 4 — Auto-download silently overwrites on filename collision

**Status:** DONE (2026-07-08) — `save-converted-file` now never overwrites: it auto-suffixes
`name (1).ext`, `name (2).ext`, … using the `wx` (exclusive-create) flag so racing auto-saves
can't clobber each other, and returns the actual path written. Async I/O. Needs a quick runtime
check (convert two sources that map to the same output name → both land).

**Problem.** Auto-download writes `f.name` with a bare `writeFileSync` and no collision check.
Converting `photo.jpg` **and** `photo.png` both to WebP produces two `photo.webp` → the second
silently destroys the first. **Silent data loss** — the worst category for a file tool.

**Where.**
- `src/components/files/converted.tsx:60` → `window.electron.saveConvertedFile(folder, f.name, buf)`
- `electron/file-save.js:15` — `save-converted-file` handler, `fs.writeFileSync(dest)` unconditionally
- Contrast: `electron/bulk-convert.js:69` already does the right thing (throws on existing output)

**Plan.**
1. In the `save-converted-file` handler, if `dest` exists, don't overwrite — auto-suffix a unique
   name (`photo (1).webp`, `photo (2).webp`, …) and write that. Return the final path.
2. (Optional) Surface the renamed path back to the UI so the user can see where it actually landed.
3. Keep the manual "Save" dialog path as-is (the OS dialog already handles overwrite prompts).

**Edge cases.**
- Race between two auto-saves resolving near-simultaneously → the existence check + write should be
  as atomic as practical; worst case use `wx` flag write and retry with next suffix on `EEXIST`.
- Don't infinite-loop the suffix search — cap and fall back to a timestamp/uuid suffix.

**Verification.**
- Enable auto-download, convert two different source files that map to the same output name →
  both files land, neither is lost.
- `pnpm typecheck`.

---

## Item 5 — Everything routes by file extension (mislabeled files fail confusingly)

**Status:** DONE (2026-07-08) — added `sniffContainer` magic-byte check (`electron/convert.js`).
Document handler now fails clearly when a `.pdf`/`.docx` is really another type (instead of a
pdf-parse/mammoth stack trace). Image handler rejects a PDF/Office file mislabeled as an image
with "use the Document converter." Note: Sharp already auto-detects image content, so genuine
image-vs-image mislabels (JPEG named `.png`) just convert correctly - no guard needed there.

**Problem.** Except for the HEIC content-sniff, the engine is chosen purely by extension
(`getExtension` in `src/utils/fileUtils.ts`). A `.png` that's really a JPEG, or a mislabeled
`.pdf`, is sent to the wrong engine and fails with a raw library error. The document engine
(`electron/convert.js:29`) is strictest — extension is the only signal.

**Where.**
- `src/engines/engineRegistry.ts:19` `getEngineForFile` — extension → engine
- `electron/convert.js:29` `extractText` — throws on format mismatch
- Sharp/ffmpeg are somewhat content-tolerant already; documents are the brittle case.

**Plan.**
1. Add lightweight magic-byte sniffing (we already sniff HEIC/SVG) for the common cases —
   at minimum distinguish PDF (`%PDF`), PNG, JPEG, and the ZIP-based docx (`PK\x03\x04`).
2. When the sniffed type disagrees with the extension, either (a) route by content, or (b) fail
   with a *clear* message: "This file looks like a JPEG, not a PNG — rename it and try again."
3. Keep it minimal — this is about turning confusing failures into clear ones, not a full
   content-type engine.

**Edge cases.**
- Don't over-trust sniffing for ambiguous containers (HEIC/AVIF already handled separately).
- SVG is text — keep the existing `<svg`/`<?xml` header check.

**Verification.**
- Rename a JPEG to `.png` and drop it → clear message or correct conversion, not a raw Sharp error.
- Rename a docx to `.pdf` → clean message instead of a pdf-parse stack trace.
- `pnpm typecheck`.

---

## Item 6 — Raw FFmpeg stderr leaks to users

**Status:** DONE (2026-07-08) — `makeMediaError` (`electron/convert.js`) logs full stderr to the
console for debugging but rejects with a short human message, mapping a few known signatures
(missing file, unsupported codec, corrupt/invalid data) to specific sentences. Wired into both
the video and audio error handlers (audio previously passed raw `reject`).

**Problem.** `electron/convert.js:238` rejects with the entire ffmpeg stderr dump, which becomes
the user-facing failure message. Reliable-feeling tools translate errors; they don't leak the
engine's internals.

**Where.**
- `electron/convert.js:238` — `reject(new Error(stderr || err.message))`
- `electron/convert.js:269` (audio) — passes raw ffmpeg error
- `src/services/conversionService.ts:121` — surfaces `err.message` directly into `setFailedFile`

**Plan.**
1. In the ffmpeg error handler, log the full stderr to the console/main log for debugging, but
   reject with a **short, human message** ("Couldn't convert this video — the file may be corrupt
   or use an unsupported codec.").
2. Optionally map a few known stderr signatures (unknown codec, invalid data, no such file) to
   specific friendly messages.

**Edge cases.**
- Keep full detail in logs so we can still debug real reports.
- Don't swallow genuinely useful info (e.g. "unsupported codec: X") — surface the *codec* if easy.

**Verification.**
- Trigger a real ffmpeg failure → UI shows a clean sentence, full detail in the dev console.
- `pnpm typecheck`.

---

## Item 7 — No output validation (zero-byte "successes")

**Status:** DONE (2026-07-08) — image, video, and audio handlers now throw if the output buffer
is empty (`result.length === 0`), so a zero-byte result fails cleanly and the existing refund
path in `conversionService.convertFile` reverses the token spend instead of counting a false
success. Used `> 0` (not a floor) so legitimately tiny outputs still pass. Document handler left
as-is (a text-layer-less PDF legitimately extracts to empty text; a floor would false-fail).

**Problem.** Nothing checks the result buffer is non-empty / plausibly valid before it's returned
as a successful conversion. A zero-byte or truncated output currently counts as success **and**
spends the token.

**Where.**
- `electron/convert.js:169` (image), `241` (video), `273` (audio) — return whatever came back
- `src/services/conversionService.ts:113` — `setConvertedFile` on any non-throw

**Plan.**
1. After each conversion, assert the output buffer length > 0 (and ideally a sane minimum for the
   format). Throw a clear error if not, so the existing refund path in `convertFile` reverses the
   token spend and the file shows as failed, not falsely succeeded.
2. Cheap sanity: for known magic-byte formats, verify the output header matches the target format.

**Edge cases.**
- Legitimately tiny outputs (a 1×1 transparent PNG) exist — use `> 0`, not an aggressive floor.

**Verification.**
- Force a zero-byte output (mock) → file shows as failed and the token is refunded, not consumed.
- `pnpm typecheck`.

---

## Cross-cutting notes
- After **any** change here, run `pnpm typecheck` — the build does not typecheck (`vite build`
  strips types via esbuild). See CLAUDE.md.
- Don't meter/charge differently as a side effect of these fixes — token logic is intricate and
  out of scope; only ensure refunds fire correctly when a conversion now fails that previously
  (wrongly) succeeded (Items 3 and 7).
- Keep changes surgical around the format-specific logic listed under "What's solid."
