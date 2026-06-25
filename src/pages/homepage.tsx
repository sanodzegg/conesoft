import Dropbox from "@/components/files/dropbox";
import FileList from "@/components/files/list";
import ConvertedFiles from "@/components/files/converted";
import { useConvertStore } from "@/store/useConvertStore";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Homepage() {
  const autoDownloadEnabled = useConvertStore(s => s.autoDownloadEnabled)
  const autoDownloadFolder = useConvertStore(s => s.autoDownloadFolder)
  const setAutoDownloadEnabled = useConvertStore(s => s.setAutoDownloadEnabled)
  const setAutoDownloadFolder = useConvertStore(s => s.setAutoDownloadFolder)

  const handlePickFolder = async () => {
    const folder = await window.electron.pickDownloadFolder()
    if (folder) {
      setAutoDownloadFolder(folder)
      setAutoDownloadEnabled(true)
    }
  }

  return (
    <section className="section py-8 xl:py-10 2xl:py-12">
      <div className="mb-6 xl:mb-7 2xl:mb-8">
        <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">Convert anything, instantly.</h2>
        <p className="text-sm xl:text-base text-muted-foreground mt-1">
          Images, video, audio, documents - converted on your device, never uploaded.
        </p>
      </div>
      <Dropbox />

      <div className="mt-4 h-14.5 xl:mt-5 xl:h-15 2xl:h-16 flex items-center gap-3 px-4 xl:px-5 py-3 xl:py-3.5 rounded-2xl border border-accent bg-secondary/30">
        <button
          role="checkbox"
          aria-checked={autoDownloadEnabled}
          onClick={() => setAutoDownloadEnabled(!autoDownloadEnabled)}
          className={`relative inline-flex h-5 w-9 xl:h-6 xl:w-10 2xl:w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            autoDownloadEnabled ? 'bg-primary' : 'bg-accent'
          }`}
        >
          <span
            className={`pointer-events-none inline-block size-4 xl:size-5 rounded-full bg-white shadow transition-transform ${
              autoDownloadEnabled ? 'translate-x-4 xl:translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
        <span className="text-sm xl:text-base text-primary font-medium select-none">Auto-download to folder</span>
        {autoDownloadEnabled && (
          <>
            <button
              onClick={handlePickFolder}
              className="flex items-center gap-1.5 text-xs xl:text-sm text-muted-foreground hover:text-foreground transition-colors min-w-0 flex-1 truncate"
            >
              <FolderOpen className="size-4 shrink-0" />
              <span className="truncate">{autoDownloadFolder ?? 'Choose folder…'}</span>
            </button>
            {!autoDownloadFolder && (
              <Button variant="outline" className="text-xs xl:text-sm h-8 xl:h-9 px-3 shrink-0" onClick={handlePickFolder}>
                Choose
              </Button>
            )}
          </>
        )}
      </div>

      <FileList />
      <ConvertedFiles />
    </section>
  )
}
