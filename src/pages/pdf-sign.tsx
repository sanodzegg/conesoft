import { useState, useEffect, useRef } from 'react'
import { FileUp, Download, AlertCircle, RotateCcw, Loader2, Info, PenTool, Upload, Eraser, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { BackLink } from '@/components/back-link'
import { pdfjsLib } from '@/lib/pdf-worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfSaveMeter, resetSignSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'

type Status = 'idle' | 'loading' | 'ready' | 'working' | 'error'
type Source = 'draw' | 'upload'
type Scope = 'current' | 'all'

export default function PdfSign() {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [thumb, setThumb] = useState<string | null>(null)
  const [previewW, setPreviewW] = useState(0)
  const [previewH, setPreviewH] = useState(0)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [source, setSource] = useState<Source>('draw')
  const [sigUrl, setSigUrl] = useState<string | null>(null)
  const [sigAspect, setSigAspect] = useState(2.5)
  const [widthFrac, setWidthFrac] = useState(0.3)
  const [xFrac, setXFrac] = useState(0.35)
  const [yFrac, setYFrac] = useState(0.62)
  const [scope, setScope] = useState<Scope>('current')

  const docRef = useRef<PDFDocumentProxy | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ gx: number; gy: number } | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const [hasInk, setHasInk] = useState(false)

  const { reserveSignSave, markSignSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  useEffect(() => { resetSignSaveSession() }, [])
  useEffect(() => () => { docRef.current?.destroy() }, [])

  const renderPage = async (n: number) => {
    const doc = docRef.current
    if (!doc) return
    const page = await doc.getPage(n)
    const vp1 = page.getViewport({ scale: 1 })
    const scale = 620 / vp1.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    setThumb(canvas.toDataURL('image/jpeg', 0.85))
  }

  const pick = async () => {
    const res = await window.electron.pdfSignPick()
    if (res.canceled) return
    setStatus('loading')
    setError(null)
    setSavedPath(null)
    setThumb(null)
    try {
      docRef.current?.destroy()
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(res.data) }).promise
      docRef.current = doc
      setFileName(res.name)
      setPageCount(doc.numPages)
      setCurrentPage(1)
      await renderPage(1)
      setStatus('ready')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const goPage = async (n: number) => {
    const clamped = Math.max(1, Math.min(pageCount, n))
    setCurrentPage(clamped)
    await renderPage(clamped)
  }

  // ── Signature pad drawing ──
  const padPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = padRef.current!
    const rect = c.getBoundingClientRect()
    return { x: (e.clientX - rect.left) * (c.width / rect.width), y: (e.clientY - rect.top) * (c.height / rect.height) }
  }
  const padDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true
    lastRef.current = padPos(e)
    padRef.current!.setPointerCapture(e.pointerId)
  }
  const padMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastRef.current) return
    const ctx = padRef.current!.getContext('2d')!
    const p = padPos(e)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(lastRef.current.x, lastRef.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastRef.current = p
    setHasInk(true)
  }
  const padUp = () => { drawingRef.current = false; lastRef.current = null }
  const clearPad = () => {
    const c = padRef.current
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setHasInk(false)
    if (source === 'draw') setSigUrl(null)
  }

  const useDrawnSignature = () => {
    const c = padRef.current
    if (!c || !hasInk) return
    setSigUrl(c.toDataURL('image/png'))
    setSigAspect(c.width / c.height)
    setWidthFrac(0.3); setXFrac(0.35); setYFrac(0.62)
  }

  const onUploadFile = (file: File) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const max = 1200
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * scale)
      c.height = Math.round(img.naturalHeight * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      setSigUrl(c.toDataURL('image/png'))
      setSigAspect(img.naturalWidth / img.naturalHeight)
      setWidthFrac(0.3); setXFrac(0.35); setYFrac(0.62)
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  // ── Drag the signature on the page ──
  const sigDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = previewRef.current!.getBoundingClientRect()
    dragRef.current = { gx: e.clientX - (rect.left + xFrac * rect.width), gy: e.clientY - (rect.top + yFrac * rect.height) }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const sigMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const rect = previewRef.current!.getBoundingClientRect()
    const hFrac = (widthFrac * rect.width / sigAspect) / rect.height
    let nx = (e.clientX - dragRef.current.gx - rect.left) / rect.width
    let ny = (e.clientY - dragRef.current.gy - rect.top) / rect.height
    nx = Math.max(0, Math.min(1 - widthFrac, nx))
    ny = Math.max(0, Math.min(1 - hFrac, ny))
    setXFrac(nx); setYFrac(ny)
  }
  const sigUp = () => { dragRef.current = null }

  const download = async () => {
    if (!sigUrl) return
    const refund = reserveSignSave()
    if (!refund) return
    setStatus('working')
    setError(null)
    try {
      const buf = await (await fetch(sigUrl)).arrayBuffer()
      const pages = scope === 'all'
        ? Array.from({ length: pageCount }, (_, i) => i + 1)
        : [currentPage]
      const applied = await window.electron.pdfSignApply({
        pages,
        signature: Array.from(new Uint8Array(buf)),
        xFrac, yFrac, widthFrac,
      })
      if (!applied.success) { setError(applied.error ?? 'Failed to sign'); setStatus('error'); refund(); return }
      const res = await window.electron.pdfSignSave()
      if (res.canceled || !res.filePath) { refund(); setStatus('ready'); return }
      markSignSaved()
      onSaved()
      setSavedPath(res.filePath)
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
    setThumb(null)
    setSigUrl(null)
    setHasInk(false)
    setSavedPath(null)
    setError(null)
    resetSignSaveSession()
  }

  const isLoading = status === 'loading'
  const isWorking = status === 'working'
  const hasDoc = status === 'ready' || isWorking
  const sigWpx = widthFrac * previewW
  const sigHpx = sigWpx / sigAspect

  return (
    <section className="section py-8">
      <BackLink to="/extensions/pdf" label="Back to PDF Tools" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Sign PDF</h2>
          <p className="text-sm text-muted-foreground mt-1">Draw or upload a signature, then place it on the page. This adds a visual signature, not a certified digital one.</p>
        </div>
        <div className="flex items-end gap-2.5 shrink-0">
          {(hasDoc || status === 'error') && (
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
              disabled={isLoading || isWorking}
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

          {hasDoc && (
            <>
              {/* Source tabs */}
              <div className="grid grid-cols-2 gap-1.5">
                {(['draw', 'upload'] as Source[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSource(s)}
                    disabled={isWorking}
                    className={cn(
                      'cursor-pointer rounded-lg border py-1.5 text-xs capitalize flex items-center justify-center gap-1.5 transition-colors',
                      source === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                    )}
                  >
                    {s === 'draw' ? <PenTool className="size-3.5" /> : <Upload className="size-3.5" />}
                    {s}
                  </button>
                ))}
              </div>

              {source === 'draw' ? (
                <div className="space-y-1.5">
                  <canvas
                    ref={padRef}
                    width={300}
                    height={120}
                    onPointerDown={padDown}
                    onPointerMove={padMove}
                    onPointerUp={padUp}
                    className="w-full rounded-lg border border-border bg-white touch-none cursor-crosshair"
                    style={{ aspectRatio: '300 / 120' }}
                  />
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={clearPad} disabled={isWorking} className="flex-1 gap-1.5">
                      <Eraser className="size-3.5" /> Clear
                    </Button>
                    <Button size="sm" onClick={useDrawnSignature} disabled={isWorking || !hasInk} className="flex-1">
                      Place
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input
                    ref={uploadRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) onUploadFile(f); e.target.value = '' }}
                  />
                  <Button variant="outline" size="sm" onClick={() => uploadRef.current?.click()} disabled={isWorking} className="w-full gap-1.5">
                    <Upload className="size-3.5" /> Choose image
                  </Button>
                  <p className="text-[10px] text-muted-foreground">A transparent PNG works best.</p>
                </div>
              )}

              {/* Size + page nav appear once a signature exists */}
              {sigUrl && (
                <>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Size</Label>
                      <span className="text-[10px] text-muted-foreground">{Math.round(widthFrac * 100)}%</span>
                    </div>
                    <input type="range" min={5} max={80} step={1} value={Math.round(widthFrac * 100)} onChange={e => setWidthFrac(Number(e.target.value) / 100)} disabled={isWorking} className="w-full accent-primary" />
                  </div>

                  {pageCount > 1 && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Apply to</Label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(['current', 'all'] as Scope[]).map(s => (
                            <button
                              key={s}
                              onClick={() => setScope(s)}
                              disabled={isWorking}
                              className={cn(
                                'cursor-pointer rounded-lg border py-1.5 text-xs transition-colors',
                                scope === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                              )}
                            >
                              {s === 'current' ? 'This page' : 'All pages'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <Button variant="outline" size="sm" onClick={() => goPage(currentPage - 1)} disabled={isWorking || currentPage <= 1} className="gap-1 shrink-0">
                          <ChevronLeft className="size-3.5" />
                        </Button>
                        <span className="text-xs text-muted-foreground">Page {currentPage} / {pageCount}</span>
                        <Button variant="outline" size="sm" onClick={() => goPage(currentPage + 1)} disabled={isWorking || currentPage >= pageCount} className="gap-1 shrink-0">
                          <ChevronRight className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  )}

                  <Button className="w-full gap-2" size="sm" onClick={download} disabled={isWorking}>
                    {isWorking ? (
                      <><Loader2 className="size-3.5 animate-spin" /> Working…</>
                    ) : (
                      <><Download className="size-3.5" /> Sign &amp; download</>
                    )}
                  </Button>

                  {savedPath && <p className="text-[10px] text-muted-foreground break-all">{savedPath}</p>}
                </>
              )}
            </>
          )}
        </div>

        {/* Right: preview */}
        <div className="flex-1 min-w-0">
          {hasDoc && thumb ? (
            <div className="rounded-xl border border-border p-4 flex flex-col items-center">
              <div ref={previewRef} className="relative inline-block max-w-full">
                <img
                  src={thumb}
                  alt={`Page ${currentPage}`}
                  onLoad={e => { setPreviewW(e.currentTarget.offsetWidth); setPreviewH(e.currentTarget.offsetHeight) }}
                  className="block max-w-full max-h-140 rounded shadow-sm select-none"
                  draggable={false}
                />
                {sigUrl && previewW > 0 && (
                  <div
                    onPointerDown={sigDown}
                    onPointerMove={sigMove}
                    onPointerUp={sigUp}
                    style={{ position: 'absolute', left: xFrac * previewW, top: yFrac * previewH, width: sigWpx, height: sigHpx, touchAction: 'none' }}
                    className="cursor-move ring-1 ring-primary/60 hover:ring-primary rounded-sm"
                  >
                    <img src={sigUrl} alt="Signature" className="w-full h-full pointer-events-none select-none" draggable={false} />
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                {sigUrl ? 'Drag the signature to position it, then Sign & download' : 'Draw or upload a signature to place it here'}
              </p>
            </div>
          ) : status === 'error' ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Something went wrong</p>
                <p className="text-[10px] text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Loading…</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <PenTool className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a PDF to sign</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
