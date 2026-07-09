import { useState, useMemo, useEffect, useCallback, lazy } from 'react'
import { RotateCcw, Check, Copy, Download, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem } from '@/components/ui/combobox'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/useAuth'
import { isPaidPlan } from '@/store/useAuthStore'
import { spendTokens, imageToolCost } from '@/lib/useConversionCount'
import { useConversionCountContext } from '@/lib/ConversionCountContext'
import SvgDropzone from '@/components/svg-editor/svg-dropzone'
import {
    optimizeSvg, prettifySvg, extractMeta,
    toBase64Uri, toEncodedUri, toMinifiedUri,
    byteSize, toCodeSnippet, CODE_FORMAT_OPTIONS, type CodeFormat,
    injectColorIdx, getElementColor, patchElementColor,
} from '@/components/svg-editor/svg-utils'
import { ColorPicker } from '@/components/ui/color-picker'

const SvgCodeEditor = lazy(() => import('@/components/svg-editor/SvgCodeEditor').then(m => ({ default: m.SvgCodeEditor })))

type Tab = 'preview' | 'code' | 'data-uri'

const BG_OPTIONS = [
    { label: 'Transparent', value: 'transparent', class: 'bg-[repeating-conic-gradient(#808080_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]' },
    { label: 'White', value: 'white', class: 'bg-white' },
    { label: 'Black', value: 'black', class: 'bg-black' },
    { label: 'Gray', value: 'gray', class: 'bg-zinc-800' },
]

function preparePreview(code: string, selectedIdx: number | null = null): string {
    const indexed = injectColorIdx(code, selectedIdx)
    return indexed
        .replace(/<\?xml[\s\S]*?\?>\s*/gi, '')
        .replace(/<!--[\s\S]*?-->\s*/g, '')
        .replace(/<svg([\s\S]*?)>/i, (_, attrs) => {
            const cleaned = attrs
                .replace(/\s*\bwidth="[^"]*"/gi, '')
                .replace(/\s*\bheight="[^"]*"/gi, '')
                .replace(/\s*\bpreserveAspectRatio="[^"]*"/gi, '')
            return `<svg${cleaned} preserveAspectRatio="xMidYMid meet">`
        })
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    const copy = () => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }
    return (
        <Button variant="ghost" size="icon" className="h-7 w-7 xl:h-8 xl:w-8 shrink-0" onClick={copy}>
            {copied ? <Check className="size-3.5 xl:size-4 text-primary" /> : <Copy className="size-3.5 xl:size-4" />}
        </Button>
    )
}

function DataUriRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
                <span className="text-xs xl:text-sm font-medium text-foreground">{label}</span>
                <div className="flex items-center gap-2">
                    <span className="text-xs xl:text-sm text-muted-foreground">{byteSize(value)}</span>
                    <CopyButton text={value} />
                </div>
            </div>
            <div className="pointer-events-none rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-xs xl:text-sm text-muted-foreground break-all line-clamp-3 select-all">
                {value}
            </div>
        </div>
    )
}

