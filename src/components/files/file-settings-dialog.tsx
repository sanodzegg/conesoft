import { useState, useEffect, useRef } from "react"
import { useConvertStore } from "@/store/useConvertStore"
import { fileKey } from "@/utils/fileUtils"
import { getEngineForFile } from "@/engines/engineRegistry"
import type { FitMode } from "@/types"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogClose,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Settings } from "lucide-react"

const FIT_OPTIONS: { value: FitMode; label: string; description: string }[] = [
    { value: 'max', label: 'Max', description: 'Fit within dimensions, never upscale' },
    { value: 'crop', label: 'Crop', description: 'Fill dimensions, crop excess' },
    { value: 'scale', label: 'Scale', description: 'Force exact dimensions' },
]

function loadFileDimensions(file: File, engineId: string | undefined): Promise<{ w: number; h: number } | null> {
    if (engineId === 'image') {
        return createImageBitmap(file).then(bmp => {
            const dims = { w: bmp.width, h: bmp.height }
            bmp.close()
            return dims
        }).catch(() => null)
    }
    if (engineId === 'video') {
        return new Promise(resolve => {
            const url = URL.createObjectURL(file)
            const vid = document.createElement('video')
            vid.preload = 'metadata'
            vid.onloadedmetadata = () => {
                resolve({ w: vid.videoWidth, h: vid.videoHeight })
                URL.revokeObjectURL(url)
            }
            vid.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
            vid.src = url
        })
    }
    return Promise.resolve(null)
}

function computeAutoHeight(w: number, srcW: number, srcH: number, fit: FitMode): number {
    const aspect = srcH / srcW
    if (fit === 'scale') return w
    if (fit === 'crop') return Math.round(w * aspect)
    // max: fit within, preserve aspect
    return Math.round(w * aspect)
}

function computeAutoWidth(h: number, srcW: number, srcH: number, fit: FitMode): number {
    const aspect = srcW / srcH
    if (fit === 'scale') return h
    if (fit === 'crop') return Math.round(h * aspect)
    return Math.round(h * aspect)
}

