# Cross-Platform Build Guide (Windows + macOS)

Reference for adding a macOS build **without splitting the repo**. Nothing here is applied
yet — apply it **after** the current Windows build is committed, and verify each ⚠️ step on a
real Mac before relying on it.

> TL;DR: keep one repo. Windows and macOS share 99% of the code; the only real differences
> are (a) a handful of `process.platform` branches already in `main.js`, (b) electron-builder's
> per-platform config blocks already in `package.json`, and (c) platform-specific native
> binaries. Only (c) needs work for macOS.

---

## 1. Why one repo (not two)

The Win/Mac delta is tiny and already isolated:

| Difference | Where | Already handled? |
|---|---|---|
| Window chrome (`vibrancy` vs `backgroundMaterial`), OAuth (`open-url` vs `second-instance`), dock/quit | `main.js` | ✅ `process.platform` branches |
| Targets (dmg/zip + icns vs nsis/appx + ico), Store identity, tiles | `package.json` `build.mac` / `build.win` | ✅ per-platform blocks |
| `conesoft://` protocol → mac `CFBundleURLTypes` + win manifest | top-level `build.protocols` | ✅ emits both |
| Native binaries (sharp `@img/*`, Chromium) | deps + `ms-playwright` | ⚠️ **macOS sharp binaries not yet declared** (section 2) |

Splitting would duplicate the entire React renderer + engines + business logic to isolate
~1% platform code → permanent drift and double maintenance. Don't.

---

## 2. The sharp native-binary gotcha (the one real macOS gap)

electron-builder's pnpm collector **drops sharp's platform-specific `@img/*` binaries** (they
are nested *optional* deps). On Windows this caused the packaged app to launch with **no window**
(sharp's native `.node` was missing → hard crash on `require('sharp')`, swallowed by the
`uncaughtException` handler). Fix: declare the host-platform binaries as **direct** deps so the
collector includes them.

**Windows (current, working):** `@img/sharp-win32-x64@0.34.5` in `dependencies`. On Windows this
package is **self-contained** — libvips DLLs are bundled inside it.

**macOS needs TWO packages per arch** — on macOS/Linux, libvips ships as a *separate* package:

| Arch | binding (match sharp version) | libvips (separate, own version) |
|---|---|---|
| Apple Silicon | `@img/sharp-darwin-arm64@0.34.5` | `@img/sharp-libvips-darwin-arm64@1.2.4` |
| Intel Mac | `@img/sharp-darwin-x64@0.34.5` | `@img/sharp-libvips-darwin-x64@1.2.4` |

> Versions must match what `sharp` pins (see `sharp`'s own `optionalDependencies`): bindings
> track sharp's version (`0.34.5`), libvips is independent (`1.2.4`). **Bump them together when
> upgrading sharp**, or the binary won't load.

### How to declare them

The binaries must be **direct deps** (so electron-builder collects them) but must **not** break
`pnpm install` on the *other* OS. Two options:

**Option A — `optionalDependencies` (recommended; install-safe on both OSes):**
```jsonc
"optionalDependencies": {
  "@img/sharp-win32-x64": "0.34.5",
  "@img/sharp-darwin-arm64": "0.34.5",
  "@img/sharp-darwin-x64": "0.34.5",
  "@img/sharp-libvips-darwin-arm64": "1.2.4",
  "@img/sharp-libvips-darwin-x64": "1.2.4"
}
```
npm/pnpm always skip os/cpu-mismatched **optional** deps without error, so Windows installs only
`win32-x64` and macOS installs only the darwin set.
⚠️ **Verify electron-builder still bundles them:** after `pnpm install` + a `--dir` build, confirm
`release/<platform>-unpacked/resources/app.asar.unpacked/node_modules/@img/` contains the host
binary. We proved the collector includes direct **`dependencies`**; confirm it also includes
direct **`optionalDependencies`** (if it drops them, use Option B).

**Option B — `dependencies` (proven to collect, but verify install):**
Move `@img/sharp-win32-x64` out of `dependencies` and add all five under one section is *not*
possible here — instead keep each platform binary in `dependencies`.
⚠️ **Verify `pnpm install` doesn't error** with an os-mismatched entry in `dependencies` on each
OS (pnpm generally skips os/cpu mismatches; npm errors with `EBADPLATFORM`). If pnpm errors, use
Option A.

> Whichever you pick: after editing `package.json`, run `pnpm install` to refresh
> `pnpm-lock.yaml`, then **commit the lockfile** so CI (`--frozen-lockfile`) reproduces it.

`asarUnpack` already includes `**/node_modules/@img/**/*`, so no change there.

---

## 3. Build each OS on its own runner

electron-builder **cannot cross-compile native modules** — build Windows on Windows, macOS on
macOS. That's not a repo concern; it's a CI concern. Use a GitHub Actions matrix (section 4).

The existing `package:mac` script already targets dmg+zip with the icns icon. ⚠️ It also runs
`electron-rebuild -f -w sharp`; sharp 0.34 uses **prebuilt** `@img` binaries (no compile step),
so that rebuild is likely unnecessary and can be removed once section 2 is in place — verify on
the first Mac build.

---

## 4. GitHub Actions matrix workflow

Create `.github/workflows/build.yml`. Builds Win + Mac from this one repo on every `v*` tag.

```yaml
name: Build desktop

on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            pkg: package:win
          - os: macos-latest        # Apple Silicon runner
            pkg: package:mac
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm ${{ matrix.pkg }}
        env:
          # .env is gitignored — inject the Vite-inlined keys as CI secrets.
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
          # macOS Developer ID signing + notarization (only for distributed dmg, not the Store).
          # Leave unset for an unsigned build (Gatekeeper will warn on launch).
          # CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          # CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          # APPLE_ID: ${{ secrets.APPLE_ID }}
          # APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          # APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os }}
          path: |
            release/*.exe
            release/*.appx
            release/*.dmg
            release/*.zip
          if-no-files-found: ignore
```

Notes:
- **Secrets:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in repo Settings →
  Secrets → Actions. Vite inlines any `VITE_`-prefixed env var at build time, so these flow into
  the bundle exactly like the local `.env`. (Mind the `5`/`S` typo lesson — paste carefully.)
- **Chromium/ffmpeg:** `package:*` runs `install-browser.mjs`, which downloads the host
  platform's Chromium on the runner — no extra setup, ~170 MB per build.
- **Windows appx in CI** is produced **unsigned** (correct — Partner Center re-signs). Don't add
  signtool steps for the Store package.
- **Node:** local dev uses Node 24 (Electron 41's bundled runtime); CI build tooling is fine on
  22 LTS.

---

## 5. macOS distribution notes (beyond building)

- **Not the Mac App Store** (this guide targets a notarized dmg). MAS has its own sandbox +
  provisioning requirements and is a separate effort.
- **Signing + notarization** are required for a dmg that opens without Gatekeeper warnings:
  Apple Developer ID Application cert (`CSC_LINK`) + an app-specific password for notarization.
  electron-builder notarizes automatically when the `APPLE_*` env vars are present.
- **OAuth deep link:** the top-level `build.protocols` already emits `CFBundleURLTypes` into
  `Info.plist`, and `main.js` handles the macOS `open-url` event — so `conesoft://` works on mac
  the same way it does on Windows. (On macOS the redirect arrives via `open-url`, not
  `second-instance`.)
- **Verify the spawn-dependent features** (FFmpeg, bundled Chromium screenshot/PDF, Lighthouse)
  on a real Mac, same as on Windows — they rely on launching bundled binaries.
