import { useState, useEffect } from 'react'
import { ImagePlus, Download, AlertCircle, RotateCcw, Loader2, GripVertical, X, Info, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePdfSaveMeter, resetImagesToPdfSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'
import { BackLink } from '@/components/back-link'

type Status = 'idle' | 'building' | 'done' | 'error'
type PageSize = 'auto' | 'a4' | 'letter'
type Orientation = 'portrait' | 'landscape'

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

interface ImageFile {
  id: string
  name: string
  size: number
  path: string
}

const PAGE_SIZES: { value: PageSize; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Match image' },
  { value: 'a4', label: 'A4', hint: '210×297' },
  { value: 'letter', label: 'Letter', hint: '8.5×11' },
]

export default function ImagesToPdf() {
  const [files, setFiles] = useState<ImageFile[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [built, setBuilt] = useState(false)
  const [pageCount, setPageCount] = useState(0)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const [pageSize, setPageSize] = useState<PageSize>('auto')
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [margin, setMargin] = useState(0)

  const { reserveImagesToPdfSave, markImagesToPdfSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  // One page visit = one save session: first save costs 5, every later save 2 - until Reset / leave.
  useEffect(() => { resetImagesToPdfSaveSession() }, [])

  const addFiles = async () => {
    const res = await window.electron.pdfConvertPickImages()
    if (res.canceled || !res.files.length) return
    const newFiles: ImageFile[] = res.files.map(f => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      name: f.name,
      size: f.size,
      path: f.path,
    }))
    setFiles(prev => [...prev, ...newFiles])
    // Adding images invalidates a previous build.
    setBuilt(false)
    setStatus('idle')
  }

  const remove = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    setBuilt(false)
    setStatus('idle')
  }

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
    setBuilt(false)
    setStatus('idle')
    setDraggingId(null)
    setDragOverId(null)
  }
  const onDragEnd = () => { setDraggingId(null); setDragOverId(null) }

  const build = async () => {
    if (files.length < 1) return
    setStatus('building')
    setError(null)
    try {
      const res = await window.electron.pdfConvertImagesToPdf({
        images: files.map(f => ({ path: f.path })),
        options: { pageSize, orientation, margin },
      })
      if (!res.success) throw new Error(res.error ?? 'Conversion failed')
      setPageCount(res.pageCount ?? files.length)
      setBuilt(true)
      setStatus('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const save = async () => {
    const refund = reserveImagesToPdfSave()
    if (!refund) return
    const res = await window.electron.pdfConvertImagesToPdfSave()
    if (res.canceled || !res.filePath) { refund(); return }
    setSavedPath(res.filePath)
    markImagesToPdfSaved()
    onSaved()
  }

  const reset = () => {
    setFiles([])
    setBuilt(false)
    setPageCount(0)
    setSavedPath(null)
    setError(null)
    setStatus('idle')
    window.electron.pdfConvertReset()
    resetImagesToPdfSaveSession()
  }

  const isBuilding = status === 'building'
  const isDone = status === 'done'
  const isError = status === 'error'
  const totalSize = files.reduce((s, f) => s + f.size, 0)

  return (
    <section className="section py-8">
      <BackLink to="/extensions/pdf" label="Back to PDF Tools" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Images to PDF</h2>
          <p className="text-sm text-muted-foreground mt-1">Combine images into a single PDF, one per page.</p>
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
              disabled={isBuilding}
              className="w-full rounded-xl border border-dashed border-border p-4 flex flex-col items-center gap-2 text-center hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ImagePlus className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Click to add images</p>
            </button>
          </div>

          {files.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{files.length} image{files.length !== 1 ? 's' : ''} · {formatBytes(totalSize)}</Label>
                <span className="text-[10px] text-muted-foreground">Drag to reorder</span>
              </div>
              <div className="flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
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

          {/* Page size */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Page size</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {PAGE_SIZES.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPageSize(p.value)}
                  disabled={isBuilding}
                  className={cn(
                    'cursor-pointer rounded-lg border py-1.5 text-xs transition-colors',
                    pageSize === p.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {p.label}
                  <span className="block text-[10px] opacity-60">{p.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Orientation - only meaningful for fixed page sizes */}
          {pageSize !== 'auto' && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Orientation</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['portrait', 'landscape'] as Orientation[]).map(o => (
                  <button
                    key={o}
                    onClick={() => setOrientation(o)}
                    disabled={isBuilding}
                    className={cn(
                      'cursor-pointer rounded-lg border py-1.5 text-xs capitalize transition-colors',
                      orientation === o
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Margin */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Margin</Label>
              <span className="text-[10px] text-muted-foreground">{margin} pt</span>
            </div>
            <input
              type="range"
              min={0}
              max={72}
              step={4}
              value={margin}
              onChange={e => setMargin(Number(e.target.value))}
              disabled={isBuilding}
              className="w-full accent-primary"
            />
          </div>

          <Button
            className="w-full gap-2"
            size="sm"
            onClick={build}
            disabled={isBuilding || files.length < 1}
          >
            {isBuilding ? (
              <><Loader2 className="size-3.5 animate-spin" /> Building…</>
            ) : (
              <><FileText className="size-3.5" /> Create PDF</>
            )}
          </Button>

          {isDone && built && (
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
          {isDone && built ? (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <FileText className="size-8 text-green-500" />
              <div>
                <p className="text-sm font-medium text-green-500">PDF ready</p>
                <p className="text-xs text-muted-foreground mt-1">{pageCount} page{pageCount !== 1 ? 's' : ''} · Click Download to save</p>
              </div>
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Conversion failed</p>
                <p className="text-[10px] text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          ) : isBuilding ? (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Building PDF…</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <ImagePlus className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {files.length === 0
                  ? 'Add images to combine into a PDF'
                  : 'Set your options, then click Create PDF'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
