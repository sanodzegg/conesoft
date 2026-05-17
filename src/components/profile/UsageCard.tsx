import { LIMITED_DAILY_LIMITS, getDailyCounts, getTrialScore, WEIGHTS, TOKEN_TOTAL } from '@/lib/useConversionCount'
import type { ConversionCounts } from '@/lib/useConversionCount'
import type { Plan } from '@/lib/useAuth'
import { cn } from '@/lib/utils'
import { Image, FileText, Video, Music } from 'lucide-react'

function UsageBar({ pct, nearAt = 80, fullAt = 100 }: { pct: number; nearAt?: number; fullAt?: number }) {
    const isNear = pct >= nearAt
    const isFull = pct >= fullAt
    return (
        <div className="w-full h-1.5 rounded-full bg-accent overflow-hidden">
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

export function UsageCard({ plan, counts }: UsageCardProps) {
    const isLimited = plan === 'limited'
    const isTrial = plan === 'trial'

    if (isLimited) {
        const daily = getDailyCounts()
        const rows = [
            { label: 'Images', used: daily.image, limit: LIMITED_DAILY_LIMITS.image, icon: Image },
            { label: 'Documents', used: daily.document, limit: LIMITED_DAILY_LIMITS.document, icon: FileText },
            { label: 'Videos', used: daily.video, limit: LIMITED_DAILY_LIMITS.video, icon: Video },
            { label: 'Audio', used: daily.audio, limit: LIMITED_DAILY_LIMITS.audio, icon: Music },
        ]
        return (
            <div className="rounded-2xl border border-border p-5 space-y-3">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Usage today</p>
                <div className="space-y-3">
                    {rows.map(({ label, used, limit, icon: Icon }) => (
                        <div key={label} className="space-y-1">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                                    <Icon className="size-4" />
                                    {label}
                                </p>
                                <p className="text-sm text-foreground tabular-nums">{used} / {limit} <span className="text-muted-foreground">today</span></p>
                            </div>
                            <UsageBar pct={(used / limit) * 100} />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (isTrial) {
        const score = getTrialScore(counts)
        const tokensUsed = Math.round(score * TOKEN_TOTAL)
        const scorePct = score * 100
        const rows = [
            { label: 'Images', value: counts.image, cost: Math.round(WEIGHTS.image * TOKEN_TOTAL), icon: Image },
            { label: 'Documents', value: counts.document, cost: Math.round(WEIGHTS.document * TOKEN_TOTAL), icon: FileText },
            { label: 'Videos', value: counts.video, cost: Math.round(WEIGHTS.video * TOKEN_TOTAL), icon: Video },
            { label: 'Audio', value: counts.audio, cost: Math.round(WEIGHTS.audio * TOKEN_TOTAL), icon: Music },
        ]
        return (
            <div className="rounded-2xl border border-border p-5 space-y-4">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Usage</p>
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">Credits used</p>
                        <p className="text-sm text-foreground tabular-nums">{tokensUsed} / {TOKEN_TOTAL}</p>
                    </div>
                    <UsageBar pct={scorePct} nearAt={85} fullAt={100} />
                </div>
                <div className="space-y-2">
                    {rows.map(({ label, value, cost, icon: Icon }) => (
                        <div key={label} className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                                <Icon className="size-4" />
                                {label}
                                <span className="text-xs">· {cost} cr each</span>
                            </p>
                            <p className="text-sm text-foreground tabular-nums">{value}</p>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    // paid plans — lifetime stats
    const totalStats = [
        { label: 'Images', value: counts.image, icon: Image },
        { label: 'Documents', value: counts.document, icon: FileText },
        { label: 'Videos', value: counts.video, icon: Video },
        { label: 'Audio', value: counts.audio, icon: Music },
    ]

    return (
        <div className="rounded-2xl border border-border p-5 space-y-3">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Usage</p>
            <div className="grid grid-cols-2 gap-3">
                {totalStats.map(({ label, value, icon: Icon }) => (
                    <div key={label} className="flex items-center gap-2.5">
                        <div className="size-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                            <Icon className="size-4 text-muted-foreground" />
                        </div>
                        <div>
                            <p className="text-base font-medium text-foreground tabular-nums">{value.toLocaleString()}</p>
                            <p className="text-sm text-muted-foreground">{label}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
