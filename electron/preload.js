const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // Resolve a dropped/picked File to its absolute disk path. Replaces the removed
  // `File.path` (gone in Electron 32); returns '' for in-memory Files with no path.
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || '' } catch { return '' }
  },
  convert: (buffer, targetFormat, quality, imageOptions) => ipcRenderer.invoke('convert-file', buffer, targetFormat, quality, imageOptions),
  convertDocument: (buffer, targetFormat, sourceFormat) => ipcRenderer.invoke('convert-document', buffer, targetFormat, sourceFormat),
  // source may be an absolute path (string) or an ArrayBuffer (in-memory fallback).
  // jobId lets the renderer cancel an in-flight conversion via cancelConversion.
  convertVideo: (source, sourceExt, targetFormat, videoOptions, jobId) => ipcRenderer.invoke('convert-video', source, sourceExt, targetFormat, videoOptions, jobId),
  convertAudio: (source, sourceExt, targetFormat, jobId) => ipcRenderer.invoke('convert-audio', source, sourceExt, targetFormat, jobId),
  cancelConversion: (jobId) => ipcRenderer.invoke('cancel-conversion', jobId),
  convertFavicon: (buffer) => ipcRenderer.invoke('convert-favicon', buffer),

  // Bulk converter
  bulkPickFolder: () => ipcRenderer.invoke('bulk-pick-folder'),
  bulkScanFolder: (opts) => ipcRenderer.invoke('bulk-scan-folder', opts),
  bulkConvertFolder: (opts) => ipcRenderer.invoke('bulk-convert-folder', opts),
  bulkWatchStart: (opts) => ipcRenderer.invoke('bulk-watch-start', opts),
  bulkWatchStop: (folderPath) => ipcRenderer.invoke('bulk-watch-stop', folderPath),
  bulkRetryFile: (opts) => ipcRenderer.invoke('bulk-retry-file', opts),
  onBulkProgress: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('bulk-convert-progress', handler)
    return () => ipcRenderer.removeListener('bulk-convert-progress', handler)
  },
  onBulkWatchConverted: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('bulk-watch-converted', handler)
    return () => ipcRenderer.removeListener('bulk-watch-converted', handler)
  },

  // PDF tools
  pdfMerge: (opts) => ipcRenderer.invoke('pdf-merge', opts),
  pdfMergeSave: () => ipcRenderer.invoke('pdf-merge-save'),
  pdfPickFiles: () => ipcRenderer.invoke('pdf-pick-files'),

  // Website PDF
  websitePdfGenerate: (opts) => ipcRenderer.invoke('website-pdf-generate', opts),
  websitePdfSave: () => ipcRenderer.invoke('website-pdf-save'),
  onWebsitePdfWaiting: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('website-pdf-waiting', handler)
    return () => ipcRenderer.removeListener('website-pdf-waiting', handler)
  },

  // Auto-download
  pickDownloadFolder: () => ipcRenderer.invoke('pick-download-folder'),
  saveConvertedFile: (folderPath, fileName, buffer) => ipcRenderer.invoke('save-converted-file', folderPath, fileName, buffer),
  saveImageBuffer: (opts) => ipcRenderer.invoke('save-image-buffer', opts),

  // Batch rename
  batchRenamePickFolder: () => ipcRenderer.invoke('batch-rename-pick-folder'),
  batchRenameScan: (opts) => ipcRenderer.invoke('batch-rename-scan', opts),
  batchRenamePreview: (opts) => ipcRenderer.invoke('batch-rename-preview', opts),
  batchRenameApply: (opts) => ipcRenderer.invoke('batch-rename-apply', opts),

  // Lighthouse (bundled - no install step)
  lighthouseStatus: () => ipcRenderer.invoke('lighthouse-status'),
  lighthouseRun: (opts) => ipcRenderer.invoke('lighthouse-run', opts),

  // PDF Editor
  pdfEditorPickFile: () => ipcRenderer.invoke('pdf-editor-pick-file'),
  pdfEditorReadFile: (filePath) => ipcRenderer.invoke('pdf-editor-read-file', filePath),
  pdfEditorPageOps: (opts) => ipcRenderer.invoke('pdf-editor-page-ops', opts),
  pdfEditorSave: () => ipcRenderer.invoke('pdf-editor-save'),
  pdfEditorReset: () => ipcRenderer.invoke('pdf-editor-reset'),
  pdfEditorWatermark: (opts) => ipcRenderer.invoke('pdf-editor-watermark', opts),
  pdfEditorGetFormFields: (filePath) => ipcRenderer.invoke('pdf-editor-get-form-fields', filePath),
  pdfEditorFillForms: (opts) => ipcRenderer.invoke('pdf-editor-fill-forms', opts),
  pdfEditorBurnAnnotations: (opts) => ipcRenderer.invoke('pdf-editor-burn-annotations', opts),

  // PDF converters (image <-> pdf)
  pdfConvertPickImages: () => ipcRenderer.invoke('pdf-convert-pick-images'),
  pdfConvertImagesToPdf: (opts) => ipcRenderer.invoke('pdf-convert-images-to-pdf', opts),
  pdfConvertImagesToPdfSave: () => ipcRenderer.invoke('pdf-convert-images-to-pdf-save'),
  pdfConvertReset: () => ipcRenderer.invoke('pdf-convert-reset'),
  pdfConvertPickPdf: () => ipcRenderer.invoke('pdf-convert-pick-pdf'),
  pdfConvertSplitPick: () => ipcRenderer.invoke('pdf-convert-split-pick'),
  pdfConvertSplitBuild: (opts) => ipcRenderer.invoke('pdf-convert-split-build', opts),
  pdfConvertSplitSave: (opts) => ipcRenderer.invoke('pdf-convert-split-save', opts),
  pdfCompressPick: () => ipcRenderer.invoke('pdf-compress-pick'),
  pdfCompressRun: (opts) => ipcRenderer.invoke('pdf-compress-run', opts),
  pdfCompressSave: () => ipcRenderer.invoke('pdf-compress-save'),
  pdfPageNumbersPick: () => ipcRenderer.invoke('pdf-pagenumbers-pick'),
  pdfPageNumbersApply: (opts) => ipcRenderer.invoke('pdf-pagenumbers-apply', opts),
  pdfPageNumbersSave: () => ipcRenderer.invoke('pdf-pagenumbers-save'),
  pdfHeaderFooterPick: () => ipcRenderer.invoke('pdf-headerfooter-pick'),
  pdfHeaderFooterApply: (opts) => ipcRenderer.invoke('pdf-headerfooter-apply', opts),
  pdfHeaderFooterSave: () => ipcRenderer.invoke('pdf-headerfooter-save'),

  // Tray / notifications
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),

  // OAuth
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onOAuthCallback: (cb) => {
    const handler = (_e, url) => cb(url)
    ipcRenderer.on('oauth-callback', handler)
    return () => ipcRenderer.removeListener('oauth-callback', handler)
  },

  // Website screenshot
  screenshotEnsureBrowser: () => ipcRenderer.invoke('screenshot-ensure-browser'),
  screenshotCapture: (opts) => ipcRenderer.invoke('screenshot-capture', opts),
  screenshotSave: (opts) => ipcRenderer.invoke('screenshot-save', opts),
  onScreenshotBrowserStatus: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('screenshot-browser-status', handler)
    return () => ipcRenderer.removeListener('screenshot-browser-status', handler)
  },
})
