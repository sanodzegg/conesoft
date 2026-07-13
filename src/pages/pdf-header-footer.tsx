import { useState, useEffect, useRef } from 'react'
import { FileUp, Download, AlertCircle, RotateCcw, Loader2, Info, Heading } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { BackLink } from '@/components/back-link'
import { pdfjsLib } from '@/lib/pdf-worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfSaveMeter, resetHeaderFooterSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'

type Status = 'idle' | 'loading' | 'ready' | 'working' | 'error'
type Slots = { left: string; center: string; right: string }
type Row = 'header' | 'footer'
type Align = 'left' | 'center' | 'right'

const EMPTY: Slots = { left: '', center: '', right: '' }
const DATE_STR = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export default function PdfHeaderFooter() {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [thumb, setThumb] = useState<string | null>(null)
  const [pageW, setPageW] = useState(0)
  const [pageH, setPageH] = useState(0)
  const [previewW, setPreviewW] = useState(0)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [header, setHeader] = useState<Slots>(EMPTY)
  const [footer, setFooter] = useState<Slots>(EMPTY)
  const [fontSize, setFontSize] = useState(10)
  const [margin, setMargin] = useState(28)
  const [skipFirst, setSkipFirst] = useState(false)

  const docRef = useRef<PDFDocumentProxy | null>(null)
  const { reserveHeaderFooterSave, markHeaderFooterSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  useEffect(() => { resetHeaderFooterSaveSession() }, [])
  useEffect(() => () => { docRef.current?.destroy() }, [])

  const pick = async () => {
    const res = await window.electron.pdfHeaderFooterPick()
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
    const refund = reserveHeaderFooterSave()
    if (!refund) return
    setStatus('working')
    setError(null)
    try {
      const applied = await window.electron.pdfHeaderFooterApply({
        options: { header, footer, fontSize, margin, skipFirst },
      })
      if (!applied.success) { setError(applied.error ?? 'Failed to add text'); setStatus('error'); refund(); return }
      const res = await window.electron.pdfHeaderFooterSave()
      if (res.canceled || !res.filePath) { refund(); setStatus('ready'); return }
      markHeaderFooterSaved()
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
    setHeader(EMPTY)
    setFooter(EMPTY)
    setSavedPath(null)
    setError(null)
    resetHeaderFooterSaveSession()
  }

  const isLoading = status === 'loading'
  const isWorking = status === 'working'
  const hasDoc = status === 'ready' || isWorking
  const hasText = [header, footer].some(s => s.left.trim() || s.center.trim() || s.right.trim())

  const subst = (t: string) => t.replace(/\{page\}/g, '1').replace(/\{pages\}/g, String(pageCount || 1)).replace(/\{date\}/g, DATE_STR)

  // Preview badge geometry (percentages stay correct at any display size).
  const scale = previewW && pageW ? previewW / pageW : 0
  const badgeFont = Math.max(6, Math.round(fontSize * scale))
  const mxPct = pageW ? (margin / pageW) * 100 : 5
  const myPct = pageH ? (margin / pageH) * 100 : 5
  const slotStyle = (row: Row, align: Align): React.CSSProperties => {
    const s: React.CSSProperties = { position: 'absolute', fontSize: badgeFont, lineHeight: 1, textShadow: '0 0 2px rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }
    if (row === 'header') s.top = `${myPct}%`; else s.bottom = `${myPct}%`
    if (align === 'left') s.left = `${mxPct}%`
    else if (align === 'right') s.right = `${mxPct}%`
    else { s.left = '50%'; s.transform = 'translateX(-50%)' }
    return s
  }

  const slotInputs = (row: Row, value: Slots, setValue: (s: Slots) => void) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground capitalize">{row}</Label>
      <div className="space-y-1.5">
        {(['left', 'center', 'right'] as Align[]).map(align => (
          <Input
            key={align}
            placeholder={align.charAt(0).toUpperCase() + align.slice(1)}
            value={value[align]}
            onChange={e => setValue({ ...value, [align]: e.target.value })}
            disabled={isWorking}
            className="text-sm h-8"
          />
        ))}
      </div>
    </div>
  )

  return (
    <section className="section py-8">
      <BackLink to="/extensions/pdf" label="Back to PDF Tools" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Header &amp; Footer</h2>
          <p className="text-sm text-muted-foreground mt-1">Add header and footer text to every page. Use {'{page}'}, {'{pages}'}, and {'{date}'} as placeholders.</p>
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
              {slotInputs('header', header, setHeader)}
              {slotInputs('footer', footer, setFooter)}

              <p className="text-[10px] text-muted-foreground -mt-1">
                Placeholders: <span className="text-foreground">{'{page}'}</span> <span className="text-foreground">{'{pages}'}</span> <span className="text-foreground">{'{date}'}</span>
              </p>

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

              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={skipFirst} onChange={e => setSkipFirst(e.target.checked)} disabled={isWorking} className="accent-primary" />
                Skip first page
              </label>

              <Button className="w-full gap-2" size="sm" onClick={download} disabled={isWorking || !hasText}>
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
                {(['header', 'footer'] as Row[]).map(row =>
                  (['left', 'center', 'right'] as Align[]).map(align => {
                    const raw = (row === 'header' ? header : footer)[align]
                    if (!raw.trim()) return null
                    return (
                      <span key={`${row}-${align}`} style={slotStyle(row, align)} className="font-medium text-black">
                        {subst(raw)}
                      </span>
                    )
                  })
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                Preview of page 1{skipFirst ? ' (first page will be skipped)' : ''}
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
              <Heading className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a PDF to add headers and footers</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
