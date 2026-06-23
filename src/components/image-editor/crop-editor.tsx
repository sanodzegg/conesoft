import { useRef, useState, useCallback } from 'react'
import { Button } from '../ui/button'
import { RotateCcw, Undo2, Redo2 } from 'lucide-react'
import { SideToolbar } from './toolbar/side-toolbar'
import { BottomPanel } from './toolbar/bottom-panel'
import type { OverlayMode } from './toolbar/tab-overlay'
import ExportDialog from './export-dialog'
import { DEFAULT_ADJUSTMENTS, DEFAULT_TRANSFORM } from './toolbar/types'
import type { Adjustments, Transform } from './toolbar/types'
import type { ScaleInfo } from './utils/image-space'
import { DEFAULT_RESIZE, type ResizeState } from './utils/resize-presets'
import { useTextOverlays } from './layers/use-text-overlays'
import { useDrawCommands, type DrawTool } from './layers/use-draw-commands'
import { useEditorHistory, type EditorSnapshot } from './layers/use-editor-history'
import { useCanvasDraw } from './layers/use-canvas-draw'
import { useCropInteraction, type DragState, type TextDragState } from './layers/use-crop-interaction'
import { useUndoRedo } from './layers/use-undo-redo'
import { useBgRemove } from './layers/use-bg-remove'
import { exportCanvas } from './utils/export-canvas'
import { useAuth } from '@/lib/useAuth'
import { useConversionCountContext } from '@/lib/ConversionCountContext'
import { spendTokens, isTrialExhausted } from '@/lib/useConversionCount'
import { toast } from 'sonner'

interface Rect { x: number; y: number; w: number; h: number }

interface Props {
  file: File
  onReset: () => void
}

