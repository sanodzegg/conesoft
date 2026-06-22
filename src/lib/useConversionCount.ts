import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export type EngineType = 'image' | 'document' | 'video' | 'audio'

export interface ConversionCounts {
    image: number
    document: number
    video: number
    audio: number
}

const STORAGE_KEY = 'conesoft_conversion_counts'
const DAILY_STORAGE_KEY = 'conesoft_daily_counts'

// `tokens_used` is the single quota currency. Per-category counts are kept only for
// analytics/bonuses and are NOT arithmetically linked to tokens_used (see TODO.md spec).
// Token cost per conversion, applied going forward:
export const TOKEN_COSTS: Record<EngineType, number> = {
    image: 1,
    document: 5,
    video: 8,
    audio: 6,
}

// Cost used to value pre-token historical usage at migration/backfill time. Kept at the
// OLD flat rate (image 1, others 5) so existing users' standing doesn't shift when the
// heavier media costs land - the new costs apply only to new conversions. Mirrors the
// SQL backfill in migrations/20260603120000_add_tokens_used.sql.
const BACKFILL_COSTS: Record<EngineType, number> = {
    image: 1,
    document: 5,
    video: 5,
    audio: 5,
}

export const TRIAL_TOKEN_LIMIT = 100   // lifetime trial budget
export const DAILY_TOKEN_LIMIT = 50    // limited-tier daily allowance

interface LocalCounts extends ConversionCounts {
    tokensUsed: number
}

interface DailyTokens {
    tokens: number
    resetAt: number // epoch ms when the window expires
}

function freshDaily(): DailyTokens {
    return { tokens: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 }
}

function getDailyLocal(): DailyTokens {
    try {
        const raw = localStorage.getItem(DAILY_STORAGE_KEY)
        if (!raw) return freshDaily()
        const parsed = JSON.parse(raw)
        // Old per-category daily format (pre-tokens) has no numeric `tokens` - start fresh.
        if (typeof parsed.tokens !== 'number' || typeof parsed.resetAt !== 'number') {
            const fresh = freshDaily()
            localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(fresh))
            return fresh
        }
        if (Date.now() > parsed.resetAt) {
            const fresh = freshDaily()
            localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(fresh))
            return fresh
        }
        return parsed as DailyTokens
    } catch {
        return freshDaily()
    }
}

function setDailyLocal(daily: DailyTokens) {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(daily))
    useCountsStore.setState({ dailyTokens: daily.tokens })
}

export function getDailyCounts(): DailyTokens {
    return getDailyLocal()
}

export function getDailyTokens(): number {
    return getDailyLocal().tokens
}

function backfillTokens(c: ConversionCounts): number {
    return (
        c.image * BACKFILL_COSTS.image +
        c.document * BACKFILL_COSTS.document +
        c.video * BACKFILL_COSTS.video +
        c.audio * BACKFILL_COSTS.audio
    )
}

function getLocal(): LocalCounts {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return { image: 0, document: 0, video: 0, audio: 0, tokensUsed: 0 }
        const parsed = JSON.parse(raw)
        const counts: ConversionCounts = {
            image: parsed.image ?? 0,
            document: parsed.document ?? 0,
            video: parsed.video ?? 0,
            audio: parsed.audio ?? 0,
        }
        // Backfill tokensUsed from existing counts (old flat rate) for pre-token local state.
        const tokensUsed = typeof parsed.tokensUsed === 'number' ? parsed.tokensUsed : backfillTokens(counts)
        return { ...counts, tokensUsed }
    } catch {
        return { image: 0, document: 0, video: 0, audio: 0, tokensUsed: 0 }
    }
}

function setLocal(next: LocalCounts) {
    const prev = getLocal()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    useCountsStore.setState({
        counts: { image: next.image, document: next.document, video: next.video, audio: next.audio },
        tokensUsed: next.tokensUsed,
    })
    // If tokens dropped back below the trial cap (e.g. admin refund), the daily bucket is stale - clear it.
    // The limited→trial plan flip itself is handled server-side now (DB trigger reset_plan_on_low_tokens),
    // and propagates back to the app via the users-table Realtime subscription in useAuthStore.
    if (prev.tokensUsed >= TRIAL_TOKEN_LIMIT && next.tokensUsed < TRIAL_TOKEN_LIMIT) {
        localStorage.removeItem(DAILY_STORAGE_KEY)
        useCountsStore.setState({ dailyTokens: 0 })
    }
}

