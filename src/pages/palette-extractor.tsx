import { useState, useRef, useCallback } from 'react'
import { Pipette, Loader2, Copy, Check, RotateCcw, Import, Download, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'
import { spendTokens, imageToolCost } from '@/lib/useConversionCount'
import { useConversionCountContext } from '@/lib/ConversionCountContext'

type RGB = [number, number, number]

function toHex([r, g, b]: RGB) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function colorDistance(a: RGB, b: RGB) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

function kMeans(pixels: RGB[], k: number, maxIter = 20): RGB[] {
  const step = Math.floor(pixels.length / k)
  let centroids: RGB[] = Array.from({ length: k }, (_, i) => [...pixels[i * step]] as RGB)

  for (let iter = 0; iter < maxIter; iter++) {
    const clusters: RGB[][] = Array.from({ length: k }, () => [])

    for (const px of pixels) {
      let minDist = Infinity
      let best = 0
      for (let i = 0; i < k; i++) {
        const d = colorDistance(px, centroids[i])
        if (d < minDist) { minDist = d; best = i }
      }
      clusters[best].push(px)
    }

    let moved = false
    const next: RGB[] = centroids.map((c, i) => {
      if (!clusters[i].length) return c
      const r = Math.round(clusters[i].reduce((s, p) => s + p[0], 0) / clusters[i].length)
      const g = Math.round(clusters[i].reduce((s, p) => s + p[1], 0) / clusters[i].length)
      const b = Math.round(clusters[i].reduce((s, p) => s + p[2], 0) / clusters[i].length)
      const newC: RGB = [r, g, b]
      if (colorDistance(newC, c) > 1) moved = true
      return newC
    })

    centroids = next
    if (!moved) break
  }

  return centroids.sort((a, b) =>
    (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]) - (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2])
  )
}

function samplePixels(img: HTMLImageElement, maxSamples = 8000): RGB[] {
  const canvas = document.createElement('canvas')
  const scale = Math.sqrt(maxSamples / (img.naturalWidth * img.naturalHeight))
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const pixels: RGB[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    pixels.push([data[i], data[i + 1], data[i + 2]])
  }
  return pixels
}

function exportCssVars(palette: RGB[]) {
  const lines = palette.map((c, i) => `  --color-${i + 1}: ${toHex(c)};`)
  return `:root {\n${lines.join('\n')}\n}`
}

