import { useState, useEffect, useRef } from 'react'
import {
  Gauge, Loader2, AlertCircle, WifiOff, RotateCcw, Globe,
  Check, Monitor, Smartphone, ChevronDown, Copy, FileJson, Clock,
  TrendingUp, ShieldCheck, Search, Zap, ExternalLink, Info
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'
import { spendTokens } from '@/lib/useConversionCount'
import { useConversionCountContext } from '@/lib/ConversionCountContext'

// ─── Types ────────────────────────────────────────────────────────────────────

type LighthouseStatus = { installed: boolean; version: string | null }
type Scores = { performance: number; accessibility: number; bestPractices: number; seo: number }
type WebVitals = { lcp: string | null; fcp: string | null; cls: string | null; tbt: string | null; si: string | null }
type Issue = {
  id: string
  title: string
  description: string | null
  score: number | null
  displayValue: string | null
  items: Record<string, string>[]
}
type AuditResult = {
  success: boolean
  error?: string
  scores?: Scores
  webVitals?: WebVitals
  topIssues?: Issue[]
}
type Results = { desktop: AuditResult | null; mobile: AuditResult | null }
type HistoryEntry = {
  url: string
  timestamp: number
  scores: { desktop: Scores | null; mobile: Scores | null }
}

const HISTORY_KEY = 'conesoft_lighthouse_history'
const MAX_HISTORY = 8

// ─── Score helpers ─────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 90) return 'text-green-500'
  if (score >= 50) return 'text-yellow-500'
  return 'text-red-500'
}

function scoreRingColor(score: number) {
  if (score >= 90) return 'stroke-green-500'
  if (score >= 50) return 'stroke-yellow-500'
  return 'stroke-red-500'
}

function scoreGrade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

function scoreBg(score: number) {
  if (score >= 90) return 'bg-green-500/10 text-green-500 border-green-500/20'
  if (score >= 50) return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
  return 'bg-red-500/10 text-red-500 border-red-500/20'
}

// ─── Web Vital thresholds ─────────────────────────────────────────────────────

type VitalKey = 'lcp' | 'fcp' | 'cls' | 'tbt' | 'si'

const VITAL_META: Record<VitalKey, { label: string; good: number; poor: number; unit: string; description: string }> = {
  lcp: { label: 'LCP', good: 2.5, poor: 4, unit: 's', description: 'Largest Contentful Paint - how fast the main content loads' },
  fcp: { label: 'FCP', good: 1.8, poor: 3, unit: 's', description: 'First Contentful Paint - when the first content appears' },
  cls: { label: 'CLS', good: 0.1, poor: 0.25, unit: '', description: 'Cumulative Layout Shift - visual stability during load' },
  tbt: { label: 'TBT', good: 200, poor: 600, unit: 'ms', description: 'Total Blocking Time - main thread blocked, affects interactivity' },
  si: { label: 'Speed Index', good: 3.4, poor: 5.8, unit: 's', description: 'How quickly content is visually displayed during load' },
}

function vitalStatus(key: VitalKey, rawValue: string | null): 'good' | 'needs-improvement' | 'poor' | 'unknown' {
  if (!rawValue) return 'unknown'
  const meta = VITAL_META[key]
  const num = parseFloat(rawValue.replace(/[^0-9.]/g, ''))
  if (isNaN(num)) return 'unknown'
  // CLS has no unit, rest are in s or ms - raw displayValue from lighthouse is already formatted
  if (num <= meta.good) return 'good'
  if (num <= meta.poor) return 'needs-improvement'
  return 'poor'
}

function vitalStatusColor(status: ReturnType<typeof vitalStatus>) {
  if (status === 'good') return 'text-green-500 border-green-500/30 bg-green-500/8'
  if (status === 'needs-improvement') return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/8'
  if (status === 'poor') return 'text-red-500 border-red-500/30 bg-red-500/8'
  return 'text-muted-foreground border-border bg-card'
}

function vitalStatusLabel(status: ReturnType<typeof vitalStatus>) {
  if (status === 'good') return 'Good'
  if (status === 'needs-improvement') return 'Improve'
  if (status === 'poor') return 'Poor'
  return '-'
}

