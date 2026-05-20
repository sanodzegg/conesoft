import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser()
  if (userError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: row } = await supabaseAdmin
    .from('users')
    .select('paddle_subscription_id')
    .eq('id', user.id)
    .single()

  if (!row?.paddle_subscription_id) {
    return new Response('No active subscription', { status: 400, headers: corsHeaders })
  }

  const apiKey = Deno.env.get('PADDLE_API_KEY')!
  const baseUrl = Deno.env.get('PADDLE_SANDBOX') === 'true'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com'

  const res = await fetch(`${baseUrl}/subscriptions/${row.paddle_subscription_id}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ effective_from: 'next_billing_period' }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('Paddle cancel failed:', body)
    return new Response('Failed to cancel subscription', { status: 500, headers: corsHeaders })
  }

  console.log(`Canceled subscription ${row.paddle_subscription_id} for user ${user.id}`)
  return new Response('OK', { status: 200, headers: corsHeaders })
})
