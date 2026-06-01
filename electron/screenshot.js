const { ipcMain, dialog, app } = require('electron')
const fs = require('fs')
const path = require('path')

// In the packaged app Chromium is bundled under resources/ms-playwright
// (electron-builder `extraResources` + the `playwright-core install` step in the
// `package` scripts). Point Playwright at it BEFORE the module computes
// executablePath(). In dev this stays unset so the developer's own browser cache is used.
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright')
}
const { chromium } = require('playwright-core')

let browserInstance = null
let browserReady = false
let browserSetupPromise = null

async function ensureBrowser(mainWindow) {
  if (browserReady) return true
  if (browserSetupPromise) return browserSetupPromise

  browserSetupPromise = (async () => {
    try {
      mainWindow.webContents.send('screenshot-browser-status', { status: 'downloading' })
      const execPath = chromium.executablePath()
      if (!execPath || !fs.existsSync(execPath)) {
        throw new Error('Browser engine is missing from this build. Reinstall the app to restore Website PDF and Screenshot.')
      }
      browserInstance = await chromium.launch({
        executablePath: execPath,
        headless: true,
      })
      browserReady = true
      mainWindow.webContents.send('screenshot-browser-status', { status: 'ready' })
      return true
    } catch (err) {
      browserSetupPromise = null
      mainWindow.webContents.send('screenshot-browser-status', { status: 'error', error: err.message })
      return false
    }
  })()

  return browserSetupPromise
}

function registerScreenshotHandlers(mainWindow) {
  ipcMain.handle('screenshot-ensure-browser', async () => {
    return ensureBrowser(mainWindow)
  })

  ipcMain.handle('screenshot-capture', async (_event, { url, format, viewportWidth, userAgent }) => {
    if (!browserReady) {
      const ok = await ensureBrowser(mainWindow)
      if (!ok) throw new Error('Browser not available')
    }

    const contextOpts = { viewport: { width: viewportWidth, height: 900 } }
    if (userAgent) contextOpts.userAgent = userAgent
    const context = await browserInstance.newContext(contextOpts)

    const page = await context.newPage()

    // Block tracking/analytics to reduce side effects and speed up load
    await page.route('**/*', (route) => {
      const blocked = ['google-analytics', 'googletagmanager', 'facebook.net', 'hotjar', 'intercom', 'crisp.chat', 'tawk.to', 'drift.com']
      const reqUrl = route.request().url()
      if (blocked.some(b => reqUrl.includes(b))) return route.abort()
      return route.continue()
    })

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {})

      // Scroll through the page to trigger lazy-loaded images and video observers
      await page.evaluate(async () => {
        const distance = 300
        const delay = 150
        const totalHeight = document.body.scrollHeight
        let current = 0
        while (current < totalHeight) {
          window.scrollBy(0, distance)
          current += distance
          await new Promise(r => setTimeout(r, delay))
        }
        window.scrollTo(0, 0)
      })

      // Wait for triggered lazy images and video sources to finish loading
      await page.waitForTimeout(2500)

      // Replace video elements with poster image or first frame via canvas
      await page.evaluate(async () => {
        const videos = Array.from(document.querySelectorAll('video'))
        await Promise.all(videos.map(video => new Promise(resolve => {
          const poster = video.getAttribute('poster')
          const rect = video.getBoundingClientRect()
          const w = rect.width || video.offsetWidth || 640
          const h = rect.height || video.offsetHeight || 360
          const img = document.createElement('img')
          img.style.cssText = `width:${w}px;height:${h}px;object-fit:cover;display:block;`
          if (poster) {
            img.onload = resolve
            img.onerror = resolve
            img.src = poster
            video.replaceWith(img)
          } else if (video.src || video.currentSrc) {
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            const tryDraw = () => {
              try { ctx.drawImage(video, 0, 0, w, h) } catch (e) {}
              img.src = canvas.toDataURL()
              img.onload = resolve
              img.onerror = resolve
              video.replaceWith(img)
            }
            if (video.readyState >= 2) {
              video.currentTime = 0
              video.addEventListener('seeked', tryDraw, { once: true })
              setTimeout(tryDraw, 3000)
            } else {
              video.addEventListener('loadeddata', () => {
                video.currentTime = 0
                video.addEventListener('seeked', tryDraw, { once: true })
              }, { once: true })
              setTimeout(tryDraw, 5000)
            }
          } else {
            video.style.setProperty('display', 'none', 'important')
            resolve()
          }
        })))
      })

      // Hide off-canvas drawers (slid outside viewport bounds)
      await page.evaluate(() => {
        const vw = window.innerWidth
        document.querySelectorAll('*').forEach(el => {
          const style = window.getComputedStyle(el)
          if (style.position !== 'fixed' && style.position !== 'absolute') return
          if (style.display === 'none' || style.visibility === 'hidden') return
          const rect = el.getBoundingClientRect()
          if (rect.width > 50 && rect.height > 50 && (rect.x >= vw || rect.right <= 0)) {
            el.style.setProperty('display', 'none', 'important')
          }
        })
      })

      await page.addStyleTag({ content: `
        [id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"] { display: none !important; }
        [role="dialog"][aria-modal="true"], [role="dialog"].is-open, [role="dialog"].open, [role="dialog"].active { display: none !important; }
        [id*="gorgias"], [class*="gorgias"], [id*="intercom"], [class*="intercom"],
        [id*="crisp"], [class*="crisp"], [id*="drift"], [class*="drift"] { display: none !important; }
      ` })

      await page.waitForTimeout(300)

      const screenshotType = format === 'jpg' ? 'jpeg' : format
      const buffer = await page.screenshot({
        fullPage: true,
        type: screenshotType,
        quality: screenshotType === 'jpeg' ? 90 : undefined,
      })

      const base64 = buffer.toString('base64')
      const mimeType = format === 'jpg' ? 'image/jpeg' : `image/${format}`
      return { preview: `data:${mimeType};base64,${base64}`, buffer: Array.from(buffer), format }
    } finally {
      await context.close()
    }
  })

  ipcMain.handle('screenshot-save', async (_event, { buffer, format, url }) => {
    const hostname = new URL(url).hostname.replace(/\./g, '-')
    const filename = `${hostname}.${format}`

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save screenshot',
      defaultPath: filename,
      filters: [{ name: 'Image', extensions: [format] }],
    })

    if (canceled || !filePath) return { canceled: true }

    fs.writeFileSync(filePath, Buffer.from(buffer))
    return { canceled: false, filePath }
  })
}

async function getBrowserInstance(mainWindow) {
  if (browserReady) return browserInstance
  const ok = await ensureBrowser(mainWindow)
  return ok ? browserInstance : null
}

module.exports = { registerScreenshotHandlers, getBrowserInstance }
