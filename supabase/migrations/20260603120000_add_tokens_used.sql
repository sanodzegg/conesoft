-- tokens_used: explicit, monotonic lifetime quota currency (see CLAUDE.md token spec).
-- Source of truth for the trial gate; decoupled from the per-category counts, which are kept
-- for analytics/bonuses. Backfilled once from existing counts at the current token costs:
-- image = 1, document = 5, video = 5, audio = 5.

alter table "public"."conversion_counts"
  add column if not exists "tokens_used" integer not null default 0;

-- One-time backfill. Guarded on tokens_used = 0 so re-running can't clobber real usage.
update "public"."conversion_counts"
set "tokens_used" =
  coalesce("image_count", 0) * 1 +
  coalesce("document_count", 0) * 5 +
  coalesce("video_count", 0) * 5 +
  coalesce("audio_count", 0) * 5
where "tokens_used" = 0;
