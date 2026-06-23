import { useState, useEffect, lazy } from "react"
import { Info } from "lucide-react"
import EditorDropzone from "@/components/image-editor/editor-dropzone"

const CropEditor = lazy(() => import("@/components/image-editor/crop-editor"))
import { useConvertStore } from "@/store/useConvertStore"
import { useAuth } from "@/lib/useAuth"
import { isPaidPlan } from "@/store/useAuthStore"

export default function ImageEditor() {
    const [file, setFile] = useState<File | null>(null)
    const pendingEditorFile = useConvertStore(s => s.pendingEditorFile)
    const setPendingEditorFile = useConvertStore(s => s.setPendingEditorFile)
    const { plan } = useAuth()
    const metered = !isPaidPlan(plan)

    useEffect(() => {
        if (pendingEditorFile) {
            setFile(pendingEditorFile)
            setPendingEditorFile(null)
        }
    }, [pendingEditorFile, setPendingEditorFile])

    return (
        <section className="section py-8">
            <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-body font-semibold text-foreground">Image Editor</h2>
                    <p className="text-sm text-muted-foreground mt-1">Crop, adjust, annotate, and export your image.</p>
                </div>
                {metered && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs shrink-0">
                        <Info className="size-4 text-primary shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                            Each export costs <span className="font-medium text-foreground">1 token</span>. Editing and preview are free.
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
