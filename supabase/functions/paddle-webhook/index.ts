import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PRICE_TO_PLAN: Record<string, string> = {
  'pri_01kqptt95hvdw00sffx18tkj8x': 'monthly',
  'pri_01kqpttzaxm10swzh9289rtrcn': 'annual',
  'pri_01kqptvpbwmkx94hbbcjfyxk9j': 'lifetime',
}

// Reject signatures older than this to blunt replay attacks (Paddle ts is unix seconds).
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60

// Length-independent constant-time string comparison - avoids leaking the HMAC via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

async function verifySignature(rawBody: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(';').map(p => p.split('=')))
  const ts = parts['ts']
  const h1 = parts['h1']
  if (!ts || !h1) return false

  // Freshness check first - a stale (or absurdly future) timestamp can't be a live event.
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > MAX_SIGNATURE_AGE_SECONDS) {
    return false
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${rawBody}`))
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return timingSafeEqual(computed, h1)
}

Deno.serve(async (req) => {
  const webhookSecret = Deno.env.get('PADDLE_WEBHOOK_SECRET')
  if (!webhookSecret) return new Response('Webhook secret not configured', { status: 500 })

  const rawBody = await req.text()
  const signatureHeader = req.headers.get('Paddle-Signature') ?? ''

  const valid = await verifySignature(rawBody, signatureHeader, webhookSecret)
  if (!valid) return new Response('Invalid signature', { status: 401 })

  const event = JSON.parse(rawBody)
  const { event_type, data } = event

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (event_type === 'transaction.completed') {
    const userId = data.custom_data?.user_id
    if (!userId) return new Response('Missing user_id in custom_data', { status: 400 })

    const priceId = data.items?.[0]?.price?.id
    const plan = PRICE_TO_PLAN[priceId]
    if (!plan) return new Response(`Unknown price ID: ${priceId}`, { status: 400 })

    const isSubscription = plan === 'monthly' || plan === 'annual'

    const { error } = await supabase
      .from('users')
      .update({
        plan,
        subscription_end: isSubscription ? (data.billing_period?.ends_at ?? null) : null,
        paddle_customer_id: data.customer_id ?? null,
        paddle_subscription_id: isSubscription ? (data.subscription_id ?? null) : null,
        paddle_transaction_id: !isSubscription ? data.id : null,
      })
      .eq('id', userId)

    if (error) {
      console.error('Failed to update user plan:', error)
      return new Response('DB error', { status: 500 })
    }

    console.log(`Updated user ${userId} to plan ${plan}`)
    return new Response('OK', { status: 200 })
  }

  if (event_type === 'subscription.canceled') {
    const subscriptionId = data.id
    if (!subscriptionId) return new Response('Missing subscription ID', { status: 400 })

    const subscriptionEnd = data.current_billing_period?.ends_at ?? new Date().toISOString()

    const { error } = await supabase
      .from('users')
      .update({ plan: 'limited', paddle_subscription_id: null, subscription_end: subscriptionEnd })
      .eq('paddle_subscription_id', subscriptionId)

    if (error) {
      console.error('Failed to cancel subscription:', error)
      return new Response('DB error', { status: 500 })
    }

    console.log(`Canceled subscription ${subscriptionId}`)
    return new Response('OK', { status: 200 })
  }

  return new Response('Unhandled event', { status: 200 })
})
