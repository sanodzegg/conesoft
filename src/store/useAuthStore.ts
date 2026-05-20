import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export type Plan = 'trial' | 'limited' | 'monthly' | 'annual' | 'lifetime'

const PLAN_KEY = 'conesoft_plan'
const SUBSCRIPTION_END_KEY = 'conesoft_subscription_end'

function getStoredPlan(): Plan {
    return (localStorage.getItem(PLAN_KEY) as Plan) ?? 'trial'
}

function storePlan(plan: Plan) {
    localStorage.setItem(PLAN_KEY, plan)
}

function getStoredSubscriptionEnd(): string | null {
    return localStorage.getItem(SUBSCRIPTION_END_KEY)
}

function storeSubscriptionEnd(value: string | null) {
    if (value) localStorage.setItem(SUBSCRIPTION_END_KEY, value)
    else localStorage.removeItem(SUBSCRIPTION_END_KEY)
}

interface AuthState {
    user: User | null
    plan: Plan
    subscriptionEnd: string | null
    loading: boolean
    setPlan: (plan: Plan) => void
}

export const useAuthStore = create<AuthState>()(() => ({
    user: null,
    plan: getStoredPlan(),
    subscriptionEnd: getStoredSubscriptionEnd(),
    loading: true,
    setPlan: (plan) => {
        storePlan(plan)
        useAuthStore.setState({ plan })
    },
}))

function effectivePlan(plan: Plan, subscriptionEnd: string | null): Plan {
    if ((plan === 'monthly' || plan === 'annual') && subscriptionEnd && new Date(subscriptionEnd) < new Date()) {
        return 'limited'
    }
    return plan
}

async function fetchAndSetPlan(u: User) {
    const { data: row } = await supabase.from('users').select('plan, subscription_end').eq('id', u.id).single()
    const subscriptionEnd: string | null = row?.subscription_end ?? null
    const plan = effectivePlan((row?.plan as Plan) ?? 'trial', subscriptionEnd)
    storePlan(plan)
    storeSubscriptionEnd(subscriptionEnd)
    useAuthStore.setState({ user: u, plan, subscriptionEnd, loading: false })
}

// Listen for manual DB edits to users.plan via Realtime — Supabase is authoritative
let planChannel: ReturnType<typeof supabase.channel> | null = null

function subscribeToPlanChanges(userId: string) {
    unsubscribeFromPlanChanges()
    planChannel = supabase
        .channel(`plan-${userId}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'users' },
            (payload) => {
                if (payload.new.id !== userId) return
                const subscriptionEnd: string | null = payload.new.subscription_end ?? null
                const fresh = effectivePlan((payload.new.plan as Plan) ?? 'trial', subscriptionEnd)
                storePlan(fresh)
                storeSubscriptionEnd(subscriptionEnd)
                useAuthStore.setState({ plan: fresh, subscriptionEnd })
            }
        )
        .subscribe()
}

function unsubscribeFromPlanChanges() {
    if (planChannel) {
        supabase.removeChannel(planChannel)
        planChannel = null
    }
}

supabase.auth.getSession().then(async ({ data }) => {
    const u = data.session?.user ?? null
    if (!u) {
        useAuthStore.setState({ loading: false })
        return
    }
    await fetchAndSetPlan(u)
    subscribeToPlanChanges(u.id)
})

supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
        useAuthStore.setState({ user: null, loading: false })
        unsubscribeFromPlanChanges()
    } else if (event === 'SIGNED_IN' && session?.user) {
        fetchAndSetPlan(session.user)
        subscribeToPlanChanges(session.user.id)
    }
})
