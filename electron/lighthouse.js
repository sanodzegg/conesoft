const { ipcMain, app } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile, spawn } = require('child_process') // execFile used for lighthouse-run
const https = require('https')

const LIGHTHOUSE_DIR = path.join(app.getPath('userData'), 'lighthouse-cli')
const LIGHTHOUSE_BIN = path.join(LIGHTHOUSE_DIR, 'node_modules', '.bin', 'lighthouse')
const STATUS_FILE = path.join(LIGHTHOUSE_DIR, 'installed.json')

function isInstalled() {
  return fs.existsSync(LIGHTHOUSE_BIN) && fs.existsSync(STATUS_FILE)
}

function getVersion() {
  try {
    const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
    return data.version ?? null
  } catch {
    return null
  }
}

function registerLighthouseHandlers(mainWindow) {
  ipcMain.handle('lighthouse-status', () => {
    return { installed: isInstalled(), version: getVersion() }
  })

  ipcMain.handle('lighthouse-check-update', () => {
    return new Promise((resolve) => {
      const req = https.get('https://registry.npmjs.org/lighthouse/latest', { headers: { 'User-Agent': 'conesoft-app' } }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const { version } = JSON.parse(data)
            resolve({ latestVersion: version })
          } catch {
            resolve({ latestVersion: null })
          }
        })
      })
      req.on('error', () => resolve({ latestVersion: null }))
      req.setTimeout(8000, () => { req.destroy(); resolve({ latestVersion: null }) })
    })
  })

  ipcMain.handle('lighthouse-install', async () => {
    return new Promise((resolve) => {
      fs.mkdirSync(LIGHTHOUSE_DIR, { recursive: true })

      const pkgPath = path.join(LIGHTHOUSE_DIR, 'package.json')
      if (!fs.existsSync(pkgPath)) {
        fs.writeFileSync(pkgPath, JSON.stringify({ name: 'conesoft-lighthouse', version: '1.0.0', private: true }))
      }

      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      // shell:true on Windows — Node refuses to spawn .cmd files directly (EINVAL) since the
      // CVE-2024-27980 fix. On posix npm is a normal executable so no shell is needed.
      const child = spawn(npm, ['install', 'lighthouse@latest', '--save-exact'], {
        cwd: LIGHTHOUSE_DIR,
        shell: process.platform === 'win32',
      })

      // If npm isn't on PATH, spawn emits 'error' and 'close' never fires — without this the
      // install would hang forever. Resolve cleanly with an actionable message instead.
      child.on('error', (err) => {
        const msg = err.code === 'ENOENT'
          ? 'npm was not found on this system. Node.js (which includes npm) is required to install the Lighthouse engine.'
          : err.message
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lighthouse-install-progress', { status: 'error', error: msg })
        }
        resolve({ success: false, error: msg })
      })

      // npm prints one "added N packages" line at the end — we can't get real per-package
      // progress, so we simulate smooth fill by counting stderr dots and lines over time.
      let tick = 0
      const TOTAL_TICKS = 80 // rough number of output lines a fresh lighthouse install produces

      function sendProgress(pct) {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lighthouse-install-progress', { status: 'progress', pct })
        }
      }

      child.stdout.on('data', () => {
        tick = Math.min(tick + 1, TOTAL_TICKS - 1)
        sendProgress(Math.round((tick / TOTAL_TICKS) * 95))
      })

      child.stderr.on('data', () => {
        tick = Math.min(tick + 1, TOTAL_TICKS - 1)
        sendProgress(Math.round((tick / TOTAL_TICKS) * 95))
      })

      child.on('close', (code) => {
        if (code !== 0) {
          mainWindow.webContents.send('lighthouse-install-progress', { status: 'error', error: `npm exited with code ${code}` })
          resolve({ success: false, error: `npm exited with code ${code}` })
          return
        }
        try {
          const pkgJson = JSON.parse(fs.readFileSync(path.join(LIGHTHOUSE_DIR, 'node_modules', 'lighthouse', 'package.json'), 'utf8'))
          fs.writeFileSync(STATUS_FILE, JSON.stringify({ version: pkgJson.version }))
          mainWindow.webContents.send('lighthouse-install-progress', { status: 'done', version: pkgJson.version })
          resolve({ success: true, version: pkgJson.version })
        } catch (e) {
          mainWindow.webContents.send('lighthouse-install-progress', { status: 'error', error: e.message })
          resolve({ success: false, error: e.message })
        }
      })
    })
  })

  ipcMain.handle('lighthouse-run', async (_e, { url, strategy = 'desktop' }) => {
    if (!isInstalled()) return { success: false, error: 'Lighthouse not installed' }

    // Get Playwright chromium path
    let chromiumPath
    try {
      const { chromium } = require('playwright-core')
      chromiumPath = chromium.executablePath()
    } catch {
      return { success: false, error: 'Chromium not available' }
    }

    return new Promise((resolve) => {
      const args = [
        url,
        '--output=json',
        '--output-path=stdout',
        '--chrome-path=' + chromiumPath,
        '--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-extensions',
        '--only-categories=performance,accessibility,best-practices,seo',
        '--quiet',
        '--no-enable-error-reporting',
        ...(strategy === 'desktop' ? ['--preset=desktop'] : []),
      ]

      execFile(LIGHTHOUSE_BIN, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) {
          resolve({ success: false, error: err.message })
          return
        }
        try {
          const report = JSON.parse(stdout)
          const cats = report.categories
          const audits = report.audits

          resolve({
            success: true,
            scores: {
              performance: Math.round((cats.performance?.score ?? 0) * 100),
              accessibility: Math.round((cats.accessibility?.score ?? 0) * 100),
              bestPractices: Math.round((cats['best-practices']?.score ?? 0) * 100),
              seo: Math.round((cats.seo?.score ?? 0) * 100),
            },
            webVitals: {
              lcp: audits['largest-contentful-paint']?.displayValue ?? null,
              fcp: audits['first-contentful-paint']?.displayValue ?? null,
              cls: audits['cumulative-layout-shift']?.displayValue ?? null,
              tbt: audits['total-blocking-time']?.displayValue ?? null,
              si: audits['speed-index']?.displayValue ?? null,
            },
            topIssues: Object.values(audits)
              .filter((a) => a.score !== null && a.score < 0.9 && a.details?.type !== 'debugdata')
              .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
              .slice(0, 10)
              .map((a) => {
                // Extract detail rows from the audit's details table
                let items = []
                const d = a.details
                if (d && (d.type === 'table' || d.type === 'opportunity') && Array.isArray(d.items)) {
                  items = d.items.slice(0, 5).map((item) => {
                    const row = {}
                    // Pull out the most useful fields from each row
                    if (item.node?.snippet) row.node = item.node.snippet
                    if (item.node?.nodeLabel) row.nodeLabel = item.node.nodeLabel
                    if (item.url) row.url = typeof item.url === 'string' ? item.url : item.url?.value ?? null
                    if (item.source?.url) row.url = item.source.url
                    if (item.label) row.label = item.label
                    if (item.groupLabel) row.label = item.groupLabel
                    if (item.duration != null) row.duration = Math.round(item.duration) + ' ms'
                    if (item.wastedMs != null) row.wastedMs = Math.round(item.wastedMs) + ' ms'
                    if (item.wastedBytes != null) row.wastedBytes = Math.round(item.wastedBytes / 1024) + ' KB'
                    if (item.totalBytes != null) row.totalBytes = Math.round(item.totalBytes / 1024) + ' KB'
                    if (item.transferSize != null) row.transferSize = Math.round(item.transferSize / 1024) + ' KB'
                    if (item.cacheLifetimeMs != null) row.cacheLifetime = Math.round(item.cacheLifetimeMs / 1000) + ' s'
                    return row
                  }).filter((row) => Object.keys(row).length > 0)
                }
                return {
                  id: a.id,
                  title: a.title,
                  description: a.description
                    ? a.description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').slice(0, 200)
                    : null,
                  score: a.score,
                  displayValue: a.displayValue ?? null,
                  items,
                }
              }),
          })
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse report' })
        }
      })
    })
  })
}

module.exports = { registerLighthouseHandlers }
