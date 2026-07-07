const { ipcMain, app } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { randomUUID } = require('crypto')

// In production, sharp must be loaded from the unpacked asar directory
const sharpPath = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp')
  : 'sharp'
const sharp = require(sharpPath)

const heicConvert = require('heic-convert')

// ffmpeg-static binary path (unpacked from asar in production).
// ffmpeg-static names the binary `ffmpeg.exe` on Windows and `ffmpeg` elsewhere - the
// packaged path must match or video/audio conversion fails with ENOENT on Windows.
const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const ffmpegStaticPath = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', ffmpegBinaryName)
  : require('ffmpeg-static')
const ffmpeg = require('fluent-ffmpeg')

const pdfParse = require('pdf-parse')
const { Document, Packer, Paragraph, TextRun } = require('docx')
const mammoth = require('mammoth')
const PDFDocument = require('pdfkit')

async function extractText(buffer, sourceFormat) {
  switch (sourceFormat) {
    case 'pdf': {
      const data = await pdfParse(buffer)
      return data.text
    }
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer })
      return result.value
    }
    case 'txt':
      return buffer.toString('utf-8')
    default:
      throw new Error(`Cannot extract text from format: ${sourceFormat}`)
  }
}

async function textToPdf(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 })
    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.font('Helvetica').fontSize(11)
    text.split('\n').forEach(line => doc.text(line || ' '))
    doc.end()
  })
}

async function textToDocx(text) {
  const paragraphs = text.split('\n').map(line => new Paragraph({ children: [new TextRun(line)] }))
  const doc = new Document({ sections: [{ children: paragraphs }] })
  return Packer.toBuffer(doc)
}

const FAVICON_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]

// Encode multiple PNG buffers into a single .ico file
function encodeIco(pngBuffers) {
  const HEADER_SIZE = 6
  const DIR_ENTRY_SIZE = 16
  const numImages = pngBuffers.length
  let offset = HEADER_SIZE + DIR_ENTRY_SIZE * numImages

  const header = Buffer.alloc(HEADER_SIZE)
  header.writeUInt16LE(0, 0)        // reserved
  header.writeUInt16LE(1, 2)        // type: 1 = ICO
  header.writeUInt16LE(numImages, 4)

  const dirEntries = []
  for (let i = 0; i < numImages; i++) {
    const size = FAVICON_SIZES[i]
    const png = pngBuffers[i]
    const entry = Buffer.alloc(DIR_ENTRY_SIZE)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)   // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)   // height
    entry.writeUInt8(0, 2)   // color count
    entry.writeUInt8(0, 3)   // reserved
    entry.writeUInt16LE(1, 4)   // color planes
    entry.writeUInt16LE(32, 6)  // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    dirEntries.push(entry)
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers])
}

// Normalize input/output format aliases to what sharp actually accepts
function normalizeFormat(fmt) {
  if (fmt === 'jfif') return 'jpeg'
  if (fmt === 'tif') return 'tiff'
  if (fmt === 'heic' || fmt === 'heif') return 'heif'
  return fmt
}

// HEIC/HEIF uses HEVC which sharp's prebuilt libheif omits - decode via heic-convert first.
// ftyp box is at bytes 4-7; major brand at 8-11 distinguishes HEIC from MP4/MOV.
// AVIF shares the generic 'mif1'/'msf1' brands with HEIF but is AV1, not HEVC -
// sharp decodes it natively, so it must NOT be sent to heic-convert. Detect the
// 'avif'/'avis' brand anywhere in the ftyp box (major + compatible brands) and skip.
// Returns the buffer untouched when it isn't HEVC-HEIC, so callers can pass anything.
// Centralised so both single-file and bulk-convert use identical decode logic.
async function decodeHeic(buf) {
  const brand = buf.subarray(8, 12).toString('ascii')
  const isFtyp = buf.subarray(4, 8).toString('ascii') === 'ftyp'
  const ftypBox = buf.subarray(0, 32).toString('ascii')
  const isAvif = ftypBox.includes('avif') || ftypBox.includes('avis') || ftypBox.includes('av01')
  const isHeic = isFtyp && !isAvif &&
    (brand.startsWith('hei') || brand.startsWith('hev') || brand === 'mif1' || brand === 'msf1')
  if (isHeic) {
    return Buffer.from(await heicConvert({ buffer: buf, format: 'PNG', quality: 1 }))
  }
  return buf
}

