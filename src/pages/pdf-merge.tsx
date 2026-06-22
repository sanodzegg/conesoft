import { useState } from 'react'
import { FilePlus, Download, AlertCircle, RotateCcw, Loader2, GripVertical, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePdfSaveMeter } from '@/lib/usePdfSaveMeter'

type Status = 'idle' | 'merging' | 'done' | 'error'

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

interface PdfFile {
  id: string
  name: string
  size: number
  path: string
}

export default function PdfMerge() {
  const [files, setFiles] = useState<PdfFile[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [merged, setMerged] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  // dirty = a freshly merged buffer not yet saved. First save after a merge costs 5 (new
  // document); saving the same buffer again ("Save again") costs 2 (clean re-save).
  const [dirty, setDirty] = useState(false)
  const { reserve, onSaved } = usePdfSaveMeter()

  const addFiles = async () => {
    const res = await window.electron.pdfPickFiles()
    if (res.canceled || !res.files.length) return
    const newFiles: PdfFile[] = res.files.map(f => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      name: f.name,
      size: f.size,
      path: f.path,
    }))
    setFiles(prev => [...prev, ...newFiles])
  }

  const remove = (id: string) => setFiles(prev => prev.filter(f => f.id !== id))

  const onDragStart = (id: string) => setDraggingId(id)
  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    setDragOverId(id)
  }
  const onDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return
    setFiles(prev => {
      const from = prev.findIndex(f => f.id === draggingId)
      const to = prev.findIndex(f => f.id === targetId)
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDraggingId(null)
    setDragOverId(null)
  }
  const onDragEnd = () => { setDraggingId(null); setDragOverId(null) }

  const merge = async () => {
    if (files.length < 2) return
    setStatus('merging')
    setError(null)
    try {
      await window.electron.pdfMerge({ filePaths: files.map(f => f.path) })
      setMerged(true)
      setDirty(true)
      setStatus('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const save = async () => {
    // 5 tokens for the first save of a freshly merged doc, 2 for a clean re-save.
    const refund = reserve(dirty ? 5 : 2)
    if (!refund) return
    const res = await window.electron.pdfMergeSave()
    if (res.canceled || !res.filePath) { refund(); return }
    setSavedPath(res.filePath)
    setDirty(false)
    onSaved()
  }

  const reset = () => {
    setFiles([])
    setMerged(false)
    setSavedPath(null)
    setError(null)
    setStatus('idle')
    setDirty(false)
  }

  const isMerging = status === 'merging'
  const isDone = status === 'done'
  const isError = status === 'error'
  const totalSize = files.reduce((s, f) => s + f.size, 0)

  return (
    <section className="section py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Merge PDFs</h2>
          <p className="text-sm text-muted-foreground mt-1">Combine multiple PDF files into one.</p>
        </div>
        {(isDone || isError) && (
          <Button variant="outline" size="sm" onClick={reset} className="gap-1.5 shrink-0">
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        )}
      </div>

      <div className="flex gap-6">
        {/* Left: controls */}
        <div className="w-64 shrink-0 space-y-4">
          <div className="space-y-1.5">
            <button
              onClick={addFiles}
              disabled={isMerging}
              className="w-full rounded-xl border border-dashed border-border p-4 flex flex-col items-center gap-2 text-center hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FilePlus className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Click to add PDF files</p>
            </button>
          </div>

          {files.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{files.length} file{files.length !== 1 ? 's' : ''} · {formatBytes(totalSize)}</Label>
                <span className="text-[10px] text-muted-foreground">Drag to reorder</span>
              </div>
              <div className="flex flex-col gap-1">
                {files.map((f, i) => (
                  <div
                    key={f.id}
                    draggable
                    onDragStart={() => onDragStart(f.id)}
                    onDragOver={e => onDragOver(e, f.id)}
                    onDrop={() => onDrop(f.id)}
                    onDragEnd={onDragEnd}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors select-none',
                      dragOverId === f.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30',
                      draggingId === f.id && 'opacity-40'
                    )}
                  >
                    <GripVertical className="size-3.5 text-muted-foreground shrink-0 cursor-grab" />
                    <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <Tooltip>
                      <TooltipTrigger className="flex-1 min-w-0 text-left">
                        <span className="truncate text-foreground cursor-default block w-full">{f.name}</span>
                      </TooltipTrigger>
                      <TooltipContent><p>{f.name}</p></TooltipContent>
                    </Tooltip>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatBytes(f.size)}</span>
                    <button onClick={() => remove(f.id)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors">
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            className="w-full gap-2"
            size="sm"
            onClick={merge}
            disabled={isMerging || files.length < 2}
          >
            {isMerging ? (
              <><Loader2 className="size-3.5 animate-spin" /> Merging…</>
            ) : (
              <><FilePlus className="size-3.5" /> Merge {files.length >= 2 ? `${files.length} PDFs` : 'PDFs'}</>
            )}
          </Button>

          {isDone && merged && (
            <Button variant="outline" className="w-full gap-2" size="sm" onClick={save}>
              <Download className="size-3.5" />
              {savedPath ? 'Save again' : 'Download'}
            </Button>
          )}

          {savedPath && (
            <p className="text-[10px] text-muted-foreground break-all">{savedPath}</p>
          )}
        </div>

        {/* Right: status */}
        <div className="flex-1 min-w-0">
          {isDone && merged ? (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <FilePlus className="size-8 text-green-500" />
              <div>
                <p className="text-sm font-medium text-green-500">Merged successfully</p>
                <p className="text-xs text-muted-foreground mt-1">{files.length} files combined · Click Download to save</p>
              </div>
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Merge failed</p>
                <p className="text-[10px] text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          ) : isMerging ? (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Merging PDFs…</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <FilePlus className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {files.length === 0
                  ? 'Add at least 2 PDF files to merge'
                  : files.length === 1
                    ? 'Add at least one more PDF'
                    : 'Drag to reorder, then click Merge'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
