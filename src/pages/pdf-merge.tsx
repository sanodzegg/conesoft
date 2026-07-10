import { useState, useEffect } from 'react'
import { FilePlus, Download, AlertCircle, RotateCcw, Loader2, GripVertical, X, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePdfSaveMeter, resetMergeSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'
import { BackLink } from '@/components/back-link'

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
  const { reserveMergeSave, markMergeSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  // A merge-page visit is one session: the first save (any merge) costs 5, every later save -
  // including after re-merging different files - costs 2, until the page is left or Reset is hit.
  useEffect(() => { resetMergeSaveSession() }, [])

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
      setStatus('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const save = async () => {
    // First save this session costs 5, every later save (even after re-merging) costs 2.
    const refund = reserveMergeSave()
    if (!refund) return
    const res = await window.electron.pdfMergeSave()
    if (res.canceled || !res.filePath) { refund(); return }
    setSavedPath(res.filePath)
    markMergeSaved()
    onSaved()
  }

  const reset = () => {
    setFiles([])
    setMerged(false)
    setSavedPath(null)
    setError(null)
    setStatus('idle')
    resetMergeSaveSession() // start over - next save bills as the first (5)
  }

  const isMerging = status === 'merging'
  const isDone = status === 'done'
  const isError = status === 'error'
  const totalSize = files.reduce((s, f) => s + f.size, 0)

  return (
    <section className="section py-8">
      <BackLink to="/extensions/pdf" label="Back to PDF Tools" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Merge PDFs</h2>
          <p className="text-sm text-muted-foreground mt-1">Combine multiple PDF files into one.</p>
        </div>
        <div className="flex items-end gap-2.5 shrink-0">
          {(isDone || isError) && (
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
