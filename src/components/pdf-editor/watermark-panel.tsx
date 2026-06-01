import { useState } from 'react'
import { Type, ImageIcon, Loader2, Check, AlertCircle, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import type { PdfFile } from '@/pages/pdf-editor'

type WatermarkType = 'text' | 'image'

const ROTATIONS = [0, 45, 90, 315]

export default function WatermarkPanel({ file }: { file: PdfFile }) {
  const [type, setType] = useState<WatermarkType>('text')
  const [text, setText] = useState('CONFIDENTIAL')
  const [color, setColor] = useState('#000000')
  const [fontSize, setFontSize] = useState(48)
  const [opacity, setOpacity] = useState(30)
  const [rotation, setRotation] = useState(45)
  const [pages, setPages] = useState<'all' | string>('all')
  const [imageBytes, setImageBytes] = useState<number[] | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [scale, setScale] = useState(30)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function parsePages(): 'all' | number[] {
    if (pages === 'all' || pages.trim() === '') return 'all'
    const nums = pages.split(',').map(s => parseInt(s.trim()) - 1).filter(n => !isNaN(n) && n >= 0)
    return nums.length > 0 ? nums : 'all'
  }

  async function pickImage() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const buf = await file.arrayBuffer()
      setImageBytes(Array.from(new Uint8Array(buf)))
      setImagePreview(URL.createObjectURL(file))
    }
    input.click()
  }

  async function apply() {
    setApplying(true)
    setError(null)
    setDone(false)

    const watermark: Parameters<typeof window.electron.pdfEditorWatermark>[0]['watermark'] = {
      type,
      pages: parsePages(),
      opacity,
      ...(type === 'text' ? { text, color, fontSize, rotation } : { imageBytes: imageBytes!, scale }),
    }

    const result = await window.electron.pdfEditorWatermark({ filePath: file.path, watermark })
    if (!result.success) {
      setError(result.error ?? 'Failed to apply watermark')
      setApplying(false)
      return
    }

    const saved = await window.electron.pdfEditorSave()
    setApplying(false)
    if (!saved.canceled) setDone(true)
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      {/* Type toggle */}
      <div className="flex flex-col gap-2">
        <Label>Watermark type</Label>
        <div className="flex rounded-lg border border-border overflow-hidden self-start">
          {(['text', 'image'] as WatermarkType[]).map(t => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors cursor-pointer',
                type === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
              )}
            >
              {t === 'text' ? <Type className="size-3.5" /> : <ImageIcon className="size-3.5" />}
              {t === 'text' ? 'Text' : 'Image'}
            </button>
          ))}
        </div>
      </div>

      {type === 'text' ? (
        <>
          {/* Text */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="wm-text">Text</Label>
            <Input id="wm-text" value={text} onChange={e => setText(e.target.value)} placeholder="CONFIDENTIAL" />
          </div>

          {/* Color + Font size */}
          <div className="flex gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="wm-color">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  id="wm-color"
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="size-9 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                />
                <span className="text-sm text-muted-foreground font-mono">{color}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 flex-1">
              <Label>Font size — {fontSize}px</Label>
              <Slider
                value={[fontSize]}
                min={12}
                max={120}
                step={2}
                onValueChange={(v) => setFontSize(Array.isArray(v) ? v[0] : v)}
              />
            </div>
          </div>

          {/* Rotation */}
          <div className="flex flex-col gap-2">
            <Label>Rotation</Label>
            <div className="flex gap-2">
              {ROTATIONS.map(r => (
                <button
                  key={r}
                  onClick={() => setRotation(r)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer',
                    rotation === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  {r}°
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Image picker */}
          <div className="flex flex-col gap-2">
            <Label>Image</Label>
            {imagePreview ? (
              <div className="flex items-center gap-3">
                <img src={imagePreview} className="size-16 rounded-lg object-contain border border-border bg-muted" />
                <button onClick={pickImage} className="text-sm text-primary hover:underline cursor-pointer">Change image</button>
              </div>
            ) : (
              <button
                onClick={pickImage}
                className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-6 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors cursor-pointer"
              >
                <ImageIcon className="size-4" />
                Click to pick PNG or JPG
              </button>
            )}
          </div>

          {/* Scale */}
          <div className="flex flex-col gap-2">
            <Label>Scale — {scale}%</Label>
            <Slider value={[scale]} min={5} max={100} step={5} onValueChange={(v) => setScale(Array.isArray(v) ? v[0] : v)} />
          </div>
        </>
      )}

      {/* Opacity (shared) */}
      <div className="flex flex-col gap-2">
        <Label>Opacity — {opacity}%</Label>
        <Slider value={[opacity]} min={5} max={100} step={5} onValueChange={(v) => setOpacity(Array.isArray(v) ? v[0] : v)} />
      </div>

      {/* Pages */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="wm-pages">Apply to pages</Label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPages('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer',
              pages === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            All pages
          </button>
          <Input
            id="wm-pages"
            placeholder="e.g. 1, 3, 5"
            value={pages === 'all' ? '' : pages}
            onFocus={() => { if (pages === 'all') setPages('') }}
            onChange={e => setPages(e.target.value)}
            className="flex-1"
          />
        </div>
        <p className="text-xs text-muted-foreground">Leave blank or click "All pages" to apply to every page.</p>
      </div>

      {/* Apply */}
      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </div>
      )}
      <Button
        onClick={apply}
        disabled={applying || (type === 'text' && !text.trim()) || (type === 'image' && !imageBytes)}
        className="gap-2 cursor-pointer self-start"
      >
        {applying ? <Loader2 className="size-4 animate-spin" /> : done ? <Check className="size-4 text-green-500" /> : <Save className="size-4" />}
        {applying ? 'Applying…' : done ? 'Saved!' : 'Apply & Save'}
      </Button>
    </div>
  )
}
