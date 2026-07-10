import { useState, useEffect, useRef } from 'react'
import { FileUp, Download, AlertCircle, RotateCcw, Loader2, Info, Scissors, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { pdfjsLib } from '@/lib/pdf-worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfSaveMeter, resetSplitSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'
import { BackLink } from '@/components/back-link'

type Status = 'idle' | 'loading' | 'ready' | 'exporting' | 'error'
type Mode = 'extract' | 'split'

const THUMB_CAP = 150

// Parse "1-3, 5, 8-10" (1-based, inclusive) into a sorted list of 0-based page indices.
function parseRange(input: string, total: number): number[] {
  const out = new Set<number>()
  for (const part of input.split(',')) {
    const s = part.trim()
    if (!s) continue
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      let a = parseInt(m[1], 10)
      let b = parseInt(m[2], 10)
      if (a > b) [a, b] = [b, a]
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.add(i - 1)
    } else if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10)
      if (n >= 1 && n <= total) out.add(n - 1)
    }
  }
  return [...out].sort((a, b) => a - b)
}

async function renderThumb(doc: PDFDocumentProxy, pageIndex: number): Promise<string> {
  const page = await doc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 0.4 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.7)
}

export default function PdfSplit() {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [rangeInput, setRangeInput] = useState('')
  const [mode, setMode] = useState<Mode>('extract')
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const docRef = useRef<PDFDocumentProxy | null>(null)
  const { reserveSplitSave, markSplitSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  useEffect(() => { resetSplitSaveSession() }, [])
  useEffect(() => () => { docRef.current?.destroy() }, [])

  const pick = async () => {
    const res = await window.electron.pdfConvertSplitPick()
    if (res.canceled) return
    setStatus('loading')
    setError(null)
    setSaved(null)
    setThumbs([])
    setSelected(new Set())
    setRangeInput('')
    try {
      docRef.current?.destroy()
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(res.data) }).promise
      docRef.current = doc
      setFileName(res.name)
      setPageCount(doc.numPages)
      const count = Math.min(doc.numPages, THUMB_CAP)
      const urls: string[] = []
      for (let i = 0; i < count; i++) urls.push(await renderThumb(doc, i))
      setThumbs(urls)
      setStatus('ready')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
    setSaved(null)
  }

  const selectAll = () => { setSelected(new Set(Array.from({ length: pageCount }, (_, i) => i))); setSaved(null) }
  const clearAll = () => { setSelected(new Set()); setSaved(null) }
  const applyRange = () => {
    const idx = parseRange(rangeInput, pageCount)
    if (idx.length) { setSelected(new Set(idx)); setSaved(null) }
  }

  const download = async () => {
    const pages = [...selected].sort((a, b) => a - b)
    if (!pages.length) return
    const refund = reserveSplitSave()
    if (!refund) return
    setStatus('exporting')
    setError(null)
    try {
      const build = await window.electron.pdfConvertSplitBuild({ pages, mode })
      if (!build.success) { setError(build.error ?? 'Failed to build output'); setStatus('error'); refund(); return }
      const res = await window.electron.pdfConvertSplitSave({ mode })
      if (res.canceled) { refund(); setStatus('ready'); return }
      markSplitSaved()
      onSaved()
      setSaved(mode === 'split' ? `${res.count} PDFs → ${res.folderPath}` : (res.filePath ?? null))
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
    setSelected(new Set())
    setRangeInput('')
    setSaved(null)
    setError(null)
    resetSplitSaveSession()
  }

  const isLoading = status === 'loading'
  const isExporting = status === 'exporting'
  const isError = status === 'error'
  const hasDoc = status === 'ready' || isExporting
  const selCount = selected.size

  return (
    <section className="section py-8">
      <BackLink to="/extensions/pdf" label="Back to PDF Tools" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Split &amp; Extract</h2>
          <p className="text-sm text-muted-foreground mt-1">Pull selected pages into a new PDF, or split each into its own file.</p>
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
              <p className="text-[10px] text-muted-foreground mt-0.5">{pageCount} page{pageCount !== 1 ? 's' : ''} · {selCount} selected</p>
            </div>
          )}

          {hasDoc && (
            <>
              {/* Range select */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Pages</Label>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="1-3, 5, 8-10"
                    value={rangeInput}
                    onChange={e => setRangeInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyRange() }}
                    disabled={isExporting}
                    className="text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={applyRange} disabled={isExporting} className="shrink-0">Apply</Button>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={selectAll} disabled={isExporting} className="cursor-pointer flex-1 rounded-lg border border-border py-1 text-[11px] text-muted-foreground hover:border-primary/50 transition-colors disabled:opacity-50">Select all</button>
                  <button onClick={clearAll} disabled={isExporting} className="cursor-pointer flex-1 rounded-lg border border-border py-1 text-[11px] text-muted-foreground hover:border-primary/50 transition-colors disabled:opacity-50">Clear</button>
                </div>
              </div>

              {/* Mode */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Output</Label>
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    onClick={() => setMode('extract')}
                    disabled={isExporting}
                    className={cn(
                      'cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      mode === 'extract' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                    )}
                  >
                    <span className="font-medium">Extract to one PDF</span>
                    <span className="block text-[10px] opacity-70 mt-0.5">Selected pages → a single file</span>
                  </button>
                  <button
                    onClick={() => setMode('split')}
                    disabled={isExporting}
                    className={cn(
                      'cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      mode === 'split' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                    )}
                  >
                    <span className="font-medium">Split into separate PDFs</span>
                    <span className="block text-[10px] opacity-70 mt-0.5">One file per page → a folder</span>
                  </button>
                </div>
              </div>

              <Button className="w-full gap-2" size="sm" onClick={download} disabled={isExporting || selCount === 0}>
                {isExporting ? (
                  <><Loader2 className="size-3.5 animate-spin" /> Working…</>
                ) : mode === 'extract' ? (
                  <><Download className="size-3.5" /> Extract {selCount || ''} page{selCount !== 1 ? 's' : ''}</>
                ) : (
                  <><Scissors className="size-3.5" /> Split {selCount || ''} page{selCount !== 1 ? 's' : ''}</>
                )}
              </Button>

              {saved && <p className="text-[10px] text-muted-foreground break-all">{saved}</p>}
            </>
          )}
        </div>

        {/* Right: page grid */}
        <div className="flex-1 min-w-0">
          {hasDoc && thumbs.length > 0 ? (
            <div className="rounded-xl border border-border p-4">
              <div className="grid grid-cols-4 gap-3 max-h-140 overflow-y-auto">
                {thumbs.map((src, i) => {
                  const on = selected.has(i)
                  return (
                    <button
                      key={i}
                      onClick={() => toggle(i)}
                      disabled={isExporting}
                      className={cn(
                        'group relative rounded-lg border-2 overflow-hidden transition-colors',
                        on ? 'border-primary' : 'border-border hover:border-primary/50'
                      )}
                    >
                      <div className="bg-white">
                        <img src={src} alt={`Page ${i + 1}`} className={cn('w-full block transition-opacity', !on && 'opacity-90 group-hover:opacity-100')} />
                      </div>
                      <span className={cn(
                        'absolute top-1 right-1 size-4 rounded-full flex items-center justify-center transition-colors',
                        on ? 'bg-primary text-primary-foreground' : 'bg-black/40 text-transparent'
                      )}>
                        <Check className="size-3" />
                      </span>
                      <span className="absolute bottom-1 left-1 text-[10px] font-mono px-1 rounded bg-black/50 text-white">{i + 1}</span>
                    </button>
                  )
                })}
              </div>
              {pageCount > thumbs.length && (
                <p className="text-[10px] text-muted-foreground text-center mt-3">
                  Showing first {thumbs.length} of {pageCount} pages · use the Pages box to select any page
                </p>
              )}
            </div>
          ) : isError ? (
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
              <p className="text-sm text-muted-foreground">Rendering pages…</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Scissors className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a PDF, then pick the pages to extract or split</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
