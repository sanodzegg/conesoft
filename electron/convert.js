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

// Coarse content sniff by magic bytes - used to catch files whose extension lies about their
// type (e.g. a .pdf that's really a docx) so we can fail with a clear message instead of a
// cryptic library stack trace. Returns null for formats without a distinctive header (txt, svg).
function sniffContainer(buf) {
  if (!buf || buf.length < 4) return null
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf'   // %PDF
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) return 'zip' // PK.. (docx/office)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif'   // GIF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'riff'  // RIFF (webp/wav/avi)
  return null
}

const SNIFF_LABELS = { pdf: 'PDF', zip: 'Word/Office document', png: 'PNG image', jpeg: 'JPEG image', gif: 'GIF image', riff: 'WebP/WAV/AVI file' }

// Translate a raw ffmpeg failure into a short, human message. Full stderr goes to the log so
// real bug reports stay debuggable; the user never sees the engine's guts.
function makeMediaError(stderr, err, kind) {
  const detail = stderr || (err && err.message) || ''
  console.error(`[convert-${kind}] ffmpeg failed:\n${detail}`)
  const low = detail.toLowerCase()
  if (low.includes('no such file') || low.includes('enoent'))
    return new Error(`Couldn't read the ${kind} file - it may have been moved or deleted.`)
  if ((low.includes('codec') && (low.includes('unknown') || low.includes('not found'))) || low.includes('decoder') || low.includes('unsupported'))
    return new Error(`Couldn't convert this ${kind} - it uses a codec we don't support.`)
  if (low.includes('invalid data') || low.includes('moov atom') || low.includes('error while decoding') || low.includes('does not contain'))
    return new Error(`Couldn't convert this ${kind} - the file looks corrupt or incomplete.`)
  return new Error(`Couldn't convert this ${kind}. The file may be corrupt or use an unsupported format.`)
}

// Kill an ffmpeg job that makes no progress for this long. Based on *time since last activity*
// (not total elapsed) so a legitimately slow-but-progressing large conversion is never killed -
// only a genuinely stuck one. Also holds active jobs so a user cancel can kill them (Item 3B).
const STALL_TIMEOUT_MS = 90_000
const activeJobs = new Map() // jobId -> fluent-ffmpeg command

function runFfmpeg(cmd, kind, jobId) {
  return new Promise((resolve, reject) => {
    let last = Date.now()
    let settled = false
    const bump = () => { last = Date.now() }
    const settle = (fn) => (...args) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      if (jobId) activeJobs.delete(jobId)
      fn(...args)
    }
    const onEnd = settle(() => resolve())
    const onError = settle((err, _stdout, stderr) => {
      // A deliberate user cancel (Item 3B) isn't a failure - resolve quietly with a sentinel so
      // Electron doesn't log the rejected handler as a scary "Error occurred in handler" trace.
      if (cmd._canceled) return resolve('canceled')
      reject(makeMediaError(stderr, err, kind))
    })
    const timer = setInterval(() => {
      if (settled) return
      if (Date.now() - last > STALL_TIMEOUT_MS) {
        try { cmd.kill('SIGKILL') } catch {}
        settle(reject)(new Error(`This ${kind} conversion stalled and was stopped - the file may be corrupt or use an unsupported codec.`))
      }
    }, 5000)
    if (jobId) activeJobs.set(jobId, cmd)
    cmd.on('start', bump).on('progress', bump).on('stderr', bump).on('end', onEnd).on('error', onError).run()
  })
}

