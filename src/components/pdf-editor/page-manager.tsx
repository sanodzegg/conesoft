import { useState, useEffect, useRef, useCallback } from 'react'
import { RotateCcw, RotateCw, Trash2, Copy, Save, Loader2, GripVertical, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pdfjsLib } from '@/lib/pdf-worker'
import { usePdfSaveMeter } from '@/lib/usePdfSaveMeter'
import type { PdfFile } from '@/pages/pdf-editor'
import type { PDFDocumentProxy } from 'pdfjs-dist'

// ─── Types ────────────────────────────────────────────────────────────────────

type PageEntry = {
  id: string        // unique stable key
  srcIndex: number  // original page index in the source doc
  rotation: number  // cumulative rotation delta (0, 90, 180, 270)
  thumbnail: string | null
}

// ─── Thumbnail renderer ───────────────────────────────────────────────────────

async function renderThumbnail(doc: PDFDocumentProxy, pageIndex: number, rotation: number): Promise<string> {
  const page = await doc.getPage(pageIndex + 1)
  const baseViewport = page.getViewport({ scale: 1, rotation: 0 })
  const THUMB_WIDTH = 160
  const scale = THUMB_WIDTH / baseViewport.width
  const viewport = page.getViewport({ scale, rotation })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.85)
}

// ─── Page thumbnail card ──────────────────────────────────────────────────────

