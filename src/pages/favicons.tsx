import { useState, lazy } from "react"
import { Info } from "lucide-react"
import FaviconDropzone from "@/components/favicons/favicon-dropzone"
import type { FaviconResult } from "@/components/favicons/favicon-results"

const FaviconResults = lazy(() => import("@/components/favicons/favicon-results"))
import { useAuth } from "@/lib/useAuth"
import { isPaidPlan } from "@/store/useAuthStore"
import { isAtLimit, imageToolCost } from "@/lib/useConversionCount"

type State =
    | { status: 'idle' }
    | { status: 'converting' }
    | { status: 'done'; result: FaviconResult; file: File }
    | { status: 'error'; message: string }

export default function FaviconConversion() {
    const [state, setState] = useState<State>({ status: 'idle' })
    const { plan } = useAuth()
    const cost = imageToolCost(plan)
    const atLimit = isAtLimit('image', plan, cost)
    const metered = !isPaidPlan(plan)

    const handleFile = async (file: File) => {
        // Generating the set is free (it's just a preview); the single image token is charged
        // on the first actual download in FaviconResults, so a canceled save costs nothing.
        setState({ status: 'converting' })
        try {
            const buffer = await file.arrayBuffer()
            const raw = await window.electron.convertFavicon(buffer)
            const result: FaviconResult = {
                ico: raw.ico,
                pngs: raw.pngs,
            }
            setState({ status: 'done', result, file })
        } catch (e) {
            setState({ status: 'error', message: e instanceof Error ? e.message : 'Conversion failed' })
        }
    }

    const reset = () => setState({ status: 'idle' })

    return (
        <section className="section py-8 xl:py-10 2xl:py-12">
            <div className="mb-6 xl:mb-7 2xl:mb-8 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">Favicon Generator</h2>
                    <p className="text-sm xl:text-base text-muted-foreground mt-1">
                        Upload any image and get the complete icon set - .ico, PNGs from 16 to 1024px, and macOS .icns.
                    </p>
                </div>
                {metered && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs shrink-0">
                        <Info className="size-4 xl:size-5 text-primary shrink-0 mt-0.5" />
                        <p className="text-xs xl:text-sm text-muted-foreground">
                            Each icon set costs <span className="font-medium text-foreground">{cost} token{cost === 1 ? '' : 's'}</span>, charged on your first download.
                        </p>
                    </div>
                )}
            </div>

            {state.status === 'idle' && (
                <FaviconDropzone onFile={handleFile} atLimit={atLimit} />
            )}

            {state.status === 'converting' && (
                <div className="flex flex-col items-center justify-center h-72 xl:h-80 2xl:h-90 border border-border rounded-3xl border-dashed gap-4 xl:gap-5">
                    <div className="size-10 xl:size-11 2xl:size-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    <p className="text-sm xl:text-base text-muted-foreground">Generating icons…</p>
                </div>
            )}

            {state.status === 'error' && (
                <div className="flex flex-col items-center justify-center h-72 xl:h-80 2xl:h-90 border border-destructive/40 bg-destructive/5 rounded-3xl gap-3">
                    <p className="text-sm xl:text-base text-destructive">{state.message}</p>
                    <button onClick={reset} className="text-xs xl:text-sm text-muted-foreground underline underline-offset-2">Try again</button>
                </div>
            )}

            {state.status === 'done' && (
                <FaviconResults result={state.result} sourceFile={state.file} onReset={reset} />
            )}
        </section>
    )
}
