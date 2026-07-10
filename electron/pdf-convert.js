const { ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const { PDFDocument } = require('pdf-lib')
const { decodeHeic } = require('./convert')

// Image <-> PDF conversions. Kept separate from pdf-tools.js (merge) and pdf-editor.js so the
// converter tools have their own home. All on-device via pdf-lib + sharp (already bundled).

// Standard page sizes in PDF points (72 pt = 1 inch).
const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}

let imagesToPdfBuffer = null

// Embed one image buffer into the doc, choosing PNG (lossless, preserves alpha) or JPEG
// (smaller for photos) so we never bloat the output.
// - decodeHeic first: this libvips build can't decode HEVC-HEIC, so route HEIC/HEIF through
//   the shared heic-convert helper (returns the buffer untouched for everything else).
// - .rotate() with no args auto-orients from the EXIF Orientation tag, so portrait phone
//   photos don't embed sideways (sharp strips metadata on output, baking rotation into pixels).
async function embedImage(doc, rawBuf) {
  const buf = await decodeHeic(rawBuf)
  const meta = await sharp(buf, { failOn: 'none' }).metadata()
  const pipeline = sharp(buf, { failOn: 'none' }).rotate()
  if (meta.hasAlpha) {
    return doc.embedPng(await pipeline.png().toBuffer())
  }
  const jpg = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
  return doc.embedJpg(jpg)
}

// Write a file into a folder without ever overwriting: on a name clash, auto-suffix
// "name (1).ext", "name (2).ext", … The 'wx' flag makes the check+write atomic. Mirrors
// electron/file-save.js's save-converted-file.
async function writeUnique(folderPath, fileName, data) {
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
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
  const fallback = path.join(folderPath, `${base}-${Date.now()}${ext}`)
  await fs.promises.writeFile(fallback, data)
  return fallback
}

