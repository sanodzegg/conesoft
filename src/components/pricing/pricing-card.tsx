import { Check } from 'lucide-react'
import { type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { CountingNumber } from '@/components/animate-ui/primitives/texts/counting-number'
import { cn } from '@/lib/utils'

type Interval = 'monthly' | 'annual'
type Badge = 'current' | 'popular' | 'best-value'

export interface PricingCardProps {
    icon: LucideIcon
    title: string
    description: string
    price: number | { monthly: number; annual: number }
    priceSuffix?: string
    features: string[]
    ctaLabel: string
    ctaVariant?: 'default' | 'outline'
    interval?: Interval
    onIntervalChange?: (interval: Interval) => void
    badge?: Badge
    disabled?: boolean
    onCtaClick?: () => void
}

const BADGE_CONFIG: Record<Badge, { label: string; className: string }> = {
    current: { label: 'Current Plan', className: 'bg-foreground/10 text-foreground border border-foreground/20' },
    popular: { label: 'Most Popular', className: 'bg-primary text-primary-foreground' },
    'best-value': { label: 'Best Value', className: 'bg-primary text-primary-foreground' },
}

export function PricingCard({
    icon: Icon,
    title,
    description,
    price,
    priceSuffix,
    features,
    ctaLabel,
    ctaVariant = 'default',
    interval,
    onIntervalChange,
    badge,
    disabled,
    onCtaClick,
}: PricingCardProps) {
    const displayPrice = typeof price === 'object'
        ? (interval === 'monthly' ? price.monthly : price.annual)
        : price

    return (
        <Card className={cn("relative border-border backdrop-blur-xl flex flex-col bg-muted/50 dark:bg-black/30 dark:border-white/20", title === 'Pro' ? "h-full" : "h-full")}>
            <div className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden bg-linear-to-br from-foreground/10 to-transparent" />

            {badge && badge !== 'current' && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span className={cn('text-xs xl:text-sm font-medium px-3 xl:px-4 py-1 xl:py-1.5 rounded-full block', BADGE_CONFIG[badge].className)}>
                        {BADGE_CONFIG[badge].label}
                    </span>
                </div>
            )}

            <CardHeader className="relative gap-4 xl:gap-5">
                <div className="size-14 xl:size-15 2xl:size-16 rounded-2xl flex items-center justify-center shrink-0 bg-foreground/10 border border-foreground/15">
                    <Icon className="size-6 xl:size-7 text-foreground/70" />
                </div>

                <div>
                    <CardTitle className="text-2xl xl:text-3xl mb-2 font-body font-medium">{title}</CardTitle>
                    <div className="flex items-center gap-1.5">
                        {displayPrice === 0 ? (
                            <span className="text-4xl xl:text-5xl font-medium text-foreground leading-none">FREE</span>
                        ) : typeof price === 'object' ? (
                            <>
                                <span className="text-xl xl:text-2xl text-muted-foreground">$</span>
                                <CountingNumber
                                    number={displayPrice}
                                    decimalPlaces={2}
                                    initiallyStable
                                    inView
                                    transition={{ stiffness: 300, damping: 60 }}
                                    className="text-4xl xl:text-5xl font-medium text-foreground leading-none tabular-nums"
                                />
                                {priceSuffix && (
                                    <span className="text-sm xl:text-base text-muted-foreground mt-auto mb-1 ml-0.5">{priceSuffix}</span>
                                )}
                            </>
                        ) : (
                            <>
                                <span className="text-xl xl:text-2xl text-muted-foreground">$</span>
                                <span className="text-4xl xl:text-5xl font-medium text-foreground leading-none">{displayPrice}</span>
                                {priceSuffix && (
                                    <span className="text-sm xl:text-base text-muted-foreground mt-auto mb-1 ml-0.5">{priceSuffix}</span>
                                )}
                            </>
                        )}
                    </div>

                    {interval && onIntervalChange ? (
                        <div className="flex items-center gap-1.5 mt-2">
                            {(['monthly', 'annual'] as Interval[]).map(i => (
                                <button
                                    key={i}
                                    onClick={() => onIntervalChange(i)}
                                    className={cn(
                                        'text-xs xl:text-sm px-3 xl:px-4 py-1 xl:py-1.5 rounded-full border transition-colors capitalize',
                                        interval === i
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-border text-muted-foreground hover:border-primary/50'
                                    )}
                                >
                                    {i}
                                </button>
                            ))}
                            <div className={cn("flex items-center gap-0.5 -mb-4", interval === 'annual' && "invisible")}>
                                <svg className='stroke-primary' width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M19.2502 13.4903C17.2329 13.9151 12.0803 14.7522 10.9872 12.5038C10.1127 10.7051 12.5922 8.94374 11.7177 7.14504C10.6246 4.89667 5.02236 5.95241 3.00505 6.37719" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                                    <path d="M5.3725 14.6775L1.0002 5.68397L9.9937 1.31167" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                                <span className="text-xs xl:text-sm text-primary font-medium -mb-2 ml-1">Save 25%</span>
                            </div>
                        </div>
                    ) : (
                        <CardDescription className="mt-1 xl:text-base">{description}</CardDescription>
                    )}
                </div>
            </CardHeader>

            <CardContent className="relative">
                <ul className="flex flex-col gap-3 xl:gap-4">
                    {features.map(f => (
                        <li key={f} className="flex items-start gap-2.5 text-sm xl:text-base text-muted-foreground">
                            <Check className="size-4 xl:size-5 text-foreground/70 shrink-0 mt-0.5" />
                            {f}
                        </li>
                    ))}
                </ul>
            </CardContent>

            <CardFooter className="relative mt-auto">
                <Button variant={ctaVariant} className="w-full h-10 xl:h-11 xl:text-base" disabled={badge === 'current' || disabled} onClick={onCtaClick}>
                    {badge === 'current' ? 'Current Plan' : interval ? `${ctaLabel} (${interval === 'monthly' ? 'Monthly' : 'Annual'})` : ctaLabel}
                </Button>
            </CardFooter>
        </Card>
    )
}
