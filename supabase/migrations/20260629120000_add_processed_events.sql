-- Idempotency ledger for Paddle webhook deliveries (TODO #5).
-- Paddle delivers webhooks at-least-once and retries on any slow/failed response, so the
-- same event (same event_id) can arrive multiple times. The handler records each event_id
-- here AFTER applying it and short-circuits any later delivery of an id already present - so
-- a redelivered transaction.completed can't re-apply (or clobber a newer plan with) a stale
-- update.
--
-- Keyed on Paddle's per-event event_id (NOT customer/transaction/subscription id) so two
-- DISTINCT purchases by the same user - e.g. buy monthly then immediately upgrade to lifetime
-- - are still processed independently.

create table if not exists public.processed_events (
  event_id text primary key,
  event_type text,
  processed_at timestamptz not null default now()
);

-- Only the webhook (service_role, which bypasses RLS) ever touches this table. Enabling RLS
-- with no policies denies anon/authenticated entirely - clients have no business reading it.
alter table public.processed_events enable row level security;

grant select, insert on table public.processed_events to service_role;
