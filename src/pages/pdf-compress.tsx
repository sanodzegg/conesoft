import { useState, useEffect } from 'react'
import { FileUp, Download, AlertCircle, RotateCcw, Loader2, Info, Minimize2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { BackLink } from '@/components/back-link'
import { usePdfSaveMeter, resetCompressSaveSession } from '@/lib/usePdfSaveMeter'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'

type Status = 'idle' | 'working' | 'done' | 'error'
type Level = 'low' | 'recommended' | 'high'

type Result = { originalSize: number; compressedSize: number; images: number }

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: 'low', label: 'Low', hint: 'Best quality' },
  { value: 'recommended', label: 'Medium', hint: 'Recommended' },
  { value: 'high', label: 'High', hint: 'Smallest file' },
]

export default function PdfCompress() {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState(0)
  const [level, setLevel] = useState<Level>('recommended')
  const [result, setResult] = useState<Result | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { reserveCompressSave, markCompressSaved, onSaved } = usePdfSaveMeter()
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  useEffect(() => { resetCompressSaveSession() }, [])

  const pick = async () => {
    const res = await window.electron.pdfCompressPick()
    if (res.canceled) return
    setFileName(res.name)
    setOriginalSize(res.size)
    setResult(null)
    setSavedPath(null)
    setError(null)
    setStatus('idle')
  }

  const run = async () => {
    setStatus('working')
    setError(null)
    setResult(null)
    setSavedPath(null)
    try {
      const res = await window.electron.pdfCompressRun({ level })
      if (!res.success) { setError(res.error ?? 'Compression failed'); setStatus('error'); return }
      setResult({ originalSize: res.originalSize ?? 0, compressedSize: res.compressedSize ?? 0, images: res.images ?? 0 })
      setStatus('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const download = async () => {
    const refund = reserveCompressSave()
    if (!refund) return
    const res = await window.electron.pdfCompressSave()
    if (res.canceled || !res.filePath) { refund(); return }
    markCompressSaved()
    onSaved()
    setSavedPath(res.filePath)
  }

  const reset = () => {
    setStatus('idle')
    setFileName(null)
    setOriginalSize(0)
    setResult(null)
    setSavedPath(null)
    setError(null)
    resetCompressSaveSession()
  }

  const isWorking = status === 'working'
  const savedPct = result && result.originalSize > 0
    ? Math.round((1 - result.compressedSize / result.originalSize) * 100)
    : 0
  const gained = !!result && result.compressedSize < result.originalSize

  return (
    <section className="section py-8">
      <BackLink to="/extensions/pdf" label="Back to PDF Tools" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Compress PDF</h2>
          <p className="text-sm text-muted-foreground mt-1">Shrink a PDF by recompressing its images and packing its structure.</p>
        </div>
        <div className="flex items-end gap-2.5 shrink-0">
          {(fileName || status === 'error') && (
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
              disabled={isWorking}
              className="w-full rounded-xl border border-dashed border-border p-4 flex flex-col items-center gap-2 text-center hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileUp className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{fileName ? 'Choose a different PDF' : 'Click to select a PDF'}</p>
            </button>
          </div>

          {fileName && (
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <p className="text-xs text-foreground truncate">{fileName}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{formatBytes(originalSize)}</p>
            </div>
          )}

          {fileName && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Compression</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {LEVELS.map(l => (
                    <button
                      key={l.value}
                      onClick={() => setLevel(l.value)}
                      disabled={isWorking}
                      className={cn(
                        'cursor-pointer rounded-lg border py-1.5 text-xs transition-colors',
                        level === l.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50'
                      )}
                    >
                      {l.label}
                      <span className="block text-[10px] opacity-60">{l.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Button className="w-full gap-2" size="sm" onClick={run} disabled={isWorking}>
                {isWorking ? (
                  <><Loader2 className="size-3.5 animate-spin" /> Compressing…</>
                ) : (
                  <><Minimize2 className="size-3.5" /> {result ? 'Compress again' : 'Compress'}</>
                )}
              </Button>

              {status === 'done' && gained && (
                <Button variant="outline" className="w-full gap-2" size="sm" onClick={download}>
                  <Download className="size-3.5" />
                  {savedPath ? 'Save again' : 'Download'}
                </Button>
              )}

              {savedPath && (
                <p className="text-[10px] text-muted-foreground break-all">{savedPath}</p>
              )}
            </>
          )}
        </div>

        {/* Right: result */}
        <div className="flex-1 min-w-0">
          {status === 'done' && result ? (
            gained ? (
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-8 flex flex-col items-center justify-center gap-4 text-center h-64">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-semibold text-green-500">−{savedPct}%</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground line-through">{formatBytes(result.originalSize)}</span>
                  <Check className="size-4 text-green-500" />
                  <span className="font-medium text-foreground">{formatBytes(result.compressedSize)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {result.images > 0
                    ? `Recompressed ${result.images} image${result.images !== 1 ? 's' : ''}. Click Download to save.`
                    : 'Optimized the PDF structure. Click Download to save.'}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-border p-8 flex flex-col items-center justify-center gap-3 text-center h-64">
                <Check className="size-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Already optimized</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    This PDF is about as small as it gets with lossless methods, so there's nothing worth saving. Try the High level if you're fine trading some image quality.
                  </p>
                </div>
              </div>
            )
          ) : status === 'error' ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Compression failed</p>
                <p className="text-[10px] text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          ) : isWorking ? (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Compressing…</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Minimize2 className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {fileName ? 'Pick a level, then click Compress' : 'Select a PDF to compress'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
