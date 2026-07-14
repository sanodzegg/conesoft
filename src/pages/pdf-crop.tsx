import { useState, useEffect, useRef } from 'react'
import { FileUp, Download, AlertCircle, RotateCcw, Loader2, Info, Crop, ChevronLeft, ChevronRight, Eraser } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { BackLink } from '@/components/back-link'
import { pdfjsLib } from '@/lib/pdf-worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfSaveMeter, resetCropSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'

type Status = 'idle' | 'loading' | 'ready' | 'working' | 'error'
type Scope = 'current' | 'all'
type Rect = { x: number; y: number; w: number; h: number } // top-origin fractions of the page

export default function PdfCrop() {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [thumb, setThumb] = useState<string | null>(null)
  const [previewW, setPreviewW] = useState(0)
  const [previewH, setPreviewH] = useState(0)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [sel, setSel] = useState<Rect | null>(null)
  const [scope, setScope] = useState<Scope>('current')

  const docRef = useRef<PDFDocumentProxy | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)

  const { reserveCropSave, markCropSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  useEffect(() => { resetCropSaveSession() }, [])
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
    const res = await window.electron.pdfCropPick()
    if (res.canceled) return
    setStatus('loading')
    setError(null)
    setSavedPath(null)
    setThumb(null)
    setSel(null)
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

  // ── Drag to draw the crop rectangle ──
  const frac = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = previewRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }
  const boxDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (status === 'working') return
    startRef.current = frac(e)
    setSel({ x: startRef.current.x, y: startRef.current.y, w: 0, h: 0 })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const boxMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    const p = frac(e)
    const s = startRef.current
    setSel({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
  }
  const boxUp = () => {
    startRef.current = null
    // Ignore accidental tiny selections (a click, not a drag).
    setSel(s => (s && (s.w < 0.02 || s.h < 0.02) ? null : s))
  }
  const clearSel = () => setSel(null)

  const download = async () => {
    if (!sel || sel.w < 0.02 || sel.h < 0.02) return
    const refund = reserveCropSave()
    if (!refund) return
    setStatus('working')
    setError(null)
    try {
      const pages = scope === 'all'
        ? Array.from({ length: pageCount }, (_, i) => i + 1)
        : [currentPage]
      const applied = await window.electron.pdfCropApply({
        pages, xFrac: sel.x, yFrac: sel.y, wFrac: sel.w, hFrac: sel.h,
      })
      if (!applied.success) { setError(applied.error ?? 'Failed to crop'); setStatus('error'); refund(); return }
      const res = await window.electron.pdfCropSave()
      if (res.canceled || !res.filePath) { refund(); setStatus('ready'); return }
      markCropSaved()
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
    setSel(null)
    setSavedPath(null)
    setError(null)
    resetCropSaveSession()
  }

  const isLoading = status === 'loading'
  const isWorking = status === 'working'
  const hasDoc = status === 'ready' || isWorking
  const hasSel = !!sel && sel.w >= 0.02 && sel.h >= 0.02

  return (
    <section className="section py-8">
      <BackLink to="/extensions/pdf" label="Back to PDF Tools" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Crop PDF</h2>
          <p className="text-sm text-muted-foreground mt-1">Drag a rectangle on the page to keep, then crop it out. Apply to one page or the whole document.</p>
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
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Crop area</Label>
                  {hasSel && (
                    <span className="text-[10px] text-muted-foreground">{Math.round(sel!.w * 100)}% × {Math.round(sel!.h * 100)}%</span>
                  )}
                </div>
                {hasSel ? (
                  <Button variant="outline" size="sm" onClick={clearSel} disabled={isWorking} className="w-full gap-1.5">
                    <Eraser className="size-3.5" /> Clear selection
                  </Button>
                ) : (
                  <p className="text-[10px] text-muted-foreground">Drag on the page to draw the area to keep.</p>
                )}
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
                    {scope === 'all' && (
                      <p className="text-[10px] text-muted-foreground">Uses the same area, sized to each page.</p>
                    )}
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

              <Button className="w-full gap-2" size="sm" onClick={download} disabled={isWorking || !hasSel}>
                {isWorking ? (
                  <><Loader2 className="size-3.5 animate-spin" /> Working…</>
                ) : (
                  <><Download className="size-3.5" /> Crop &amp; download</>
                )}
              </Button>

              {savedPath && <p className="text-[10px] text-muted-foreground break-all">{savedPath}</p>}
            </>
          )}
        </div>

        {/* Right: preview */}
        <div className="flex-1 min-w-0">
          {hasDoc && thumb ? (
            <div className="rounded-xl border border-border p-4 flex flex-col items-center">
              <div
                ref={previewRef}
                onPointerDown={boxDown}
                onPointerMove={boxMove}
                onPointerUp={boxUp}
                className="relative inline-block max-w-full cursor-crosshair touch-none"
              >
                <img
                  src={thumb}
                  alt={`Page ${currentPage}`}
                  onLoad={e => { setPreviewW(e.currentTarget.offsetWidth); setPreviewH(e.currentTarget.offsetHeight) }}
                  className="block max-w-full max-h-140 rounded shadow-sm select-none pointer-events-none"
                  draggable={false}
                />
                {sel && previewW > 0 && (
                  <>
                    {/* Dim everything outside the selection (4 bands), then ring the selection. */}
                    <div className="absolute bg-black/45 pointer-events-none" style={{ left: 0, top: 0, width: previewW, height: sel.y * previewH }} />
                    <div className="absolute bg-black/45 pointer-events-none" style={{ left: 0, top: (sel.y + sel.h) * previewH, width: previewW, height: (1 - (sel.y + sel.h)) * previewH }} />
                    <div className="absolute bg-black/45 pointer-events-none" style={{ left: 0, top: sel.y * previewH, width: sel.x * previewW, height: sel.h * previewH }} />
                    <div className="absolute bg-black/45 pointer-events-none" style={{ left: (sel.x + sel.w) * previewW, top: sel.y * previewH, width: (1 - (sel.x + sel.w)) * previewW, height: sel.h * previewH }} />
                    <div className="absolute ring-2 ring-primary pointer-events-none rounded-[1px]" style={{ left: sel.x * previewW, top: sel.y * previewH, width: sel.w * previewW, height: sel.h * previewH }} />
                  </>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                {hasSel ? 'Drag again to redraw the area, then Crop & download' : 'Drag on the page to draw the crop area'}
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
              <Crop className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a PDF to crop</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