// Build Sharp format options for a given target format and quality (1–100).
// Centralised so both single-file and bulk-convert use identical logic.
function sharpFormatOptions(sharpFormat, quality) {
  if (sharpFormat === 'png') {
    // Sharp ignores `quality` for PNG - map to compressionLevel (0=fast/large, 9=slow/small).
    return { compressionLevel: Math.round((100 - quality) / 100 * 9) }
  }
  if (sharpFormat === 'webp') {
    // At quality 100 use lossless - avoids the lossy-at-max bloat vs a lossless source.
    return quality >= 100 ? { lossless: true } : { quality }
  }
  if (sharpFormat === 'gif') {
    // Sharp GIF output ignores quality entirely.
    return {}
  }
  // jpeg, avif, heif, tiff - quality maps directly
  return { quality }
}

function registerConvertHandlers() {
  ipcMain.handle('convert-file', async (_event, buffer, targetFormat, quality = 60, imageOptions = {}) => {
    const { width, height, fit, keepMetadata = true } = imageOptions
    const sharpFormat = normalizeFormat(targetFormat)
    let buf = await decodeHeic(Buffer.from(buffer))

    // SVG needs density (DPI) set at read time for proper rasterization.
    // Check the first 512 bytes to handle <?xml ...?> preambles and BOMs.
    const header = buf.subarray(0, 512).toString('utf8')
    const isSvg = header.includes('<svg') || (header.includes('<?xml') && header.includes('<svg'))
    let pipeline = isSvg ? sharp(buf, { density: 300 }) : sharp(buf)

    if (keepMetadata) pipeline = pipeline.keepMetadata()

    if (width || height) {
      const fitMap = { max: 'inside', crop: 'cover', scale: 'fill' }
      pipeline = pipeline.resize({
        width: width || undefined,
        height: height || undefined,
        fit: fitMap[fit] || 'inside',
      })
    }

    const result = await pipeline.toFormat(sharpFormat, sharpFormatOptions(sharpFormat, quality)).toBuffer()
    return result
  })

  ipcMain.handle('convert-document', async (_event, buffer, targetFormat, sourceFormat) => {
    const buf = Buffer.from(buffer)
    const text = await extractText(buf, sourceFormat)

    if (targetFormat === 'txt') return Buffer.from(text, 'utf-8')
    if (targetFormat === 'pdf') return textToPdf(text)
    if (targetFormat === 'docx') return textToDocx(text)

    throw new Error(`Unsupported target format: ${targetFormat}`)
  })

  ipcMain.handle('convert-favicon', async (_event, buffer) => {
    const src = Buffer.from(buffer)
    const pngBuffers = await Promise.all(
      FAVICON_SIZES.map(size =>
        sharp(src).resize(size, size, { fit: 'cover' }).png().toBuffer()
      )
    )
    const ico = encodeIco(pngBuffers)
    return { ico, pngs: pngBuffers.map((buf, i) => ({ size: FAVICON_SIZES[i], buf })) }
  })

  ipcMain.handle('convert-video', async (_event, source, sourceExt, targetFormat, videoOptions = {}) => {
    const { width, height, fit } = videoOptions
    const tmpDir = os.tmpdir()
    const outputPath = path.join(tmpDir, `${randomUUID()}.${targetFormat}`)

    // `source` is either an absolute path (large-file fast path: ffmpeg reads it directly,
    // no bytes through the renderer) or an ArrayBuffer (in-memory File fallback → temp file).
    const usePath = typeof source === 'string'
    const inputPath = usePath ? source : path.join(tmpDir, `${randomUUID()}.${sourceExt}`)
    if (!usePath) await fs.promises.writeFile(inputPath, Buffer.from(source))

    try {
      await new Promise((resolve, reject) => {
        const cmd = ffmpeg(inputPath).setFfmpegPath(ffmpegStaticPath)

        if (width || height) {
          // For Scale fit, missing dimension defaults to the other (square output)
          const effectiveWidth = width || (fit === 'scale' ? height : undefined)
          const effectiveHeight = height || (fit === 'scale' ? width : undefined)
          // Round user-supplied dimensions down to nearest even number (libx264 requires even dimensions)
          const w = effectiveWidth ? (effectiveWidth % 2 === 0 ? effectiveWidth : effectiveWidth - 1) : -2
          const h = effectiveHeight ? (effectiveHeight % 2 === 0 ? effectiveHeight : effectiveHeight - 1) : -2
          // -2 tells FFmpeg to auto-calculate that dimension and keep it divisible by 2.
          // When both dimensions are set with force_original_aspect_ratio, the calculated
          // side can still end up odd, so we append a final even-rounding scale pass.
          const bothSet = w !== -2 && h !== -2
          const scaleFilter = fit === 'crop'
            ? `scale=${w}:${h}${bothSet ? ':force_original_aspect_ratio=increase' : ''},crop=${w === -2 ? 'iw' : w}:${h === -2 ? 'ih' : h}`
            : fit === 'scale'
              ? `scale=${w}:${h}`
              : bothSet
                ? `scale=${w}:${h}:force_original_aspect_ratio=decrease`
                : `scale=${w}:${h}`
          // First normalize to display dimensions (handles non-1:1 SAR sources like screen recordings)
          const fullFilter = `[0:v]scale=iw*sar:ih,${scaleFilter},scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[vout]`
          cmd.complexFilter(fullFilter).outputOptions(['-map [vout]', '-map 0:a?'])
        }

        if (targetFormat === 'gif') {
          cmd.fps(15)
          if (!width && !height) cmd.size('640x?')
          cmd.output(outputPath)
        } else {
          cmd.output(outputPath)
        }

        cmd.on('end', resolve).on('error', (err, _stdout, stderr) => reject(new Error(stderr || err.message))).run()
      })

      const result = await fs.promises.readFile(outputPath)
      return result
    } finally {
      // Only remove the input temp file if we created it - never delete the user's source path.
      if (!usePath) await fs.promises.rm(inputPath, { force: true })
      await fs.promises.rm(outputPath, { force: true })
    }
  })

  ipcMain.handle('convert-audio', async (_event, source, sourceExt, targetFormat) => {
    // Map output format aliases to ffmpeg format/container names
    const fmtMap = { m4a: 'ipod', weba: 'webm', ogg: 'ogg', aiff: 'aiff' }
    const ffmpegFmt = fmtMap[targetFormat] || targetFormat
    const outputExt = targetFormat === 'm4a' ? 'm4a' : targetFormat === 'weba' ? 'weba' : targetFormat

    const tmpDir = os.tmpdir()
    const outputPath = path.join(tmpDir, `${randomUUID()}.${outputExt}`)

    // `source` is either an absolute path (ffmpeg reads it directly) or an ArrayBuffer fallback.
    const usePath = typeof source === 'string'
    const inputPath = usePath ? source : path.join(tmpDir, `${randomUUID()}.${sourceExt}`)
    if (!usePath) await fs.promises.writeFile(inputPath, Buffer.from(source))

    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setFfmpegPath(ffmpegStaticPath)
          .noVideo()
          .toFormat(ffmpegFmt)
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run()
      })

      const result = await fs.promises.readFile(outputPath)
      return result
    } finally {
      if (!usePath) await fs.promises.rm(inputPath, { force: true })
      await fs.promises.rm(outputPath, { force: true })
    }
  })
}

module.exports = { registerConvertHandlers, normalizeFormat, sharpFormatOptions, decodeHeic }
