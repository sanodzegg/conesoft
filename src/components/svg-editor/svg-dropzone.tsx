import { useRef, useState } from 'react'
import { Import } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isValidSvg } from './svg-utils'

interface Props {
    onSvg: (code: string) => void
}

export default function SvgDropzone({ onSvg }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const dropRef = useRef<HTMLDivElement>(null)
    const [paste, setPaste] = useState('')
    const [dragging, setDragging] = useState(false)

    function readFile(file: File) {
        const reader = new FileReader()
        reader.onload = e => {
            const text = e.target?.result as string
            if (text && isValidSvg(text)) onSvg(text)
        }
        reader.readAsText(file)
    }

    function handleFiles(files: FileList | null) {
        const file = Array.from(files ?? []).find(
            f => f.type === 'image/svg+xml' || f.name.endsWith('.svg')
        )
        if (file) readFile(file)
    }

    function handleDrop(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
    }

    function handleLoad() {
        const trimmed = paste.trim()
        if (isValidSvg(trimmed)) onSvg(trimmed)
    }

    return (
        <div className="flex flex-col gap-4">
            <form onSubmit={e => e.preventDefault()}>
                <input
                    ref={inputRef}
                    type="file"
                    accept=".svg,image/svg+xml"
                    className="sr-only"
                    onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
                />
                <div
                    ref={dropRef}
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    onDragEnter={() => setDragging(true)}
                    onDragLeave={() => setDragging(false)}
                    className={`flex flex-col items-center justify-center py-10 xl:py-12 w-full h-90 xl:h-100 2xl:h-108 border border-dashed border-border rounded-3xl transition-colors gap-4 xl:gap-5 cursor-pointer ${dragging ? 'bg-accent border-primary' : 'hover:border-primary'}`}
                >
                    <Button onClick={() => inputRef.current?.click()} variant="outline" className="w-20 h-20 xl:w-22 xl:h-22 2xl:w-24 2xl:h-24 border-border hover:border-primary transition-colors">
                        <Import className="size-10 xl:size-11 2xl:size-12 stroke-primary" />
                    </Button>
                    <div className="text-center">
                        <h2 className="text-xl xl:text-2xl font-body font-semibold text-foreground">Drop an SVG file here</h2>
                        <p className="text-sm xl:text-base text-muted-foreground mt-1">or browse to upload</p>
                    </div>
                    <Button
                        type="button"
                        variant="default"
                        className="h-10 w-48 xl:h-11 xl:w-52 2xl:h-12 2xl:w-56"
                        onClick={() => inputRef.current?.click()}
                    >
                        Browse SVG
                    </Button>
                </div>
            </form>

            <div className="flex flex-col gap-2">
                <p className="text-sm xl:text-base text-muted-foreground">Or paste SVG code</p>
                <textarea
                    value={paste}
                    onChange={e => {
                        const val = e.target.value
                        setPaste(val)
                        if (isValidSvg(val.trim())) onSvg(val.trim())
                    }}
                    placeholder="<svg xmlns=..."
                    rows={5}
                    className="w-full rounded-xl border border-border bg-background text-sm xl:text-base text-foreground font-mono p-3 resize-none focus:outline-none focus:border-primary transition-colors"
                />
                <Button
                    onClick={handleLoad}
                    disabled={!isValidSvg(paste.trim())}
                    className="self-end"
                >
                    Load SVG
                </Button>
            </div>
        </div>
    )
}
