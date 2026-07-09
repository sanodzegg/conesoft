import { Camera, RotateCcw, Loader2, Globe, Download, AlertCircle, WifiOff, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useScreenshot } from '@/components/website-screenshot/use-screenshot'
import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'

const FORMATS = ['png', 'jpg', 'webp'] as const
const VIEWPORT_PRESETS = [
  { label: 'Mobile', value: 390 },
  { label: 'Tablet', value: 768 },
  { label: 'Desktop', value: 1440 },
  { label: 'Wide', value: 1920 },
]
const USER_AGENT_PRESETS = [
  { label: 'Default', value: '', viewport: 1440 },
  { label: 'Chrome', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', viewport: 1440 },
  { label: 'Safari', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', viewport: 1440 },
  { label: 'Mobile', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', viewport: 390 },
  { label: 'Bot', value: 'Googlebot/2.1 (+http://www.google.com/bot.html)', viewport: 1440 },
]

export default function WebsiteScreenshot() {
  const { state, capture, save, setUrl, blurUrl, setFormat, setViewportWidth, setUserAgent, reset } = useScreenshot()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const { plan } = useAuth()
  const metered = !isPaidPlan(plan)

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const isCapturing = state.captureStatus === 'capturing'
  const isDone = state.captureStatus === 'done'
  const isError = state.captureStatus === 'error' || state.captureStatus === 'timeout'
  const browserReady = state.browserStatus === 'ready'

  if (!isOnline) {
    return (
      <section className="section py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-body font-semibold text-foreground">Website Screenshot</h2>
          <p className="text-sm text-muted-foreground mt-1">Capture full-page screenshots of any public URL.</p>
        </div>
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-3 text-center h-64">
          <WifiOff className="size-8 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">No internet connection</p>
            <p className="text-xs text-muted-foreground mt-1">Website screenshots require an active internet connection.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="section py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-body font-semibold text-foreground">Website Screenshot</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Capture full-page screenshots of any public URL.
          </p>
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
                First download costs <span className="font-medium text-foreground">3 tokens</span>, then <span className="font-medium text-foreground">2</span> for each one after.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left: controls */}
        <div className="w-64 shrink-0 space-y-4">
          {/* Browser status - always rendered to avoid CLS */}
          <div className={cn(
            'rounded-xl border p-3 text-xs flex items-start gap-2',
            state.browserStatus === 'error'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : state.browserStatus === 'ready'
                ? 'border-green-500/30 bg-green-500/10 text-green-500'
                : 'border-border bg-secondary/30 text-muted-foreground'
          )}>
            {(state.browserStatus === 'downloading' || state.browserStatus === 'unknown') && (
              <Loader2 className="size-3.5 mt-0.5 shrink-0 animate-spin" />
            )}
            {state.browserStatus === 'error' && <AlertCircle className="size-3.5 mt-0.5 shrink-0" />}
            {state.browserStatus === 'ready' && <span className="size-1.5 rounded-full bg-green-500 mt-1 shrink-0" />}
            <span>
              {state.browserStatus === 'downloading' && 'Setting up browser engine…'}
              {state.browserStatus === 'unknown' && 'Checking browser engine…'}
              {state.browserStatus === 'ready' && 'Browser engine ready'}
              {state.browserStatus === 'error' && (state.browserError ?? 'Browser setup failed')}
            </span>
          </div>

          {/* URL input */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL</Label>
            <Input
              placeholder="https://example.com"
              value={state.url}
              onChange={e => setUrl(e.target.value)}
              onBlur={blurUrl}
              disabled={isCapturing}
              className="text-sm"
            />
          </div>

          {/* Format */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Output format</Label>
            <div className="flex gap-1.5">
              {FORMATS.map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  disabled={isCapturing}
                  className={cn(
                    'cursor-pointer flex-1 rounded-lg border py-1.5 text-xs font-medium uppercase transition-colors',
                    state.format === f
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Viewport width */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Viewport width</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {VIEWPORT_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setViewportWidth(p.value)}
                  disabled={isCapturing}
                  className={cn(
                    'cursor-pointer rounded-lg border py-1.5 text-xs transition-colors',
                    state.viewportWidth === p.value
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
              value={state.viewportWidth}
              onChange={e => setViewportWidth(Number(e.target.value))}
              disabled={isCapturing}
              className="text-sm"
              min={320}
              max={3840}
            />
          </div>

          {/* User agent */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">User agent</Label>
            <div className="flex gap-1.5 flex-wrap">
              {USER_AGENT_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { setUserAgent(p.value); setViewportWidth(p.viewport) }}
                  disabled={isCapturing}
                  className={cn(
                    'cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors',
                    state.userAgent === p.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Capture button */}
          <Button
            className="w-full gap-2"
            size="sm"
            onClick={capture}
            disabled={isCapturing || !state.url || !browserReady}
          >
            {isCapturing ? (
              <><Loader2 className="size-3.5 animate-spin" /> Capturing…</>
            ) : (
              <><Camera className="size-3.5" /> Capture screenshot</>
            )}
          </Button>

          {/* Download button - shown after capture */}
          {isDone && state.preview && (
            <Button
              variant="outline"
              className="w-full gap-2"
              size="sm"
              onClick={save}
            >
              <Download className="size-3.5" />
              {state.savedPath ? 'Save again' : 'Download'}
            </Button>
          )}

          {state.savedPath && (
            <p className="text-[10px] text-muted-foreground break-all">{state.savedPath}</p>
          )}
        </div>

        {/* Right: preview / status */}
        <div className="flex-1 min-w-0">
          {isDone && state.preview ? (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="max-h-140 overflow-y-auto">
                <img src={state.preview} alt="Screenshot preview" className="w-full block" />
              </div>
            </div>
          ) : state.captureStatus === 'timeout' ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Page timed out</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The page took longer than a minute to load. Check the URL or try again.
                </p>
              </div>
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Capture failed</p>
                <p className="text-[10px] text-muted-foreground mt-1">{state.error}</p>
              </div>
            </div>
          ) : isCapturing ? (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <div>
                <p className="text-sm text-muted-foreground">Capturing full page…</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Loading page content</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center justify-center gap-3 text-center h-64">
              <Globe className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {!browserReady ? 'Waiting for browser engine…' : 'Enter a URL and click Capture'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
