import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, AlertCircle, Save, Undo2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pdfjsLib } from '@/lib/pdf-worker'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PdfFile } from '@/pages/pdf-editor'
import AnnotationToolbar, { type AnnotationTool } from './annotation-toolbar'
import AnnotationCanvas, { type Annotation, type AnnotationCanvasHandle } from './annotation-canvas'
import { usePdfSaveMeter } from '@/lib/usePdfSaveMeter'

// ─── Per-page rendered state ──────────────────────────────────────────────────

type RenderedPage = {
  pageNum: number      // 1-based
  canvas: HTMLCanvasElement
  width: number
  height: number
  annotations: Annotation[]
}

// ─── Render a PDF page to an off-screen canvas ────────────────────────────────

async function renderPage(page: PDFPageProxy, scale: number): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return { canvas, width: canvas.width, height: canvas.height }
}

// ─── Single page display ──────────────────────────────────────────────────────

function PageView({
  rendered,
  tool,
  color,
  strokeWidth,
  onAnnotationsChange,
}: {
  rendered: RenderedPage
  tool: AnnotationTool
  color: string
  strokeWidth: number
  onAnnotationsChange: (pageNum: number, annotations: Annotation[]) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const annotCanvasRef = useRef<AnnotationCanvasHandle>(null)

  // Draw the rendered page into the visible canvas on mount / page change
  useEffect(() => {
    const canvas = pdfCanvasRef.current
    if (!canvas) return
    canvas.width = rendered.width
    canvas.height = rendered.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(rendered.canvas, 0, 0)
  }, [rendered.canvas, rendered.width, rendered.height])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs text-muted-foreground font-mono">Page {rendered.pageNum}</span>
      <div
        ref={containerRef}
        className="relative rounded-lg overflow-hidden border border-border shadow-sm"
        style={{ width: rendered.width, height: rendered.height, maxWidth: '100%' }}
      >
        {/* PDF render layer */}
        <canvas
          ref={pdfCanvasRef}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
        {/* Annotation overlay */}
        <AnnotationCanvas
          ref={annotCanvasRef}
          width={rendered.width}
          height={rendered.height}
          annotations={rendered.annotations}
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          onChange={anns => onAnnotationsChange(rendered.pageNum, anns)}
        />
      </div>
    </div>
  )
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export default function AnnotationEditor({ file }: { file: PdfFile }) {
  const [pages, setPages] = useState<RenderedPage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const { reserveEditorSave, markEditorSaved, onSaved } = usePdfSaveMeter()

  const [tool, setTool] = useState<AnnotationTool>('highlight')
  const [color, setColor] = useState('#FFFF00')
  const [strokeWidth, setStrokeWidth] = useState(4)

  // History for undo - array of per-page annotation snapshots
  const history = useRef<Record<number, Annotation[]>[]>([])

  const docRef = useRef<PDFDocumentProxy | null>(null)

  // Load PDF
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDone(false)
    history.current = []

    async function load() {
      try {
        const bytes = await window.electron.pdfEditorReadFile(file.path)
        const data = new Uint8Array(bytes)
        const doc = await pdfjsLib.getDocument({ data }).promise
        docRef.current = doc

        const SCALE = 1.5
        const rendered: RenderedPage[] = []

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const { canvas, width, height } = await renderPage(page, SCALE)
          rendered.push({ pageNum: i, canvas, width, height, annotations: [] })
        }

        if (!cancelled) {
          setPages(rendered)
          setLoading(false)
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message ?? 'Failed to load PDF')
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [file.path])

  // Push history snapshot before any annotation change
  function pushHistory(current: RenderedPage[]) {
    const snapshot: Record<number, Annotation[]> = {}
    for (const p of current) snapshot[p.pageNum] = [...p.annotations]
    history.current = [...history.current.slice(-30), snapshot]
  }

  const handleAnnotationsChange = useCallback((pageNum: number, annotations: Annotation[]) => {
    setPages(prev => {
      pushHistory(prev)
      return prev.map(p => p.pageNum === pageNum ? { ...p, annotations } : p)
    })
    setDone(false)
  }, [])

  function undo() {
    if (history.current.length === 0) return
    const snapshot = history.current[history.current.length - 1]
    history.current = history.current.slice(0, -1)
    setPages(prev => prev.map(p => ({
      ...p,
      annotations: snapshot[p.pageNum] ?? p.annotations,
    })))
  }

  function clearAll() {
    setPages(prev => {
      pushHistory(prev)
      return prev.map(p => ({ ...p, annotations: [] }))
    })
    setDone(false)
  }

  const totalAnnotations = pages.reduce((s, p) => s + p.annotations.length, 0)

  async function save() {
    // Reserve up front: 5 for the first save of this document, 2 for a re-save.
    const refund = reserveEditorSave()
    if (!refund) return
    setSaving(true)
    setSaveError(null)
    setDone(false)

    const pageData = pages.map(p => ({
      pageNum: p.pageNum,
      annotations: p.annotations,
      width: p.width,
      height: p.height,
    }))

    const result = await window.electron.pdfEditorBurnAnnotations({
      filePath: file.path,
      pages: pageData,
    })

    if (!result.success) {
      refund()
      setSaveError(result.error ?? 'Failed to burn annotations')
      setSaving(false)
      return
    }

    const saved = await window.electron.pdfEditorSave()
    setSaving(false)
    if (!saved.canceled) { onSaved(); markEditorSaved(); setDone(true) }
    else refund()
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <Loader2 className="size-7 animate-spin" />
        <p className="text-sm">Loading pages…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex items-center gap-3">
        <AlertCircle className="size-5 text-destructive shrink-0" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <AnnotationToolbar
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        onToolChange={setTool}
        onColorChange={setColor}
        onStrokeWidthChange={setStrokeWidth}
      />

      {/* Action bar */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground flex-1">
          {totalAnnotations > 0
            ? `${totalAnnotations} annotation${totalAnnotations !== 1 ? 's' : ''}`
            : 'No annotations yet - pick a tool and draw on a page'}
        </span>
        <button
          onClick={undo}
          disabled={history.current.length === 0}
          title="Undo"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <Undo2 className="size-3.5" /> Undo
        </button>
        <button
          onClick={clearAll}
          disabled={totalAnnotations === 0}
          title="Clear all annotations"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <Trash2 className="size-3.5" /> Clear all
        </button>
        {saveError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="size-3.5" /> {saveError}
          </p>
        )}
        <Button
          onClick={save}
          disabled={saving || totalAnnotations === 0}
          size="sm"
          className="gap-2 cursor-pointer"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {saving ? 'Saving…' : done ? 'Saved!' : 'Save PDF'}
        </Button>
      </div>

      {/* Pages */}
      <div className="flex flex-col gap-8 items-center pb-8">
        {pages.map(rendered => (
          <PageView
            key={rendered.pageNum}
            rendered={rendered}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            onAnnotationsChange={handleAnnotationsChange}
          />
        ))}
      </div>
    </div>
  )
}
