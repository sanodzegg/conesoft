import File from "./file"
import { Button } from "../ui/button"
import { useConvertStore } from "@/store/useConvertStore"
import { fileKey } from "@/utils/fileUtils"
import { convertAll } from "@/services/conversionService"
import { useConversionCountContext } from "@/lib/ConversionCountContext"
import { useAuth } from "@/lib/useAuth"
import { useNavigate } from "react-router-dom"
import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

const ITEM_HEIGHT = 82
const ITEM_GAP = 10
const VIRTUALIZE_THRESHOLD = 20
const LIST_HEIGHT = 560

export default function FileList() {
    const { files, fileSettings, quality, imageQuality, convertedCount, convertingTotal, convertingFiles, convertedFiles, failedFiles, setConvertedFile, setFailedFile, markFileConverting, unmarkFileConverting, startConversion, removeFile } = useConvertStore()
    const { onConversionSuccess, onBatchComplete, onPlanExhausted } = useConversionCountContext()
    const { plan } = useAuth()
    const navigate = useNavigate()
    const scrollRef = useRef<HTMLDivElement>(null)

    const failedCount = Object.keys(failedFiles).length
    const isConverting = convertingFiles.size > 0 || (convertingTotal > 0 && (convertedCount + failedCount) < convertingTotal)
    const allDone = files.length > 0 && files.every(f => !!convertedFiles[fileKey(f)])

    const virtualizer = useVirtualizer({
        count: files.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ITEM_HEIGHT + ITEM_GAP,
        overscan: 5,
        enabled: files.length >= VIRTUALIZE_THRESHOLD,
    })

    const handleConvertAll = async () => {
        await convertAll(files, {
            quality,
            imageQuality,
            fileSettings,
            convertedFiles,
            convertingFiles,
            startConversion,
            setConvertedFile,
            setFailedFile,
            markFileConverting,
            unmarkFileConverting,
            removeFile,
            plan,
            onConversionSuccess,
            onBatchComplete,
            onPlanExhausted,
            onNavigateToPricing: () => navigate('/pricing'),
        })
    }

    if (files.length === 0 || allDone) return null

    const useVirtual = files.length >= VIRTUALIZE_THRESHOLD

    return (
        <section className="py-6 xl:py-7 2xl:py-8">
            <div className="mb-6 xl:mb-7 2xl:mb-8 flex items-center justify-between">
                <h3 className="font-medium text-primary/60 font-body text-base xl:text-lg">Added ({files.length})</h3>
                <Button onClick={handleConvertAll} disabled={isConverting} variant={'secondary'} className={'font-normal xl:text-base xl:h-10 xl:px-5'}>
                    Convert All
                </Button>
            </div>
            {useVirtual ? (
                <div ref={scrollRef} style={{ height: LIST_HEIGHT, overflowY: 'auto', scrollbarWidth: 'none' }}>
                    <ul style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                        {virtualizer.getVirtualItems().map((row) => {
                            const file = files[row.index]
                            return (
                                <li
                                    key={`${file.lastModified}${row.index}${file.size}`}
                                    style={{
                                        position: 'absolute',
                                        top: row.start,
                                        left: 0,
                                        right: 0,
                                        paddingBottom: ITEM_GAP,
                                    }}
                                >
                                    <File data={file} />
                                </li>
                            )
                        })}
                    </ul>
                </div>
            ) : (
                <ul className="space-y-2.5 xl:space-y-3">
                    {files.map((file, i) => (
                        <li key={`${file.lastModified}${i}${file.size}`}>
                            <File data={file} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}
