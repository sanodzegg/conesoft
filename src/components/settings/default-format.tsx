import { useConvertStore } from '@/store/useConvertStore'
import { useAuth } from '@/lib/useAuth'
import { imageEngine } from '@/engines/imageEngine'
import { documentEngine } from '@/engines/documentEngine'
import { videoEngine } from '@/engines/videoEngine'
import { isFormatLocked } from '@/engines/engineRegistry'
import {
    Combobox,
    ComboboxInput,
    ComboboxContent,
    ComboboxList,
    ComboboxItem,
} from '@/components/ui/combobox'
import { Lock } from 'lucide-react'

interface FormatPickerProps {
    label: string
    description: string
    value: string
    formats: string[]
    engineId: string
    limited: boolean
    onChange: (v: string) => void
}

function FormatPicker({ label, description, value, formats, engineId, limited, onChange }: FormatPickerProps) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <p className="text-sm xl:text-base font-medium text-primary">{label}</p>
                <p className="text-xs xl:text-sm text-muted-foreground mt-0.5">{description}</p>
            </div>
            <Combobox value={value} onValueChange={(v) => {
                if (!v) return
                const locked = limited ? isFormatLocked(engineId, v) : false
                if (!locked) onChange(v)
            }} items={formats} filter={null}>
                <ComboboxInput className={'w-28! h-9! xl:w-30! xl:h-10! 2xl:w-32! [&_input]:uppercase! [&_input]:select-none!'} readOnly />
                <ComboboxContent>
                    <ComboboxList>
                        {(item) => {
                            const locked = limited ? isFormatLocked(engineId, item) : false
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
        </div>
    )
}

export default function DefaultFormat() {
    const defaultImageFormat = useConvertStore(s => s.defaultImageFormat)
    const defaultDocumentFormat = useConvertStore(s => s.defaultDocumentFormat)
    const defaultVideoFormat = useConvertStore(s => s.defaultVideoFormat)
    const setDefaultImageFormat = useConvertStore(s => s.setDefaultImageFormat)
    const setDefaultDocumentFormat = useConvertStore(s => s.setDefaultDocumentFormat)
    const setDefaultVideoFormat = useConvertStore(s => s.setDefaultVideoFormat)
    const { plan } = useAuth()
    const limited = plan === 'limited'

    return (
        <div className="p-5 xl:p-6 rounded-2xl border border-accent bg-secondary/30 space-y-5 xl:space-y-6">
            <div>
                <p className="text-sm xl:text-base font-medium text-primary">Default Output Format</p>
                <p className="text-xs xl:text-sm text-muted-foreground mt-0.5">Format applied to newly added files.</p>
            </div>
            <div className="space-y-4 xl:space-y-5">
                <FormatPicker
                    label="Images"
                    description="JPG, PNG, WEBP, AVIF..."
                    value={defaultImageFormat}
                    formats={imageEngine.outputFormats}
                    engineId="image"
                    limited={limited}
                    onChange={setDefaultImageFormat}
                />
                <FormatPicker
                    label="Documents"
                    description="PDF, DOCX, TXT..."
                    value={defaultDocumentFormat}
                    formats={documentEngine.outputFormats}
                    engineId="document"
                    limited={limited}
                    onChange={setDefaultDocumentFormat}
                />
                <FormatPicker
                    label="Videos"
                    description="MP4, MOV, AVI, MKV..."
                    value={defaultVideoFormat}
                    formats={videoEngine.outputFormats}
                    engineId="video"
                    limited={limited}
                    onChange={setDefaultVideoFormat}
                />
            </div>
        </div>
    )
}
