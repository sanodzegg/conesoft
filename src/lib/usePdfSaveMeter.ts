import { useAuth } from '@/lib/useAuth'
import { useConversionCountContext } from '@/lib/ConversionCountContext'
import { spendTokens } from '@/lib/useConversionCount'
import { toast } from 'sonner'

// Metering for PDF saves, billed as a `document` operation: 5 tokens for the first save of a
// document, 2 for every later save of that same document (a "re-save"). We reserve up front
// (so we can block before doing any work) and refund if the op fails or the user cancels the
// save dialog - mirroring the homepage converter. Paid plans are ungated (spendTokens just
// counts), so saves never block.

// Whether the current EDITOR / MERGE document has been saved at least once this session. First
// save = 5 (producing the output), every save after = 2, regardless of how much was edited or
// re-merged in between. Reset on a clear new-document boundary: the editor resets when a file is
// opened/closed (pdf-editor.tsx); merge resets when the page mounts or Reset is clicked
// (pdf-merge.tsx). Separate flags so the two tools don't affect each other's pricing.
// Module-level singletons - each tool is single-document / single-window.
let editorSavedOnce = false
let mergeSavedOnce = false
let imagesToPdfSavedOnce = false
let pdfToImagesSavedOnce = false
let splitSavedOnce = false
let compressSavedOnce = false
export function resetEditorSaveSession() { editorSavedOnce = false }
export function resetMergeSaveSession() { mergeSavedOnce = false }
export function resetImagesToPdfSaveSession() { imagesToPdfSavedOnce = false }
export function resetPdfToImagesSaveSession() { pdfToImagesSavedOnce = false }
export function resetSplitSaveSession() { splitSavedOnce = false }
export function resetCompressSaveSession() { compressSavedOnce = false }

const NEW_DOC_COST = 5
const RESAVE_COST = 2

export function usePdfSaveMeter() {
    const { plan } = useAuth()
    const { onConversionSuccess } = useConversionCountContext()

    // Reserve a document token. Returns the refund fn, or null if the budget can't cover it
    // (a toast is shown).
    function reserve(cost: number): (() => void) | null {
        // countCategory:false - PDF saves spend tokens but don't bump the per-category
        // "Documents" analytics count; that tally is for actual document conversions only.
        const [refund, reserved] = spendTokens('document', plan, { cost, countCategory: false })
        if (!reserved) {
            toast.error('PDF limit reached', {
                description: 'Upgrade to Pro to keep saving PDFs.',
                duration: 5000,
            })
            return null
        }
        return refund
    }

    return {
        // 5 for the first save of the document this session, 2 for each subsequent save.
        reserveEditorSave() { return reserve(editorSavedOnce ? RESAVE_COST : NEW_DOC_COST) },
        reserveMergeSave() { return reserve(mergeSavedOnce ? RESAVE_COST : NEW_DOC_COST) },
        reserveImagesToPdfSave() { return reserve(imagesToPdfSavedOnce ? RESAVE_COST : NEW_DOC_COST) },
        reservePdfToImagesSave() { return reserve(pdfToImagesSavedOnce ? RESAVE_COST : NEW_DOC_COST) },
        reserveSplitSave() { return reserve(splitSavedOnce ? RESAVE_COST : NEW_DOC_COST) },
        reserveCompressSave() { return reserve(compressSavedOnce ? RESAVE_COST : NEW_DOC_COST) },
        // Mark the document saved so later saves this session bill as re-saves (2).
        markEditorSaved() { editorSavedOnce = true },
        markMergeSaved() { mergeSavedOnce = true },
        markImagesToPdfSaved() { imagesToPdfSavedOnce = true },
        markPdfToImagesSaved() { pdfToImagesSavedOnce = true },
        markSplitSaved() { splitSavedOnce = true },
        markCompressSaved() { compressSavedOnce = true },
        // Call once the file is actually written (triggers server sync + exhaustion flip).
        onSaved() { onConversionSuccess('document') },
    }
}