// ─── Fix suggestions ──────────────────────────────────────────────────────────

const FIX_HINTS: Record<string, string> = {
  'render-blocking-resources': 'Add defer/async to scripts, or inline critical CSS.',
  'unused-javascript': 'Use code splitting, tree-shaking, or dynamic imports.',
  'unused-css-rules': 'Remove unused styles via PurgeCSS or remove unused stylesheets.',
  'uses-optimized-images': 'Convert images to WebP/AVIF and compress before uploading.',
  'uses-webp-images': 'Serve WebP with <picture> element fallback for older browsers.',
  'uses-responsive-images': 'Use srcset to serve appropriately-sized images per viewport.',
  'offscreen-images': 'Add loading="lazy" to images below the fold.',
  'efficient-animated-content': 'Replace GIFs with video (MP4/WebM) for smaller file sizes.',
  'uses-text-compression': 'Enable gzip or Brotli compression on your server.',
  'uses-long-cache-ttl': 'Set Cache-Control headers to cache static assets for longer.',
  'server-response-time': 'Check server performance, hosting location, or add a CDN.',
  'redirects': 'Remove unnecessary redirect chains - each adds latency.',
  'bootup-time': 'Minify, defer, or split large JS bundles.',
  'mainthread-work-breakdown': 'Reduce JS parsing/execution time by splitting or deferring code.',
  'font-display': 'Add font-display: swap; to avoid invisible text during font load.',
  'critical-request-chains': 'Inline critical resources and reduce dependency depth.',
  'dom-size': 'Simplify HTML - fewer nodes means faster rendering.',
  'third-party-summary': 'Audit third-party scripts - remove or defer non-critical ones.',
  'layout-shift-elements': 'Add explicit width/height to images and embeds to prevent shifts.',
  'uses-passive-event-listeners': 'Mark scroll/touch listeners as passive for smoother scrolling.',
  'image-size-responsive': 'Serve images that match the size they are displayed at.',
  'image-aspect-ratio': 'Set explicit width and height attributes on all img elements.',
  'total-byte-weight': 'Reduce page weight by compressing assets and removing unused code.',
  'link-text': 'Use descriptive link text instead of "click here" or "read more".',
  'aria-required-attr': 'Add required ARIA attributes to interactive elements.',
  'color-contrast': 'Increase contrast ratio to at least 4.5:1 for text readability.',
  'tap-targets': 'Make tap targets at least 48×48px with enough spacing.',
  'meta-description': 'Add a unique, descriptive meta description to each page.',
  'document-title': 'Set a descriptive <title> tag on every page.',
  'hreflang': 'Add hreflang attributes for multi-language sites.',
  'canonical': 'Add a canonical link element to prevent duplicate content issues.',
  'robots-txt': 'Ensure robots.txt is valid and not blocking important pages.',
}

// ─── History helpers ──────────────────────────────────────────────────────────

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}

function saveHistory(entry: HistoryEntry) {
  const hist = loadHistory().filter(h => h.url !== entry.url)
  hist.unshift(entry)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, MAX_HISTORY)))
}

// ─── Item labels ──────────────────────────────────────────────────────────────

const ITEM_LABELS: Record<string, string> = {
  url: 'URL',
  nodeLabel: 'Element',
  node: 'Snippet',
  label: 'Label',
  duration: 'Duration',
  wastedMs: 'Wasted time',
  wastedBytes: 'Wasted size',
  totalBytes: 'Total size',
  transferSize: 'Transfer size',
  cacheLifetime: 'Cache TTL',
}

// ─── Score circle with animation ─────────────────────────────────────────────

