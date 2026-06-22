import { useAuth } from '@/lib/useAuth'
import { useConversionCountContext } from '@/lib/ConversionCountContext'
import { spendTokens } from '@/lib/useConversionCount'
import { toast } from 'sonner'

// Metering for PDF saves, billed as a `document` operation: 5 tokens for the first save of a
// document, 2 for every later save of that same document (a "re-save"). We reserve up front
// (so we can block before doing any work) and refund if the op fails or the user cancels the
// save dialog - mirroring the homepage converter. Paid plans are ungated (spendTokens just
// counts), so saves never block.

// Whether the currently-open EDITOR document has been saved at least once this session. First
// save = 5 (producing the output), every save after = 2, regardless of how much was edited in
// between. Reset when a new file is opened (pdf-editor.tsx). Module-level singleton - the
// editor is single-file / single-window, like the main-process editorBuffer it mirrors.
let editorSavedOnce = false
export function resetEditorSaveSession() { editorSavedOnce = false }

const NEW_DOC_COST = 5
const RESAVE_COST = 2

export function usePdfSaveMeter() {
    const { plan } = useAuth()
    const { onConversionSuccess } = useConversionCountContext()

    // Reserve a document token. Returns the refund fn, or null if the budget can't cover it
    // (a toast is shown).
    function reserve(cost: number): (() => void) | null {
        const [refund, reserved] = spendTokens('document', plan, cost)
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
        // Merge: pass the cost directly (5 for a fresh merge, 2 for "Save again").
        reserve,
        // Editor: 5 for the first save of the open document, 2 for each subsequent save.
        reserveEditorSave() { return reserve(editorSavedOnce ? RESAVE_COST : NEW_DOC_COST) },
        // Mark the open editor document as saved so later saves bill as re-saves (2).
        markEditorSaved() { editorSavedOnce = true },
        // Call once the file is actually written (triggers server sync + exhaustion flip).
        onSaved() { onConversionSuccess('document') },
    }
}
