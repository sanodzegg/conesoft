import { useState, useEffect, useRef } from 'react'
import { FileUp, Download, AlertCircle, RotateCcw, Loader2, Info, Images } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { pdfjsLib } from '@/lib/pdf-worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfSaveMeter, resetPdfToImagesSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'

type Status = 'idle' | 'loading' | 'ready' | 'exporting' | 'error'
type Format = 'png' | 'jpg' | 'webp'

const FORMATS: Format[] = ['png', 'jpg', 'webp']
const RESOLUTIONS: { label: string; hint: string; scale: number }[] = [
  { label: 'Low', hint: '~110 dpi', scale: 1.5 },
  { label: 'Medium', hint: '~150 dpi', scale: 2 },
  { label: 'High', hint: '~220 dpi', scale: 3 },
]
const MIME: Record<Format, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

// Render one PDF page to an off-screen canvas at the given scale.
async function renderPageToCanvas(doc: PDFDocumentProxy, pageIndex: number, scale: number) {
  const page = await doc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas
}

function canvasToBytes(canvas: HTMLCanvasElement, format: Format, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async blob => {
        if (!blob) return reject(new Error('Failed to encode image'))
        resolve(new Uint8Array(await blob.arrayBuffer()))
      },
      MIME[format],
      format === 'png' ? undefined : quality,
    )
  })
}

