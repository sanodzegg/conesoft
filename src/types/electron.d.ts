interface BulkConvertOptions {
  folderPath: string
  targetFormat: string
  quality: number
  outputMode: 'alongside' | 'subfolder'
  deleteOriginal: boolean
  customOutputFolder?: string
}

interface BulkFileResult {
  ok: boolean
  srcPath: string
  destPath?: string
  originalSize?: number
  convertedSize?: number
  savedBytes?: number
  error?: string
}

declare interface Window {
  electron: {
    // Node Buffers come back over IPC as Uint8Array views over a regular ArrayBuffer
    // (never SharedArrayBuffer), so they are valid BlobParts - pass them straight to new Blob([...]).
    // Resolve a dropped/picked File to its absolute disk path ('' if in-memory / no path).
    getPathForFile: (file: File) => string
    convert: (buffer: ArrayBuffer, targetFormat: string, quality?: number, imageOptions?: { width?: number; height?: number; fit?: string; keepMetadata?: boolean }) => Promise<Uint8Array<ArrayBuffer>>
    convertDocument: (buffer: ArrayBuffer, targetFormat: string, sourceFormat: string) => Promise<Uint8Array<ArrayBuffer>>
    // source: absolute path (string) for large files, or ArrayBuffer for in-memory Files.
    // jobId: opaque id to cancel this conversion mid-flight via cancelConversion.
    // Resolve to null when the user cancelled the job mid-flight (see cancelConversion).
    convertVideo: (source: string | ArrayBuffer, sourceExt: string, targetFormat: string, videoOptions?: { width?: number; height?: number; fit?: string }, jobId?: string) => Promise<Uint8Array<ArrayBuffer> | null>
    convertAudio: (source: string | ArrayBuffer, sourceExt: string, targetFormat: string, jobId?: string) => Promise<Uint8Array<ArrayBuffer> | null>
    cancelConversion: (jobId: string) => Promise<boolean>
    convertFavicon: (buffer: ArrayBuffer) => Promise<{ ico: ArrayBuffer; pngs: { size: number; buf: ArrayBuffer }[] }>

    bulkPickFolder: () => Promise<string | null>
    bulkScanFolder: (opts: { folderPath: string; targetFormat: string }) => Promise<{ path: string; relativePath: string; size: number; sameFormat: boolean }[]>
    bulkConvertFolder: (opts: { folderPath: string; targetFormat: string; quality: number; outputMode: string; deleteOriginal: boolean; customOutputFolder?: string }) => Promise<BulkFileResult[]>
    bulkWatchStart: (opts: { folderPath: string; targetFormat: string; quality: number; outputMode: string; deleteOriginal: boolean; customOutputFolder?: string }) => Promise<boolean>
    bulkWatchStop: (folderPath: string) => Promise<boolean>
    bulkRetryFile: (opts: { srcPath: string; targetFormat: string; quality: number; outputMode: string; deleteOriginal: boolean; customOutputFolder?: string }) => Promise<BulkFileResult>
    onBulkProgress: (cb: (data: { done: number; total: number; latest: BulkFileResult }) => void) => () => void
    onBulkWatchConverted: (cb: (data: BulkFileResult) => void) => () => void

    // PDF tools
    pdfMerge: (opts: { filePaths: string[] }) => Promise<{}>
    pdfMergeSave: () => Promise<{ canceled: boolean; filePath?: string }>
    pdfPickFiles: () => Promise<{ canceled: boolean; files: { path: string; name: string; size: number }[] }>

    // Website PDF
    websitePdfGenerate: (opts: {
      url: string
      viewportWidth: number
      format: string
      orientation: 'portrait' | 'landscape'
      marginTop: number
      marginBottom: number
      marginLeft: number
      marginRight: number
      printBackground: boolean
      waitUntil: 'load' | 'domcontentloaded' | 'networkidle'
      waitTime: number
    }) => Promise<{ ok: boolean }>
    websitePdfSave: () => Promise<{ canceled: boolean; filePath?: string }>
    onWebsitePdfWaiting: (cb: (data: { waitTime: number }) => void) => () => void

    // Website screenshot
    screenshotEnsureBrowser: () => Promise<boolean>
    screenshotCapture: (opts: { url: string; format: 'png' | 'jpg' | 'webp'; viewportWidth: number; userAgent?: string }) => Promise<{ preview: string; buffer: number[]; format: string }>
    screenshotSave: (opts: { buffer: number[]; format: string; url: string }) => Promise<{ canceled: boolean; filePath?: string }>
    onScreenshotBrowserStatus: (cb: (data: { status: 'downloading' | 'ready' | 'error'; error?: string }) => void) => () => void

    // Batch rename
    batchRenamePickFolder: () => Promise<string | null>
    batchRenameScan: (opts: { folderPath: string }) => Promise<{ name: string; dir: string }[]>
    batchRenamePreview: (opts: { files: { name: string; dir: string }[]; rules: object }) => Promise<{ original: string; newName: string; dir: string; changed: boolean }[]>
    batchRenameApply: (opts: { preview: { original: string; newName: string; dir: string; changed: boolean }[] }) => Promise<{ ok: boolean; original: string; newName?: string; error?: string }[]>

    // Auto-download
    pickDownloadFolder: () => Promise<string | null>
    saveConvertedFile: (folderPath: string, fileName: string, buffer: ArrayBuffer) => Promise<string>
    saveImageBuffer: (opts: { buffer: number[]; fileName: string; format: string; title?: string }) => Promise<{ canceled: boolean; filePath?: string }>

    // PDF Editor
    pdfEditorPickFile: () => Promise<{ canceled: true } | { canceled: false; path: string; name: string; size: number }>
    pdfEditorReadFile: (filePath: string) => Promise<number[]>
    pdfEditorPageOps: (opts: { filePath: string; ops: { srcIndex: number; rotation: number }[] }) => Promise<{ success: boolean; pageCount?: number; error?: string }>
    pdfEditorSave: () => Promise<{ canceled: boolean; filePath?: string }>
    pdfEditorReset: () => Promise<{ ok: boolean }>
    pdfEditorWatermark: (opts: {
      filePath: string
      watermark: {
        type: 'text' | 'image'
        text?: string
        color?: string
        fontSize?: number
        opacity?: number
        rotation?: number
        imageBytes?: number[]
        scale?: number
        pages: 'all' | number[]
      }
    }) => Promise<{ success: boolean; error?: string }>
    pdfEditorGetFormFields: (filePath: string) => Promise<{ success: boolean; error?: string; fields: { name: string; type: string; value: string | null }[] }>
    pdfEditorFillForms: (opts: { filePath: string; fields: { name: string; type: string; value: string }[] }) => Promise<{ success: boolean; error?: string }>
    pdfEditorBurnAnnotations: (opts: {
      filePath: string
      pages: {
        pageNum: number
        width: number
        height: number
        annotations: Array<
          | { kind: 'highlight'; id: string; x: number; y: number; w: number; h: number; color: string; opacity: number }
          | { kind: 'text'; id: string; x: number; y: number; text: string; color: string; fontSize: number }
          | { kind: 'draw'; id: string; points: { x: number; y: number }[]; color: string; strokeWidth: number }
          | { kind: 'arrow'; id: string; x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth: number }
        >
      }[]
    }) => Promise<{ success: boolean; error?: string }>

    // PDF converters (image <-> pdf)
    pdfConvertPickImages: () => Promise<{ canceled: boolean; files: { path: string; name: string; size: number }[] }>
    pdfConvertImagesToPdf: (opts: {
      images: { path: string }[]
      options: { pageSize: 'auto' | 'a4' | 'letter'; orientation: 'portrait' | 'landscape'; margin: number }
    }) => Promise<{ success: boolean; pageCount?: number; error?: string }>
    pdfConvertImagesToPdfSave: () => Promise<{ canceled: boolean; filePath?: string }>
    pdfConvertReset: () => Promise<{ ok: boolean }>
    pdfConvertPickPdf: () => Promise<{ canceled: true } | { canceled: false; name: string; size: number; data: number[] }>

    // Tray / notifications
    showNotification: (title: string, body: string) => void

    // OAuth
    openExternal: (url: string) => Promise<void>
    onOAuthCallback: (cb: (url: string) => void) => () => void

    // Lighthouse (bundled - no install step)
    lighthouseStatus: () => Promise<{ installed: boolean; version: string | null }>
    lighthouseRun: (opts: { url: string; strategy?: 'desktop' | 'mobile' }) => Promise<{
      success: boolean
      error?: string
      scores?: { performance: number; accessibility: number; bestPractices: number; seo: number }
      webVitals?: { lcp: string | null; fcp: string | null; cls: string | null; tbt: string | null; si: string | null }
      topIssues?: {
        id: string
        title: string
        description: string | null
        score: number | null
        displayValue: string | null
        items: Record<string, string>[]
      }[]
    }>
  }
}
