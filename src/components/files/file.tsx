import { Badge } from "../ui/badge"
import {
    Combobox,
    ComboboxContent,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
} from "@/components/ui/combobox"
import { ArrowRightIcon, Loader2, MoveRight, Pencil, X } from "lucide-react"
import { useConvertStore } from "@/store/useConvertStore"
import { fileKey, getExtension, formatBytes } from "@/utils/fileUtils"
import { getFormatsForFile, getEngineForFile, isFormatLocked } from "@/engines/engineRegistry"
import { Lock } from "lucide-react"
import { estimateOutputSize, isLearnedEstimate } from "@/utils/estimateSize"
import { Button } from "../ui/button"
import FileSettingsDialog from "./file-settings-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { convertSingle } from "@/services/conversionService"
import { useNavigate } from "react-router-dom"
import { useConversionCountContext } from "@/lib/ConversionCountContext"
import { useAuth } from "@/lib/useAuth"
import { IMAGE_INPUT_EXTENSIONS } from "@/engines/imageEngine"

const IMAGE_EXTS = new Set(IMAGE_INPUT_EXTENSIONS)

export default function File({ data }: { data: File }) {
    const ext = getExtension(data)
    const formatKey = ext || null
    const colorStyle = formatKey ? {
        backgroundColor: `var(--badge-${formatKey}-bg)`,
        borderColor: `var(--badge-${formatKey}-border)`,
        color: `var(--badge-${formatKey}-text)`,
    } : {}

    const convertTo = getFormatsForFile(data)

    const rawTargetFormat = useConvertStore(s => s.fileSettings[fileKey(data)]?.targetFormat ?? convertTo[0])
    const targetFormat = convertTo.includes(rawTargetFormat) ? rawTargetFormat : convertTo[0]
    const setTargetFormat = useConvertStore(s => s.setTargetFormat)
    const isDone = useConvertStore(s => !!s.convertedFiles[fileKey(data)])
    const failedError = useConvertStore(s => s.failedFiles[fileKey(data)] ?? null)
    const removeFile = useConvertStore(s => s.removeFile)
    const setPendingEditorFile = useConvertStore(s => s.setPendingEditorFile)
    const convertingFiles = useConvertStore(s => s.convertingFiles)
    const { quality, imageQuality, fileSettings, convertedFiles, convertingFiles: convertingFilesMap, startConversion, setConvertedFile, setFailedFile, markFileConverting, unmarkFileConverting, conversionRatios } = useConvertStore()
    const { onConversionSuccess, onBatchComplete, onPlanExhausted } = useConversionCountContext()
    const { plan } = useAuth()
    const navigate = useNavigate()

    const isImage = ext ? IMAGE_EXTS.has(ext.toLowerCase()) : false

    const perFileQuality = fileSettings[fileKey(data)]?.quality
    const engineId = getEngineForFile(data)?.id
    const isConverting = convertingFiles.has(fileKey(data))
    const effectiveQuality = perFileQuality ?? (engineId === 'image' ? imageQuality : quality)
    const estimateQuality = engineId === 'image' ? effectiveQuality : 80
    const estimatedSize = targetFormat && ext ? estimateOutputSize(data.size, ext, targetFormat, estimateQuality, conversionRatios) : null
    const learned = ext && targetFormat ? isLearnedEstimate(ext, targetFormat, conversionRatios) : false

    const LOSSLESS_EXTS = new Set(['png', 'tiff', 'tif', 'gif', 'bmp', 'svg'])
    const LOSSY_FORMATS = new Set(['jpg', 'jpeg', 'webp', 'avif'])
    const isLosslessSource = ext ? LOSSLESS_EXTS.has(ext.toLowerCase()) : false
    const isLossyTarget = targetFormat ? LOSSY_FORMATS.has(targetFormat.toLowerCase()) : false
    const isWebpLossless = targetFormat === 'webp' && effectiveQuality >= 100
    const sizeIncreaseWarning = isLosslessSource && isLossyTarget && !isWebpLossless && effectiveQuality >= 90 && estimatedSize !== null && estimatedSize >= data.size

    const handleConvertSingle = () => convertSingle(data, {
        quality, imageQuality, fileSettings, convertedFiles, convertingFiles: convertingFilesMap, startConversion, setConvertedFile, setFailedFile, markFileConverting, unmarkFileConverting, removeFile, plan, onConversionSuccess, onBatchComplete, onPlanExhausted,
        onNavigateToPricing: () => navigate('/pricing'),
    })

    const handleEditInEditor = () => {
        setPendingEditorFile(data)
        navigate('/extensions/image-editor')
    }

    if (isDone) return null;

    return (
        <div className={`flex items-center justify-start p-4 xl:p-5 rounded-2xl border bg-secondary/30 ${failedError ? 'border-destructive/40 bg-destructive/5' : isConverting ? 'border-primary/40 bg-primary/5' : 'border-accent'}`}>
            <Badge variant={'secondary'} className="shrink-0 uppercase h-10 w-10 xl:h-11 xl:w-11 2xl:h-12 2xl:w-12 rounded-sm mr-2 xl:mr-3" style={colorStyle}>
                {ext}
            </Badge>
            <div className="flex flex-col min-w-0 flex-1">
                <h3 className="text-sm xl:text-base font-normal text-accent-foreground font-body truncate">{data.name}</h3>
                {failedError
                    ? <p className="text-xs xl:text-sm font-normal text-destructive">{failedError}</p>
                    : <p className="text-xs xl:text-sm font-normal text-accent-foreground/50">
                        {formatBytes(data.size)}
                        {estimatedSize !== null && (
                            <Tooltip>
                                <TooltipTrigger className="ml-1.5 cursor-default">
                                    → <span className={estimatedSize < data.size ? 'text-green-500' : 'text-yellow-500'}>~{formatBytes(estimatedSize)}</span>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p className="text-sm">
                                        {sizeIncreaseWarning
                                            ? `Quality ${effectiveQuality}% is near-lossless on a lossless source - lower quality for a smaller file`
                                            : learned
                                                ? 'Estimated from your previous conversions'
                                                : 'Rough estimate - improves as you convert'
                                        }
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </p>
                }
            </div>
            <div className="flex-1 flex justify-center">
                {isConverting
                    ? <Loader2 className="size-5 xl:size-6 text-primary animate-spin" />
                    : <MoveRight size={24} className="stroke-accent xl:size-7" />
                }
            </div>
            <div className="flex items-center gap-2 shrink-0 justify-end min-w-70.5 xl:min-w-77 2xl:min-w-84">
                <Combobox value={targetFormat} onValueChange={(v) => {
                    if (!v || isConverting) return
                    const locked = plan === 'limited' && engineId ? isFormatLocked(engineId, v) : false
                    if (!locked) setTargetFormat(data, v)
                }} items={convertTo}>
                    <ComboboxInput className={`w-24! h-10! xl:w-26! xl:h-11! 2xl:w-28! [&_input]:uppercase! [&_input]:select-none! ${isConverting ? 'opacity-50 pointer-events-none' : ''}`} readOnly />
                    <ComboboxContent>
                        <ComboboxList>
                            {(item) => {
                                const locked = plan === 'limited' && engineId ? isFormatLocked(engineId, item) : false
                                return (
                                    <ComboboxItem
                                        className={`uppercase ${locked ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
                                        key={item}
                                        value={item}
                                    >
                                        <span className="flex-1">{item}</span>
                                        {locked && <Lock className="size-3 shrink-0" />}
                                    </ComboboxItem>
                                )
                            }}
                        </ComboboxList>
                    </ComboboxContent>
                </Combobox>
                <Tooltip>
                    <TooltipTrigger>
                        <span className={isConverting ? 'pointer-events-none opacity-50' : ''}>
                            <FileSettingsDialog file={data} />
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p className="text-sm xl:text-base font-light text-accent">File Settings</p>
                    </TooltipContent>
                </Tooltip>
                {isImage && (
                    <Tooltip>
                        <TooltipTrigger>
                            <Button variant={'secondary'} className={'group p-2.5! h-full!'} disabled={isConverting} onClick={handleEditInEditor}>
                                <Pencil className="size-4 xl:size-5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="text-sm xl:text-base font-light text-accent">Edit in Image Editor</p>
                        </TooltipContent>
                    </Tooltip>
                )}
                <Tooltip>
                    <TooltipTrigger>
                        <Button variant={'secondary'} className={'group p-2.5! h-full!'} disabled={isConverting} onClick={handleConvertSingle}>
                            <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5 size-5 xl:size-6" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p className="text-sm xl:text-base font-light text-accent">Convert Single</p>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger>
                        <Button
                            variant={failedError ? 'destructive' : 'ghost'}
                            size="icon"
                            className="shrink-0 xl:size-10"
                            disabled={isConverting}
                            onClick={() => removeFile(data)}
                        >
                            <X className="size-4 xl:size-5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p className="text-sm xl:text-base font-light text-accent">Remove</p>
                    </TooltipContent>
                </Tooltip>
            </div>
        </div>
    )
}