export default function PdfToImages() {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [format, setFormat] = useState<Format>('png')
  const [quality, setQuality] = useState(90)
  const [scale, setScale] = useState(2)

  const docRef = useRef<PDFDocumentProxy | null>(null)
  const { reservePdfToImagesSave, markPdfToImagesSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  useEffect(() => { resetPdfToImagesSaveSession() }, [])
  // Release the pdfjs document on unmount.
  useEffect(() => () => { docRef.current?.destroy() }, [])

  const pick = async () => {
    const res = await window.electron.pdfConvertPickPdf()
    if (res.canceled) return
    setStatus('loading')
    setError(null)
    setSavedPath(null)
    setThumbs([])
    try {
      docRef.current?.destroy()
      const data = new Uint8Array(res.data)
      const doc = await pdfjsLib.getDocument({ data }).promise
      docRef.current = doc
      setFileName(res.name)
      setPageCount(doc.numPages)
      // Render low-res preview thumbnails (cap to keep it snappy on huge PDFs).
      const previewCount = Math.min(doc.numPages, 30)
      const urls: string[] = []
      for (let i = 0; i < previewCount; i++) {
        const canvas = await renderPageToCanvas(doc, i, 0.4)
        urls.push(canvas.toDataURL('image/jpeg', 0.7))
      }
      setThumbs(urls)
      setStatus('ready')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const download = async () => {
    const doc = docRef.current
    if (!doc) return
    const refund = reservePdfToImagesSave()
    if (!refund) return
    setStatus('exporting')
    try {
      const base = (fileName ?? 'page').replace(/\.pdf$/i, '')
      const ext = format === 'jpg' ? 'jpg' : format
      const q = quality / 100

      if (doc.numPages === 1) {
        const canvas = await renderPageToCanvas(doc, 0, scale)
        const bytes = await canvasToBytes(canvas, format, q)
        const res = await window.electron.saveImageBuffer({
          buffer: Array.from(bytes),
          fileName: `${base}.${ext}`,
          format: format === 'jpg' ? 'jpeg' : format,
          title: 'Save image',
        })
        if (res.canceled || !res.filePath) { refund(); setStatus('ready'); return }
        setSavedPath(res.filePath)
      } else {
        const JSZip = (await import('jszip')).default
        const zip = new JSZip()
        const pad = String(doc.numPages).length
        for (let i = 0; i < doc.numPages; i++) {
          const canvas = await renderPageToCanvas(doc, i, scale)
          const bytes = await canvasToBytes(canvas, format, q)
          zip.file(`${base}-${String(i + 1).padStart(pad, '0')}.${ext}`, bytes)
        }
        const blob = await zip.generateAsync({ type: 'blob' })
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
        const res = await window.electron.saveImageBuffer({
          buffer: bytes,
          fileName: `${base}-images.zip`,
          format: 'zip',
          title: 'Save images',
        })
        if (res.canceled || !res.filePath) { refund(); setStatus('ready'); return }
        setSavedPath(res.filePath)
      }
      markPdfToImagesSaved()
      onSaved()
      setStatus('ready')
    } catch (err: unknown) {
      refund()
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const reset = () => {
    docRef.current?.destroy()
    docRef.current = null
    setStatus('idle')
    setFileName(null)
    setPageCount(0)
    setThumbs([])
    setSavedPath(null)
    setError(null)
    resetPdfToImagesSaveSession()
  }

  const isLoading = status === 'loading'
  const isReady = status === 'ready'
  const isExporting = status === 'exporting'
  const isError = status === 'error'
  const hasDoc = isReady || isExporting

  return (
    <section className="section py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">PDF to Images</h2>
          <p className="text-sm text-muted-foreground mt-1">Export every page of a PDF as a PNG, JPG, or WebP image.</p>
        </div>
        <div className="flex items-end gap-2.5 shrink-0">
          {(hasDoc || isError) && (
            <Button variant="outline" size="sm" onClick={reset} className="gap-1.5 shrink-0">
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
          {metered && (
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs">
              <Info className="size-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                First save costs <span className="font-medium text-foreground">5 tokens</span>, then <span className="font-medium text-foreground">2</span> for each one after.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left: controls */}
        <div className="w-64 shrink-0 space-y-4">
          <div className="space-y-1.5">
            <button
              onClick={pick}
              disabled={isLoading || isExporting}
              className="w-full rounded-xl border border-dashed border-border p-4 flex flex-col items-center gap-2 text-center hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileUp className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{fileName ? 'Choose a different PDF' : 'Click to select a PDF'}</p>
            </button>
          </div>

          {fileName && (
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <p className="text-xs text-foreground truncate">{fileName}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{pageCount} page{pageCount !== 1 ? 's' : ''}</p>
            </div>
          )}

          {/* Format */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Output format</Label>
            <div className="flex gap-1.5">
              {FORMATS.map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  disabled={isExporting}
                  className={cn(
                    'cursor-pointer flex-1 rounded-lg border py-1.5 text-xs font-medium uppercase transition-colors',
                    format === f
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Quality - only for lossy formats */}
          {format !== 'png' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Quality</Label>
                <span className="text-[10px] text-muted-foreground">{quality}%</span>
              </div>
              <input
                type="range"
                min={40}
                max={100}
                step={5}
                value={quality}
                onChange={e => setQuality(Number(e.target.value))}
                disabled={isExporting}
                className="w-full accent-primary"
              />
            </div>
          )}

          {/* Resolution */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Resolution</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {RESOLUTIONS.map(r => (
                <button
                  key={r.label}
                  onClick={() => setScale(r.scale)}
                  disabled={isExporting}
                  className={cn(
                    'cursor-pointer rounded-lg border py-1.5 text-xs transition-colors',
                    scale === r.scale
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {r.label}
                  <span className="block text-[10px] opacity-60">{r.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {hasDoc && (
            <Button className="w-full gap-2" size="sm" onClick={download} disabled={isExporting}>
              {isExporting ? (
                <><Loader2 className="size-3.5 animate-spin" /> Exporting…</>
              ) : (
                <><Download className="size-3.5" /> {pageCount > 1 ? `Download ${pageCount} images (zip)` : 'Download image'}</>
              )}
            </Button>
          )}

          {savedPath && (
            <p className="text-[10px] text-muted-foreground break-all">{savedPath}</p>
          )}
        </div>

        {/* Right: preview */}
        <div className="flex-1 min-w-0">
          {hasDoc && thumbs.length > 0 ? (
            <div className="rounded-xl border border-border p-4">
              <div className="grid grid-cols-4 gap-3 max-h-140 overflow-y-auto">
                {thumbs.map((src, i) => (
                  <div key={i} className="space-y-1">
                    <div className="rounded-lg border border-border overflow-hidden bg-white">
                      <img src={src} alt={`Page ${i + 1}`} className="w-full block" />
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">{i + 1}</p>
                  </div>
                ))}
              </div>
              {pageCount > thumbs.length && (
                <p className="text-[10px] text-muted-foreground text-center mt-3">
                  Showing first {thumbs.length} of {pageCount} pages · all pages are exported
                </p>
              )}
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Couldn't open PDF</p>
                <p className="text-[10px] text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Rendering pages…</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Images className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a PDF to preview and export its pages</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