function PageCard({
  entry,
  index,
  total,
  selected,
  onClick,
  onRotate,
  onDelete,
  onDuplicate,
  dragHandleProps,
  isDragging,
  isOver,
}: {
  entry: PageEntry
  index: number
  total: number
  selected: boolean
  onClick: () => void
  onRotate: (dir: 'cw' | 'ccw') => void
  onDelete: () => void
  onDuplicate: () => void
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>
  isDragging: boolean
  isOver: boolean
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-xl border-2 p-2 transition-all select-none group',
        selected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
        isDragging && 'opacity-40',
        isOver && 'border-primary/60 bg-primary/5 scale-[1.02]'
      )}
      onClick={onClick}
    >
      {/* Drag handle */}
      <div
        {...dragHandleProps}
        className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground z-10"
        onClick={e => e.stopPropagation()}
      >
        <GripVertical className="size-4" />
      </div>

      {/* Page number */}
      <span className="absolute top-2 right-2 text-xs text-muted-foreground font-mono z-10 bg-background/80 rounded px-1">
        {index + 1}
      </span>

      {/* Thumbnail */}
      <div className="w-full rounded-lg overflow-hidden bg-muted flex items-center justify-center" style={{ minHeight: 120 }}>
        {entry.thumbnail ? (
          <img
            src={entry.thumbnail}
            alt={`Page ${index + 1}`}
            className="w-full h-auto object-contain rounded-lg"
            draggable={false}
          />
        ) : (
          <Loader2 className="size-5 text-muted-foreground animate-spin my-8" />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => onRotate('ccw')}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="Rotate counter-clockwise"
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          onClick={() => onRotate('cw')}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="Rotate clockwise"
        >
          <RotateCw className="size-3.5" />
        </button>
        <button
          onClick={onDuplicate}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="Duplicate page"
        >
          <Copy className="size-3.5" />
        </button>
        <button
          onClick={onDelete}
          disabled={total <= 1}
          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Delete page"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Page Manager ─────────────────────────────────────────────────────────────

export default function PageManager({ file }: { file: PdfFile }) {
  const [pages, setPages] = useState<PageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const { reserveEditorSave, markEditorSaved, onSaved } = usePdfSaveMeter()

  const docRef = useRef<PDFDocumentProxy | null>(null)

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // Load PDF and build initial page list
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDirty(false)

    async function load() {
      try {
        const bytes = await window.electron.pdfEditorReadFile(file.path)
        const data = new Uint8Array(bytes)
        const doc = await pdfjsLib.getDocument({ data }).promise
        docRef.current = doc

        const entries: PageEntry[] = Array.from({ length: doc.numPages }, (_, i) => ({
          id: `page-${i}-${Date.now()}`,
          srcIndex: i,
          rotation: 0,
          thumbnail: null,
        }))

        if (!cancelled) {
          setPages(entries)
          setLoading(false)

          // Render thumbnails progressively
          for (let i = 0; i < entries.length; i++) {
            if (cancelled) break
            const thumb = await renderThumbnail(doc, i, 0)
            if (!cancelled) {
              setPages(prev => prev.map(p => p.id === entries[i].id ? { ...p, thumbnail: thumb } : p))
            }
          }
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

  // Re-render thumbnail when rotation changes
  const rerenderThumbnail = useCallback(async (entry: PageEntry) => {
    if (!docRef.current) return
    const thumb = await renderThumbnail(docRef.current, entry.srcIndex, entry.rotation)
    setPages(prev => prev.map(p => p.id === entry.id ? { ...p, thumbnail: thumb } : p))
  }, [])

  function rotate(id: string, dir: 'cw' | 'ccw') {
    setDirty(true)
    setPages(prev => {
      const updated = prev.map(p => {
        if (p.id !== id) return p
        const delta = dir === 'cw' ? 90 : -90
        const rotation = ((p.rotation + delta) % 360 + 360) % 360
        const entry = { ...p, rotation, thumbnail: null }
        rerenderThumbnail(entry)
        return entry
      })
      return updated
    })
  }

  function deletePage(id: string) {
    setDirty(true)
    setPages(prev => prev.filter(p => p.id !== id))
    setSelected(s => s === id ? null : s)
  }

  function duplicatePage(id: string) {
    setDirty(true)
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === id)
      if (idx === -1) return prev
      const src = prev[idx]
      const copy: PageEntry = { ...src, id: `page-dup-${Date.now()}-${Math.random()}` }
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────────────

  function onDragStart(index: number) {
    setDragIndex(index)
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    setOverIndex(index)
  }

  function onDrop(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }
    setDirty(true)
    setPages(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(index, 0, moved)
      return next
    })
    setDragIndex(null)
    setOverIndex(null)
  }

  function onDragEnd() {
    setDragIndex(null)
    setOverIndex(null)
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  async function save() {
    // Reserve up front: 5 for the first save of this document, 2 for a re-save.
    const refund = reserveEditorSave()
    if (!refund) return
    setSaving(true)
    setSaveError(null)
    const ops = pages.map(p => ({ srcIndex: p.srcIndex, rotation: p.rotation }))
    const result = await window.electron.pdfEditorPageOps({ filePath: file.path, ops })
    if (!result.success) {
      refund()
      setSaveError(result.error ?? 'Failed to apply changes')
      setSaving(false)
      return
    }
    const saved = await window.electron.pdfEditorSave()
    setSaving(false)
    if (!saved.canceled) { onSaved(); markEditorSaved(); setDirty(false) }
    else refund()
  }

  // ── Render ───────────────────────────────────────────────────────────────────

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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{pages.length} page{pages.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          {saveError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="size-3.5" /> {saveError}
            </p>
          )}
          <Button
            onClick={save}
            disabled={saving || !dirty}
            size="sm"
            className="gap-2 cursor-pointer"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {saving ? 'Saving…' : 'Save PDF'}
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {pages.map((entry, index) => (
          <div
            key={entry.id}
            draggable
            onDragStart={() => onDragStart(index)}
            onDragOver={e => onDragOver(e, index)}
            onDrop={e => onDrop(e, index)}
            onDragEnd={onDragEnd}
          >
            <PageCard
              entry={entry}
              index={index}
              total={pages.length}
              selected={selected === entry.id}
              onClick={() => setSelected(s => s === entry.id ? null : entry.id)}
              onRotate={dir => rotate(entry.id, dir)}
              onDelete={() => deletePage(entry.id)}
              onDuplicate={() => duplicatePage(entry.id)}
              dragHandleProps={{}}
              isDragging={dragIndex === index}
              isOver={overIndex === index && dragIndex !== index}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
