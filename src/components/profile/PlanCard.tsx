import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Plan } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Clock, Timer, Zap, Star, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

const PLAN_CONFIG: Record<Plan, { label: string; icon: typeof Clock; color: string; description: string }> = {
    trial: {
        label: 'Trial',
        icon: Clock,
        color: 'text-muted-foreground',
        description: 'Limited conversions included. Upgrade for unlimited access.',
    },
    limited: {
        label: 'Limited',
        icon: Timer,
        color: 'text-muted-foreground',
        description: 'Daily conversion limits. Upgrade for unlimited access.',
    },
    monthly: {
        label: 'Pro — Monthly',
        icon: Zap,
        color: 'text-primary',
        description: 'Unlimited conversions, billed monthly.',
    },
    annual: {
        label: 'Pro — Annual',
        icon: Zap,
        color: 'text-primary',
        description: 'Unlimited conversions, billed annually. You save 20%.',
    },
    lifetime: {
        label: 'Lifetime',
        icon: Star,
        color: 'text-primary',
        description: 'Unlimited conversions, forever. No renewals.',
    },
}

interface PlanCardProps {
    plan: Plan
    subscriptionEnd?: string | null
}

type CancelStep = 'idle' | 'confirm' | 'loading' | 'done' | 'error'

export function PlanCard({ plan, subscriptionEnd }: PlanCardProps) {
    const navigate = useNavigate()
    const [cancelStep, setCancelStep] = useState<CancelStep>('idle')
    const config = PLAN_CONFIG[plan]
    const Icon = config.icon
    const isFree = plan === 'trial' || plan === 'limited'
    const isPaid = plan === 'monthly' || plan === 'annual'

    async function handleCancel() {
        setCancelStep('loading')
        const { error } = await supabase.functions.invoke('cancel-subscription')
        setCancelStep(error ? 'error' : 'done')
    }

    const formattedEnd = subscriptionEnd
        ? new Date(subscriptionEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
        : 'end of billing period'

    return (
        <div className="rounded-2xl border border-border p-5 space-y-4">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Plan</p>

            <div className="flex items-center gap-3">
                <div className={cn("size-11 rounded-full flex items-center justify-center shrink-0", isFree ? "bg-foreground/10" : "bg-primary/10")}>
                    <Icon className={cn("size-5", config.color)} />
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <p className="text-base font-semibold text-foreground">{config.label}</p>
                        <span className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            isFree ? "bg-foreground/10 text-muted-foreground" : "bg-primary/10 text-primary"
                        )}>
                            {isFree ? 'Free' : 'Active'}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{config.description}</p>
                    {subscriptionEnd && isPaid && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Renews {new Date(subscriptionEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {isFree && (
                    <Button size="sm" onClick={() => navigate('/pricing')} className="gap-1.5">
                        Upgrade
                        <ArrowUpRight className="size-3.5" />
                    </Button>
                )}
                {isPaid && (
                    <>
                        {cancelStep === 'idle' && (
                            <>
                                <Button variant="outline" size="sm" onClick={() => navigate('/pricing')}>Change plan</Button>
                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setCancelStep('confirm')}>
                                    Cancel subscription
                                </Button>
                            </>
                        )}
                        {cancelStep === 'confirm' && (
                            <div className="flex flex-col gap-2 w-full">
                                <p className="text-sm text-muted-foreground">Access continues until {formattedEnd}. After that you'll move to the limited plan.</p>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setCancelStep('idle')}>Keep plan</Button>
                                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleCancel}>Confirm cancel</Button>
                                </div>
                            </div>
                        )}
                        {cancelStep === 'loading' && (
                            <Button variant="ghost" size="sm" disabled>Canceling…</Button>
                        )}
                        {cancelStep === 'done' && (
                            <p className="text-sm text-muted-foreground">Subscription canceled. Access continues until {formattedEnd}.</p>
                        )}
                        {cancelStep === 'error' && (
                            <div className="flex items-center gap-2">
                                <p className="text-sm text-destructive">Something went wrong.</p>
                                <Button variant="ghost" size="sm" onClick={() => setCancelStep('idle')}>Try again</Button>
                            </div>
                        )}
                    </>
                )}
                {plan === 'lifetime' && (
                    <p className="text-xs text-muted-foreground">No action needed — you own Conesoft forever.</p>
                )}
            </div>
        </div>
    )
}