export default function CropEditor({ file, onReset }: Props) {
  const { plan } = useAuth()
  const { onConversionSuccess } = useConversionCountContext()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const scaleRef = useRef<ScaleInfo>({ x: 1, y: 1, offX: 0, offY: 0, dispW: 0, dispH: 0 })

  // Crop state
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 })
  const cropRef = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 })
  const dragRef = useRef<DragState | null>(null)
  const textDragRef = useRef<TextDragState | null>(null)
  const isDrawingRef = useRef(false)

  // Editor state
  const [imgLoaded, setImgLoaded] = useState(false)
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS)
  const [transform, setTransform] = useState<Transform>(DEFAULT_TRANSFORM)
  const [resize, setResize] = useState<ResizeState>(DEFAULT_RESIZE)
  const [mode, setMode] = useState<OverlayMode>('crop')
  const [drawTool, setDrawTool] = useState<DrawTool>('pen')
  const [drawColor, setDrawColor] = useState('#ffffff')
  const [drawWidth, setDrawWidth] = useState(3)

  // Refs for read-in-callback access
  const adjustmentsRef = useRef(adjustments)
  const transformRef = useRef(transform)
  const resizeRef = useRef(resize)
  const modeRef = useRef(mode)
  const drawToolRef = useRef(drawTool)
  const drawColorRef = useRef(drawColor)
  const drawWidthRef = useRef(drawWidth)

  // Keep refs in sync
  const syncedSetAdjustments = useCallback((a: Adjustments) => { setAdjustments(a); adjustmentsRef.current = a }, [])
  const syncedSetTransform = useCallback((t: Transform) => { setTransform(t); transformRef.current = t }, [])
  const syncedSetResize = useCallback((fn: ResizeState | ((prev: ResizeState) => ResizeState)) => {
    setResize(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      resizeRef.current = next
      return next
    })
  }, [])
  const syncedSetMode = useCallback((m: OverlayMode) => { setMode(m); modeRef.current = m }, [])
  const syncedSetDrawTool = useCallback((t: DrawTool) => { setDrawTool(t); drawToolRef.current = t }, [])
  const syncedSetDrawColor = useCallback((c: string) => { setDrawColor(c); drawColorRef.current = c }, [])
  const syncedSetDrawWidth = useCallback((w: number) => { setDrawWidth(w); drawWidthRef.current = w }, [])
  const syncedSetCrop = useCallback((r: Rect) => { setCrop(r); cropRef.current = r }, [])

  // Overlay layers
  const textLayer = useTextOverlays()
  const textLayerRef = useRef(textLayer)
  textLayerRef.current = textLayer

  const drawLayer = useDrawCommands()
  const drawLayerRef = useRef(drawLayer)
  drawLayerRef.current = drawLayer

  // History
  const history = useEditorHistory({
    crop: { x: 0, y: 0, w: 0, h: 0 },
    adjustments: DEFAULT_ADJUSTMENTS,
    transform: DEFAULT_TRANSFORM,
    drawCommands: [],
    textOverlays: [],
  })

  const getSnapshot = useCallback((): EditorSnapshot => ({
    crop: cropRef.current,
    adjustments: adjustmentsRef.current,
    transform: transformRef.current,
    drawCommands: drawLayerRef.current.commands,
    textOverlays: textLayerRef.current.overlays,
  }), [])

  // Canvas draw hook
  const { draw, initCanvas } = useCanvasDraw({
    file,
    canvasRef, ctxRef, containerRef, imgRef, scaleRef,
    cropRef, adjustmentsRef, transformRef, modeRef,
    textLayerRef, drawLayerRef,
    crop, adjustments, transform,
    textOverlaysDep: textLayer.overlays,
    drawCommandsDep: drawLayer.commands,
    mode,
    setCrop: syncedSetCrop,
    setResize: syncedSetResize,
    setImgLoaded,
  })

  // Crop + draw interaction
  const { onMouseDown, getCursor } = useCropInteraction({
    canvasRef, scaleRef, imgRef, cropRef,
    modeRef, drawToolRef, drawColorRef, drawWidthRef,
    textLayerRef, drawLayerRef,
    dragRef, textDragRef, isDrawingRef,
    history, getSnapshot,
    setCrop: syncedSetCrop,
    draw,
  })

  // Undo/redo + history-aware setters
  const {
    handleUndo, handleRedo, handlePushHistory,
    handleSetAdjustments, handleSetAdjustmentsLive,
    handleSetTransform, handleDeleteText, handleUpdateText,
  } = useUndoRedo({
    history, getSnapshot,
    cropRef, setCrop: syncedSetCrop,
    setAdjustments: syncedSetAdjustments, adjustmentsRef,
    setTransform: syncedSetTransform,
    drawLayer, textLayer,
  })

  // Background removal
  const { bgRemoveStatus, bgRemoveProgress, handleBgRemove, handleBgRemoveCancel } = useBgRemove({
    imgRef, initCanvas,
  })

  // Export. Charge one image token on a successful download only (all the live editing is
  // free); refund if the canvas fails to encode. Paid plans are ungated, limited can't reach
  // this route (ProRoute), so in practice only trial users are metered.
  const handleExport = async (format: 'png' | 'jpeg' | 'webp', quality: number) => {
    const img = imgRef.current
    if (!img) return
    const [refund, reserved] = spendTokens('image', plan)
    if (!reserved) {
      toast.error(
        plan === 'limited' || isTrialExhausted()
          ? 'Daily limit reached. Try again tomorrow or upgrade to Pro.'
          : 'Conversion limit reached. Upgrade to continue.',
        { description: 'Upgrade to Pro for unlimited exports.', duration: 5000 }
      )
      return
    }
    const result = await exportCanvas({
      img,
      crop: cropRef.current,
      transform: transformRef.current,
      adjustments: adjustmentsRef.current,
      resize: resizeRef.current,
      textOverlays: textLayerRef.current.overlays,
      drawCommands: drawLayerRef.current.commands,
      fileName: file.name.replace(/\.[^.]+$/, `-edited.${format === 'jpeg' ? 'jpg' : format}`),
      format,
      quality,
    })
    // Refund on anything that isn't a real save (canceled dialog or encode failure); only a
    // genuine failure gets an error toast.
    if (result !== 'saved') { refund(); if (result === 'failed') toast.error('Export failed'); return }
    onConversionSuccess('image')
  }

  const exportW = resize.enabled ? resize.w : Math.round(crop.w)
  const exportH = resize.enabled ? resize.h : Math.round(crop.h)

  return (
    <div className="flex gap-4 items-start">
      {/* Left: canvas + bottom panel */}
      <div className="min-w-0 space-y-3" style={{ width: 'calc(100% - 272px)' }}>
        <div ref={containerRef} className="w-full rounded-2xl overflow-hidden border border-border bg-secondary/20">
          <canvas
            ref={canvasRef}
            className="block mx-auto"
            onMouseDown={onMouseDown}
            onMouseMove={e => { if (canvasRef.current) canvasRef.current.style.cursor = getCursor(e) }}
          />
        </div>

        {imgLoaded && (
          <BottomPanel
            adjustments={adjustments}
            onAdjustments={handleSetAdjustmentsLive}
            onAdjustmentsCommit={handleSetAdjustments}
            onHistoryPush={handlePushHistory}
            bgRemoveStatus={bgRemoveStatus}
            bgRemoveProgress={bgRemoveProgress}
            onBgRemove={handleBgRemove}
            onBgRemoveCancel={handleBgRemoveCancel}
          />
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {exportW} × {exportH} px
            {resize.enabled && <span className="text-primary ml-1.5">(resized)</span>}
          </p>
          <Button variant="outline" className="gap-2" onClick={onReset}>
            <RotateCcw className="size-4" />
            New Image
          </Button>
        </div>
      </div>

      {/* Right: spatial tools */}
      {imgLoaded && (
        <div className="w-64 shrink-0 space-y-3">
          <SideToolbar
            adjustments={adjustments}
            transform={transform}
            resize={resize}
            naturalW={imgRef.current?.naturalWidth ?? 0}
            naturalH={imgRef.current?.naturalHeight ?? 0}
            mode={mode}
            textOverlays={textLayer.overlays}
            selectedTextId={textLayer.selectedId}
            drawTool={drawTool}
            drawColor={drawColor}
            drawWidth={drawWidth}
            onAdjustments={handleSetAdjustments}
            onAdjustmentsLive={handleSetAdjustmentsLive}
            onHistoryPush={handlePushHistory}
            onTransform={handleSetTransform}
            onResize={r => syncedSetResize(r)}
            onMode={syncedSetMode}
            onSelectText={textLayer.setSelectedId}
            onUpdateText={handleUpdateText}
            onDeleteText={handleDeleteText}
            onDrawTool={syncedSetDrawTool}
            onDrawColor={syncedSetDrawColor}
            onDrawWidth={syncedSetDrawWidth}
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handleUndo} disabled={!history.canUndo} title="Undo (⌘Z)">
              <Undo2 className="size-3.5" /> Undo
            </Button>
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handleRedo} disabled={!history.canRedo} title="Redo (⌘⇧Z)">
              <Redo2 className="size-3.5" /> Redo
            </Button>
            <ExportDialog onExport={handleExport} iconOnly />
          </div>
        </div>
      )}
    </div>
  )
}
