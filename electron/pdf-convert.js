const { ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const { PDFDocument } = require('pdf-lib')

// Image <-> PDF conversions. Kept separate from pdf-tools.js (merge) and pdf-editor.js so the
// converter tools have their own home. All on-device via pdf-lib + sharp (already bundled).

// Standard page sizes in PDF points (72 pt = 1 inch).
const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}

let imagesToPdfBuffer = null

// Embed one image buffer into the doc, choosing PNG (lossless, preserves alpha) or JPEG
// (smaller for photos) so we never bloat the output. sharp normalizes every input format
// (webp, avif, heic, tiff, gif, …) down to something pdf-lib can embed.
async function embedImage(doc, buf) {
  const img = sharp(buf, { failOn: 'none' })
  const meta = await img.metadata()
  if (meta.hasAlpha) {
    const png = await img.clone().png().toBuffer()
    return doc.embedPng(png)
  }
  const jpg = await img.clone().flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
  return doc.embedJpg(jpg)
}

function registerPdfConvertHandlers(mainWindow) {
  // Pick image files to turn into a PDF.
  ipcMain.handle('pdf-convert-pick-images', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select images',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'avif', 'heic', 'heif', 'gif', 'tiff', 'tif', 'bmp'] }],
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
}

module.exports = { registerPdfConvertHandlers }