export function getTokensUsed(): number {
    return getLocal().tokensUsed
}

export function isTrialExhausted(): boolean {
    return getLocal().tokensUsed >= TRIAL_TOKEN_LIMIT
}

export function getLocalCounts(): ConversionCounts {
    const l = getLocal()
    return { image: l.image, document: l.document, video: l.video, audio: l.audio }
}

// Reactive store so UI re-renders when usage changes (sign-in merge, spends, Realtime overwrites).
export const useCountsStore = create<{
    counts: ConversionCounts
    tokensUsed: number
    dailyTokens: number
}>()(() => {
    const l = getLocal()
    return {
        counts: { image: l.image, document: l.document, video: l.video, audio: l.audio },
        tokensUsed: l.tokensUsed,
        dailyTokens: getDailyLocal().tokens,
    }
})

// Timestamps of upserts we fired ourselves. Realtime echoes those writes back; we skip
// echoes whose updated_at is in this set so they don't overwrite the authoritative local
// state we just incremented. Admin edits from the dashboard carry an updated_at that was
// never put here, so they always pass through. Entries are pruned 10 s after insertion.
const ownPushTimestamps = new Set<string>()
function rememberPush(ts: string) {
    ownPushTimestamps.add(ts)
    setTimeout(() => ownPushTimestamps.delete(ts), 10_000)
}
function isSelfEcho(updatedAt: string | undefined): boolean {
    return !!updatedAt && ownPushTimestamps.has(updatedAt)
}

// Spend tokens for one conversion (reserved up front). Free tiers (trial + limited) draw from
// the lifetime trial budget FIRST, then spill the remainder into the daily allowance - so a
// single conversion can straddle the boundary (e.g. at 93/100 an 8-token job uses 7 trial + 1
// daily → daily 1/50). tokensUsed therefore tops out at TRIAL_TOKEN_LIMIT and represents trial
// budget consumed; the daily bucket holds today's overflow/limited spend; per-category counts
// record every conversion regardless. Synchronous localStorage RMW → parallel-safe. Returns
// [refund, reserved]; reserved=false means the combined free budget can't cover it. Paid plans
// are ungated. Call refund() if the conversion later fails - it reverses the exact split taken.
export function spendTokens(engine: EngineType, plan: string, costOverride?: number): [() => void, boolean] {
    const cost = costOverride ?? TOKEN_COSTS[engine]

    // Paid plans: ungated - just record the per-category analytics count.
    if (plan !== 'trial' && plan !== 'limited') {
        const local = getLocal()
        local[engine] += 1
        setLocal(local)
        return [() => {
            const l = getLocal()
            if (l[engine] > 0) l[engine] -= 1
            setLocal(l)
        }, true]
    }

    // Free tiers: trial budget first, overflow into the daily allowance.
    const trialRemaining = Math.max(0, TRIAL_TOKEN_LIMIT - getLocal().tokensUsed)
    const trialPart = Math.min(cost, trialRemaining)
    const dailyPart = cost - trialPart

    if (dailyPart > 0) {
        const daily = getDailyLocal()
        if (daily.tokens + dailyPart > DAILY_TOKEN_LIMIT) return [() => {}, false]
        daily.tokens += dailyPart
        setDailyLocal(daily)
    }

    const local = getLocal()
    local[engine] += 1
    local.tokensUsed += trialPart // ≤ trialRemaining, so tokensUsed caps at TRIAL_TOKEN_LIMIT
    setLocal(local)

    return [() => {
        if (dailyPart > 0) {
            const d = getDailyLocal()
            d.tokens = Math.max(0, d.tokens - dailyPart)
            setDailyLocal(d)
        }
        const l = getLocal()
        if (l[engine] > 0) l[engine] -= 1
        l.tokensUsed = Math.max(0, l.tokensUsed - trialPart)
        setLocal(l)
    }, true]
}

// "At limit" = this conversion can't be covered by the combined trial + daily free budget.
export function isAtLimit(engine: EngineType, plan: string): boolean {
    if (plan !== 'trial' && plan !== 'limited') return false
    const cost = TOKEN_COSTS[engine]
    const trialRemaining = Math.max(0, TRIAL_TOKEN_LIMIT - getLocal().tokensUsed)
    const dailyPart = Math.max(0, cost - trialRemaining)
    return dailyPart > 0 && getDailyTokens() + dailyPart > DAILY_TOKEN_LIMIT
}