export default function FileSettingsDialog({ file }: { file: File }) {
    const key = fileKey(file)
    const fileSettings = useConvertStore(s => s.fileSettings[key])
    const imageQuality = useConvertStore(s => s.imageQuality)
    const setFileSettings = useConvertStore(s => s.setFileSettings)

    const engineId = getEngineForFile(file)?.id
    const isImage = engineId === 'image'
    const isVideo = engineId === 'video'

    const [width, setWidth] = useState<string>(fileSettings?.width?.toString() ?? '')
    const [height, setHeight] = useState<string>(fileSettings?.height?.toString() ?? '')
    const [fit, setFit] = useState<FitMode>(fileSettings?.fit ?? 'max')
    const [keepMetadata, setKeepMetadata] = useState<boolean>(fileSettings?.keepMetadata ?? true)
    const [quality, setQuality] = useState<number>(fileSettings?.quality ?? imageQuality)

    const [srcDims, setSrcDims] = useState<{ w: number; h: number } | null>(null)
    // which field the user last explicitly typed into - the other becomes auto-computed
    const [lastEdited, setLastEdited] = useState<'width' | 'height' | null>(null)

    const syncFromStore = () => {
        setWidth(fileSettings?.width?.toString() ?? '')
        setHeight(fileSettings?.height?.toString() ?? '')
        setFit(fileSettings?.fit ?? 'max')
        setKeepMetadata(fileSettings?.keepMetadata ?? true)
        setQuality(fileSettings?.quality ?? imageQuality)
        setLastEdited(null)
    }

    const loadDims = useRef(false)
    const onOpen = () => {
        syncFromStore()
        if (!loadDims.current) {
            loadDims.current = true
            loadFileDimensions(file, engineId).then(dims => setSrcDims(dims))
        }
    }

    // Compute auto value for the non-edited field
    const autoHeight = (() => {
        if (!srcDims || !width || lastEdited === 'height') return null
        const w = parseInt(width)
        if (!w || w < 1) return null
        return computeAutoHeight(w, srcDims.w, srcDims.h, fit)
    })()

    const autoWidth = (() => {
        if (!srcDims || !height || lastEdited === 'width') return null
        const h = parseInt(height)
        if (!h || h < 1) return null
        return computeAutoWidth(h, srcDims.w, srcDims.h, fit)
    })()

    // Recompute auto values when fit changes
    useEffect(() => {
        if (!srcDims) return
        if (lastEdited === 'width' && width) {
            const w = parseInt(width)
            if (w >= 1) setHeight(computeAutoHeight(w, srcDims.w, srcDims.h, fit).toString())
        } else if (lastEdited === 'height' && height) {
            const h = parseInt(height)
            if (h >= 1) setWidth(computeAutoWidth(h, srcDims.w, srcDims.h, fit).toString())
        }
    }, [fit])

    const parseDimension = (v: string): number | undefined => {
        const n = Math.floor(Number(v))
        return v && n >= 1 ? n : undefined
    }

    const handleSave = () => {
        const w = parseDimension(width)
        const h = parseDimension(height)
        setFileSettings(file, {
            ...(isImage || isVideo ? {
                width: w,
                height: h,
                fit: (w || h) ? fit : undefined,
            } : {}),
            ...(isImage ? {
                keepMetadata: keepMetadata !== true ? keepMetadata : undefined,
                quality: quality !== imageQuality ? quality : undefined,
            } : {}),
        })
    }

    const hasSettings = isImage || isVideo
    const isCustomized = !!(
        fileSettings?.width ||
        fileSettings?.height ||
        (fileSettings?.quality !== undefined && fileSettings.quality !== imageQuality) ||
        fileSettings?.keepMetadata === false
    )

    if (!hasSettings) {
        return (
            <Button variant="secondary" className="group p-2.5! h-full!" disabled>
                <Settings className="group-hover:animate-spin-once size-5" />
            </Button>
        )
    }

    const isWidthAuto = lastEdited === 'height' && !!height && !!autoWidth
    const isHeightAuto = lastEdited === 'width' && !!width && !!autoHeight

    return (
        <Dialog onOpenChange={open => { if (open) onOpen() }}>
            <DialogTrigger
                render={
                    <Button variant="secondary" className="group p-2.5! h-full!">
                        <Settings className={`group-hover:animate-spin-once size-5 ${isCustomized ? 'text-yellow-500' : ''}`} />
                    </Button>
                }
            />
            <DialogContent className="max-w-sm xl:max-w-md">
                <DialogHeader>
                    <DialogTitle className={'font-body xl:text-xl'}>File Settings</DialogTitle>
                </DialogHeader>

                <div className="space-y-5 xl:space-y-6">
                    {/* Resize - image + video */}
                    {(isImage || isVideo) && (
                        <>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm xl:text-base font-medium text-primary">Resize</p>
                                    {srcDims && (
                                        <span className="text-xs text-muted-foreground">Original: {srcDims.w} × {srcDims.h}</span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <label className="text-xs xl:text-sm text-muted-foreground mb-1 block">Width (px)</label>
                                        <Input
                                            type="number"
                                            placeholder={srcDims ? `${srcDims.w}` : 'Auto'}
                                            value={isWidthAuto ? (autoWidth?.toString() ?? '') : width}
                                            onChange={e => {
                                                setWidth(e.target.value)
                                                setLastEdited('width')
                                                if (srcDims && e.target.value) {
                                                    const w = parseInt(e.target.value)
                                                    if (w >= 1) setHeight(computeAutoHeight(w, srcDims.w, srcDims.h, fit).toString())
                                                } else {
                                                    setHeight('')
                                                }
                                            }}
                                            onFocus={() => {
                                                if (isWidthAuto) {
                                                    setWidth(autoWidth?.toString() ?? '')
                                                    setLastEdited('width')
                                                }
                                            }}
                                            min={1}
                                            className={isWidthAuto ? 'text-muted-foreground' : ''}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-xs xl:text-sm text-muted-foreground mb-1 block">Height (px)</label>
                                        <Input
                                            type="number"
                                            placeholder={srcDims ? `${srcDims.h}` : 'Auto'}
                                            value={isHeightAuto ? (autoHeight?.toString() ?? '') : height}
                                            onChange={e => {
                                                setHeight(e.target.value)
                                                setLastEdited('height')
                                                if (srcDims && e.target.value) {
                                                    const h = parseInt(e.target.value)
                                                    if (h >= 1) setWidth(computeAutoWidth(h, srcDims.w, srcDims.h, fit).toString())
                                                } else {
                                                    setWidth('')
                                                }
                                            }}
                                            onFocus={() => {
                                                if (isHeightAuto) {
                                                    setHeight(autoHeight?.toString() ?? '')
                                                    setLastEdited('height')
                                                }
                                            }}
                                            min={1}
                                            className={isHeightAuto ? 'text-muted-foreground' : ''}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className={`space-y-2 ${!width && !height ? 'opacity-40 pointer-events-none' : ''}`}>
                                <p className="text-sm xl:text-base font-medium text-primary">Fit</p>
                                <div className="flex gap-2">
                                    {FIT_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            onClick={() => setFit(opt.value)}
                                            title={opt.description}
                                            className={`flex-1 rounded-xl border py-2 xl:py-2.5 text-xs xl:text-sm font-medium transition-colors cursor-pointer ${
                                                fit === opt.value
                                                    ? 'border-primary bg-primary text-primary-foreground'
                                                    : 'border-accent bg-secondary/30 text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs xl:text-sm text-muted-foreground">
                                    {FIT_OPTIONS.find(o => o.value === fit)?.description}
                                </p>
                            </div>
                        </>
                    )}

                    {/* Quality - image only, not for GIF (no quality control) */}
                    {isImage && fileSettings?.targetFormat !== 'gif' && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="text-sm xl:text-base font-medium text-primary">
                                    {fileSettings?.targetFormat === 'png' ? 'Compression' : 'Quality'}
                                </p>
                                <span className="text-sm xl:text-base font-medium text-primary">
                                    {fileSettings?.targetFormat === 'png'
                                        ? quality >= 100 ? 'None' : quality <= 10 ? 'Max' : `${100 - quality}%`
                                        : quality >= 100 && fileSettings?.targetFormat === 'webp' ? 'Lossless' : `${quality}%`
                                    }
                                </span>
                            </div>
                            <Slider
                                min={1}
                                max={100}
                                step={1}
                                value={[quality]}
                                onValueChange={v => setQuality(Array.isArray(v) ? v[0] : v)}
                                className="w-full"
                            />
                            {fileSettings?.targetFormat === 'png' && (
                                <p className="text-xs text-muted-foreground">Always lossless - more compression means a smaller file, slower encode.</p>
                            )}
                            {fileSettings?.targetFormat === 'webp' && quality >= 100 && (
                                <p className="text-xs text-muted-foreground">Lossless mode - no quality loss, possible larger file.</p>
                            )}
                        </div>
                    )}

                    {/* Keep Metadata - image only */}
                    {isImage && (
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm xl:text-base font-medium text-primary">Keep Metadata</p>
                                <p className="text-xs xl:text-sm text-muted-foreground">Preserve EXIF and ICC color profiles</p>
                            </div>
                            <button
                                role="checkbox"
                                aria-checked={keepMetadata}
                                onClick={() => setKeepMetadata(v => !v)}
                                className={`relative inline-flex h-6 w-11 xl:h-7 xl:w-12 2xl:w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                                    keepMetadata ? 'bg-primary' : 'bg-accent'
                                }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block size-5 xl:size-6 rounded-full bg-white shadow-lg transition-transform ${
                                        keepMetadata ? 'translate-x-5 xl:translate-x-6' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>
                    )}

                </div>

                <DialogFooter>
                    <DialogClose render={<Button variant="outline">Cancel</Button>} />
                    <DialogClose render={<Button onClick={handleSave}>Save</Button>} />
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
