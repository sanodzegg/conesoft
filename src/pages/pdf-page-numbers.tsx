import { useState, useEffect, useRef } from 'react'
import { FileUp, Download, AlertCircle, RotateCcw, Loader2, Info, Hash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { BackLink } from '@/components/back-link'
import { pdfjsLib } from '@/lib/pdf-worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfSaveMeter, resetPageNumbersSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'

type Status = 'idle' | 'loading' | 'ready' | 'working' | 'error'
type Position = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
type Format = 'n' | 'n-of-total' | 'n-slash-total'

const POSITIONS: { value: Position; dot: string }[] = [
  { value: 'top-left', dot: 'top-1 left-1' },
  { value: 'top-center', dot: 'top-1 left-1/2 -translate-x-1/2' },
  { value: 'top-right', dot: 'top-1 right-1' },
  { value: 'bottom-left', dot: 'bottom-1 left-1' },
  { value: 'bottom-center', dot: 'bottom-1 left-1/2 -translate-x-1/2' },
  { value: 'bottom-right', dot: 'bottom-1 right-1' },
]

function sampleText(format: Format, n: number, total: number) {
  if (format === 'n-of-total') return `Page ${n} of ${total}`
  if (format === 'n-slash-total') return `${n} / ${total}`
  return `${n}`
}

export default function PdfPageNumbers() {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [thumb, setThumb] = useState<string | null>(null)
  const [pageW, setPageW] = useState(0)
  const [pageH, setPageH] = useState(0)
  const [previewW, setPreviewW] = useState(0)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [position, setPosition] = useState<Position>('bottom-center')
  const [format, setFormat] = useState<Format>('n')
  const [fontSize, setFontSize] = useState(11)
  const [margin, setMargin] = useState(28)
  const [startPage, setStartPage] = useState(1)
  const [startNumber, setStartNumber] = useState(1)

  const docRef = useRef<PDFDocumentProxy | null>(null)
  const { reservePageNumbersSave, markPageNumbersSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  useEffect(() => { resetPageNumbersSaveSession() }, [])
  useEffect(() => () => { docRef.current?.destroy() }, [])

  const pick = async () => {
    const res = await window.electron.pdfPageNumbersPick()
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
      setStartPage(1)
      setStartNumber(1)
      const page = await doc.getPage(1)
      const vp1 = page.getViewport({ scale: 1 })
      setPageW(vp1.width)
      setPageH(vp1.height)
      const scale = 620 / vp1.width
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')!
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      setThumb(canvas.toDataURL('image/jpeg', 0.85))
      setStatus('ready')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const download = async () => {
    const refund = reservePageNumbersSave()
    if (!refund) return
    setStatus('working')
    setError(null)
    try {
      const applied = await window.electron.pdfPageNumbersApply({
        options: { position, format, fontSize, margin, startPage, startNumber },
      })
      if (!applied.success) { setError(applied.error ?? 'Failed to add page numbers'); setStatus('error'); refund(); return }
      const res = await window.electron.pdfPageNumbersSave()
      if (res.canceled || !res.filePath) { refund(); setStatus('ready'); return }
      markPageNumbersSaved()
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
    setSavedPath(null)
    setError(null)
    resetPageNumbersSaveSession()
  }

  const isLoading = status === 'loading'
  const isWorking = status === 'working'
  const hasDoc = status === 'ready' || isWorking

  // Live preview badge geometry (percentages keep it correct at any display size).
  const scale = previewW && pageW ? previewW / pageW : 0
  const badgeFont = Math.max(7, Math.round(fontSize * scale))
  const mxPct = pageW ? (margin / pageW) * 100 : 5
  const myPct = pageH ? (margin / pageH) * 100 : 5
  const maxNumber = startNumber + Math.max(0, pageCount - startPage)
  const badgeStyle: React.CSSProperties = { position: 'absolute', fontSize: badgeFont, lineHeight: 1, textShadow: '0 0 2px rgba(255,255,255,0.9)' }
  if (position.startsWith('top')) badgeStyle.top = `${myPct}%`; else badgeStyle.bottom = `${myPct}%`
  if (position.endsWith('left')) badgeStyle.left = `${mxPct}%`
  else if (position.endsWith('right')) badgeStyle.right = `${mxPct}%`
  else { badgeStyle.left = '50%'; badgeStyle.transform = 'translateX(-50%)' }

  return (
    <section className="section py-8">
      <BackLink to="/extensions/pdf" label="Back to PDF Tools" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Page Numbers</h2>
          <p className="text-sm text-muted-foreground mt-1">Add page numbers to a PDF, with control over position and format.</p>
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
              {/* Position */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Position</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {POSITIONS.map(p => (
                    <button
                      key={p.value}
                      onClick={() => setPosition(p.value)}
                      disabled={isWorking}
                      aria-label={p.value}
                      className={cn(
                        'relative h-9 rounded-lg border transition-colors',
                        position === p.value ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                      )}
                    >
                      <span className={cn('absolute size-1.5 rounded-full bg-current', p.dot)} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Format */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Format</Label>
                <div className="grid grid-cols-1 gap-1.5">
                  {(['n', 'n-of-total', 'n-slash-total'] as Format[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      disabled={isWorking}
                      className={cn(
                        'cursor-pointer rounded-lg border px-3 py-1.5 text-xs text-left transition-colors',
                        format === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                      )}
                    >
                      {sampleText(f, startNumber, maxNumber || startNumber)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font size */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Font size</Label>
                  <span className="text-[10px] text-muted-foreground">{fontSize} pt</span>
                </div>
                <input type="range" min={8} max={24} step={1} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} disabled={isWorking} className="w-full accent-primary" />
              </div>

              {/* Margin */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Margin</Label>
                  <span className="text-[10px] text-muted-foreground">{margin} pt</span>
                </div>
                <input type="range" min={12} max={72} step={2} value={margin} onChange={e => setMargin(Number(e.target.value))} disabled={isWorking} className="w-full accent-primary" />
              </div>

              {/* Start page + start number */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Start on page</Label>
                  <Input type="number" min={1} max={pageCount} value={startPage} onChange={e => setStartPage(Math.max(1, Math.min(pageCount, Number(e.target.value) || 1)))} disabled={isWorking} className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Start at</Label>
                  <Input type="number" min={0} value={startNumber} onChange={e => setStartNumber(Math.max(0, Number(e.target.value) || 0))} disabled={isWorking} className="text-sm" />
                </div>
              </div>

              <Button className="w-full gap-2" size="sm" onClick={download} disabled={isWorking}>
                {isWorking ? (
                  <><Loader2 className="size-3.5 animate-spin" /> Working…</>
                ) : (
                  <><Download className="size-3.5" /> Add &amp; download</>
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
              <div className="relative inline-block max-w-full">
                <img
                  src={thumb}
                  alt="Page 1 preview"
                  onLoad={e => setPreviewW(e.currentTarget.offsetWidth)}
                  className="block max-w-full max-h-140 rounded shadow-sm"
                />
                <span style={badgeStyle} className="font-medium text-black whitespace-nowrap">
                  {sampleText(format, startNumber, maxNumber || startNumber)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                Preview of page 1{startPage > 1 ? ` (numbers start on page ${startPage})` : ''}
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
              <Hash className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a PDF to add page numbers</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
