import { useState } from 'react'
import { Clock, Zap, Star, Timer } from 'lucide-react'
import { PricingCard } from '@/components/pricing/pricing-card'
import { useAuth } from '@/lib/useAuth'
import { isTrialExhausted } from '@/lib/useConversionCount'
import pricingBgDark from '@/assets/pricing-bg.webm'
import pricingBgLight from '@/assets/pricing-bg-light.webm'
import { useTheme } from '@/components/theme/theme-provider'

type Interval = 'monthly' | 'annual'

// Tier ordering for downgrade detection. Pro (monthly/annual) share rank 2.
const PLAN_RANK: Record<string, number> = {
    trial: 0,
    limited: 0,
    monthly: 1,
    annual: 1,
    lifetime: 2,
}
const CARD_RANK: Record<string, number> = {
    trial: 0,
    limited: 0,
    pro: 1,
    lifetime: 2,
}

const PLANS = [
    {
        id: 'trial',
        icon: Clock,
        title: 'Trial',
        description: 'Free to get started',
        price: 0,
        features: [
            '200 image conversions',
            '150 document conversions',
            '50 video conversions',
            'All output formats included',
            'Image editor & canvas tools',
            'Favicon generator',
            'SVG editor',
        ],
        ctaLabel: 'Get started',
        ctaVariant: 'outline' as const,
    },
    {
        id: 'limited',
        icon: Timer,
        title: 'Limited',
        description: 'Free with daily limits',
        price: 0,
        features: [
            '20 image conversions / day',
            '15 document conversions / day',
            '5 video conversions / day',
            'Resets every 24 hours',
            'Image editor & canvas tools',
            'Favicon generator',
            'SVG editor',
        ],
        ctaLabel: 'Upgrade to Pro',
        ctaVariant: 'outline' as const,
    },
    {
        id: 'pro',
        icon: Zap,
        title: 'Pro',
        description: 'Billed monthly or annually',
        price: { monthly: 8, annual: 6 },
        priceSuffix: '/mo',
        features: [
            'Unlimited conversions — no caps',
            'Bulk convert entire folders at once',
            'Watch folder, auto-convert on save',
            'Image editor & canvas tools',
            'Favicon generator & SVG editor',
            'Settings sync across devices',
            'Priority support',
        ],
        ctaLabel: 'Get Pro',
        ctaVariant: 'default' as const,
    },
    {
        id: 'lifetime',
        icon: Star,
        title: 'Lifetime',
        description: 'Pay once, own it forever.',
        price: 110,
        features: [
            'Everything in Pro, forever',
            'One-time payment, no renewals',
            'All future updates included',
            'Works fully offline',
        ],
        ctaLabel: 'Get Lifetime',
        ctaVariant: 'outline' as const,
    },
]

export default function Pricing() {
    const { theme } = useTheme();
    const { plan } = useAuth()
    const [interval, setInterval] = useState<Interval>('annual')
    const [videoReady, setVideoReady] = useState(false)
    const trialExhausted = isTrialExhausted()
    const showLimited = plan === 'limited' || (plan === 'trial' && trialExhausted)

    const pricingBg = theme === 'dark' ? pricingBgDark : pricingBgLight

    return (
        <section className="relative overflow-hidden min-h-[calc(100vh-var(--nav-height))]">
            <div className='section py-8 2xl:py-12'>
                <video
                    src={pricingBg}
                    autoPlay
                    loop
                    muted
                    playsInline
                    onCanPlay={() => setVideoReady(true)}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-700"
                    style={{ opacity: videoReady ? .7 : 0 }}
                />
                <div className="relative z-10 mb-10 2xl:mb-14 text-center">
                    <h2 className="text-4xl 2xl:text-5xl font-body font-semibold text-foreground mb-3 2xl:mb-4">Simple, transparent pricing</h2>
                    <p className="text-sm 2xl:text-base text-muted-foreground">No subscriptions required. Start free, upgrade when you need more.</p>
                </div>
                <div className="relative z-10 grid grid-cols-3 gap-4 2xl:gap-6 items-center">
                    {PLANS.filter(p => showLimited ? p.id !== 'trial' : p.id !== 'limited').map(p => {
                        const isCurrent =
                            (p.id === 'limited' && showLimited) ||
                            (p.id === 'trial' && plan === 'trial' && !showLimited) ||
                            (p.id === 'pro' && plan === interval) ||
                            (p.id === 'lifetime' && plan === 'lifetime')
                        const userRank = PLAN_RANK[plan] ?? 0
                        const cardRank = CARD_RANK[p.id]
                        const isDowngrade = !isCurrent && cardRank < userRank
                        const badge = isCurrent ? 'current' : p.id === 'pro' ? 'popular' : p.id === 'lifetime' ? 'best-value' : undefined
                        return (
                            <PricingCard
                                key={p.id}
                                icon={p.icon}
                                title={p.title}
                                description={p.description}
                                price={p.price}
                                priceSuffix={p.priceSuffix}
                                features={p.features}
                                ctaLabel={isDowngrade ? 'Not available' : p.ctaLabel}
                                ctaVariant={p.ctaVariant}
                                badge={badge}
                                disabled={isDowngrade}
                                {...(p.id === 'pro' && { interval, onIntervalChange: setInterval })}
                            />
                        )
                    })}
                </div>
            </div>
        </section>
    )
}
