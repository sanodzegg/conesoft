const { ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

function registerFileSaveHandlers(mainWindow) {
  ipcMain.handle('pick-download-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select auto-download folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('save-converted-file', async (_event, folderPath, fileName, buffer) => {
    const data = Buffer.from(buffer)
    const ext = path.extname(fileName)
    const base = path.basename(fileName, ext)
    // Never overwrite: if the name is taken, auto-suffix "name (1).ext", "name (2).ext", ...
    // The 'wx' flag makes the existence check + write atomic, so two auto-saves racing to the
    // same name can't clobber each other - the loser gets EEXIST and takes the next suffix.
    for (let i = 0; i < 1000; i++) {
      const candidate = i === 0
        ? path.join(folderPath, fileName)
        : path.join(folderPath, `${base} (${i})${ext}`)
      try {
        await fs.promises.writeFile(candidate, data, { flag: 'wx' })
        return candidate
      } catch (err) {
        if (err.code === 'EEXIST') continue
        throw err
      }
    }
    // Pathological fallback (1000 collisions): a timestamped name is effectively unique.
    const fallback = path.join(folderPath, `${base}-${Date.now()}${ext}`)
    await fs.promises.writeFile(fallback, data)
    return fallback
  })

  // Save an in-memory file (image editor export, favicon download, etc.) via a native save
  // dialog so the renderer can tell a real save apart from a canceled dialog - which lets a
  // metered caller refund its token on cancel.
  ipcMain.handle('save-image-buffer', async (_event, { buffer, fileName, format, title }) => {
    const ext = format === 'jpeg' ? 'jpg' : format
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: title || 'Save image',
      defaultPath: fileName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (canceled || !filePath) return { canceled: true }
    fs.writeFileSync(filePath, Buffer.from(buffer))
    return { canceled: false, filePath }
  })
}

module.exports = { registerFileSaveHandlers }
