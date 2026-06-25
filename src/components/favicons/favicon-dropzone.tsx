import { Import } from "lucide-react"
import { Button } from "../ui/button"
import { useRef } from "react"
import { Badge } from "../ui/badge"
import { cn } from "@/lib/utils"
import { useNavigate } from "react-router-dom"

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']
const ACCEPTED_EXT = ['PNG', 'JPG', 'WEBP', 'SVG', 'GIF']

interface Props {
    onFile: (file: File) => void
    atLimit?: boolean
}

export default function FaviconDropzone({ onFile, atLimit = false }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const navigate = useNavigate()

    const handleClickRedirection = () => inputRef.current?.click()
    const handleDragEnter = () => wrapperRef.current?.classList.add('dragenter')
    const handleDragEnd = () => wrapperRef.current?.classList.remove('dragenter')
    const preventDragOver = (e: React.DragEvent) => e.preventDefault()

    const handleFiles = (files: FileList | null) => {
        const file = Array.from(files ?? []).find(f => ACCEPTED.includes(f.type))
        if (file) onFile(file)
    }

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        handleFiles(e.dataTransfer.files)
        wrapperRef.current?.classList.remove('dragenter')
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(e.target.files)
        e.target.value = ''
    }

    return (
        <form>
            <input
                ref={inputRef}
                accept={ACCEPTED.join(',')}
                onChange={handleInputChange}
                className="sr-only"
                type="file"
                name="faviconFile"
            />
            <div
                ref={wrapperRef}
                onDrop={atLimit ? undefined : handleDrop}
                onDragOver={atLimit ? undefined : preventDragOver}
                onDragEnter={atLimit ? undefined : handleDragEnter}
                onDragEnd={atLimit ? undefined : handleDragEnd}
                className={cn(
                    "flex flex-col items-center justify-center py-10 xl:py-12 w-full h-90 xl:h-100 2xl:h-108 border rounded-3xl border-dashed transition-colors gap-4 xl:gap-5 [&.dragenter]:bg-accent",
                    atLimit ? "border-border cursor-default" : "border-border hover:border-primary cursor-pointer"
                )}
            >
                <div className={cn("flex flex-col items-center justify-center gap-4 xl:gap-5", atLimit && "opacity-60 pointer-events-none")}>
                    <Button onClick={atLimit ? undefined : handleClickRedirection} variant="outline" className="w-20 h-20 xl:w-22 xl:h-22 2xl:w-24 2xl:h-24 border-border hover:border-primary transition-colors">
                        <Import className="size-10 xl:size-11 2xl:size-12 stroke-primary" />
                    </Button>

                    <div className="text-center">
                        <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">Drop an image here</h2>
                        <p className="text-sm xl:text-base text-muted-foreground mt-1">{atLimit ? 'Out of tokens for today - they refresh in 24 hours' : "You'll get .ico, every PNG size, and macOS .icns"}</p>
                    </div>

                    <div className="flex items-center justify-center flex-wrap gap-2">
                        {ACCEPTED_EXT.map((ext) => (
                            <Badge variant="secondary" key={ext} className="rounded-sm p-3 xl:p-3.5 text-sm xl:text-base font-light text-primary">{ext}</Badge>
                        ))}
                    </div>
                </div>

                <Button onClick={atLimit ? () => navigate('/pricing') : handleClickRedirection} className="bg-primary h-12 w-60 xl:h-13 xl:w-66 2xl:h-14 2xl:w-72 text-lg xl:text-xl" variant="default">
                    {atLimit ? 'Upgrade to Pro' : 'Browse Image'}
                </Button>
            </div>
        </form>
    )
}
