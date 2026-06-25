import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { LogOut, Mail, Calendar } from 'lucide-react'

interface AccountCardProps {
    user: User
}

export function AccountCard({ user }: AccountCardProps) {
    async function handleSignOut() {
        await supabase.auth.signOut()
    }

    const provider = user.app_metadata?.provider
    const providerLabel =
        provider === 'google' ? 'Google' :
        provider === 'github' ? 'GitHub' :
        'Email'

    return (
        <div className="rounded-2xl border border-border p-5 xl:p-6 space-y-4 xl:space-y-5">
            <p className="text-sm xl:text-base font-medium text-muted-foreground uppercase tracking-wide">Account</p>

            <div className="space-y-3 xl:space-y-4">
                <div className="flex items-center gap-3">
                    <div className="size-11 xl:size-12 2xl:size-13 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-base xl:text-lg font-semibold text-primary">
                            {(user.email?.[0] ?? '?').toUpperCase()}
                        </span>
                    </div>
                    <div className="min-w-0">
                        <p className="text-base xl:text-lg font-medium text-foreground truncate">{user.email}</p>
                        <p className="text-sm xl:text-base text-muted-foreground">Signed in with {providerLabel}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 text-sm xl:text-base text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <Calendar className="size-4 xl:size-5" />
                        Member since {new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                </div>
            </div>

            <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-1.5 xl:text-sm xl:h-9">
                <LogOut className="size-3.5 xl:size-4" />
                Sign out
            </Button>
        </div>
    )
}
