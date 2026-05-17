import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { supabase } from './supabase'
import { useAuthStore } from '@/store/useAuthStore'
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

// Per-category weights: 1 / budget. Score = sum(count * weight), threshold at 1.0.
// TOKEN_TOTAL maps the score to user-visible credits: image = 1 cr, others = 5 cr each.
export const TOKEN_TOTAL = 100
export const WEIGHTS = {
    image: 1 / 100,
    document: 1 / 20,
    video: 1 / 20,
    audio: 1 / 20,
}

const LIMITS: ConversionCounts = {
    image: 100,
    document: 20,
    video: 20,
    audio: 20,
}

const DAILY_LIMITS: ConversionCounts = {
    image: 20,
    document: 20,
    video: 10,
    audio: 10,
}

export const TRIAL_LIMITS = LIMITS
export const LIMITED_DAILY_LIMITS = DAILY_LIMITS

interface DailyCounts {
    image: number
    document: number
    video: number
    audio: number
    resetAt: number // epoch ms when the window expires
}

function getDailyLocal(): DailyCounts {
    try {
        const raw = localStorage.getItem(DAILY_STORAGE_KEY)
        if (!raw) return { image: 0, document: 0, video: 0, audio: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 }
        const parsed = JSON.parse(raw) as DailyCounts
        if (Date.now() > parsed.resetAt) {
            const fresh: DailyCounts = { image: 0, document: 0, video: 0, audio: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 }
            localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(fresh))
            return fresh
        }
        return parsed
    } catch {
        return { image: 0, document: 0, video: 0, audio: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 }
    }
}

function setDailyLocal(counts: DailyCounts) {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(counts))
}

export function incrementDailyCount(engine: EngineType) {
    const counts = getDailyLocal()
    if (counts[engine] >= DAILY_LIMITS[engine]) return
    counts[engine] = (counts[engine] ?? 0) + 1
    setDailyLocal(counts)
}

export function getDailyCounts(): DailyCounts {
    return getDailyLocal()
}

// Score = sum(count * weight), capped at 1.0 per category. Flip to 'limited' at 0.9.
const EXHAUSTION_THRESHOLD = 1.0

export function getTrialScore(counts: ConversionCounts): number {
    return (
        Math.min(counts.image * WEIGHTS.image, 1) +
        Math.min(counts.document * WEIGHTS.document, 1) +
        Math.min(counts.video * WEIGHTS.video, 1) +
        Math.min(counts.audio * WEIGHTS.audio, 1)
    )
}

export function isTrialExhausted(): boolean {
    return getTrialScore(getLocal()) >= EXHAUSTION_THRESHOLD
}

function getLocal(): ConversionCounts {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return { image: 0, document: 0, video: 0, audio: 0 }
        const parsed = JSON.parse(raw)
        return {
            image: parsed.image ?? 0,
            document: parsed.document ?? 0,
            video: parsed.video ?? 0,
            audio: parsed.audio ?? 0,
        }
    } catch {
        return { image: 0, document: 0, video: 0, audio: 0 }
    }
}

function setLocal(counts: ConversionCounts, { reconcile = false } = {}) {
    const prev = getLocal()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts))
    useCountsStore.setState({ counts })
    // If the overall score dropped back below exhaustion, daily buckets are stale — clear them.
    if (getTrialScore(prev) >= EXHAUSTION_THRESHOLD && getTrialScore(counts) < EXHAUSTION_THRESHOLD) {
        localStorage.removeItem(DAILY_STORAGE_KEY)
    }
    if (reconcile) reconcilePlanWithCounts(counts)
}

// Only called from authoritative sources (Realtime events, sign-in merge) — never from
// local refunds, so no threshold games needed: score < 1.0 means trial isn't exhausted.
function reconcilePlanWithCounts(counts: ConversionCounts) {
    const store = useAuthStore.getState()
    if (store.plan !== 'limited') return
    if (getTrialScore(counts) >= EXHAUSTION_THRESHOLD) return
    store.setPlan('trial')
    const uid = store.user?.id
    if (uid) {
        supabase.from('users').update({ plan: 'trial' }).eq('id', uid)
            .then(({ error }) => { if (error) console.error('[conversionCount] failed to revert plan:', error) })
    }
}

// Reactive store so UI re-renders when counts change (sign-in merge, increments, Realtime overwrites)
export const useCountsStore = create<{ counts: ConversionCounts }>()(() => ({
    counts: getLocal(),
}))

