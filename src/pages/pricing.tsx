import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
        description: 'Try everything, on us',
        price: 0,
        features: [
            '100 tokens to start',
            'Images 1 · documents 5 · audio 6 · video 8 tokens',
            'All conversion types & output formats',
            'Image editor & canvas tools',
            'Favicon generator & SVG editor',
        ],
        ctaLabel: 'Get started',
        ctaVariant: 'outline' as const,
    },
    {
        id: 'limited',
        icon: Timer,
        title: 'Free',
        description: 'Keep converting, every day',
        price: 0,
        features: [
            '50 tokens every day',
            'Refreshes every 24 hours',
            'All conversion types & output formats',
            'Image editor & canvas tools',
            'Favicon generator & SVG editor',
        ],
        ctaLabel: 'Upgrade to Pro',
        ctaVariant: 'outline' as const,
    },
    {
        id: 'pro',
        icon: Zap,
        title: 'Pro',
        description: 'No tokens, no counting',
        price: { monthly: 8, annual: 6 },
        priceSuffix: '/mo',
        features: [
            'Unlimited conversions - no tokens',
            'Bulk convert entire folders',
            'Watch folders - convert new files automatically',
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
        description: 'Pay once, own it forever',
        price: 110,
        features: [
            'Everything in Pro, forever',
            'One payment - no renewals',
            'All future updates included',
            'Works fully offline',
        ],
        ctaLabel: 'Get Lifetime',
        ctaVariant: 'outline' as const,
    },
]

export default function Pricing() {
    const { theme } = useTheme();
    const { user, plan } = useAuth()
    const navigate = useNavigate()
    const [interval, setInterval] = useState<Interval>('annual')

    function handleCheckout(planId: 'pro' | 'lifetime') {
        if (!user) { navigate('/account'); return }
        const resolvedPlan = planId === 'pro' ? interval : 'lifetime'
        const url = `https://conesoft.app?uid=${user.id}&plan=${resolvedPlan}#pricing`
        window.electron.openExternal(url)
    }
    const [videoReady, setVideoReady] = useState(false)
    const trialExhausted = isTrialExhausted()
    const showLimited = plan === 'limited' || (plan === 'trial' && trialExhausted)

    const pricingBg = theme === 'dark' ? pricingBgDark : pricingBgLight

    return (
        <section className="relative overflow-hidden min-h-[calc(100vh-var(--nav-height))]">
            <div className='section py-8 xl:py-10 2xl:py-12'>
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
                <div className="relative z-10 mb-10 xl:mb-12 2xl:mb-14 text-center">
                    <h2 className="text-4xl xl:text-5xl font-body font-semibold text-foreground mb-3 xl:mb-4">Simple, transparent pricing</h2>
                    <p className="text-sm xl:text-base text-muted-foreground">Start free. Upgrade when you need more - or pay once and keep it forever.</p>
                </div>
                <div className="relative z-10 grid grid-cols-3 gap-4 xl:gap-5 2xl:gap-6 items-center">
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
                                {...(p.id === 'pro' || p.id === 'lifetime' ? { onCtaClick: () => handleCheckout(p.id as 'pro' | 'lifetime') } : {})}
                            />
                        )
                    })}
                </div>
            </div>
        </section>
    )
}
