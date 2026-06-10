const { ipcMain, app, utilityProcess } = require('electron')
const path = require('path')
const fs = require('fs')

// Lighthouse is bundled as a regular dependency and runs in-process (via a utility
// process) against the bundled Playwright Chromium. No runtime npm install — the old
// design spawned `npm install lighthouse` into userData, which crashed in packaged
// builds (GUI apps don't get the shell PATH, so npm was never found). Lighthouse now
// updates with normal app releases.

const AUDIT_TIMEOUT_MS = 3 * 60 * 1000

function getVersion() {
  try {
    return require('lighthouse/package.json').version
  } catch {
    return null
  }
}

function registerLighthouseHandlers() {
  // Remove the old runtime-installed CLI dir if a previous version left one behind.
  try {
    fs.rmSync(path.join(app.getPath('userData'), 'lighthouse-cli'), { recursive: true, force: true })
  } catch {}

  ipcMain.handle('lighthouse-status', () => {
    return { installed: true, version: getVersion() }
  })

  ipcMain.handle('lighthouse-run', async (_e, { url, strategy = 'desktop' }) => {
    // Same bundled Chromium the screenshot/website-pdf features use. screenshot.js sets
    // PLAYWRIGHT_BROWSERS_PATH for packaged builds before playwright-core is first required.
    let chromiumPath
    try {
      const { chromium } = require('playwright-core')
      chromiumPath = chromium.executablePath()
      if (!chromiumPath || !fs.existsSync(chromiumPath)) throw new Error('missing')
    } catch {
      return { success: false, error: 'Browser engine is missing from this build. Reinstall the app to restore Lighthouse.' }
    }

    return new Promise((resolve) => {
      const worker = utilityProcess.fork(path.join(__dirname, 'lighthouse-worker.js'))
      let settled = false

      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
        try { worker.kill() } catch {}
      }

      const timer = setTimeout(() => {
        finish({ success: false, error: 'Audit timed out after 3 minutes' })
      }, AUDIT_TIMEOUT_MS)

      worker.on('message', finish)
      worker.on('exit', () => finish({ success: false, error: 'Audit process exited unexpectedly' }))
      worker.postMessage({ url, strategy, chromiumPath })
    })
  })
}

module.exports = { registerLighthouseHandlers }
