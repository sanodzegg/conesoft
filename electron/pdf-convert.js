const { ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } = require('pdf-lib')
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

// ── Compression ────────────────────────────────────────────────────────────────
// Each level maps to a JPEG quality + a max pixel dimension. Downscaling oversized images is
// where most of the real size win lives; the quality drop does the rest.
const COMPRESS_LEVELS = {
  low: { quality: 85, maxDim: 3500 },          // lighter squeeze, best quality
  recommended: { quality: 72, maxDim: 2200 },
  high: { quality: 58, maxDim: 1600 },         // smallest file
}

// Recompress one image stream if (and only if) it's a plain JPEG (DCTDecode) and the result is
// actually smaller. Returns the new bytes + dims, or null to leave the original untouched.
// We deliberately only touch DCTDecode: FlateDecode/raw images need colorspace-aware decoding and
// are risky to rewrite, so we skip them rather than corrupt anything. No EXIF .rotate() here - a
// PDF places images via its own matrix and ignores the JPEG's EXIF orientation, so rotating would
// mis-orient the image relative to the page.
async function recompressOne(obj, level) {
  const { quality, maxDim } = COMPRESS_LEVELS[level] ?? COMPRESS_LEVELS.recommended
  const dict = obj.dict
  const subtype = dict.get(PDFName.of('Subtype'))
  if (!subtype || subtype.toString() !== '/Image') return null
  const filter = dict.get(PDFName.of('Filter'))
  if (!filter || filter.toString() !== '/DCTDecode') return null

  const original = Buffer.from(obj.contents)
  const meta = await sharp(original, { failOn: 'none' }).metadata()
  const isGray = meta.channels === 1
  let pipe = sharp(original, { failOn: 'none' })
  if (meta.width && meta.height && Math.max(meta.width, meta.height) > maxDim) {
    pipe = pipe.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
  }
  // Normalize colorspace so CMYK/ICC JPEGs don't need a /Decode array or invert in-viewer.
  pipe = isGray ? pipe.toColourspace('b-w') : pipe.toColourspace('srgb')
  const bytes = await pipe.jpeg({ quality, mozjpeg: true }).toBuffer()
  if (bytes.length >= original.length) return null
  const outMeta = await sharp(bytes).metadata()
  return { bytes, width: outMeta.width, height: outMeta.height, isGray }
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

  // ── Compress ───────────────────────────────────────────────────────────────
  let compressSource = null   // { buf, name }
  let compressResult = null   // Buffer/Uint8Array of the smaller output (or the original)

  ipcMain.handle('pdf-compress-pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths.length) return { canceled: true }
    const fp = filePaths[0]
    const buf = await fs.promises.readFile(fp)
    compressSource = { buf, name: path.basename(fp, path.extname(fp)) }
    compressResult = null
    return { canceled: false, name: path.basename(fp), size: buf.length }
  })

  // Two passes: (1) recompress embedded JPEGs via sharp, (2) always re-save with object streams
  // so even image-free PDFs get the structural win. Never returns a bigger file than the input.
  ipcMain.handle('pdf-compress-run', async (_e, { level }) => {
    try {
      if (!compressSource) return { success: false, error: 'No PDF loaded.' }
      const doc = await PDFDocument.load(compressSource.buf)
      let images = 0
      for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue
        try {
          const res = await recompressOne(obj, level)
          if (!res) continue
          const dict = obj.dict
          dict.set(PDFName.of('Width'), doc.context.obj(res.width))
          dict.set(PDFName.of('Height'), doc.context.obj(res.height))
          dict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8))
          dict.set(PDFName.of('ColorSpace'), PDFName.of(res.isGray ? 'DeviceGray' : 'DeviceRGB'))
          dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
          dict.set(PDFName.of('Length'), doc.context.obj(res.bytes.length))
          dict.delete(PDFName.of('DecodeParms'))
          dict.delete(PDFName.of('Decode'))
          doc.context.assign(ref, PDFRawStream.of(dict, res.bytes))
          images++
        } catch { /* leave this image untouched */ }
      }
      const rebuilt = await doc.save({ useObjectStreams: true })
      const originalSize = compressSource.buf.length
      // Honesty guard: if we couldn't beat the original, hand back the original bytes.
      compressResult = rebuilt.length < originalSize ? rebuilt : compressSource.buf
      return { success: true, originalSize, compressedSize: compressResult.length, images }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('pdf-compress-save', async () => {
    if (!compressResult) return { canceled: true }
    const base = compressSource ? compressSource.name : 'compressed'
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save compressed PDF',
      defaultPath: `${base}-compressed.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { canceled: true }
    await fs.promises.writeFile(filePath, compressResult)
    return { canceled: false, filePath }
  })

  // ── Page numbers ───────────────────────────────────────────────────────────
  let pageNumSource = null   // { buf, name }
  let pageNumResult = null

  ipcMain.handle('pdf-pagenumbers-pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths.length) return { canceled: true }
    const fp = filePaths[0]
    const buf = await fs.promises.readFile(fp)
    pageNumSource = { buf, name: path.basename(fp, path.extname(fp)) }
    pageNumResult = null
    return { canceled: false, name: path.basename(fp), size: buf.length, data: Array.from(buf) }
  })

  // Burn page numbers onto each page in range.
  // options: { position, format: 'n'|'n-of-total'|'n-slash-total', fontSize, margin, startPage, startNumber }
  ipcMain.handle('pdf-pagenumbers-apply', async (_e, { options }) => {
    try {
      if (!pageNumSource) return { success: false, error: 'No PDF loaded.' }
      const o = options ?? {}
      const doc = await PDFDocument.load(pageNumSource.buf)
      const pages = doc.getPages()
      const total = pages.length
      const fontSize = Math.max(6, Math.min(72, o.fontSize ?? 11))
      const margin = Math.max(0, o.margin ?? 28)
      const startPage = Math.max(1, Math.min(total, o.startPage ?? 1))
      const startNumber = o.startNumber ?? 1
      const position = o.position ?? 'bottom-center'
      const format = o.format ?? 'n'
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const isTop = position.startsWith('top')
      const maxNumber = startNumber + (total - startPage)

      for (let i = startPage - 1; i < total; i++) {
        const page = pages[i]
        const num = startNumber + (i - (startPage - 1))
        const text = format === 'n-of-total' ? `Page ${num} of ${maxNumber}`
          : format === 'n-slash-total' ? `${num} / ${maxNumber}`
          : `${num}`
        const { width, height } = page.getSize()
        const tw = font.widthOfTextAtSize(text, fontSize)
        const th = font.heightAtSize(fontSize)
        let x
        if (position.endsWith('left')) x = margin
        else if (position.endsWith('right')) x = width - margin - tw
        else x = (width - tw) / 2
        const y = isTop ? height - margin - th : margin // bottom: baseline `margin` up from edge
        page.drawText(text, { x, y, size: fontSize, font, color: rgb(0, 0, 0) })
      }

      pageNumResult = await doc.save()
      return { success: true, numbered: total - startPage + 1 }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('pdf-pagenumbers-save', async () => {
    if (!pageNumResult) return { canceled: true }
    const base = pageNumSource ? pageNumSource.name : 'numbered'
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: `${base}-numbered.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { canceled: true }
    await fs.promises.writeFile(filePath, pageNumResult)
    return { canceled: false, filePath }
  })

  // ── Header / footer text ─────────────────────────────────────────────────────
  let headerFooterSource = null   // { buf, name }
  let headerFooterResult = null

  ipcMain.handle('pdf-headerfooter-pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths.length) return { canceled: true }
    const fp = filePaths[0]
    const buf = await fs.promises.readFile(fp)
    headerFooterSource = { buf, name: path.basename(fp, path.extname(fp)) }
    headerFooterResult = null
    return { canceled: false, name: path.basename(fp), size: buf.length, data: Array.from(buf) }
  })

  // Draw up to six text slots (header/footer × left/center/right) on every page.
  // Tokens {page} {pages} {date} are substituted per page. Same drawText engine as page numbers.
  // options: { header:{left,center,right}, footer:{left,center,right}, fontSize, margin, skipFirst }
  ipcMain.handle('pdf-headerfooter-apply', async (_e, { options }) => {
    try {
      if (!headerFooterSource) return { success: false, error: 'No PDF loaded.' }
      const o = options ?? {}
      const doc = await PDFDocument.load(headerFooterSource.buf)
      const pages = doc.getPages()
      const total = pages.length
      const fontSize = Math.max(6, Math.min(72, o.fontSize ?? 10))
      const margin = Math.max(0, o.margin ?? 28)
      const skipFirst = !!o.skipFirst
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      const slots = [['header', 'left'], ['header', 'center'], ['header', 'right'], ['footer', 'left'], ['footer', 'center'], ['footer', 'right']]
      const slotText = (row, align) => (o[row] && o[row][align]) ? String(o[row][align]) : ''

      let drew = 0
      for (let i = 0; i < total; i++) {
        if (skipFirst && i === 0) continue
        const page = pages[i]
        const { width, height } = page.getSize()
        const th = font.heightAtSize(fontSize)
        for (const [row, align] of slots) {
          const raw = slotText(row, align)
          if (!raw) continue
          const text = raw.replaceAll('{page}', String(i + 1)).replaceAll('{pages}', String(total)).replaceAll('{date}', dateStr)
          const tw = font.widthOfTextAtSize(text, fontSize)
          let x
          if (align === 'left') x = margin
          else if (align === 'right') x = width - margin - tw
          else x = (width - tw) / 2
          const y = row === 'header' ? height - margin - th : margin
          page.drawText(text, { x, y, size: fontSize, font, color: rgb(0, 0, 0) })
          drew++
        }
      }
      if (drew === 0) return { success: false, error: 'Add some header or footer text first.' }
      headerFooterResult = await doc.save()
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('pdf-headerfooter-save', async () => {
    if (!headerFooterResult) return { canceled: true }
    const base = headerFooterSource ? headerFooterSource.name : 'header-footer'
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: `${base}-labeled.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { canceled: true }
    await fs.promises.writeFile(filePath, headerFooterResult)
    return { canceled: false, filePath }
  })
}

module.exports = { registerPdfConvertHandlers }