function ScoreCircle({ label, score, icon }: { label: string; score: number; icon: React.ReactNode }) {
  const [displayed, setDisplayed] = useState(0)
  const r = 28
  const circ = 2 * Math.PI * r

  useEffect(() => {
    setDisplayed(0)
    const step = score / 40
    let current = 0
    const id = setInterval(() => {
      current = Math.min(current + step, score)
      setDisplayed(Math.round(current))
      if (current >= score) clearInterval(id)
    }, 16)
    return () => clearInterval(id)
  }, [score])

  const offset = circ - (displayed / 100) * circ

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative size-20">
        <svg className="size-20 -rotate-90" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-border" />
          <circle
            cx="36" cy="36" r={r}
            fill="none" strokeWidth="5"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn('transition-none', scoreRingColor(score))}
          />
        </svg>
        <span className={cn('absolute inset-0 flex items-center justify-center text-lg font-bold', scoreColor(score))}>
          {displayed}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1 text-muted-foreground">{icon}</div>
        <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
        <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded border', scoreBg(score))}>
          {scoreGrade(score)}
        </span>
      </div>
    </div>
  )
}

// ─── Vital chip with status ───────────────────────────────────────────────────

function VitalChip({ vitalKey, value }: { vitalKey: VitalKey; value: string | null }) {
  const meta = VITAL_META[vitalKey]
  const status = vitalStatus(vitalKey, value)
  const [showTip, setShowTip] = useState(false)

  return (
    <div
      className={cn('relative flex flex-col gap-1.5 rounded-lg border px-4 py-3 min-w-28 items-center cursor-default', vitalStatusColor(status))}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium">{meta.label}</span>
        <Info className="size-3 opacity-60" />
      </div>
      <span className="text-sm font-bold">{value ?? '-'}</span>
      <span className="text-xs opacity-70">{vitalStatusLabel(status)}</span>
      {showTip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-popover border border-border shadow-lg px-3 py-2 z-50 pointer-events-none">
          <p className="text-xs text-muted-foreground leading-snug">{meta.description}</p>
        </div>
      )}
    </div>
  )
}

