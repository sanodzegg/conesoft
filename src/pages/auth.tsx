import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { useCountsStore } from '@/lib/useConversionCount'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AccountCard } from '@/components/profile/AccountCard'
import { PlanCard } from '@/components/profile/PlanCard'
import { UsageCard } from '@/components/profile/UsageCard'

type Mode = 'login' | 'signup'

export default function Auth() {
    const { user, plan, subscriptionEnd, loading } = useAuth()
    const counts = useCountsStore(s => s.counts)
    const [mode, setMode] = useState<Mode>('login')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [oauthLoading, setOauthLoading] = useState<string | null>(null)

    useEffect(() => {
        const unsub = window.electron.onOAuthCallback(async (url) => {
            try {
                const hashParams = new URL(url.replace('conesoft://', 'https://conesoft.app/')).hash
                const params = new URLSearchParams(hashParams.slice(1))
                const accessToken = params.get('access_token')
                const refreshToken = params.get('refresh_token')
                if (accessToken && refreshToken) {
                    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
                    if (error) setError(error.message)
                } else {
                    setError('Login did not return tokens.')
                }
            } catch (e) {
                setError('Login failed: ' + (e instanceof Error ? e.message : String(e)))
            } finally {
                setOauthLoading(null)
            }
        })
        return unsub
    }, [])

    function friendlyAuthError(msg: string) {
        if (/failed to fetch|networkerror|network request failed/i.test(msg)) return 'No internet connection.'
        return msg
    }

    async function signInWithProvider(provider: 'github' | 'google') {
        setError(null)
        if (!navigator.onLine) { setError('No internet connection.'); return }
        setOauthLoading(provider)
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider,
            options: { skipBrowserRedirect: true, redirectTo: 'conesoft://auth' },
        })
        if (error) { setError(friendlyAuthError(error.message)); setOauthLoading(null); return }
        if (data.url) window.electron.openExternal(data.url)
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setMessage(null)
        if (!navigator.onLine) { setError('No internet connection.'); return }
        setSubmitting(true)

        if (mode === 'login') {
            const { error } = await supabase.auth.signInWithPassword({ email, password })
            if (error) setError(friendlyAuthError(error.message))
        } else {
            const { error } = await supabase.auth.signUp({ email, password })
            if (error) setError(friendlyAuthError(error.message))
            else setMessage('Check your email to confirm your account.')
        }

        setSubmitting(false)
    }

    if (loading) return null

    if (user) {
        return (
            <section className="section py-8 xl:py-10 2xl:py-12">
                <div className="mb-6 xl:mb-7 2xl:mb-8">
                    <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">Account</h2>
                    <p className="text-sm xl:text-base text-muted-foreground mt-1">Manage your account, plan, and usage.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 xl:gap-5 2xl:gap-6">
                    <AccountCard user={user} />
                    <UsageCard plan={plan} counts={counts} />
                    <PlanCard plan={plan} subscriptionEnd={subscriptionEnd} />
                </div>
            </section>
        )
    }

    const isLoading = !!oauthLoading || submitting

    return (
        <section className="section py-8 xl:py-10 2xl:py-12">
            <div className="mb-6 xl:mb-7 2xl:mb-8">
                <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">Account</h2>
                <p className="text-sm xl:text-base text-muted-foreground mt-1">Sign in to sync your usage and settings across devices.</p>
            </div>

            <div className="grid grid-cols-2 gap-4 xl:gap-5 2xl:gap-6">
                <div className="rounded-2xl border border-border p-5 xl:p-6 space-y-4 xl:space-y-5 relative">
                    <p className="text-sm xl:text-base font-medium text-muted-foreground uppercase tracking-wide">
                        {mode === 'login' ? 'Sign in' : 'Create account'}
                    </p>

                    <div className="space-y-2 xl:space-y-3">
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full xl:h-10"
                            disabled={!!oauthLoading}
                            onClick={() => signInWithProvider('github')}
                        >
                            <svg className="mr-2 h-4 w-4 xl:h-5 xl:w-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                            </svg>
                            {oauthLoading === 'github' ? 'Opening browser…' : 'Continue with GitHub'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full xl:h-10"
                            disabled={!!oauthLoading}
                            onClick={() => signInWithProvider('google')}
                        >
                            <svg className="mr-2 h-4 w-4 xl:h-5 xl:w-5" viewBox="0 0 24 24">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                            {oauthLoading === 'google' ? 'Opening browser…' : 'Continue with Google'}
                        </Button>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs xl:text-sm text-muted-foreground">or</span>
                        <div className="h-px flex-1 bg-border" />
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3 xl:space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                autoFocus
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                            />
                        </div>

                        {error && <p className="text-sm xl:text-base text-destructive">{error}</p>}
                        {message && <p className="text-sm xl:text-base text-primary">{message}</p>}

                        <Button type="submit" className="w-full xl:h-10" disabled={submitting}>
                            {submitting ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : mode === 'login' ? 'Sign in' : 'Create account'}
                        </Button>
                    </form>

                    <p className="text-sm xl:text-base text-muted-foreground text-center">
                        {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
                        <button
                            className="text-primary underline underline-offset-2"
                            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setMessage(null) }}
                        >
                            {mode === 'login' ? 'Sign up' : 'Sign in'}
                        </button>
                    </p>

                    {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/80 backdrop-blur-sm">
                            <svg className="h-6 w-6 xl:h-7 xl:w-7 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            <p className="text-sm xl:text-base text-muted-foreground">
                                {oauthLoading ? 'Waiting for browser…' : 'Signing in…'}
                            </p>
                        </div>
                    )}
                </div>

                <UsageCard plan={plan} counts={counts} />
                <PlanCard plan={plan} subscriptionEnd={subscriptionEnd} />
            </div>
        </section>
    )
}
