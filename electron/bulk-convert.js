const { ipcMain, dialog, app } = require('electron')
const path = require('path')
const fs = require('fs')
const { normalizeFormat, sharpFormatOptions, decodeHeic } = require('./convert')

const sharpPath = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp')
  : 'sharp'
const sharp = require(sharpPath)

// Mirror the formats this Sharp build can actually decode (see imageEngine.ts).
// bmp is intentionally excluded - it isn't compiled into this libvips build, so
// scanning it would only queue files that fail at conversion time.
// heic/heif can't be decoded by sharp's prebuilt libheif (HEVC omitted); convertFile
// routes them through heic-convert first, matching the homepage engine.
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.gif', '.tiff', '.tif', '.avif', '.heic', '.heif', '.svg'])

function isImage(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase())
}

function isSameFormat(filePath, targetFormat) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.' + targetFormat) return true
  // jpg and jpeg are the same format
  if (targetFormat === 'jpg' && ext === '.jpeg') return true
  if (targetFormat === 'jpeg' && ext === '.jpg') return true
  return false
}

// Recursively collect all image paths in a directory
function collectImages(dir) {
  const results = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectImages(full))
    } else if (entry.isFile() && isImage(full)) {
      results.push(full)
    }
  }
  return results
}

async function convertFile(srcPath, targetFormat, quality, outputMode, deleteOriginal, allowOverwrite = false, customOutputFolder = null) {
  const ext = '.' + targetFormat
  const dir = path.dirname(srcPath)
  const base = path.basename(srcPath, path.extname(srcPath))

  let destPath
  if (customOutputFolder) {
    fs.mkdirSync(customOutputFolder, { recursive: true })
    destPath = path.join(customOutputFolder, base + ext)
  } else if (outputMode === 'subfolder') {
    const outDir = path.join(dir, 'converted')
    fs.mkdirSync(outDir, { recursive: true })
    destPath = path.join(outDir, base + ext)
  } else {
    destPath = path.join(dir, base + ext)
  }

  // Skip if source and destination are the same file
  if (path.resolve(srcPath) === path.resolve(destPath)) {
    throw new Error(`Source is already a .${targetFormat} - skipped`)
  }

  // Skip if output already exists - another source file with the same base name was already converted there
  if (!allowOverwrite && fs.existsSync(destPath)) {
    throw new Error(`Output ${base}${ext} already exists - rename conflicting source files first`)
  }

  const srcStat = fs.statSync(srcPath)
  const originalSize = srcStat.size

  const srcExt = path.extname(srcPath).toLowerCase()
  const isSvg = srcExt === '.svg'
  const isHeic = srcExt === '.heic' || srcExt === '.heif'
  const sharpFormat = normalizeFormat(targetFormat)

  // sharp can't decode HEIC/HEIF (HEVC) - decode to a PNG buffer first, like the homepage
  // engine. Everything else streams straight from the path (cheaper than buffering).
  const input = isHeic ? await decodeHeic(fs.readFileSync(srcPath)) : srcPath

  await sharp(input, isSvg ? { density: 300 } : {})
    .toFormat(sharpFormat, sharpFormatOptions(sharpFormat, quality))
    .toFile(destPath)

  const destStat = fs.statSync(destPath)
  const convertedSize = destStat.size
  const savedBytes = originalSize - convertedSize

  if (deleteOriginal && srcPath !== destPath) {
    fs.unlinkSync(srcPath)
  }

  return {
    srcPath,
    destPath,
    originalSize,
    convertedSize,
    savedBytes,
  }
}

// Active watchers: folderPath -> FSWatcher
const watchers = new Map()

function registerBulkConvertHandlers(mainWindow) {
  // Open folder picker
  ipcMain.handle('bulk-pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select folder to convert',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Scan folder and return image list with sizes (no conversion yet)
  ipcMain.handle('bulk-scan-folder', async (_event, { folderPath, targetFormat }) => {
    const images = collectImages(folderPath)
    return images.map(p => ({
      path: p,
      relativePath: path.relative(folderPath, p),
      size: fs.statSync(p).size,
      sameFormat: targetFormat ? isSameFormat(p, targetFormat) : false,
    }))
  })

  // Convert all images in a folder
  ipcMain.handle('bulk-convert-folder', async (event, { folderPath, targetFormat, quality, outputMode, deleteOriginal, customOutputFolder }) => {
    const allImages = collectImages(folderPath)
    // Skip files already in the target format (alongside mode would produce src === dest)
    const images = (outputMode === 'subfolder' || customOutputFolder)
      ? allImages
      : allImages.filter(p => !isSameFormat(p, targetFormat))
    const results = []

    for (const imgPath of images) {
      try {
        const result = await convertFile(imgPath, targetFormat, quality, outputMode, deleteOriginal, false, customOutputFolder)
        results.push({ ok: true, ...result })
      } catch (err) {
        results.push({ ok: false, srcPath: imgPath, error: err.message })
      }
      // Send progress after each file
      event.sender.send('bulk-convert-progress', {
        done: results.length,
        total: images.length,
        latest: results[results.length - 1],
      })
    }

    return results
  })

  // Start watching a folder for new images
  ipcMain.handle('bulk-watch-start', async (_event, { folderPath, targetFormat, quality, outputMode, deleteOriginal, customOutputFolder }) => {
    // Stop any existing watcher for this folder
    if (watchers.has(folderPath)) {
      watchers.get(folderPath).close()
      watchers.delete(folderPath)
    }

    const inProgress = new Set()

    const watcher = fs.watch(folderPath, { recursive: true }, async (eventType, filename) => {
      if (!filename || eventType !== 'rename') return
      const fullPath = path.join(folderPath, filename)

      // Deduplicate - fs.watch fires multiple events for a single file write
      if (inProgress.has(fullPath)) return
      inProgress.add(fullPath)

      // File must exist, be an image, and not already be the target format
      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile() || !isImage(fullPath)) { inProgress.delete(fullPath); return }
        if (path.extname(fullPath).toLowerCase() === '.' + targetFormat) { inProgress.delete(fullPath); return }
      } catch {
        inProgress.delete(fullPath); return // file was deleted
      }

      // Wait for file write to complete
      await new Promise(r => setTimeout(r, 500))

      try {
        const result = await convertFile(fullPath, targetFormat, quality, outputMode, deleteOriginal, true, customOutputFolder)
        mainWindow.webContents.send('bulk-watch-converted', { ok: true, ...result })
      } catch (err) {
        mainWindow.webContents.send('bulk-watch-converted', { ok: false, srcPath: fullPath, error: err.message })
      } finally {
        inProgress.delete(fullPath)
      }
    })

    watchers.set(folderPath, watcher)
    return true
  })

  // Retry a single failed file
  ipcMain.handle('bulk-retry-file', async (_event, { srcPath, targetFormat, quality, outputMode, deleteOriginal, customOutputFolder }) => {
    try {
      const result = await convertFile(srcPath, targetFormat, quality, outputMode, deleteOriginal, true, customOutputFolder)
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, srcPath, error: err.message }
    }
  })

  // Stop watching a folder
  ipcMain.handle('bulk-watch-stop', async (_event, folderPath) => {
    if (watchers.has(folderPath)) {
      watchers.get(folderPath).close()
      watchers.delete(folderPath)
    }
    return true
  })
}

module.exports = { registerBulkConvertHandlers }