function registerConvertHandlers() {
  ipcMain.handle('convert-file', async (_event, buffer, targetFormat, quality = 60, imageOptions = {}) => {
    const { width, height, fit, keepMetadata = true } = imageOptions
    const sharpFormat = normalizeFormat(targetFormat)
    let buf = await decodeHeic(Buffer.from(buffer))

    // Sharp auto-detects image content, so a JPEG named .png still converts fine. But a
    // document (PDF/Office) mislabeled as an image would fail cryptically deep in libvips -
    // catch that case up front with a clear message. (buf is a PNG here if it was HEIC.)
    const sniff = sniffContainer(buf)
    if (sniff === 'pdf' || sniff === 'zip')
      throw new Error(`This looks like a ${SNIFF_LABELS[sniff]}, not an image. Use the Document converter instead.`)

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
    if (!result || result.length === 0)
      throw new Error('Conversion produced an empty image - the source may be corrupt or unsupported.')
    return result
  })

  ipcMain.handle('convert-document', async (_event, buffer, targetFormat, sourceFormat) => {
    const buf = Buffer.from(buffer)

    // The document extractors switch strictly on the extension, so a mislabeled file throws
    // a cryptic pdf-parse/mammoth error. Sniff the content and fail clearly on a real mismatch.
    const sniff = sniffContainer(buf)
    if (sourceFormat === 'pdf' && sniff && sniff !== 'pdf')
      throw new Error(`This file is named .pdf but looks like a ${SNIFF_LABELS[sniff]}. Rename it to the correct extension and try again.`)
    if (sourceFormat === 'docx' && sniff && sniff !== 'zip')
      throw new Error(`This file is named .docx but looks like a ${SNIFF_LABELS[sniff]}. Rename it to the correct extension and try again.`)

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

  ipcMain.handle('convert-video', async (_event, source, sourceExt, targetFormat, videoOptions = {}, jobId) => {
    const { width, height, fit } = videoOptions
    const tmpDir = os.tmpdir()
    const outputPath = path.join(tmpDir, `${randomUUID()}.${targetFormat}`)

    // `source` is either an absolute path (large-file fast path: ffmpeg reads it directly,
    // no bytes through the renderer) or an ArrayBuffer (in-memory File fallback → temp file).
    const usePath = typeof source === 'string'
    const inputPath = usePath ? source : path.join(tmpDir, `${randomUUID()}.${sourceExt}`)
    if (!usePath) await fs.promises.writeFile(inputPath, Buffer.from(source))

    try {
      const cmd = ffmpeg(inputPath).setFfmpegPath(ffmpegStaticPath)

      {
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
      }

      if (await runFfmpeg(cmd, 'video', jobId) === 'canceled') return null

      const result = await fs.promises.readFile(outputPath)
      if (!result || result.length === 0)
        throw new Error('Conversion produced an empty video - the source may be corrupt or unsupported.')
      return result
    } finally {
      // Only remove the input temp file if we created it - never delete the user's source path.
      if (!usePath) await fs.promises.rm(inputPath, { force: true })
      await fs.promises.rm(outputPath, { force: true })
    }
  })

  ipcMain.handle('convert-audio', async (_event, source, sourceExt, targetFormat, jobId) => {
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
      const cmd = ffmpeg(inputPath)
        .setFfmpegPath(ffmpegStaticPath)
        .noVideo()
        .toFormat(ffmpegFmt)
        .output(outputPath)

      if (await runFfmpeg(cmd, 'audio', jobId) === 'canceled') return null

      const result = await fs.promises.readFile(outputPath)
      if (!result || result.length === 0)
        throw new Error('Conversion produced an empty audio file - the source may be corrupt or unsupported.')
      return result
    } finally {
      if (!usePath) await fs.promises.rm(inputPath, { force: true })
      await fs.promises.rm(outputPath, { force: true })
    }
  })

  // Cancel an in-flight video/audio job by killing its ffmpeg process. Marked `_canceled` first
  // so runFfmpeg rejects with a quiet 'canceled' (not a scary error). No-op if already finished.
  ipcMain.handle('cancel-conversion', (_event, jobId) => {
    const cmd = activeJobs.get(jobId)
    if (cmd) {
      cmd._canceled = true
      try { cmd.kill('SIGKILL') } catch {}
      activeJobs.delete(jobId)
    }
    return true
  })
}

module.exports = { registerConvertHandlers, normalizeFormat, sharpFormatOptions, decodeHeic }