function registerPdfConvertHandlers(mainWindow) {
  // Pick image files to turn into a PDF.
  ipcMain.handle('pdf-convert-pick-images', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select images',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'avif', 'heic', 'heif', 'gif', 'tiff', 'tif'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (canceled || !filePaths.length) return { canceled: true, files: [] }
    const files = filePaths.map(fp => ({
      path: fp,
      name: path.basename(fp),
      size: fs.statSync(fp).size,
    }))
    return { canceled: false, files }
  })

  // Build a PDF from an ordered list of image paths.
  // options: { pageSize: 'auto'|'a4'|'letter', orientation: 'portrait'|'landscape', margin: number(pt) }
  ipcMain.handle('pdf-convert-images-to-pdf', async (_e, { images, options }) => {
    try {
      const opts = options ?? {}
      const pageSize = opts.pageSize ?? 'auto'
      const margin = Math.max(0, opts.margin ?? 0)
      const doc = await PDFDocument.create()

      for (const { path: fp } of images) {
        const buf = await fs.promises.readFile(fp)
        const image = await embedImage(doc, buf)
        const iw = image.width
        const ih = image.height

        if (pageSize === 'auto') {
          // Page exactly matches the image (plus optional margin border).
          const page = doc.addPage([iw + margin * 2, ih + margin * 2])
          page.drawImage(image, { x: margin, y: margin, width: iw, height: ih })
        } else {
          let [pw, ph] = PAGE_SIZES[pageSize] ?? PAGE_SIZES.a4
          if (opts.orientation === 'landscape') [pw, ph] = [ph, pw]
          const page = doc.addPage([pw, ph])
          // Scale to fit inside the margins, preserving aspect ratio.
          const availW = pw - margin * 2
          const availH = ph - margin * 2
          const scale = Math.min(availW / iw, availH / ih)
          const dw = iw * scale
          const dh = ih * scale
          page.drawImage(image, {
            x: (pw - dw) / 2,
            y: (ph - dh) / 2,
            width: dw,
            height: dh,
          })
        }
      }

      if (doc.getPageCount() === 0) return { success: false, error: 'No images to convert.' }
      imagesToPdfBuffer = await doc.save()
      return { success: true, pageCount: doc.getPageCount() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('pdf-convert-images-to-pdf-save', async () => {
    if (!imagesToPdfBuffer) return { canceled: true }
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: 'images.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { canceled: true }
    await fs.promises.writeFile(filePath, imagesToPdfBuffer)
    return { canceled: false, filePath }
  })

  ipcMain.handle('pdf-convert-reset', () => {
    imagesToPdfBuffer = null
    return { ok: true }
  })

  // Pick a PDF and hand its bytes straight back so the renderer can render pages with pdfjs.
  // (No singleton mutation - unlike the editor's read-file, this is stateless.)
  ipcMain.handle('pdf-convert-pick-pdf', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths.length) return { canceled: true }
    const fp = filePaths[0]
    const buf = await fs.promises.readFile(fp)
    return { canceled: false, name: path.basename(fp), size: buf.length, data: Array.from(buf) }
  })

  // ── Split / extract pages ────────────────────────────────────────────────────
  // The source PDF is stashed here on pick so the extract/split ops don't have to round-trip the
  // whole file back from the renderer. Single-window, single-document assumption (like the editor).
  let splitSource = null       // { buf, name } - name is the base (no extension)
  let splitExtractBuffer = null // 'extract' mode: one output PDF
  let splitFiles = null         // 'split' mode: [{ name, bytes }]

  ipcMain.handle('pdf-convert-split-pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths.length) return { canceled: true }
    const fp = filePaths[0]
    const buf = await fs.promises.readFile(fp)
    splitSource = { buf, name: path.basename(fp, path.extname(fp)) }
    splitExtractBuffer = null
    splitFiles = null
    return { canceled: false, name: path.basename(fp), size: buf.length, data: Array.from(buf) }
  })

  // Build the output(s) from the selected page indices (0-based).
  // mode 'extract' → one PDF of the selected pages (in ascending page order).
  // mode 'split'   → one PDF per selected page.
  ipcMain.handle('pdf-convert-split-build', async (_e, { pages, mode }) => {
    try {
      if (!splitSource) return { success: false, error: 'No PDF loaded.' }
      const srcDoc = await PDFDocument.load(splitSource.buf)
      const total = srcDoc.getPageCount()
      const sorted = [...new Set(pages)].filter(i => i >= 0 && i < total).sort((a, b) => a - b)
      if (!sorted.length) return { success: false, error: 'No pages selected.' }

      if (mode === 'split') {
        const files = []
        const pad = String(total).length
        for (const idx of sorted) {
          const d = await PDFDocument.create()
          const [p] = await d.copyPages(srcDoc, [idx])
          d.addPage(p)
          files.push({ name: `${splitSource.name}-page-${String(idx + 1).padStart(pad, '0')}.pdf`, bytes: await d.save() })
        }
        splitFiles = files
        splitExtractBuffer = null
        return { success: true, fileCount: files.length }
      }

      // extract
      const newDoc = await PDFDocument.create()
      const copied = await newDoc.copyPages(srcDoc, sorted)
      copied.forEach(p => newDoc.addPage(p))
      splitExtractBuffer = await newDoc.save()
      splitFiles = null
      return { success: true, pageCount: sorted.length }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // Save the built output. 'extract' → one save dialog; 'split' → pick a folder, write all files.
  ipcMain.handle('pdf-convert-split-save', async (_e, { mode }) => {
    if (mode === 'split') {
      if (!splitFiles || !splitFiles.length) return { canceled: true }
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a folder for the split PDFs',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (canceled || !filePaths.length) return { canceled: true }
      const folder = filePaths[0]
      for (const f of splitFiles) await writeUnique(folder, f.name, Buffer.from(f.bytes))
      return { canceled: false, folderPath: folder, count: splitFiles.length }
    }

    if (!splitExtractBuffer) return { canceled: true }
    const base = splitSource ? splitSource.name : 'extracted'
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: `${base}-extracted.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { canceled: true }
    await fs.promises.writeFile(filePath, splitExtractBuffer)
    return { canceled: false, filePath }
  })
}

module.exports = { registerPdfConvertHandlers }