// ─── Issue row ────────────────────────────────────────────────────────────────

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false)
  const score = issue.score !== null ? Math.round(issue.score * 100) : null
  const hasDetails = issue.items.length > 0 || !!issue.description
  const fixHint = FIX_HINTS[issue.id]

  const severityIcon = score === null ? null : score >= 90 ? '✓' : score >= 50 ? '!' : '✕'
  const severityColor = score === null ? 'text-muted-foreground' : score >= 90 ? 'text-green-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500'

  return (
    <div className="not-first:mt-0.5">
      <button
        onClick={() => hasDetails && setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-3 px-2 py-2.5 text-left rounded-lg transition-colors',
          hasDetails ? 'cursor-pointer hover:bg-accent/50' : 'cursor-default'
        )}
      >
        <div className={cn('text-xs font-bold w-6 text-center shrink-0 font-mono', severityColor)}>
          {severityIcon ?? '?'}
        </div>
        <span className="text-sm text-foreground flex-1 leading-snug">{issue.title}</span>
        {issue.displayValue && (
          <span className={cn('text-xs font-medium shrink-0 tabular-nums', scoreColor(score ?? 0))}>
            {issue.displayValue}
          </span>
        )}
        {hasDetails && (
          <ChevronDown className={cn('size-3.5 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open && (
        <div className="px-2 pt-1 pb-3 flex flex-col gap-2.5">
          {issue.description && (
            <p className="text-xs text-muted-foreground leading-relaxed pl-9">{issue.description}</p>
          )}
          {fixHint && (
            <div className="flex items-start gap-2 rounded-lg bg-primary/8 border border-primary/15 px-3 py-2 ml-9">
              <TrendingUp className="size-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-primary/90 leading-relaxed">{fixHint}</p>
            </div>
          )}
          {issue.items.length > 0 && (
            <div className="flex flex-col gap-1 ml-9">
              {issue.items.map((item, i) => (
                <div key={i} className="rounded-lg bg-muted/50 border border-border/50 px-3 py-2 flex flex-col gap-1.5">
                  {Object.entries(item).map(([key, val]) => (
                    <div key={key} className="flex gap-2 text-xs items-start">
                      <span className="text-muted-foreground shrink-0 w-24">{ITEM_LABELS[key] ?? key}</span>
                      <span className="text-foreground font-mono break-all leading-relaxed">{val}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Audit summary bar ────────────────────────────────────────────────────────

function AuditSummaryBar({ issues }: { issues: Issue[] }) {
  const fail = issues.filter(i => i.score !== null && i.score < 0.5).length
  const warn = issues.filter(i => i.score !== null && i.score >= 0.5 && i.score < 0.9).length
  const pass = issues.filter(i => i.score !== null && i.score >= 0.9).length

  return (
    <div className="flex items-center gap-3 text-xs">
      {fail > 0 && (
        <span className="flex items-center gap-1 text-red-500">
          <span className="size-1.5 rounded-full bg-red-500 inline-block" />
          {fail} failed
        </span>
      )}
      {warn > 0 && (
        <span className="flex items-center gap-1 text-yellow-500">
          <span className="size-1.5 rounded-full bg-yellow-500 inline-block" />
          {warn} warnings
        </span>
      )}
      {pass > 0 && (
        <span className="flex items-center gap-1 text-green-500">
          <span className="size-1.5 rounded-full bg-green-500 inline-block" />
          {pass} passed
        </span>
      )}
    </div>
  )
}

// ─── Result view ──────────────────────────────────────────────────────────────

function AuditResultView({ result, onRetry, url }: { result: AuditResult; onRetry: () => void; url: string }) {
  const [copied, setCopied] = useState(false)

  function copyReport() {
    navigator.clipboard.writeText(JSON.stringify(result, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function copySummary() {
    if (!result.scores) return
    const s = result.scores
    const v = result.webVitals
    const lines = [
      `Lighthouse Audit - ${url}`,
      '',
      `Performance: ${s.performance}  Accessibility: ${s.accessibility}  Best Practices: ${s.bestPractices}  SEO: ${s.seo}`,
      '',
      v ? `LCP: ${v.lcp ?? '-'}  FCP: ${v.fcp ?? '-'}  CLS: ${v.cls ?? '-'}  TBT: ${v.tbt ?? '-'}  SI: ${v.si ?? '-'}` : '',
    ]
    navigator.clipboard.writeText(lines.filter(Boolean).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  if (!result.success) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex items-center gap-3">
        <AlertCircle className="size-5 text-destructive shrink-0" />
        <div>
          <p className="text-sm font-medium text-destructive">Audit failed</p>
          <p className="text-xs text-muted-foreground mt-0.5">{result.error}</p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto gap-1.5 cursor-pointer" onClick={onRetry}>
          <RotateCcw className="size-3.5" /> Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Scores */}
      {result.scores && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm font-medium text-foreground">Scores</p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={copySummary}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors px-2 py-1 rounded-md hover:bg-accent"
              >
                {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy summary'}
              </button>
              <button
                onClick={copyReport}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors px-2 py-1 rounded-md hover:bg-accent"
              >
                <FileJson className="size-3.5" />
                JSON
              </button>
            </div>
          </div>
          <div className="flex justify-around">
            <ScoreCircle label="Performance" score={result.scores.performance} icon={<Zap className="size-3.5" />} />
            <ScoreCircle label="Accessibility" score={result.scores.accessibility} icon={<ShieldCheck className="size-3.5" />} />
            <ScoreCircle label="Best Practices" score={result.scores.bestPractices} icon={<Check className="size-3.5" />} />
            <ScoreCircle label="SEO" score={result.scores.seo} icon={<Search className="size-3.5" />} />
          </div>
        </div>
      )}

      {/* Web Vitals */}
      {result.webVitals && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-foreground">Core Web Vitals</p>
            <a
              href="https://web.dev/explore/metrics"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Learn more <ExternalLink className="size-3" />
            </a>
          </div>
          <div className="flex gap-3 flex-wrap">
            {(Object.entries(result.webVitals) as [VitalKey, string | null][]).map(([key, val]) => (
              <VitalChip key={key} vitalKey={key} value={val} />
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
            <div className="flex items-center gap-1.5 text-xs text-green-500"><span className="size-2 rounded-full bg-green-500 inline-block" /> Good</div>
            <div className="flex items-center gap-1.5 text-xs text-yellow-500"><span className="size-2 rounded-full bg-yellow-500 inline-block" /> Needs improvement</div>
            <div className="flex items-center gap-1.5 text-xs text-red-500"><span className="size-2 rounded-full bg-red-500 inline-block" /> Poor</div>
          </div>
        </div>
      )}

      {/* Issues */}
      {result.topIssues && result.topIssues.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium text-foreground">Top Issues</p>
            <AuditSummaryBar issues={result.topIssues} />
          </div>
          <p className="text-xs text-muted-foreground mb-4">Click any issue to see details and fix suggestions.</p>
          <div className="flex flex-col">
            {result.topIssues.map(issue => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── History bar ──────────────────────────────────────────────────────────────

function HistoryBar({ onSelect }: { onSelect: (url: string) => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)

  useEffect(() => {
    const handler = () => setHistory(loadHistory())
    window.addEventListener('lighthouse-history-updated', handler)
    return () => window.removeEventListener('lighthouse-history-updated', handler)
  }, [])

  if (history.length === 0) return null

  return (
    <div className="flex flex-col gap-2 mb-5">
      <p className="text-xs text-muted-foreground font-medium">Recent audits</p>
      <div className="flex flex-col gap-1">
        {history.map(entry => {
          const ds = entry.scores.desktop?.performance
          const ms = entry.scores.mobile?.performance
          const date = new Date(entry.timestamp)
          const ago = formatRelativeTime(entry.timestamp)
          return (
            <button
              key={entry.url}
              onClick={() => onSelect(entry.url)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent transition-colors cursor-pointer text-left group"
            >
              <Globe className="size-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm text-foreground flex-1 truncate">{entry.url}</span>
              <div className="flex items-center gap-2 shrink-0">
                {ds != null && (
                  <span className={cn('text-xs font-bold flex items-center gap-1', scoreColor(ds))}>
                    <Monitor className="size-3" /> {ds}
                  </span>
                )}
                {ms != null && (
                  <span className={cn('text-xs font-bold flex items-center gap-1', scoreColor(ms))}>
                    <Smartphone className="size-3" /> {ms}
                  </span>
                )}
                <span className="text-xs text-muted-foreground flex items-center gap-1" title={date.toLocaleString()}>
                  <Clock className="size-3" /> {ago}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Running animation ────────────────────────────────────────────────────────

function RunningState({ runningDesktop, runningMobile }: { runningDesktop: boolean; runningMobile: boolean }) {
  const steps = [
    { label: 'Desktop audit', done: !runningDesktop, icon: <Monitor className="size-4" /> },
    { label: 'Mobile audit', done: !runningMobile, icon: <Smartphone className="size-4" /> },
  ]

  return (
    <div className="rounded-xl border border-border bg-card p-10 flex flex-col items-center gap-5 text-center">
      <Loader2 className="size-8 text-primary animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground mb-1">Running audits…</p>
        <p className="text-xs text-muted-foreground">Desktop and mobile run in parallel</p>
      </div>
      <div className="flex items-center gap-6">
        {steps.map(step => (
          <div key={step.label} className="flex flex-col items-center gap-2">
            <div className={cn(
              'flex items-center justify-center size-9 rounded-full border-2 transition-colors',
              step.done ? 'border-green-500 bg-green-500/10 text-green-500' : 'border-border text-muted-foreground'
            )}>
              {step.done ? <Check className="size-4" /> : step.icon}
            </div>
            <span className="text-xs text-muted-foreground">{step.label}</span>
            {!step.done && <Loader2 className="size-3 text-primary animate-spin" />}
            {step.done && <Check className="size-3 text-green-500" />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Lighthouse() {
  const [status, setStatus] = useState<LighthouseStatus | null>(null)
  const [url, setUrl] = useState('')
  const [view, setView] = useState<'desktop' | 'mobile' | 'compare'>('desktop')
  const [running, setRunning] = useState(false)
  const [runningDesktop, setRunningDesktop] = useState(false)
  const [runningMobile, setRunningMobile] = useState(false)
  const [results, setResults] = useState<Results>({ desktop: null, mobile: null })
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showHistory, setShowHistory] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { plan } = useAuth()
  const { onConversionSuccess } = useConversionCountContext()
  const metered = !isPaidPlan(plan)

  useEffect(() => {
    window.electron.lighthouseStatus().then(setStatus)
  }, [])

  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  async function runAudit(targetUrl?: string) {
    const target = targetUrl ?? url
    if (!target.trim()) return
    const normalized = target.startsWith('http') ? target : `https://${target}`

    // Reserve 5 tokens up front; refunded below if the audit returns no results (both errored).
    // countCategory:false - an audit isn't a conversion, so it spends tokens without bumping the
    // per-category Usage counts.
    const [refund, reserved] = spendTokens('document', plan, { cost: 5, countCategory: false })
    if (!reserved) {
      toast.error('Audit limit reached', {
        description: 'Upgrade to Pro to run more audits.',
        duration: 5000,
      })
      return
    }

    setUrl(normalized)
    setRunning(true)
    setRunningDesktop(true)
    setRunningMobile(true)
    setResults({ desktop: null, mobile: null })
    setShowHistory(false)

    const [desktop, mobile] = await Promise.all([
      window.electron.lighthouseRun({ url: normalized, strategy: 'desktop' }).finally(() => setRunningDesktop(false)),
      window.electron.lighthouseRun({ url: normalized, strategy: 'mobile' }).finally(() => setRunningMobile(false)),
    ])

    setResults({ desktop, mobile })
    setRunning(false)

    // Only a successful audit (at least one strategy returned results) is billed; both errored = refund.
    if (desktop?.success || mobile?.success) {
      onConversionSuccess('document') // persist tokens_used + trial-exhaustion flip
      saveHistory({
        url: normalized,
        timestamp: Date.now(),
        scores: {
          desktop: desktop?.scores ?? null,
          mobile: mobile?.scores ?? null,
        },
      })
      window.dispatchEvent(new Event('lighthouse-history-updated'))
    } else {
      refund()
    }
  }

  // ── Offline ──
  if (!isOnline) {
    return (
      <section className="section py-8">
        <PageHeader version={status?.version} metered={metered} />
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-3 text-center h-64">
          <WifiOff className="size-8 text-destructive" />
          <p className="text-sm font-medium text-destructive">No internet connection</p>
          <p className="text-xs text-muted-foreground">Lighthouse audits require an active internet connection.</p>
        </div>
      </section>
    )
  }

  const hasResults = results.desktop !== null || results.mobile !== null

  return (
    <section className="section py-8">
      <PageHeader version={status?.version} metered={metered} />

      {/* URL input */}
      <div className="flex gap-3 mb-2">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            className="pl-9 pr-9"
            placeholder="https://example.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !running && runAudit()}
            onFocus={() => setShowHistory(true)}
            disabled={running}
          />
          {url && !running && (
            <button
              onClick={() => { setUrl(''); inputRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
        <Button onClick={() => runAudit()} disabled={running || !url.trim()} className="gap-2 cursor-pointer shrink-0">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Gauge className="size-4" />}
          {running ? 'Auditing…' : 'Run Audit'}
        </Button>
      </div>

      {/* History dropdown */}
      {showHistory && !running && (
        <div className="mb-5">
          <HistoryBar onSelect={(u) => { setUrl(u); setShowHistory(false); runAudit(u) }} />
        </div>
      )}

      {/* Running */}
      {running && (
        <div className="mt-4">
          <RunningState runningDesktop={runningDesktop} runningMobile={runningMobile} />
        </div>
      )}

      {/* Results */}
      {!running && hasResults && (
        <div className="flex flex-col gap-4 mt-4">
          {/* View switcher */}
          <div className="flex rounded-lg border border-border overflow-hidden self-start">
            {(['desktop', 'mobile', 'compare'] as const).map(v => {
              const icons = { desktop: <Monitor className="size-3.5" />, mobile: <Smartphone className="size-3.5" />, compare: <TrendingUp className="size-3.5" /> }
              const labels = { desktop: 'Desktop', mobile: 'Mobile', compare: 'Compare' }
              const score = v === 'desktop' ? results.desktop?.scores?.performance : v === 'mobile' ? results.mobile?.scores?.performance : null
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors cursor-pointer',
                    view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  )}
                >
                  {icons[v]}
                  {labels[v]}
                  {score != null && (
                    <span className={cn('text-xs font-bold', view === v ? 'text-primary-foreground/80' : scoreColor(score))}>
                      {score}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Compare view */}
          {view === 'compare' && results.desktop?.success && results.mobile?.success && (
            <CompareView desktop={results.desktop} mobile={results.mobile} url={url} onRetry={() => runAudit()} />
          )}

          {/* Single result */}
          {view !== 'compare' && results[view] && (
            <AuditResultView result={results[view]!} onRetry={() => runAudit()} url={url} />
          )}
        </div>
      )}
    </section>
  )
}

// ─── Compare view ─────────────────────────────────────────────────────────────

function CompareView({ desktop, mobile, url, onRetry }: { desktop: AuditResult; mobile: AuditResult; url: string; onRetry: () => void }) {
  if (!desktop.scores || !mobile.scores) return null
  const cats: { key: keyof Scores; label: string }[] = [
    { key: 'performance', label: 'Performance' },
    { key: 'accessibility', label: 'Accessibility' },
    { key: 'bestPractices', label: 'Best Practices' },
    { key: 'seo', label: 'SEO' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-6">
        <p className="text-sm font-medium text-foreground mb-5">Score Comparison</p>
        <div className="flex flex-col gap-4">
          {cats.map(({ key, label }) => {
            const d = desktop.scores![key]
            const m = mobile.scores![key]
            const max = Math.max(d, m, 1)
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={cn('flex items-center gap-1 font-bold', scoreColor(d))}>
                      <Monitor className="size-3" /> {d}
                    </span>
                    <span className={cn('flex items-center gap-1 font-bold', scoreColor(m))}>
                      <Smartphone className="size-3" /> {m}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Monitor className="size-3 text-muted-foreground shrink-0" />
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-700', d >= 90 ? 'bg-green-500' : d >= 50 ? 'bg-yellow-500' : 'bg-red-500')}
                        style={{ width: `${(d / 100) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Smartphone className="size-3 text-muted-foreground shrink-0" />
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-700', m >= 90 ? 'bg-green-500' : m >= 50 ? 'bg-yellow-500' : 'bg-red-500')}
                        style={{ width: `${(m / 100) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Side-by-side vitals */}
      {desktop.webVitals && mobile.webVitals && (
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-medium text-foreground mb-4">Web Vitals Comparison</p>
          <div className="grid grid-cols-[1fr_auto_1fr] gap-y-2 gap-x-4 items-center">
            <div className="text-xs font-medium text-center text-muted-foreground flex items-center justify-center gap-1">
              <Monitor className="size-3" /> Desktop
            </div>
            <div />
            <div className="text-xs font-medium text-center text-muted-foreground flex items-center justify-center gap-1">
              <Smartphone className="size-3" /> Mobile
            </div>
            {(Object.entries(VITAL_META) as [VitalKey, typeof VITAL_META[VitalKey]][]).map(([key, meta]) => {
              const dv = desktop.webVitals![key]
              const mv = mobile.webVitals![key]
              const ds = vitalStatus(key, dv)
              const ms = vitalStatus(key, mv)
              return [
                <div key={`d-${key}`} className={cn('text-center text-sm font-bold rounded-lg py-1.5 border', vitalStatusColor(ds))}>{dv ?? '-'}</div>,
                <div key={`l-${key}`} className="text-xs text-muted-foreground text-center">{meta.label}</div>,
                <div key={`m-${key}`} className={cn('text-center text-sm font-bold rounded-lg py-1.5 border', vitalStatusColor(ms))}>{mv ?? '-'}</div>,
              ]
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page header ──────────────────────────────────────────────────────────────

function PageHeader({ version, metered }: { version: string | null | undefined; metered: boolean }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-body font-semibold">Lighthouse Audit</h2>
          {version && (
            <span className="text-xs text-muted-foreground/60 border border-border rounded px-1.5 py-0.5">v{version}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Audit any website for performance, accessibility, SEO, and best practices - runs locally.
        </p>
      </div>
      {metered && (
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs shrink-0">
          <Info className="size-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Each audit uses <span className="font-medium text-foreground">5 tokens</span>, charged only when it returns results.
          </p>
        </div>
      )}
    </div>
  )
}