export function useConversionCount(user: User | null) {
    const synced = useRef(false)

    useEffect(() => {
        if (!user || !navigator.onLine || synced.current) return

        // Fetch server counts and take the higher of server vs local (all monotonic).
        supabase
            .from('conversion_counts')
            .select('*')
            .eq('user_id', user.id)
            .single()
            .then(({ data, error }) => {
                // PGRST116 = no row yet (trigger slow / missing); treat as all-zeros so
                // local counts still get pushed up. Any other error is a real failure.
                if (error && error.code !== 'PGRST116') {
                    console.error('[conversionCount] fetch error:', error)
                    return
                }
                const local = getLocal()
                const server = {
                    image: data?.image_count ?? 0,
                    document: data?.document_count ?? 0,
                    video: data?.video_count ?? 0,
                    audio: data?.audio_count ?? 0,
                    tokensUsed: data?.tokens_used ?? 0,
                }
                const merged: LocalCounts = {
                    image: Math.max(local.image, server.image),
                    document: Math.max(local.document, server.document),
                    video: Math.max(local.video, server.video),
                    audio: Math.max(local.audio, server.audio),
                    tokensUsed: Math.max(local.tokensUsed, server.tokensUsed),
                }
                setLocal(merged)

                // Push merged back if local was higher or the row didn't exist yet.
                const needsPush = !data
                    || merged.image !== server.image
                    || merged.document !== server.document
                    || merged.video !== server.video
                    || merged.audio !== server.audio
                    || merged.tokensUsed !== server.tokensUsed
                if (needsPush) {
                    const ts = new Date().toISOString()
                    rememberPush(ts)
                    supabase.from('conversion_counts').upsert({
                        user_id: user.id,
                        image_count: merged.image,
                        document_count: merged.document,
                        video_count: merged.video,
                        audio_count: merged.audio,
                        tokens_used: merged.tokensUsed,
                        updated_at: ts,
                    }, { onConflict: 'user_id' }).then(({ error: upsertError }) => {
                        if (upsertError) console.error('[conversionCount] sign-in upsert error:', upsertError)
                    })
                }

                synced.current = true
            })
    }, [user])

    // Realtime sync: admin edits are applied verbatim; our own echoes are skipped via the
    // ownPushTimestamps guard so burst self-writes can't overwrite local state with a stale
    // intermediate value. The limited→trial plan flip is handled by a DB trigger and reaches
    // the app through the users-table Realtime subscription in useAuthStore.
    useEffect(() => {
        if (!user) return
        const channel = supabase
            .channel(`counts-${user.id}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'conversion_counts' },
                (payload) => {
                    if (payload.new.user_id !== user.id) return
                    if (isSelfEcho(payload.new.updated_at)) return
                    const counts: ConversionCounts = {
                        image: payload.new.image_count ?? 0,
                        document: payload.new.document_count ?? 0,
                        video: payload.new.video_count ?? 0,
                        audio: payload.new.audio_count ?? 0,
                    }
                    setLocal({
                        ...counts,
                        tokensUsed: typeof payload.new.tokens_used === 'number' ? payload.new.tokens_used : backfillTokens(counts),
                    })
                }
            )
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [user])

    // Debounced so burst conversions (e.g. Convert All on 20 files) collapse into a single
    // upsert fired 800 ms after the last success, carrying the final counts + tokens.
    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    function syncCountToServer() {
        if (!user || !navigator.onLine) return
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
        syncTimerRef.current = setTimeout(() => {
            syncTimerRef.current = null
            const local = getLocal()
            const ts = new Date().toISOString()
            rememberPush(ts)
            supabase.from('conversion_counts').upsert({
                user_id: user.id,
                image_count: local.image,
                document_count: local.document,
                video_count: local.video,
                audio_count: local.audio,
                tokens_used: local.tokensUsed,
                updated_at: ts,
            }, { onConflict: 'user_id' }).then(({ error }) => {
                if (error) console.error('[conversionCount] sync error:', error)
            })
        }, 800)
    }

    return { syncCountToServer }
}
