import { useState, useEffect } from 'react'
import { FileDown, RotateCcw, Loader2, Globe, Download, AlertCircle, WifiOff, CircleAlert, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'
import { spendTokens } from '@/lib/useConversionCount'
import { useConversionCountContext } from '@/lib/ConversionCountContext'
import { toast } from 'sonner'

type Status = 'idle' | 'generating' | 'done' | 'error' | 'timeout'

const PAPER_FORMATS = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A6']
const WAIT_UNTIL_OPTIONS: { value: 'load' | 'domcontentloaded' | 'networkidle'; label: string; desc: string; exclamation?: string }[] = [
  { value: 'domcontentloaded', label: 'DOM ready', desc: 'Fastest - captures the page as soon as HTML is parsed, before images or scripts finish loading.' },
  { value: 'load', label: 'Load event', desc: 'Balanced - waits for images and stylesheets to finish loading. Good default for most pages.' },
  { value: 'networkidle', label: 'Network idle', desc: 'Thorough - waits until all network requests finish. Use for JS-heavy or lazy-loaded pages.', exclamation: 'Pages can take a long time to fully load all network requests and may result in a timeout.' },
]
const VIEWPORT_PRESETS = [
  { label: 'Mobile', value: 390 },
  { label: 'Tablet', value: 768 },
  { label: 'Desktop', value: 1440 },
  { label: 'Wide', value: 1920 },
]

export default function WebsitePdf() {
  const [url, setUrl] = useState('')
  const [viewportWidth, setViewportWidth] = useState(1440)
  const [format, setFormat] = useState('A4')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape')
  const [marginTop, setMarginTop] = useState(10)
  const [marginBottom, setMarginBottom] = useState(10)
  const [marginLeft, setMarginLeft] = useState(10)
  const [marginRight, setMarginRight] = useState(10)
  const [printBackground, setPrintBackground] = useState(true)
  const [waitUntil, setWaitUntil] = useState<'load' | 'domcontentloaded' | 'networkidle'>('domcontentloaded')
  const [waitTime, setWaitTime] = useState(0)
  const [waitTimeRaw, setWaitTimeRaw] = useState('0')

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  // Session flag: first download of a page visit costs full price, every later download (even
  // after re-generating with tweaked settings) is a re-save. Reset on Reset / page remount only,
  // NOT on generate - so changing a property and re-downloading bills as a re-save, not a new doc.
  const [savedOnce, setSavedOnce] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [countdown, setCountdown] = useState<number | null>(null)
  const { plan } = useAuth()
  const { onConversionSuccess } = useConversionCountContext()
  const metered = !isPaidPlan(plan)

  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    return window.electron.onWebsitePdfWaiting(({ waitTime }) => {
      if (waitTime < 2000) return
      const endAt = Date.now() + waitTime
      setCountdown(Math.ceil(waitTime / 1000))
      const interval = setInterval(() => {
        const remaining = Math.ceil((endAt - Date.now()) / 1000)
        if (remaining <= 0) {
          setCountdown(null)
          clearInterval(interval)
        } else {
          setCountdown(remaining)
        }
      }, 250)
    })
  }, [])

  const normalizeUrl = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return trimmed
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  }

  const generate = async () => {
    const normalized = normalizeUrl(url)
    setUrl(normalized)
    setStatus('generating')
    setError(null)
    setReady(false)
    setSavedPath(null)
    try {
      await window.electron.websitePdfGenerate({
        url: normalized, viewportWidth, format, orientation,
        marginTop, marginBottom, marginLeft, marginRight,
        printBackground, waitUntil, waitTime,
      })
      setReady(true)
      setStatus('done')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus(message.toLowerCase().includes('timeout') ? 'timeout' : 'error')
      setError(message)
    }
  }

  const save = async () => {
    // Charge on download (generating/preview is free): first download this visit = 5, every
    // later one = 2 (re-save), even after re-generating with changed settings.
    // countCategory:false - not a conversion, so it spends tokens without bumping Usage counts.
    const cost = savedOnce ? 2 : 5
    const [refund, reserved] = spendTokens('document', plan, { cost, countCategory: false })
    if (!reserved) {
      toast.error('PDF limit reached', {
        description: 'Upgrade to Pro to save more PDFs.',
        duration: 5000,
      })
      return
    }
    const result = await window.electron.websitePdfSave()
    if (result.canceled || !result.filePath) { refund(); return }
    setSavedPath(result.filePath)
    setSavedOnce(true)
    onConversionSuccess('document')
  }

  const reset = () => {
    setUrl('')
    setStatus('idle')
    setError(null)
    setReady(false)
    setSavedPath(null)
    setSavedOnce(false)
    setCountdown(null)
  }

  const isGenerating = status === 'generating'
  const isDone = status === 'done'
  const isError = status === 'error' || status === 'timeout'

  if (!isOnline) {
    return (
      <section className="section py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-body font-semibold text-foreground">Download as PDF</h2>
          <p className="text-sm text-muted-foreground mt-1">Save any webpage as a PDF.</p>
        </div>
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-3 text-center h-64">
          <WifiOff className="size-8 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">No internet connection</p>
            <p className="text-xs text-muted-foreground mt-1">This feature requires an active internet connection.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="section py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Download as PDF</h2>
          <p className="text-sm text-muted-foreground mt-1">Save any webpage as a PDF.</p>
        </div>
        <div className="flex items-end gap-2.5 shrink-0">
          {(isDone || isError) && (
            <Button variant="outline" size="sm" onClick={reset} className="gap-1.5 shrink-0">
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}
          {metered && (
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs">
              <Info className="size-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                First download costs <span className="font-medium text-foreground">5 tokens</span>, then <span className="font-medium text-foreground">2</span> for each one after.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left: all controls */}
        <div className="w-72 shrink-0 space-y-4">

          {/* URL */}
          <div className="space-y-1.5">
            <Input
              placeholder="https://example.com"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onBlur={() => setUrl(normalizeUrl(url))}
              disabled={isGenerating}
              className="text-sm"
            />
          </div>

          {/* Paper format */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Paper format</Label>
            <div className="flex flex-wrap gap-1.5">
              {PAPER_FORMATS.map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  disabled={isGenerating}
                  className={cn(
                    'cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors',
                    format === f
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Orientation */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Orientation</Label>
            <div className="flex gap-1.5">
              {(['portrait', 'landscape'] as const).map(o => (
                <button
                  key={o}
                  onClick={() => setOrientation(o)}
                  disabled={isGenerating}
                  className={cn(
                    'cursor-pointer flex-1 rounded-lg border py-1.5 text-xs capitalize transition-colors',
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

          {/* Margins */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Margins (mm)</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { label: 'Top', value: marginTop, set: setMarginTop },
                { label: 'Bottom', value: marginBottom, set: setMarginBottom },
                { label: 'Left', value: marginLeft, set: setMarginLeft },
                { label: 'Right', value: marginRight, set: setMarginRight },
              ]).map(({ label, value, set }) => (
                <div key={label}>
                  <span className="text-[10px] text-muted-foreground mb-0.5 block">{label}</span>
                  <Input
                    type="number"
                    value={value}
                    onChange={e => set(Number(e.target.value))}
                    disabled={isGenerating}
                    min={0}
                    max={50}
                    className="text-sm h-8"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Print background */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Print background</Label>
            <button
              role="checkbox"
              aria-checked={printBackground}
              onClick={() => setPrintBackground(v => !v)}
              disabled={isGenerating}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                printBackground ? 'bg-primary' : 'bg-accent'
              )}
            >
              <span className={cn(
                'pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform',
                printBackground ? 'translate-x-4' : 'translate-x-0'
              )} />
            </button>
          </div>

          {/* Wait until */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Wait until</Label>
            <div className="flex flex-col gap-1.5">
              {WAIT_UNTIL_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => setWaitUntil(o.value)}
                  disabled={isGenerating}
                  className={cn(
                    'cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors',
                    waitUntil === o.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn('text-xs font-medium', waitUntil === o.value ? 'text-primary' : 'text-foreground')}>{o.label}</span>
                    {o.exclamation && (
                      <Tooltip>
                        <TooltipTrigger onClick={e => e.stopPropagation()}>
                          <CircleAlert className={cn('size-3', waitUntil === o.value ? 'text-yellow-500' : 'text-muted-foreground')} />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-56">
                          <p className="text-sm font-light text-accent">{o.exclamation}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <p className={cn('text-[10px] mt-0.5', waitUntil === o.value ? 'text-primary/70' : 'text-muted-foreground')}>{o.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Extra wait time */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Extra wait time (ms)</Label>
            <Input
              type="number"
              value={waitTimeRaw}
              onChange={e => setWaitTimeRaw(e.target.value)}
              onBlur={() => {
                const n = Math.max(0, Math.min(30000, Number(waitTimeRaw) || 0))
                setWaitTime(n)
                setWaitTimeRaw(String(n))
              }}
              disabled={isGenerating}
              min={0}
              max={30000}
              step={500}
              className="text-sm"
            />
          </div>

          {/* Viewport width */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Viewport width</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {VIEWPORT_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setViewportWidth(p.value)}
                  disabled={isGenerating}
                  className={cn(
                    'cursor-pointer rounded-lg border py-1.5 text-xs transition-colors',
                    viewportWidth === p.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {p.label}
                  <span className="block text-[10px] opacity-60">{p.value}px</span>
                </button>
              ))}
            </div>
            <Input
              type="number"
              value={viewportWidth}
              onChange={e => setViewportWidth(Number(e.target.value))}
              disabled={isGenerating}
              className="text-sm"
              min={320}
              max={3840}
            />
          </div>

          {/* Generate */}
          <Button className="w-full gap-2" size="sm" onClick={generate} disabled={isGenerating || !url}>
            {isGenerating
              ? <><Loader2 className="size-3.5 animate-spin" /> Generating…</>
              : <><FileDown className="size-3.5" /> Generate PDF</>
            }
          </Button>

        </div>

        {/* Right: status */}
        <div className="flex-1 min-w-0">
          {isDone && ready ? (
            <div
              onClick={save}
              className="rounded-xl border border-green-500/30 bg-green-500/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64 cursor-pointer hover:bg-green-500/20 transition-colors"
            >
              <Download className="size-8 text-green-500" />
              <div>
                <p className="text-sm font-medium text-green-500">{savedPath ? 'Save again' : 'Download PDF'}</p>
                {savedPath
                  ? <p className="text-[10px] text-muted-foreground mt-1 break-all">{savedPath}</p>
                  : <p className="text-xs text-muted-foreground mt-1">Click to save the PDF.</p>
                }
              </div>
            </div>
          ) : status === 'timeout' ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Page timed out</p>
                <p className="text-xs text-muted-foreground mt-1">The page took too long to load. Try a faster wait mode like DOM ready.</p>
              </div>
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Failed to generate PDF</p>
                <p className="text-[10px] text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          ) : isGenerating ? (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <div>
                <p className="text-sm text-muted-foreground">Generating PDF…</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {countdown !== null ? `Waiting ${countdown}s…` : 'Loading page and rendering'}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Globe className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Enter a URL and click Generate PDF</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
