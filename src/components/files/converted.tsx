import { useConvertStore } from "@/store/useConvertStore"
import { useEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { ConvertedFile } from "@/types"
import { Button } from "../ui/button"
import { Check, Download, Loader2, RefreshCcw } from "lucide-react"
import { formatBytes, fileKey } from "@/utils/fileUtils"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import ConversionStats from "./conversion-stats"

export default function ConvertedFiles() {
    const convertedFiles = useConvertStore(s => s.convertedFiles)
    const failedFiles = useConvertStore(s => s.failedFiles)
    const convertedCount = useConvertStore(s => s.convertedCount)
    const convertingTotal = useConvertStore(s => s.convertingTotal)
    const totalInputSize = useConvertStore(s => s.totalInputSize)
    const totalOutputSize = useConvertStore(s => s.totalOutputSize)
    const resetAppState = useConvertStore(s => s.resetConversion)
    const autoDownloadEnabled = useConvertStore(s => s.autoDownloadEnabled)
    const autoDownloadFolder = useConvertStore(s => s.autoDownloadFolder)
    const markAutoSaved = useConvertStore(s => s.markAutoSaved)

    const [snapshot, setSnapshot] = useState<ConvertedFile[]>([])
    const [isZipping, setIsZipping] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    const ITEM_HEIGHT = 72
    const ITEM_GAP = 10
    const VIRTUALIZE_THRESHOLD = 20
    const LIST_HEIGHT = 560

    const virtualizer = useVirtualizer({
        count: snapshot.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ITEM_HEIGHT + ITEM_GAP,
        overscan: 5,
        enabled: snapshot.length >= VIRTUALIZE_THRESHOLD,
    })

    // Track which keys we've already auto-saved to avoid double-saving
    const autoSavedKeys = useRef<Set<string>>(new Set())

    useEffect(() => {
        const incoming = Object.values(convertedFiles)
        if (incoming.length > 0) setSnapshot(incoming)
        else {
            setSnapshot([])
            autoSavedKeys.current.clear()
        }
    }, [convertedFiles])

    // Auto-download newly converted files when enabled + folder set
    useEffect(() => {
        if (!autoDownloadEnabled || !autoDownloadFolder) return
        const entries = Object.entries(convertedFiles)
        for (const [key, f] of entries) {
            if (autoSavedKeys.current.has(key)) continue
            autoSavedKeys.current.add(key)
            f.blob.arrayBuffer().then(buf => {
                window.electron.saveConvertedFile(autoDownloadFolder, f.name, buf)
                    .then(() => markAutoSaved(key))
                    .catch(() => {
                        // remove from saved set so it can be retried if the user re-saves manually
                        autoSavedKeys.current.delete(key)
                    })
            })
        }
    }, [convertedFiles, autoDownloadEnabled, autoDownloadFolder])

    const convertingFiles = useConvertStore(s => s.convertingFiles)
    const failedEntries = Object.entries(failedFiles)
    const doneCount = convertedCount + failedEntries.length
    const isDone = convertingTotal > 0 && doneCount >= convertingTotal
    const isConverting = convertingFiles.size > 0 || (convertingTotal > 0 && !isDone)
    const progress = convertingTotal > 0 ? (doneCount / convertingTotal) * 100 : 0
    const quality = useConvertStore(s => s.quality)
    const savedPercent = isDone && snapshot.length > 0 && totalInputSize > 0
        ? Math.round((1 - totalOutputSize / totalInputSize) * 100)
        : null
    const hasSameFormatReencode = snapshot.some(f => f.sourceFormat === f.format)
    const hasHighSavingsAtHighQuality = quality >= 80 && savedPercent !== null && savedPercent > 50
    const hasSuspiciousSavings = savedPercent !== null && (hasSameFormatReencode || hasHighSavingsAtHighQuality)
    const suspiciousReason = hasSameFormatReencode
        ? 'Some files were re-encoded to the same format. Any size change comes from metadata removal or compression re-optimization.'
        : 'Savings above 50% at high quality are unusual. This likely means the originals had heavy metadata or inefficient encoding - not quality loss.'

    if (convertingTotal === 0) return null

    const handleDownload = (blob: Blob, name: string) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        URL.revokeObjectURL(url)
    }

    const downloadAll = async () => {
        if (snapshot.length === 0) return
        if (snapshot.length === 1) {
            handleDownload(snapshot[0].blob, snapshot[0].name)
            return
        }
        setIsZipping(true)
        try {
            const JSZip = (await import('jszip')).default
            const zip = new JSZip()
            for (const f of snapshot) {
                zip.file(f.name, f.blob)
            }
            const blob = await zip.generateAsync({ type: 'blob' })
            handleDownload(blob, 'converted.zip')
        } finally {
            setIsZipping(false)
        }
    }

    return (
        <section className="py-6 xl:py-7 2xl:py-8">
            <div className="flex items-center justify-between mb-4 xl:mb-5 2xl:mb-6">
                <h3 className="font-medium text-primary font-body text-base xl:text-lg">
                    Converted ({snapshot.length}){failedEntries.length > 0 && <span className="text-destructive ml-2">· {failedEntries.length} failed</span>}
                </h3>
                <div className="flex items-center gap-x-2">
                    <Button onClick={downloadAll} disabled={!isDone || isZipping} variant={'secondary'} className={'group p-2.5! h-full!'}>
                        {isZipping ? <Loader2 className="size-5 xl:size-6 animate-spin" /> : <Download className="size-5 xl:size-6" />}
                    </Button>
                    <Tooltip>
                        <TooltipTrigger>
                            <Button onClick={resetAppState} disabled={isConverting} variant={'secondary'} className={'group p-2.5! h-full!'}>
                                <RefreshCcw className="size-5 xl:size-6 group-hover:animate-spin-once" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="text-sm xl:text-base font-light text-accent">{isConverting ? 'Wait for conversions to finish' : 'Start over'}</p>
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
            {snapshot.length > 0 && (
                snapshot.length >= VIRTUALIZE_THRESHOLD ? (
                    <div ref={scrollRef} style={{ height: LIST_HEIGHT, overflowY: 'auto', scrollbarWidth: 'none' }}>
                        <ul style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                            {virtualizer.getVirtualItems().map((row) => {
                                const f = snapshot[row.index]
                                return (
                                    <li key={`${f.name}-${f.inputSize}`} style={{ position: 'absolute', top: row.start, left: 0, right: 0, paddingBottom: ITEM_GAP }} className="flex items-center justify-between p-4 xl:p-5 rounded-2xl border border-accent bg-secondary/30">
                                        <div className="flex items-start gap-4 min-w-0">
                                            <Tooltip>
                                                <TooltipTrigger className="flex-1 min-w-0 text-left">
                                                    <span className="text-sm xl:text-base text-accent-foreground font-body truncate cursor-default block w-full">{f.name}</span>
                                                    <span className="text-xs xl:text-sm text-accent-foreground/50 font-body">{formatBytes(f.blob.size)}</span>
                                                </TooltipTrigger>
                                                <TooltipContent><p className="text-sm xl:text-base">{f.name}</p></TooltipContent>
                                            </Tooltip>
                                            {f.customized && (
                                                <span className="shrink-0 text-xs xl:text-sm font-medium px-1.5 py-0.5 rounded-md bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 border border-yellow-400/30">
                                                    Modified
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 ml-2 shrink-0">
                                            {f.autoSaved ? (
                                                <span className="flex items-center gap-1 text-xs xl:text-sm font-medium px-2.5 py-1.5 rounded-xl bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                                                    <Check className="size-3.5" />
                                                    Saved
                                                </span>
                                            ) : (
                                                <Button variant="secondary" onClick={() => handleDownload(f.blob, f.name)} className="text-xs xl:text-sm text-primary">
                                                    <Download className="size-3.5 xl:size-4 mr-1" />
                                                    Download
                                                </Button>
                                            )}
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                ) : (
                    <ul className="space-y-2.5 xl:space-y-3">
                        {snapshot.map((f) => (
                            <li key={`${f.name}-${f.inputSize}`} className="flex items-center justify-between p-4 xl:p-5 rounded-2xl border border-accent bg-secondary/30">
                                <div className="flex items-start gap-4 min-w-0">
                                    <Tooltip>
                                        <TooltipTrigger className="flex-1 min-w-0 text-left">
                                            <span className="text-sm xl:text-base text-accent-foreground font-body truncate cursor-default block w-full">{f.name}</span>
                                            <span className="text-xs xl:text-sm text-accent-foreground/50 font-body">{formatBytes(f.blob.size)}</span>
                                        </TooltipTrigger>
                                        <TooltipContent><p className="text-sm xl:text-base">{f.name}</p></TooltipContent>
                                    </Tooltip>
                                    {f.customized && (
                                        <span className="shrink-0 text-xs xl:text-sm font-medium px-1.5 py-0.5 rounded-md bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 border border-yellow-400/30">
                                            Modified
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 ml-2 shrink-0">
                                    {f.autoSaved ? (
                                        <span className="flex items-center gap-1 text-xs xl:text-sm font-medium px-2.5 py-1.5 rounded-xl bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                                            <Check className="size-3.5" />
                                            Saved
                                        </span>
                                    ) : (
                                        <Button variant="secondary" onClick={() => handleDownload(f.blob, f.name)} className="text-xs xl:text-sm text-primary">
                                            <Download className="size-3.5 xl:size-4 mr-1" />
                                            Download
                                        </Button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )
            )}

            <ConversionStats
                isDone={isDone}
                progress={progress}
                convertedCount={convertedCount}
                convertingTotal={convertingTotal}
                savedPercent={savedPercent}
                hasSuspiciousSavings={hasSuspiciousSavings}
                suspiciousReason={suspiciousReason}
                totalOutputSize={totalOutputSize}
                totalInputSize={totalInputSize}
            />
        </section>
    )
}
