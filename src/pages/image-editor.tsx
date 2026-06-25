import { useState, useEffect, lazy } from "react"
import { Info } from "lucide-react"
import EditorDropzone from "@/components/image-editor/editor-dropzone"

const CropEditor = lazy(() => import("@/components/image-editor/crop-editor"))
import { useConvertStore } from "@/store/useConvertStore"
import { useAuth } from "@/lib/useAuth"
import { isPaidPlan } from "@/store/useAuthStore"
import { imageToolCost } from "@/lib/useConversionCount"

export default function ImageEditor() {
    const [file, setFile] = useState<File | null>(null)
    const pendingEditorFile = useConvertStore(s => s.pendingEditorFile)
    const setPendingEditorFile = useConvertStore(s => s.setPendingEditorFile)
    const { plan } = useAuth()
    const metered = !isPaidPlan(plan)
    const cost = imageToolCost(plan)

    useEffect(() => {
        if (pendingEditorFile) {
            setFile(pendingEditorFile)
            setPendingEditorFile(null)
        }
    }, [pendingEditorFile, setPendingEditorFile])

    return (
        <section className="section py-8 xl:py-10 2xl:py-12">
            <div className="mb-6 xl:mb-7 2xl:mb-8 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">Image Editor</h2>
                    <p className="text-sm xl:text-base text-muted-foreground mt-1">Crop, adjust, annotate, and export your image.</p>
                </div>
                {metered && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs shrink-0">
                        <Info className="size-4 xl:size-5 text-primary shrink-0 mt-0.5" />
                        <p className="text-xs xl:text-sm text-muted-foreground">
                            Each export costs <span className="font-medium text-foreground">{cost} token{cost === 1 ? '' : 's'}</span>. Editing and preview are free.
                        </p>
                    </div>
                )}
            </div>

            {file
                ? <CropEditor file={file} onReset={() => setFile(null)} />
                : <EditorDropzone onFile={setFile} />
            }
        </section>
    )
}
