import type { Adjustments, Transform } from '../toolbar/types'
import type { ResizeState } from './resize-presets'
import type { TextOverlay } from '../layers/use-text-overlays'
import type { DrawCommand } from '../layers/use-draw-commands'
import type { ScaleInfo } from './image-space'
import { buildFilter, applyBlur, applySharpen, applyVignette } from './canvas-filters'
import { renderCommand } from '../layers/use-draw-commands'
import { translateCommand, scaleCommand } from './draw-command-transform'

interface Rect { x: number; y: number; w: number; h: number }

export interface ExportParams {
  img: HTMLImageElement
  crop: Rect
  transform: Transform
  adjustments: Adjustments
  resize: ResizeState
  textOverlays: TextOverlay[]
  drawCommands: DrawCommand[]
  fileName: string
  format: 'png' | 'jpeg' | 'webp'
  quality: number
}

// 'saved' once the file is written, 'canceled' if the user dismissed the save dialog, and
// 'failed' if the canvas couldn't encode - so the caller can refund a reserved token on
// anything that isn't a real save, but only surface an error for an actual failure.
export type ExportResult = 'saved' | 'canceled' | 'failed'

export function exportCanvas({
  img, crop, transform, adjustments, resize,
  textOverlays, drawCommands,
  fileName, format, quality,
}: ExportParams): Promise<ExportResult> {
  const c = crop
  const t = transform
  const a = adjustments
  const r = resize

  const isRotated90 = t.rotation === 90 || t.rotation === 270
  const naturalOutW = isRotated90 ? Math.round(c.h) : Math.round(c.w)
  const naturalOutH = isRotated90 ? Math.round(c.w) : Math.round(c.h)
  const outW = r.enabled ? r.w : naturalOutW
  const outH = r.enabled ? r.h : naturalOutH

  // Stage 1–3: image pipeline at native resolution
  const stage1 = document.createElement('canvas')
  stage1.width = img.naturalWidth
  stage1.height = img.naturalHeight
  const ctx1 = stage1.getContext('2d')!
  ctx1.filter = buildFilter(a)
  ctx1.drawImage(img, 0, 0)
  ctx1.filter = 'none'

  const stage2 = a.blur > 0 ? applyBlur(stage1, a.blur) : stage1
  const stage3 = a.sharpen > 0 ? applySharpen(stage2, a.sharpen) : stage2

  // Stage 4: crop + rotate + flip + resize
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')!
  ctx.translate(outW / 2, outH / 2)
  ctx.rotate((t.rotation * Math.PI) / 180)
  ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1)
  if (isRotated90) {
    ctx.drawImage(stage3, c.x, c.y, c.w, c.h, -outH / 2, -outW / 2, c.w, c.h)
  } else {
    ctx.drawImage(stage3, c.x, c.y, c.w, c.h, -outW / 2, -outH / 2, outW, outH)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  // Vignette
  applyVignette(ctx, 0, 0, outW, outH, a.vignette)

  // Stage 6: text overlays
  for (const ov of textOverlays) {
    ctx.save()
    ctx.font = `${ov.fontSize}px ${ov.fontFamily}`
    ctx.fillStyle = ov.color
    ctx.textBaseline = 'top'
    const scaleX = outW / naturalOutW
    const scaleY = outH / naturalOutH
    ctx.fillText(ov.content, (ov.x - c.x) * scaleX, (ov.y - c.y) * scaleY)
    ctx.restore()
  }

  // Stage 7: draw commands
  const exportScale: ScaleInfo = { x: outW / naturalOutW, y: outH / naturalOutH, offX: 0, offY: 0, dispW: outW, dispH: outH }
  for (const cmd of drawCommands) {
    renderCommand(ctx, scaleCommand(translateCommand(cmd, -c.x, -c.y), exportScale))
  }

  const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  return new Promise<ExportResult>(resolve => {
    out.toBlob(async blob => {
      if (!blob) { resolve('failed'); return }
      try {
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
        const result = await window.electron.saveImageBuffer({ buffer: bytes, fileName, format })
        resolve(result.canceled ? 'canceled' : 'saved')
      } catch {
        resolve('failed')
      }
    }, mimeType, quality / 100)
  })
}
