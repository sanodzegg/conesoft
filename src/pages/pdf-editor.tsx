import { useState, useCallback } from 'react'
import { FileText, Layers, Stamp, FormInput, Upload, X, FileEdit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { resetEditorSaveSession } from '@/lib/usePdfSaveMeter'
import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'

const PageManager = lazy(() => import('@/components/pdf-editor/page-manager'))
const AnnotationEditor = lazy(() => import('@/components/pdf-editor/annotation-editor'))
const WatermarkPanel = lazy(() => import('@/components/pdf-editor/watermark-panel'))
const FormFillPanel = lazy(() => import('@/components/pdf-editor/form-fill-panel'))

// ─── Types ────────────────────────────────────────────────────────────────────

export type PdfFile = { path: string; name: string; size: number }

type Tab = 'pages' | 'annotations' | 'watermark' | 'forms'

const TABS: { id: Tab; label: string; icon: React.ReactNode; comingSoon?: boolean }[] = [
  { id: 'pages', label: 'Pages', icon: <Layers className="size-4" /> },
  { id: 'annotations', label: 'Annotate', icon: <FileEdit className="size-4" /> },
  { id: 'watermark', label: 'Watermark', icon: <Stamp className="size-4" /> },
  { id: 'forms', label: 'Form Fill', icon: <FormInput className="size-4" /> },
]

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile }: { onFile: (file: PdfFile) => void }) {
  const [dragging, setDragging] = useState(false)

  async function pickFile() {
    const result = await window.electron.pdfEditorPickFile()
    if (!result.canceled) onFile(result)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file || !file.name.endsWith('.pdf')) return
    onFile({ path: (file as any).path, name: file.name, size: file.size })
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center h-90 gap-4 rounded-xl border-2 border-dashed p-16 text-center transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/30'
      )}
    >
      <div className="size-16 rounded-full bg-muted flex items-center justify-center">
        <FileText className="size-8 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-foreground text-lg">Open a PDF to edit</p>
        <p className="text-sm text-muted-foreground mt-1.5">Drag and drop or click to browse</p>
      </div>
      <Button onClick={pickFile} className="gap-2 cursor-pointer">
        <Upload className="size-4" />
        Browse PDF
      </Button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PdfEditor() {
  const [file, setFile] = useState<PdfFile | null>(null)
  const [tab, setTab] = useState<Tab>('pages')

  const handleFile = useCallback((f: PdfFile) => {
    window.electron.pdfEditorReset()
    resetEditorSaveSession() // new document - next save bills as the first (5), then re-saves (2)
    setFile(f)
    setTab('pages')
  }, [])

  function closeFile() {
    window.electron.pdfEditorReset()
    resetEditorSaveSession()
    setFile(null)
  }

  return (
    <section className="section py-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-body font-semibold">PDF Editor</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Reorder pages, annotate, add watermarks, and fill forms - all locally.
        </p>
      </div>

      {!file ? (
        <DropZone onFile={handleFile} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* File bar */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
            <FileText className="size-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground font-medium flex-1 truncate">{file.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
            <button
              onClick={closeFile}
              className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors shrink-0 ml-1"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex rounded-lg border border-border overflow-hidden self-start">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => !t.comingSoon && setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors',
                  t.comingSoon
                    ? 'text-muted-foreground/40 cursor-not-allowed'
                    : tab === t.id
                    ? 'bg-primary text-primary-foreground cursor-pointer'
                    : 'text-muted-foreground hover:bg-accent cursor-pointer'
                )}
              >
                {t.icon}
                {t.label}
                {t.comingSoon && (
                  <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded ml-0.5">Soon</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <Suspense fallback={
            <div className="flex items-center justify-center h-64">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          }>
            {tab === 'pages' && <PageManager file={file} />}
            {tab === 'annotations' && <AnnotationEditor file={file} />}
            {tab === 'watermark' && <WatermarkPanel file={file} />}
            {tab === 'forms' && <FormFillPanel file={file} />}
          </Suspense>
        </div>
      )}
    </section>
  )
}
