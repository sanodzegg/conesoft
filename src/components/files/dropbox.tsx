import { Import } from "lucide-react";
import { Button } from "../ui/button";
import { useRef, useState, useEffect } from "react";
import { useConvertStore } from "@/store/useConvertStore";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import { getAllSupportedExtensions, getExtensionsByGroup } from "@/engines/engineRegistry";
import { useAuth } from "@/lib/useAuth";
import { isAtLimit } from "@/lib/useConversionCount";
import { useNavigate } from "react-router-dom";

export default function Dropbox() {
    const groups = getExtensionsByGroup();
    const [activeGroup, setActiveGroup] = useState(groups[0]?.label ?? '');
    const { plan } = useAuth();
    const navigate = useNavigate();
    const allLimited = plan === 'limited' &&
        isAtLimit('image', plan) && isAtLimit('document', plan) &&
        isAtLimit('video', plan) && isAtLimit('audio', plan);

    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const handleClickRedirection = () => inputRef.current && inputRef.current.click();
    const handleDragEnter = () => wrapperRef.current && wrapperRef.current.classList.add('dragenter');
    const handleDragLeave = (e: React.DragEvent) => {
        if (wrapperRef.current && !wrapperRef.current.contains(e.relatedTarget as Node)) {
            wrapperRef.current.classList.remove('dragenter')
        }
    }
    const handleDragEnd = () => wrapperRef.current && wrapperRef.current.classList.remove('dragenter');
    const preventDragOver = (e: React.DragEvent) => e.preventDefault();

    const { receiveFiles, files: existingFiles } = useConvertStore();
    const [skipMessage, setSkipMessage] = useState<string | null>(null)
    const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        return () => { if (skipTimerRef.current) clearTimeout(skipTimerRef.current) }
    }, [])

    const handleFiles = (incoming: FileList | null) => {
        if (!incoming) return
        const arr = Array.from(incoming)
        receiveFiles(arr)
        // After receiveFiles, the store updates synchronously via Zustand set -
        // but we can't read the new state here. Instead, compare what we tried to
        // add vs what the store will accept by checking duplicates ourselves.
        const existingKeys = new Set(existingFiles.map(f => `${f.name}-${f.size}-${f.lastModified}`))
        const skipped = arr.filter(f => existingKeys.has(`${f.name}-${f.size}-${f.lastModified}`)).length
        if (skipped > 0) {
            if (skipTimerRef.current) clearTimeout(skipTimerRef.current)
            setSkipMessage(`${skipped} duplicate file${skipped > 1 ? 's' : ''} skipped`)
            skipTimerRef.current = setTimeout(() => setSkipMessage(null), 3000)
        }
    }

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
        wrapperRef.current && wrapperRef.current.classList.remove('dragenter')
    }
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(e.target.files)
        e.target.value = ''
    }

    const activeFormats = groups.find(g => g.label === activeGroup)?.formats ?? [];

    return (
        <form>
            <input ref={inputRef} multiple onChange={handleInputChange} className="sr-only" type="file" name="userFiles" id="userFiles" accept={getAllSupportedExtensions().map(e => `.${e}`).join(',')} />
            <div ref={wrapperRef} onDrop={allLimited ? undefined : handleDrop} onDragOver={allLimited ? undefined : preventDragOver} onDragEnter={allLimited ? undefined : handleDragEnter} onDragLeave={allLimited ? undefined : handleDragLeave} onDragEnd={allLimited ? undefined : handleDragEnd} className={cn("flex flex-col items-center justify-center w-full border rounded-3xl border-dashed transition-colors h-100 xl:h-108 2xl:h-120 [&.dragenter]:bg-accent pt-10 pb-8 xl:pt-12 xl:pb-9 2xl:pt-14 2xl:pb-10", allLimited ? "border-border cursor-default" : "border-border hover:border-primary cursor-pointer")}>
                <div className={cn("flex flex-col items-center justify-center w-full gap-4 xl:gap-5", allLimited && "opacity-60 pointer-events-none")}>
                    <Button onClick={allLimited ? undefined : handleClickRedirection} variant="outline" className="w-20 h-20 xl:w-22 xl:h-22 2xl:w-24 2xl:h-24 border-border hover:border-primary transition-colors">
                        <Import className="size-10 xl:size-11 2xl:size-12 stroke-primary" />
                    </Button>

                    <div className="text-center">
                        <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">Drop files here</h2>
                        <p className="text-sm xl:text-base text-muted-foreground mt-1">{allLimited ? 'Out of tokens for today - they refresh in 24 hours' : 'or browse from your computer'}</p>
                    </div>

                    <div className="flex flex-col items-center gap-3 w-full max-w-lg xl:max-w-xl px-8">
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                            {groups.map(group => (
                                <button
                                    key={group.label}
                                    type="button"
                                    onClick={() => setActiveGroup(group.label)}
                                    className={cn(
                                        'px-4 py-1.5 xl:px-5 xl:py-2 rounded-full text-sm xl:text-base border transition-colors',
                                        activeGroup === group.label
                                            ? 'border-primary text-primary bg-primary/10'
                                            : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                                    )}
                                >
                                    {group.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex flex-wrap justify-center gap-1.5 h-24 xl:h-26 2xl:h-28 content-start overflow-hidden">
                            {activeFormats.map(fmt => (
                                <Badge variant="secondary" key={fmt} className="rounded-sm px-2.5 py-1.5 xl:p-3 text-sm xl:text-base font-light text-primary">{fmt}</Badge>
                            ))}
                        </div>
                    </div>
                </div>

                <Button onClick={allLimited ? () => navigate('/pricing') : handleClickRedirection} className="bg-primary h-12 w-60 xl:h-13 xl:w-66 2xl:h-14 2xl:w-72 text-lg xl:text-xl" variant="default">
                    {allLimited ? 'Upgrade to Pro' : 'Browse Files'}
                </Button>
                {skipMessage && (
                    <p className="text-xs text-muted-foreground">{skipMessage}</p>
                )}
            </div>
        </form>
    )
}