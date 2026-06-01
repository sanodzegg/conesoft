// Installs the Playwright Chromium build into ./ms-playwright so electron-builder can
// bundle it via `extraResources`. Run automatically by the `package*` scripts.
// The packaged app points PLAYWRIGHT_BROWSERS_PATH at resources/ms-playwright
// (see electron/screenshot.js), so the version installed here must match playwright-core.
import { execFileSync } from 'node:child_process'

const BROWSERS_DIR = 'ms-playwright'

try {
  execFileSync(
    process.execPath,
    ['node_modules/playwright-core/cli.js', 'install', 'chromium'],
    { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR } }
  )
  console.log(`\n✓ Chromium installed into ./${BROWSERS_DIR} for bundling.`)
} catch (err) {
  console.error('\n✗ Failed to install Chromium for bundling:', err.message)
  process.exit(1)
}