function exportTailwind(palette: RGB[]) {
  const entries = palette.map((c, i) => `      ${i + 1}: '${toHex(c)}',`)
  return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        palette: {\n${entries.join('\n')}\n        },\n      },\n    },\n  },\n}`
}

function exportJson(palette: RGB[]) {
  const obj = palette.map(c => ({ hex: toHex(c), rgb: `rgb(${c[0]}, ${c[1]}, ${c[2]})`, r: c[0], g: c[1], b: c[2] }))
  return JSON.stringify(obj, null, 2)
}

function exportSwatchPng(palette: RGB[]): string {
  const swatchW = 120
  const swatchH = 80
  const canvas = document.createElement('canvas')
  canvas.width = swatchW * palette.length
  canvas.height = swatchH
  const ctx = canvas.getContext('2d')!
  palette.forEach((c, i) => {
    ctx.fillStyle = toHex(c)
    ctx.fillRect(i * swatchW, 0, swatchW, swatchH)
  })
  return canvas.toDataURL('image/png')
}

type ExportFormat = 'css' | 'tailwind' | 'json' | 'png'

const EXPORT_OPTIONS: { id: ExportFormat; label: string; description: string }[] = [
  { id: 'css',      label: 'CSS Variables',   description: '--color-1: #hex' },
  { id: 'tailwind', label: 'Tailwind Config',  description: 'colors.palette.1' },
  { id: 'json',     label: 'JSON',             description: '[{ hex, rgb, r, g, b }]' },
  { id: 'png',      label: 'Swatch Image',     description: 'PNG strip of all colors' },
]

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/tiff'
const ACCEPTED_EXT = ['PNG', 'JPG', 'WEBP', 'GIF', 'AVIF', 'TIFF']

export default function PaletteExtractor() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageName, setImageName] = useState<string | null>(null)
  const [colorCount, setColorCount] = useState(6)
  const [palette, setPalette] = useState<RGB[]>([])
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('css')
  const inputRef = useRef<HTMLInputElement>(null)
  const dropzoneRef = useRef<HTMLDivElement>(null)
  const { plan } = useAuth()
  const cost = imageToolCost(plan)
  const { onConversionSuccess } = useConversionCountContext()
  const metered = !isPaidPlan(plan)

  const loadFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setImageSrc(prev => { if (prev) URL.revokeObjectURL(prev); return url })
    setImageName(file.name)
    setPalette([])
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }

  const extract = useCallback(() => {
    if (!imageSrc) return
    setLoading(true)
    const img = new Image()
    img.onload = () => {
      setTimeout(() => {
        const pixels = samplePixels(img)
        const colors = kMeans(pixels, colorCount)
        setPalette(colors)
        setLoading(false)
      }, 16)
    }
    img.src = imageSrc
  }, [imageSrc, colorCount])

  const copyColor = (value: string) => {
    navigator.clipboard.writeText(value)
    setCopied(value)
    setTimeout(() => setCopied(null), 1500)
  }

  const handleExport = async () => {
    if (!palette.length) return
    const base = (imageName ?? 'palette').replace(/\.[^.]+$/, '')

    let bytes: number[]
    let fileName: string
    let format: string
    if (exportFormat === 'png') {
      const b64 = exportSwatchPng(palette).split(',')[1]
      bytes = Array.from(atob(b64), ch => ch.charCodeAt(0))
      fileName = `${base}-palette.png`
      format = 'png'
    } else {
      const content = exportFormat === 'css' ? exportCssVars(palette)
        : exportFormat === 'tailwind' ? exportTailwind(palette)
        : exportJson(palette)
      bytes = Array.from(new TextEncoder().encode(content))
      fileName = exportFormat === 'css' ? `${base}-palette.css`
        : exportFormat === 'tailwind' ? `${base}-tailwind.js`
        : `${base}-palette.json`
      format = exportFormat === 'tailwind' ? 'js' : exportFormat
    }

    // Charge per successful download (extracting/copying is free); refund on a canceled save.
    const [refund, reserved] = spendTokens('image', plan, { cost, countCategory: false })
    if (!reserved) {
      toast.error('Conversion limit reached. Upgrade to continue.', {
        description: 'Upgrade to Pro for unlimited palette exports.', duration: 5000,
      })
      return
    }
    const res = await window.electron.saveImageBuffer({ buffer: bytes, fileName, format, title: 'Save palette' })
    if (res.canceled) { refund(); return }
    onConversionSuccess('image')
  }

  const reset = () => {
    if (imageSrc) URL.revokeObjectURL(imageSrc)
    setImageSrc(null)
    setImageName(null)
    setPalette([])
    setLoading(false)
  }

  return (
    <section className="section py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Palette Extractor</h2>
          <p className="text-sm text-muted-foreground mt-1">Extract dominant colors from any image.</p>
        </div>
        <div className="flex items-start gap-2.5 shrink-0">
          {imageSrc && (
            <Button variant="outline" size="sm" onClick={reset} className="gap-1.5 shrink-0">
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
          {metered && (
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs">
              <Info className="size-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Each download costs <span className="font-medium text-foreground">{cost} token{cost === 1 ? '' : 's'}</span>. Extracting and copying colors are free.
              </p>
            </div>
          )}
        </div>
      </div>

      {!imageSrc ? (
        <>
          <input ref={inputRef} type="file" accept={ACCEPTED} className="sr-only" onChange={onFileChange} />
          <div
            ref={dropzoneRef}
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={e => { if (!dropzoneRef.current?.contains(e.relatedTarget as Node)) setDragOver(false) }}
            className={cn(
              "flex flex-col items-center justify-center py-10 w-full h-90 border border-border hover:border-primary rounded-3xl border-dashed transition-colors cursor-pointer gap-4",
              dragOver && "bg-accent"
            )}
          >
            <Button onClick={() => inputRef.current?.click()} variant="outline" className="w-20 h-20 border-border hover:border-primary transition-colors">
              <Import className="size-10 stroke-primary" />
            </Button>
            <div className="text-center">
              <h2 className="text-2xl font-body font-semibold text-foreground">Drop an image here</h2>
            </div>
            <div className="flex items-center justify-center flex-wrap gap-2">
              {ACCEPTED_EXT.map(ext => (
                <Badge variant="secondary" key={ext} className="rounded-sm p-3 text-sm font-light text-primary">{ext}</Badge>
              ))}
            </div>
            <Button onClick={() => inputRef.current?.click()} className="bg-primary h-12 w-60 text-lg" variant="default">
              Browse Image
            </Button>
          </div>
        </>
      ) : (
        <div className="flex gap-6">
          {/* Left: controls */}
          <div className="w-64 shrink-0 space-y-5">
            <input ref={inputRef} type="file" accept={ACCEPTED} className="sr-only" onChange={onFileChange} />

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Image</Label>
              <div
                onClick={() => inputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
                className={cn(
                  "w-full rounded-xl border border-dashed p-3 flex flex-col items-center gap-2 text-center transition-colors cursor-pointer",
                  dragOver ? "border-primary/60 bg-accent/60" : "border-border hover:border-primary/50 hover:bg-accent/50"
                )}
              >
                <img src={imageSrc} className="w-full h-28 object-cover rounded-lg" />
                <p className="text-[10px] text-muted-foreground truncate w-full">{imageName}</p>
                <p className="text-[10px] text-muted-foreground">Click or drop to change</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Colors</Label>
                <span className="text-xs font-medium">{colorCount}</span>
              </div>
              <input
                type="range" min={2} max={12} value={colorCount}
                onChange={e => setColorCount(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>2</span><span>12</span>
              </div>
            </div>

            <Button onClick={extract} disabled={loading} className="w-full gap-1.5" size="sm">
              {loading
                ? <><Loader2 className="size-3.5 animate-spin" /> Extracting…</>
                : <><Pipette className="size-3.5" /> Extract Palette</>
              }
            </Button>

            {palette.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Export as</Label>
                <div className="space-y-1">
                  {EXPORT_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setExportFormat(opt.id)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors border",
                        exportFormat === opt.id
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "border-transparent hover:bg-accent text-foreground"
                      )}
                    >
                      <div>
                        <p className="text-xs font-medium leading-none mb-0.5">{opt.label}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{opt.description}</p>
                      </div>
                      {exportFormat === opt.id && <Check className="size-3.5 shrink-0" />}
                    </button>
                  ))}
                </div>
                <Button onClick={handleExport} variant="outline" className="w-full gap-1.5" size="sm">
                  <Download className="size-3.5" />
                  Download
                </Button>
              </div>
            )}
          </div>

          {/* Right: palette */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
                <Loader2 className="size-8 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">Extracting colors…</p>
              </div>
            ) : palette.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{palette.length} colors · click a value to copy</p>
                <div className="grid grid-cols-2 gap-3">
                  {palette.map((color, i) => {
                    const hex = toHex(color)
                    const rgb = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
                    return (
                      <div key={i} className="rounded-xl overflow-hidden border border-border">
                        <div className="h-20 w-full" style={{ backgroundColor: hex }} />
                        <div className="p-3 space-y-1 bg-secondary/30">
                          <button
                            onClick={() => copyColor(hex)}
                            className="w-full flex items-center justify-between gap-2 text-left group rounded px-2 py-1 hover:bg-accent transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <div className="size-3 rounded-sm shrink-0 border border-border/50" style={{ backgroundColor: hex }} />
                              <span className="text-xs font-mono font-medium">{hex}</span>
                            </div>
                            {copied === hex
                              ? <Check className="size-3 text-green-500 shrink-0" />
                              : <Copy className="size-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            }
                          </button>
                          <button
                            onClick={() => copyColor(rgb)}
                            className="w-full flex items-center justify-between gap-2 text-left group rounded px-2 py-1 hover:bg-accent transition-colors"
                          >
                            <span className="text-[11px] text-muted-foreground font-mono">{rgb}</span>
                            {copied === rgb
                              ? <Check className="size-3 text-green-500 shrink-0" />
                              : <Copy className="size-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            }
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
                <Pipette className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click Extract Palette to analyze colors</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
