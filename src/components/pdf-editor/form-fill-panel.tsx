import { useState, useEffect } from 'react'
import { Loader2, AlertCircle, Save, Check, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { usePdfSaveMeter } from '@/lib/usePdfSaveMeter'
import type { PdfFile } from '@/pages/pdf-editor'

type FormField = { name: string; type: string; value: string | null }

export default function FormFillPanel({ file }: { file: PdfFile }) {
  const [fields, setFields] = useState<FormField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const { reserveEditorSave, markEditorSaved, onSaved } = usePdfSaveMeter()

  useEffect(() => {
    setLoading(true)
    setError(null)
    window.electron.pdfEditorGetFormFields(file.path).then(result => {
      setLoading(false)
      if (!result.success) { setError(result.error ?? 'Failed to read form fields'); return }
      setFields(result.fields)
      const initial: Record<string, string> = {}
      for (const f of result.fields) initial[f.name] = f.value ?? ''
      setValues(initial)
    })
  }, [file.path])

  function setValue(name: string, val: string) {
    setValues(prev => ({ ...prev, [name]: val }))
    setDone(false)
  }

  async function save() {
    // Reserve up front: 5 for the first save of this document, 2 for a re-save.
    const refund = reserveEditorSave()
    if (!refund) return
    setSaving(true)
    setSaveError(null)
    setDone(false)

    const fieldPayload = fields.map(f => ({ name: f.name, type: f.type, value: values[f.name] ?? '' }))
    const result = await window.electron.pdfEditorFillForms({ filePath: file.path, fields: fieldPayload })
    if (!result.success) {
      refund()
      setSaveError(result.error ?? 'Failed to fill form')
      setSaving(false)
      return
    }

    const saved = await window.electron.pdfEditorSave()
    setSaving(false)
    if (!saved.canceled) { onSaved(); markEditorSaved(); setDone(true) }
    else refund()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">Reading form fields…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 flex items-center gap-3">
        <AlertCircle className="size-5 text-destructive shrink-0" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="size-14 rounded-full bg-muted flex items-center justify-center">
          <FileText className="size-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">No form fields found</p>
        <p className="text-xs text-muted-foreground max-w-xs">This PDF doesn't contain any fillable form fields. Only PDFs with AcroForm fields can be filled.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <p className="text-sm text-muted-foreground">{fields.length} field{fields.length !== 1 ? 's' : ''} found</p>

      <div className="flex flex-col gap-4">
        {fields.map(field => (
          <div key={field.name} className="flex flex-col gap-1.5">
            <Label htmlFor={`field-${field.name}`} className="flex items-center gap-2">
              <span className="truncate">{field.name}</span>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">{field.type}</span>
            </Label>

            {field.type === 'checkbox' ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`field-${field.name}`}
                  checked={values[field.name] === 'true'}
                  onCheckedChange={(checked) => setValue(field.name, checked ? 'true' : 'false')}
                />
                <span className="text-sm text-muted-foreground">{values[field.name] === 'true' ? 'Checked' : 'Unchecked'}</span>
              </div>
            ) : field.type === 'dropdown' ? (
              <Input
                id={`field-${field.name}`}
                value={values[field.name] ?? ''}
                onChange={e => setValue(field.name, e.target.value)}
                placeholder="Enter value…"
              />
            ) : (
              <Input
                id={`field-${field.name}`}
                value={values[field.name] ?? ''}
                onChange={e => setValue(field.name, e.target.value)}
                placeholder="Enter value…"
              />
            )}
          </div>
        ))}
      </div>

      {saveError && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="size-4 shrink-0" /> {saveError}
        </div>
      )}

      <Button
        onClick={save}
        disabled={saving}
        className="gap-2 cursor-pointer self-start"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : done ? <Check className="size-4" /> : <Save className="size-4" />}
        {saving ? 'Saving…' : done ? 'Saved!' : 'Fill & Save'}
      </Button>
    </div>
  )
}
