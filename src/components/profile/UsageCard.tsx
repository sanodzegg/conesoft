import { TOKEN_COSTS, TRIAL_TOKEN_LIMIT, DAILY_TOKEN_LIMIT, useCountsStore } from '@/lib/useConversionCount'
import type { ConversionCounts, EngineType } from '@/lib/useConversionCount'
import type { Plan } from '@/lib/useAuth'
import { cn } from '@/lib/utils'
import { Image, FileText, Video, Music } from 'lucide-react'

function UsageBar({ pct, nearAt = 80, fullAt = 100 }: { pct: number; nearAt?: number; fullAt?: number }) {
    const isNear = pct >= nearAt
    const isFull = pct >= fullAt
    return (
        <div className="w-full h-1.5 xl:h-2 rounded-full bg-accent overflow-hidden">
            <div
                className={cn('h-full rounded-full transition-all', isFull ? 'bg-destructive' : isNear ? 'bg-yellow-500' : 'bg-primary')}
                style={{ width: `${Math.min(pct, 100)}%` }}
            />
        </div>
    )
}

interface UsageCardProps {
    plan: Plan
    counts: ConversionCounts
}

const ENGINE_ROWS: { label: string; engine: EngineType; icon: typeof Image }[] = [
    { label: 'Images', engine: 'image', icon: Image },
    { label: 'Documents', engine: 'document', icon: FileText },
    { label: 'Videos', engine: 'video', icon: Video },
    { label: 'Audio', engine: 'audio', icon: Music },
]

export function UsageCard({ plan, counts }: UsageCardProps) {
    const tokensUsed = useCountsStore(s => s.tokensUsed)
    const dailyTokens = useCountsStore(s => s.dailyTokens)

    const isLimited = plan === 'limited'
    const isTrial = plan === 'trial'

    if (isLimited) {
        return (
            <div className="rounded-2xl border border-border p-5 xl:p-6 space-y-4 xl:space-y-5">
                <p className="text-sm xl:text-base font-medium text-muted-foreground uppercase tracking-wide">Usage today</p>
                <div className="space-y-1.5 xl:space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-sm xl:text-base text-muted-foreground">Daily tokens</p>
                        <p className="text-sm xl:text-base text-foreground tabular-nums">{dailyTokens} / {DAILY_TOKEN_LIMIT} <span className="text-muted-foreground">today</span></p>
                    </div>
                    <UsageBar pct={(dailyTokens / DAILY_TOKEN_LIMIT) * 100} />
                </div>
                <div className="space-y-2 xl:space-y-3">
                    {ENGINE_ROWS.map(({ label, engine, icon: Icon }) => (
                        <div key={label} className="flex items-center justify-between">
                            <p className="text-sm xl:text-base text-muted-foreground flex items-center gap-1.5">
                                <Icon className="size-4 xl:size-5" />
                                {label}
                                <span className="text-xs xl:text-sm">· {TOKEN_COSTS[engine]} tokens each</span>
                            </p>
                            <p className="text-sm xl:text-base text-foreground tabular-nums">{counts[engine]}</p>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (isTrial) {
        return (
            <div className="rounded-2xl border border-border p-5 xl:p-6 space-y-4 xl:space-y-5">
                <p className="text-sm xl:text-base font-medium text-muted-foreground uppercase tracking-wide">Usage</p>
                <div className="space-y-1.5 xl:space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-sm xl:text-base text-muted-foreground">Trial tokens used</p>
                        <p className="text-sm xl:text-base text-foreground tabular-nums">{tokensUsed} / {TRIAL_TOKEN_LIMIT}</p>
                    </div>
                    <UsageBar pct={(tokensUsed / TRIAL_TOKEN_LIMIT) * 100} nearAt={85} fullAt={100} />
                </div>
                <div className="space-y-2 xl:space-y-3">
                    {ENGINE_ROWS.map(({ label, engine, icon: Icon }) => (
                        <div key={label} className="flex items-center justify-between">
                            <p className="text-sm xl:text-base text-muted-foreground flex items-center gap-1.5">
                                <Icon className="size-4 xl:size-5" />
                                {label}
                                <span className="text-xs xl:text-sm">· {TOKEN_COSTS[engine]} tokens each</span>
                            </p>
                            <p className="text-sm xl:text-base text-foreground tabular-nums">{counts[engine]}</p>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    // paid plans - lifetime stats
    return (
        <div className="rounded-2xl border border-border p-5 xl:p-6 space-y-3 xl:space-y-4">
            <p className="text-sm xl:text-base font-medium text-muted-foreground uppercase tracking-wide">Usage</p>
            <div className="grid grid-cols-2 gap-3 xl:gap-4">
                {ENGINE_ROWS.map(({ label, engine, icon: Icon }) => (
                    <div key={label} className="flex items-center gap-2.5">
                        <div className="size-9 xl:size-10 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                            <Icon className="size-4 xl:size-5 text-muted-foreground" />
                        </div>
                        <div>
                            <p className="text-base xl:text-lg font-medium text-foreground tabular-nums">{counts[engine].toLocaleString()}</p>
                            <p className="text-sm xl:text-base text-muted-foreground">{label}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
