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
        description: '100 free tokens to try everything. Upgrade for unlimited conversions.',
    },
    limited: {
        label: 'Free',
        icon: Timer,
        color: 'text-muted-foreground',
        description: '50 tokens a day, refreshed every 24 hours. Upgrade for unlimited conversions.',
    },
    monthly: {
        label: 'Pro - Monthly',
        icon: Zap,
        color: 'text-primary',
        description: 'Unlimited conversions, billed monthly.',
    },
    annual: {
        label: 'Pro - Annual',
        icon: Zap,
        color: 'text-primary',
        description: 'Unlimited conversions, billed annually. You save 25%.',
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
        <div className="rounded-2xl border border-border p-5 xl:p-6 space-y-4 xl:space-y-5">
            <p className="text-sm xl:text-base font-medium text-muted-foreground uppercase tracking-wide">Plan</p>

            <div className="flex items-center gap-3">
                <div className={cn("size-11 xl:size-12 2xl:size-13 rounded-full flex items-center justify-center shrink-0", isFree ? "bg-foreground/10" : "bg-primary/10")}>
                    <Icon className={cn("size-5 xl:size-6", config.color)} />
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <p className="text-base xl:text-lg font-semibold text-foreground">{config.label}</p>
                        <span className={cn(
                            "text-xs xl:text-sm font-medium px-2 py-0.5 rounded-full",
                            isFree ? "bg-foreground/10 text-muted-foreground" : "bg-primary/10 text-primary"
                        )}>
                            {plan === 'limited' ? 'Daily' : isFree ? 'Free' : 'Active'}
                        </span>
                    </div>
                    <p className="text-sm xl:text-base text-muted-foreground mt-0.5">{config.description}</p>
                    {subscriptionEnd && isPaid && (
                        <p className="text-xs xl:text-sm text-muted-foreground mt-0.5">
                            Renews {new Date(subscriptionEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {isFree && (
                    <Button size="sm" onClick={() => navigate('/pricing')} className="gap-1.5 xl:text-sm xl:h-9">
                        Upgrade
                        <ArrowUpRight className="size-3.5 xl:size-4" />
                    </Button>
                )}
                {isPaid && (
                    <>
                        {cancelStep === 'idle' && (
                            <>
                                <Button variant="outline" size="sm" className="xl:text-sm xl:h-9" onClick={() => navigate('/pricing')}>Change plan</Button>
                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 xl:text-sm xl:h-9" onClick={() => setCancelStep('confirm')}>
                                    Cancel subscription
                                </Button>
                            </>
                        )}
                        {cancelStep === 'confirm' && (
                            <div className="flex flex-col gap-2 w-full">
                                <p className="text-sm xl:text-base text-muted-foreground">Access continues until {formattedEnd}. After that you'll move to the free plan - 50 tokens a day.</p>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" className="xl:text-sm xl:h-9" onClick={() => setCancelStep('idle')}>Keep plan</Button>
                                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 xl:text-sm xl:h-9" onClick={handleCancel}>Confirm cancel</Button>
                                </div>
                            </div>
                        )}
                        {cancelStep === 'loading' && (
                            <Button variant="ghost" size="sm" className="xl:text-sm xl:h-9" disabled>Canceling…</Button>
                        )}
                        {cancelStep === 'done' && (
                            <p className="text-sm xl:text-base text-muted-foreground">Subscription canceled. Access continues until {formattedEnd}.</p>
                        )}
                        {cancelStep === 'error' && (
                            <div className="flex items-center gap-2">
                                <p className="text-sm xl:text-base text-destructive">Cancellation failed.</p>
                                <Button variant="ghost" size="sm" className="xl:text-sm xl:h-9" onClick={() => setCancelStep('idle')}>Try again</Button>
                            </div>
                        )}
                    </>
                )}
                {plan === 'lifetime' && (
                    <p className="text-xs xl:text-sm text-muted-foreground">No action needed - you own Conesoft forever.</p>
                )}
            </div>
        </div>
    )
}
