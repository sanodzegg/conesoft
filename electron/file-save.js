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
    const dest = path.join(folderPath, fileName)
    fs.writeFileSync(dest, Buffer.from(buffer))
    return dest
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
