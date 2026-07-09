const { app, BrowserWindow, Menu, ipcMain, Notification, screen, shell } = require('electron')
const path = require('path')

// Last-resort handlers so an unexpected throw in the main process doesn't silently kill the
// app. Default Electron behavior on an uncaught exception is to terminate; logging and
// continuing keeps the window alive (the renderer has its own ErrorBoundary). Installed as
// early as possible so they cover startup too.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason)
})

// Register deep link protocol for OAuth callbacks
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('conesoft', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('conesoft')
}
const { registerConvertHandlers } = require('./electron/convert')
const { registerBulkConvertHandlers } = require('./electron/bulk-convert')
const { registerScreenshotHandlers } = require('./electron/screenshot')
const { registerPdfToolsHandlers } = require('./electron/pdf-tools')
const { registerWebsitePdfHandlers } = require('./electron/website-pdf')
const { registerFileSaveHandlers } = require('./electron/file-save')
const { registerBatchRenameHandlers } = require('./electron/batch-rename')
const { registerLighthouseHandlers } = require('./electron/lighthouse')
const { registerPdfEditorHandlers } = require('./electron/pdf-editor')
const { registerPdfConvertHandlers } = require('./electron/pdf-convert')

const isDev = !app.isPackaged

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainWindow = null

function createWindow() {
  // Remove the default app menu bar on Windows/Linux (File/Edit/View/...).
  // Kept on macOS, where the menu lives in the system bar and provides Cmd+Q / edit shortcuts.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(Math.max(Math.round(sw * 0.8), 1100), 1800)
  const height = Math.min(Math.max(Math.round(sh * 0.95), 720), 1200)

  mainWindow = new BrowserWindow({
    width: 1260,
    height: 830,
    icon: path.join(__dirname, 'build/icon.icns'),
    webPreferences: {
      devTools: isDev,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron/preload.js'),
    },
    resizable: false,
    vibrancy: 'fullscreen-ui',
    backgroundMaterial: 'acrylic'
  })

  mainWindow.on('closed', () => { mainWindow = null })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'))
  }

}

ipcMain.on('show-notification', (_e, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show()
  }
})

ipcMain.handle('open-external', (_e, url) => {
  shell.openExternal(url)
})

// Handle OAuth deep link callback (macOS)
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('oauth-callback', url)
    mainWindow.focus()
  }
})

// Handle OAuth deep link callback (Windows - second instance)
app.on('second-instance', (_event, argv) => {
  const url = argv.find(arg => arg.startsWith('conesoft://'))
  if (url && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('oauth-callback', url)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// Only the primary instance boots a window. A second instance already called app.quit()
// above; guarding here ensures app.whenReady() can't still fire createWindow() for it and
// flash a stray window (the exact case single-instance matters - OAuth deep-link relaunch).
if (gotLock) {
  app.whenReady().then(() => {
    createWindow()
    registerConvertHandlers()
    registerBulkConvertHandlers(mainWindow)
    registerScreenshotHandlers(mainWindow)
    registerPdfToolsHandlers(mainWindow)
    registerWebsitePdfHandlers(mainWindow)
    registerFileSaveHandlers(mainWindow)
    registerBatchRenameHandlers()
    registerLighthouseHandlers(mainWindow)
    registerPdfEditorHandlers(mainWindow)
    registerPdfConvertHandlers(mainWindow)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
})