// Timestamps of upserts we fired ourselves. Realtime echoes those writes back;
// we skip echoes whose updated_at is in this set so they don't overwrite the
// authoritative local state we just incremented. Admin edits from the dashboard
// carry an updated_at that was never put here, so they always pass through.
// Entries are pruned 10 s after insertion — ample time for any echo to arrive.
const ownPushTimestamps = new Set<string>()
function rememberPush(ts: string) {
    ownPushTimestamps.add(ts)
    setTimeout(() => ownPushTimestamps.delete(ts), 10_000)
}
function isSelfEcho(updatedAt: string | undefined): boolean {
    return !!updatedAt && ownPushTimestamps.has(updatedAt)
}

// Returns a refund fn that reverses exactly what this increment did. Counts are
// reserved at the start of a conversion so parallel attempts can't all pass the
// same limit check; call the returned refund fn if the conversion ends up failing
// so the user doesn't lose a slot.
// Returns [refund, reserved]. reserved=false means the limit was already full and
// no slot was taken — caller must not proceed with the conversion.
export function incrementLocalCount(engine: EngineType, plan: string): [() => void, boolean] {
    // limited plan: track daily window only, not the lifetime total
    if (plan === 'limited') {
        const daily = getDailyLocal()
        if (daily[engine] >= DAILY_LIMITS[engine]) return [() => {}, false]
        daily[engine] = (daily[engine] ?? 0) + 1
        setDailyLocal(daily)
        return [() => {
            const d = getDailyLocal()
            if (d[engine] > 0) {
                d[engine] = d[engine] - 1
                setDailyLocal(d)
            }
        }, true]
    }
    // trial + paid: always increment lifetime total
    const counts = getLocal()
    counts[engine] = (counts[engine] ?? 0) + 1
    setLocal(counts)
    return [() => {
        const c = getLocal()
        if (c[engine] > 0) {
            c[engine] = c[engine] - 1
            setLocal(c)
        }
    }, true]
}

export function getLocalCounts(): ConversionCounts {
    return getLocal()
}

export function isAtLimit(engine: EngineType, plan: string): boolean {
    if (plan !== 'trial' && plan !== 'limited') return false
    if (plan === 'limited') {
        return getDailyLocal()[engine] >= DAILY_LIMITS[engine]
    }
    return getTrialScore(getLocal()) >= EXHAUSTION_THRESHOLD
}

export function useConversionCount(user: User | null) {
    const synced = useRef(false)

    useEffect(() => {
        if (!user || !navigator.onLine || synced.current) return

        // Fetch server counts and take the higher of server vs local
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
                }
                const merged: ConversionCounts = {
                    image: Math.max(local.image, server.image),
                    document: Math.max(local.document, server.document),
                    video: Math.max(local.video, server.video),
                    audio: Math.max(local.audio, server.audio),
                }
                setLocal(merged, { reconcile: true })

                // Push merged back to server if local was higher or row didn't exist yet
                const needsPush = !data
                    || merged.image !== server.image
                    || merged.document !== server.document
                    || merged.video !== server.video
                    || merged.audio !== server.audio
                if (needsPush) {
                    const ts = new Date().toISOString()
                    rememberPush(ts)
                    supabase.from('conversion_counts').upsert({
                        user_id: user.id,
                        image_count: merged.image,
                        document_count: merged.document,
                        video_count: merged.video,
                        audio_count: merged.audio,
                        updated_at: ts,
                    }, { onConflict: 'user_id' }).then(({ error: upsertError }) => {
                        if (upsertError) console.error('[conversionCount] sign-in upsert error:', upsertError)
                    })
                }

                synced.current = true
            })
    }, [user])

    // Realtime sync: admin edits are applied verbatim; our own echoes are skipped via
    // the ownPushTimestamps guard so burst self-writes can't overwrite local state with
    // a stale intermediate value. setLocal calls reconcilePlanWithCounts automatically.
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
                    setLocal({
                        image: payload.new.image_count ?? 0,
                        document: payload.new.document_count ?? 0,
                        video: payload.new.video_count ?? 0,
                        audio: payload.new.audio_count ?? 0,
                    }, { reconcile: true })
                }
            )
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [user])

    // Debounced so burst conversions (e.g. Convert All on 20 files) collapse into a
    // single upsert fired 800 ms after the last success, carrying the final counts.
    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    function syncCountToServer() {
        if (!user || !navigator.onLine) return
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
        syncTimerRef.current = setTimeout(() => {
            syncTimerRef.current = null
            const counts = getLocal()
            const ts = new Date().toISOString()
            rememberPush(ts)
            supabase.from('conversion_counts').upsert({
                user_id: user.id,
                image_count: counts.image,
                document_count: counts.document,
                video_count: counts.video,
                audio_count: counts.audio,
                updated_at: ts,
            }, { onConflict: 'user_id' }).then(({ error }) => {
                if (error) console.error('[conversionCount] sync error:', error)
            })
        }, 800)
    }

    return { syncCountToServer }
}
