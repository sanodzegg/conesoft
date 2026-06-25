import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { RemoteSettings } from '@/lib/useSettingsSync'

interface Props {
    remote: RemoteSettings
    local: RemoteSettings
    onApplyRemote: () => void
    onKeepLocal: () => void
}

export function SettingsConflictDialog({ remote, local, onApplyRemote, onKeepLocal }: Props) {
    function SettingsBlock({ s }: { s: RemoteSettings }) {
        return (
            <>
                <p className="text-muted-foreground">Image quality: <span className="text-foreground">{s.image_quality}%</span></p>
                <p className="text-muted-foreground">Image format: <span className="text-foreground">{s.default_image_format}</span></p>
                <p className="text-muted-foreground">Video format: <span className="text-foreground">{s.default_video_format}</span></p>
                <p className="text-muted-foreground">Document format: <span className="text-foreground">{s.default_document_format}</span></p>
                <p className="text-muted-foreground">Output folder: <span className="text-foreground">{s.default_output_folder ?? 'Default'}</span></p>
            </>
        )
    }

    return (
        <Dialog open>
            <DialogContent className="xl:max-w-lg">
                <DialogHeader>
                    <DialogTitle className={'font-body xl:text-xl'}>Settings conflict</DialogTitle>
                    <DialogDescription className="xl:text-base">
                        Your account has different settings than what's saved locally. Which would you like to use?
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 xl:gap-4 mt-2 mb-4">
                    <div className="rounded-xl border border-border p-3 xl:p-4 space-y-1 text-sm xl:text-base">
                        <p className="font-medium text-primary mb-2">Local settings</p>
                        <SettingsBlock s={local} />
                    </div>
                    <div className="rounded-xl border border-border p-3 xl:p-4 space-y-1 text-sm xl:text-base">
                        <p className="font-medium text-primary mb-2">Account settings</p>
                        <SettingsBlock s={remote} />
                    </div>
                </div>
                <div className="flex gap-2 justify-end">
                    <Button variant="outline" className="xl:text-base xl:h-11" onClick={onKeepLocal}>Keep local</Button>
                    <Button className="xl:text-base xl:h-11" onClick={onApplyRemote}>Use account settings</Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
