import type { ConversionEngine } from './ConversionEngine'
import type { ConversionOptions } from '@/types'

// Supported by this build of sharp (libvips without dcraw/magick/ppm)
export const IMAGE_INPUT_EXTENSIONS = [
  'jpg', 'jpeg', 'jfif',          // JPEG variants
  'png',                            // PNG
  'webp',                           // WebP
  'avif', 'heic', 'heif',          // HEIF family
  'gif',                            // GIF
  'tiff', 'tif',                    // TIFF variants
  'svg',                            // SVG (rasterized at 300dpi)
]
export const IMAGE_OUTPUT_FORMATS = ['webp', 'png', 'jpg', 'avif', 'gif', 'tiff']

// Formats NOT supported by this sharp build — future work:
// RAW camera: 3fr, arw, cr2, cr3, crw, dcr, dng, erf, mos, mrw, nef, orf, pef, raf, raw, rw2, x3f
//   → requires dcraw/libraw compiled into libvips, or a separate dcraw binary
// Raster editors: psd, psb (Photoshop), xcg (GIMP), tga
//   → no viable pure-JS parser; would need ImageMagick or native binding
// Office/vector: eps, ps (Ghostscript), odg, odd (LibreOffice), pub (Publisher), xps
//   → requires system-level tools, not bundleable
// Platform icons: icns (macOS), ico (input) — ico output works via favicon generator
// Other: ppm, bmp — not compiled into this sharp build

export const imageEngine: ConversionEngine = {
  id: 'image',
  name: 'Sharp Image Engine',
  supportedInputExtensions: IMAGE_INPUT_EXTENSIONS,
  outputFormats: IMAGE_OUTPUT_FORMATS,

  async convert(file: File, targetFormat: string, options: ConversionOptions): Promise<Blob> {
    const buffer = await file.arrayBuffer()
    const result = await window.electron.convert(buffer, targetFormat, options.quality, {
      width: options.width,
      height: options.height,
      fit: options.fit,
      keepMetadata: options.keepMetadata,
    })
    // result is a Uint8Array over IPC; pass it directly — `.buffer` could include
    // bytes outside the view if it ever arrives with a non-zero byteOffset.
    return new Blob([result], { type: `image/${targetFormat}` })
  },
}
