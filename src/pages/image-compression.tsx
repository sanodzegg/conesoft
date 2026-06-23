import { useState, useRef, lazy } from 'react'
import { Import, RotateCcw, Download, ZoomIn, ZoomOut, Maximize2, Info } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'
import { useConversionCountContext } from '@/lib/ConversionCountContext'
import { spendTokens, isAtLimit, isTrialExhausted } from '@/lib/useConversionCount'

const ComparisonSlider = lazy(() => import('@/components/settings/comparison-slider'))

const FORMATS = [
  { id: 'jpeg', label: 'JPEG' },
  { id: 'webp', label: 'WebP' },
  { id: 'avif', label: 'AVIF' },
]

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/tiff'
const ACCEPTED_EXT = ['PNG', 'JPG', 'WEBP', 'AVIF', 'GIF', 'TIFF']

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

export default function ImageCompression() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageName, setImageName] = useState<string | null>(null)
  const [quality, setQuality] = useState(80)
  const [format, setFormat] = useState('jpeg')
  const [originalSize, setOriginalSize] = useState<number | null>(null)
  const [compressedSize, setCompressedSize] = useState<number | null>(null)
  const [encoding, setEncoding] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [zoom, setZoom] = useState(1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropzoneRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<File | null>(null)
  const navigate = useNavigate()
  const { plan } = useAuth()
  const { onConversionSuccess } = useConversionCountContext()
  const atLimit = isAtLimit('image', plan)
  const metered = !isPaidPlan(plan)

  const loadFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setImageSrc(prev => { if (prev) URL.revokeObjectURL(prev); return url })
    setImageName(file.name)
    setOriginalSize(file.size)
    setCompressedSize(null)
    fileRef.current = file
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

  const handleSizes = (_original: number, compressed: number) => {
    setCompressedSize(compressed)
  }

  const download = async () => {
    if (!fileRef.current) return
    // The live preview re-encodes constantly and is free; only an actual download counts.
    // Reserve one image token up front and refund it if the encode fails.
    const [refund, reserved] = spendTokens('image', plan)
    if (!reserved) {
      toast.error(
        plan === 'limited' || isTrialExhausted()
          ? 'Daily limit reached. Try again tomorrow or upgrade to Pro.'
          : 'Conversion limit reached. Upgrade to continue.',
        { description: 'Upgrade to Pro for unlimited compression.', duration: 5000 }
      )
      return
    }
    try {
      const buffer = await fileRef.current.arrayBuffer()
      const result = await window.electron.convert(buffer, format, quality)
      const base = (imageName ?? 'image').replace(/\.[^.]+$/, '')
      const ext = format === 'jpeg' ? 'jpg' : format
      // Save through a native dialog so a canceled save refunds the reserved token.
      const saveRes = await window.electron.saveImageBuffer({
        buffer: Array.from(result),
        fileName: `${base}-compressed.${ext}`,
        format,
      })
      if (saveRes.canceled) { refund(); return }
      onConversionSuccess('image')
    } catch (e) {
      refund()
      toast.error(e instanceof Error ? e.message : 'Compression failed')
    }
  }

  const reset = () => {
    if (imageSrc) URL.revokeObjectURL(imageSrc)
    setImageSrc(null)
    setImageName(null)
    setOriginalSize(null)
    setCompressedSize(null)
    setEncoding(false)
    setZoom(1)
    fileRef.current = null
  }

  const saved = originalSize && compressedSize ? originalSize - compressedSize : null
  const savedPct = saved && originalSize ? Math.round((saved / originalSize) * 100) : null

  return (
    <section className="section py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Image Compression</h2>
          <p className="text-sm text-muted-foreground mt-1">Compress images with live before/after preview.</p>
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
                Each download costs <span className="font-medium text-foreground">1 token</span>. The live preview is free.
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
        <div className="flex flex-col gap-5">
          <input ref={inputRef} type="file" accept={ACCEPTED} className="sr-only" onChange={onFileChange} />

          {/* Comparison slider with zoom controls */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Drag the slider to compare</p>
              <div className="flex items-center gap-1">
                {zoom !== 1 && (
                  <button
                    onClick={() => setZoom(1)}
                    className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent transition-colors"
                    title="Reset zoom"
                  >
                    <Maximize2 className="size-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setZoom(z => Math.max(1, +(z - 0.25).toFixed(2)))}
                  disabled={zoom <= 1}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Zoom out"
                >
                  <ZoomOut className="size-3.5" />
                </button>
                <span className="text-xs text-muted-foreground w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
                  disabled={zoom >= 4}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Zoom in"
                >
                  <ZoomIn className="size-3.5" />
                </button>
              </div>
            </div>
            <ComparisonSlider
              imageSrc={imageSrc}
              quality={quality}
              format={format}
              onSizes={handleSizes}
              onEncodingChange={setEncoding}
              zoom={zoom}
            />
          </div>

          {/* Settings row */}
          <div className="relative flex gap-30 justify-between items-stretch">
            {encoding && <div className="absolute inset-0 z-10 rounded-xl bg-background/50 pointer-events-auto" />}
            {/* Col 1: image + format */}
            <div className="flex flex-col gap-3 shrink-0">
              <div
                onClick={() => inputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border border-dashed px-3 py-2.5 cursor-pointer transition-colors",
                  dragOver ? "border-primary/60 bg-accent/60" : "border-border hover:border-primary/50 hover:bg-accent/50"
                )}
              >
                <img src={imageSrc} className="h-9 w-9 object-cover rounded-lg shrink-0" />
                <div>
                  <p className="text-xs font-medium truncate w-36">{imageName}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Click or drop to change</p>
                </div>
              </div>
              <div className="flex gap-1">
                {FORMATS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={cn(
                      "flex-1 py-1.5 text-xs rounded-md border transition-colors cursor-pointer",
                      format === f.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Col 2: quality */}
            <div className="flex flex-col justify-between grow gap-4">
              <div className='flex flex-col gap-1.5'>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Quality</Label>
                  <span className="text-xs font-medium">{quality}%</span>
                </div>
                <input
                  type="range" min={1} max={100} value={quality}
                  onChange={e => setQuality(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Smaller</span><span>Better</span>
                </div>
              </div>
              {originalSize && (
                <div className="flex flex-col gap-1 mt-1 text-xs">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Original</span>
                    <span className="font-medium">{formatBytes(originalSize)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Compressed</span>
                    <span className="font-medium">{compressedSize ? formatBytes(compressedSize) : '-'}</span>
                  </div>
                  {saved !== null && savedPct !== null && saved !== 0 && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{saved > 0 ? 'Saved' : 'Increased'}</span>
                      <span className={cn("font-medium", saved > 0 ? "text-green-500" : "text-yellow-500")}>
                        {formatBytes(Math.abs(saved))} ({Math.abs(savedPct)}%)
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Col 3: download (gated when out of token budget) */}
            {atLimit ? (
              <Button onClick={() => navigate('/pricing')} className="shrink-0" size="sm">
                Upgrade to Pro
              </Button>
            ) : (
              <Button onClick={download} disabled={encoding} className="gap-1.5 shrink-0" size="sm">
                <Download className="size-3.5" />
                Download
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