export default function SvgEditor() {
    const [code, setCode] = useState<string | null>(null)
    const [tab, setTab] = useState<Tab>('preview')
    const [bg, setBg] = useState('white')
    const [codeFormat, setCodeFormat] = useState<CodeFormat>('SVG')
    const [optimizedCode, setOptimizedCode] = useState('')
    const [savings, setSavings] = useState(0)
    const [displayCode, setDisplayCode] = useState('')
    const [minifiedUri, setMinifiedUri] = useState('')
    const [selectedColorIdx, setSelectedColorIdx] = useState<number | null>(null)
    const { plan } = useAuth()
    const cost = imageToolCost(plan)
    const { onConversionSuccess } = useConversionCountContext()
    const metered = !isPaidPlan(plan)

    const activeCode = code ?? ''


    useEffect(() => {
        if (!code) { setOptimizedCode(''); setSavings(0); return }
        optimizeSvg(code).then(opt => {
            setOptimizedCode(opt)
            const before = new TextEncoder().encode(code).length
            const after = new TextEncoder().encode(opt).length
            setSavings(before === 0 ? 0 : Math.round((1 - after / before) * 100))
        })
    }, [code])

    useEffect(() => {
        toCodeSnippet(activeCode, codeFormat).then(setDisplayCode)
    }, [activeCode, codeFormat])

    useEffect(() => {
        if (tab !== 'data-uri') return
        toMinifiedUri(activeCode).then(setMinifiedUri)
    }, [activeCode, tab])

    // Deselect when tab switches away from preview
    useEffect(() => {
        if (tab !== 'preview') setSelectedColorIdx(null)
    }, [tab])

    // Deselect when clicking outside the preview+picker area
    useEffect(() => {
        if (selectedColorIdx === null) return
        function handlePointerDown(e: PointerEvent) {
            const target = e.target as Element
            // Allow clicks inside the color picker popover (portalled to body)
            if (target.closest('.svg-color-pick') || target.closest('[data-color-picker]')) return
            setSelectedColorIdx(null)
        }
        document.addEventListener('pointerdown', handlePointerDown)
        return () => document.removeEventListener('pointerdown', handlePointerDown)
    }, [selectedColorIdx])

    const previewHtml = useMemo(() => preparePreview(activeCode, selectedColorIdx), [activeCode, selectedColorIdx])
    const bgClass = BG_OPTIONS.find(b => b.value === bg)?.class ?? 'bg-white'
    const meta = useMemo(() => extractMeta(activeCode), [activeCode])
    const fileSize = useMemo(() => byteSize(activeCode), [activeCode])

    // Deselect element when code changes externally (e.g. Optimize, Prettify)
    // but not when we ourselves just patched a color - handled in handleColorChange
    const selectedColorInfo = selectedColorIdx !== null
        ? getElementColor(activeCode, selectedColorIdx)
        : null

    // Normalize any CSS color (named, rgb(), etc.) to #rrggbb hex for the ColorPicker
    const rawPickerColor = selectedColorInfo?.color ?? null
    const pickerColor = useMemo(() => {
        if (!rawPickerColor) return '#000000ff'
        if (/^#[0-9a-fA-F]{6}$/.test(rawPickerColor)) return rawPickerColor + 'ff'
        if (/^#[0-9a-fA-F]{8}$/.test(rawPickerColor)) return rawPickerColor
        // Use canvas to resolve named/rgb colors
        try {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const ctx = canvas.getContext('2d')!
            ctx.fillStyle = rawPickerColor
            ctx.fillRect(0, 0, 1, 1)
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}ff`
        } catch {
            return '#000000ff'
        }
    }, [rawPickerColor])


    const handlePreviewClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        let target = e.target as Element | null
        // Walk up to find the nearest element with data-svg-idx
        while (target && target !== e.currentTarget) {
            const idx = target.getAttribute('data-svg-idx')
            if (idx !== null) {
                setSelectedColorIdx(Number(idx))
                return
            }
            target = target.parentElement
        }
        // Clicked on background - deselect
        setSelectedColorIdx(null)
    }, [])

    const handleColorChange = useCallback((newColor: string) => {
        if (selectedColorIdx === null || !code) return
        setCode(patchElementColor(code, selectedColorIdx, newColor))
    }, [selectedColorIdx, code])

    const loadCode = useCallback((newCode: string) => {
        setCode(newCode)
        setSelectedColorIdx(null)
    }, [])

    // Charge per successful download (editing/optimizing/copying is free); refund on cancel.
    const handleDownload = async () => {
        const [refund, reserved] = spendTokens('image', plan, { cost, countCategory: false })
        if (!reserved) {
            toast.error('Conversion limit reached. Upgrade to continue.', {
                description: 'Upgrade to Pro for unlimited SVG exports.', duration: 5000,
            })
            return
        }
        const bytes = Array.from(new TextEncoder().encode(activeCode))
        const res = await window.electron.saveImageBuffer({ buffer: bytes, fileName: 'image.svg', format: 'svg', title: 'Save SVG' })
        if (res.canceled) { refund(); return }
        onConversionSuccess('image')
    }

    if (!code) {
        return (
            <section className="section py-8 xl:py-10 2xl:py-12">
                <div className="mb-6 xl:mb-7 2xl:mb-8 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">SVG Editor</h2>
                        <p className="text-sm xl:text-base text-muted-foreground mt-1">
                            Edit, optimize, and preview SVGs - export as React, Vue, Angular, or data URIs.
                        </p>
                    </div>
                    {metered && (
                        <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs shrink-0">
                            <Info className="size-4 xl:size-5 text-primary shrink-0 mt-0.5" />
                            <p className="text-xs xl:text-sm text-muted-foreground">
                                Each download costs <span className="font-medium text-foreground">{cost} token{cost === 1 ? '' : 's'}</span>. Editing and copying are free.
                            </p>
                        </div>
                    )}
                </div>
                <SvgDropzone onSvg={loadCode} />
            </section>
        )
    }

    return (
        <section className="section py-8 xl:py-10 2xl:py-12">
            <div className="mb-6 xl:mb-7 2xl:mb-8 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">SVG Editor</h2>
                    <p className="text-sm xl:text-base text-muted-foreground mt-1 max-w-sm">
                        Edit, optimize, and preview SVGs - export as React, Vue, Angular, or data URIs.
                    </p>
                </div>
                <div className="flex items-end gap-2.5 shrink-0">
                    <Button variant="outline" size="sm" className="xl:text-sm xl:h-9" onClick={() => setCode(null)}>
                        <RotateCcw className="size-3.5 xl:size-4 mr-1.5" />
                        New SVG
                    </Button>
                    {metered && (
                        <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 max-w-xs">
                            <Info className="size-4 xl:size-5 text-primary shrink-0 mt-0.5" />
                            <p className="text-xs xl:text-sm text-muted-foreground">
                                Each download costs <span className="font-medium text-foreground">{cost} token{cost === 1 ? '' : 's'}</span>. Editing and copying are free.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 xl:gap-5 h-140 xl:h-160 2xl:h-180">
                {/* Left: CodeMirror editor */}
                <div className="flex flex-col gap-2 min-h-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-xs xl:text-sm text-muted-foreground font-medium">Source</span>
                            <span className="text-xs xl:text-sm text-muted-foreground">{fileSize}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 xl:h-8 text-xs xl:text-sm"
                                onClick={() => setCode(prettifySvg(activeCode))}
                            >
                                Prettify
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 xl:h-8 text-xs xl:text-sm"
                                onClick={() => setCode(optimizedCode)}
                                disabled={savings <= 0}
                            >
                                {savings > 0 ? `Optimize −${savings}%` : 'Optimize'}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 xl:h-8 xl:w-8 shrink-0"
                                title="Download SVG"
                                onClick={handleDownload}
                            >
                                <Download className="size-3.5 xl:size-4" />
                            </Button>
                            <CopyButton text={activeCode} />
                        </div>
                    </div>
                    <SvgCodeEditor
                        value={activeCode}
                        onChange={setCode}
                    />
                </div>

                {/* Right: tabs */}
                <div className="flex flex-col gap-2 min-h-0">
                    <div className="flex items-center gap-1 border-b border-border pb-2">
                        {(['preview', 'code', 'data-uri'] as Tab[]).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={cn(
                                    'px-3 py-1 text-xs xl:text-sm rounded-md transition-colors',
                                    tab === t
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                                )}
                            >
                                {t === 'data-uri' ? 'Data URI' : t.charAt(0).toUpperCase() + t.slice(1)}
                            </button>
                        ))}
                    </div>

                    {tab === 'preview' && (
                        <div className="flex flex-col gap-3 flex-1 min-h-0">
                            {/* Meta + bg picker row */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    {meta.viewBox && (
                                        <span className="text-xs xl:text-sm text-muted-foreground">
                                            <span className="text-foreground/50 mr-1">viewBox</span>{meta.viewBox}
                                        </span>
                                    )}
                                    {(meta.width || meta.height) && (
                                        <span className="text-xs xl:text-sm text-muted-foreground">
                                            <span className="text-foreground/50 mr-1">size</span>
                                            {meta.width ?? '?'} × {meta.height ?? '?'}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2" data-color-picker>
                                    {selectedColorInfo && (
                                        <div className='h-7 xl:h-8'>
                                            <ColorPicker
                                                value={pickerColor}
                                                onChange={c => handleColorChange(c.slice(0, 7))}
                                            />
                                        </div>
                                    )}
                                    {BG_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            title={opt.label}
                                            onClick={() => setBg(opt.value)}
                                            className={cn(
                                                'h-7 w-7 xl:h-8 xl:w-8 rounded-md border-2 transition-colors',
                                                opt.class,
                                                bg === opt.value ? 'border-primary' : 'border-border'
                                            )}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div
                                className={cn('flex-1 rounded-xl relative flex items-center justify-center overflow-hidden', bgClass)}
                                onPointerDown={e => {
                                    // Deselect if clicking the background (not an svg element)
                                    if (e.target === e.currentTarget) setSelectedColorIdx(null)
                                }}
                            >
                                <div
                                    className="svg-preview flex items-center justify-center w-full h-full svg-color-pick"
                                    onClick={handlePreviewClick}
                                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                                />
                            </div>
                        </div>
                    )}

                    {tab === 'code' && (
                        <div className="flex flex-col gap-3 flex-1 min-h-0">
                            <div className="flex items-center justify-between">
                                <Combobox
                                    value={codeFormat}
                                    onValueChange={v => v && setCodeFormat(v as CodeFormat)}
                                    items={CODE_FORMAT_OPTIONS.map(o => o.value)}
                                    filter={null}
                                >
                                    <ComboboxInput className="w-36! h-8! xl:h-9! [&_input]:select-none!" readOnly />
                                    <ComboboxContent>
                                        <ComboboxList>
                                            {(item) => (
                                                <ComboboxItem key={item} value={item}>
                                                    {CODE_FORMAT_OPTIONS.find(o => o.value === item)?.label ?? item}
                                                </ComboboxItem>
                                            )}
                                        </ComboboxList>
                                    </ComboboxContent>
                                </Combobox>
                                <CopyButton text={displayCode} />
                            </div>
                            <pre className="flex-1 min-h-0 rounded-xl border border-border bg-muted/30 p-3 text-xs xl:text-sm font-mono text-foreground overflow-auto whitespace-pre-wrap break-all">
                                {displayCode}
                            </pre>
                        </div>
                    )}

                    {tab === 'data-uri' && (
                        <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
                            <DataUriRow label="Base64" value={toBase64Uri(activeCode)} />
                            <DataUriRow label="encodeURIComponent" value={toEncodedUri(activeCode)} />
                            <DataUriRow label="Minified (encodeURIComponent)" value={minifiedUri} />
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}
