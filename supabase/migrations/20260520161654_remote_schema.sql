drop extension if exists "pg_net";


  create table "public"."conversion_counts" (
    "user_id" uuid not null,
    "image_count" integer not null default 0,
    "document_count" integer not null default 0,
    "video_count" integer not null default 0,
    "audio_count" integer not null default 0,
    "updated_at" timestamp with time zone
      );


alter table "public"."conversion_counts" enable row level security;


  create table "public"."settings" (
    "user_id" uuid not null,
    "image_quality" integer not null default 80,
    "default_image_format" text not null default 'webp'::text,
    "default_document_format" text not null default 'pdf'::text,
    "default_video_format" text not null default 'mp4'::text,
    "default_output_folder" text,
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."settings" enable row level security;


  create table "public"."users" (
    "id" uuid not null,
    "email" text not null,
    "plan" text not null default 'free'::text,
    "paid_at" timestamp with time zone,
    "license_key" text,
    "created_at" timestamp with time zone default now(),
    "subscription_end" timestamp with time zone
      );


alter table "public"."users" enable row level security;

CREATE UNIQUE INDEX conversion_counts_pkey ON public.conversion_counts USING btree (user_id);

CREATE UNIQUE INDEX settings_pkey ON public.settings USING btree (user_id);

CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);

alter table "public"."conversion_counts" add constraint "conversion_counts_pkey" PRIMARY KEY using index "conversion_counts_pkey";

alter table "public"."settings" add constraint "settings_pkey" PRIMARY KEY using index "settings_pkey";

alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";

alter table "public"."conversion_counts" add constraint "conversion_counts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;

alter table "public"."conversion_counts" validate constraint "conversion_counts_user_id_fkey";

alter table "public"."settings" add constraint "settings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;

alter table "public"."settings" validate constraint "settings_user_id_fkey";

alter table "public"."users" add constraint "users_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."users" validate constraint "users_id_fkey";

alter table "public"."users" add constraint "users_plan_check" CHECK ((plan = ANY (ARRAY['trial'::text, 'limited'::text, 'monthly'::text, 'annual'::text, 'lifetime'::text]))) not valid;

alter table "public"."users" validate constraint "users_plan_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.users (id, email, plan, created_at)
  VALUES (NEW.id, NEW.email, 'trial', NOW());

  INSERT INTO public.conversion_counts (user_id, image_count, document_count, video_count, audio_count, updated_at)
  VALUES (NEW.id, 0, 0, 0, 0, NOW());

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

grant delete on table "public"."conversion_counts" to "anon";

grant insert on table "public"."conversion_counts" to "anon";

grant references on table "public"."conversion_counts" to "anon";

grant select on table "public"."conversion_counts" to "anon";

grant trigger on table "public"."conversion_counts" to "anon";

grant truncate on table "public"."conversion_counts" to "anon";

grant update on table "public"."conversion_counts" to "anon";

grant delete on table "public"."conversion_counts" to "authenticated";

grant insert on table "public"."conversion_counts" to "authenticated";

grant references on table "public"."conversion_counts" to "authenticated";

grant select on table "public"."conversion_counts" to "authenticated";

grant trigger on table "public"."conversion_counts" to "authenticated";

grant truncate on table "public"."conversion_counts" to "authenticated";

grant update on table "public"."conversion_counts" to "authenticated";

grant delete on table "public"."conversion_counts" to "service_role";

grant insert on table "public"."conversion_counts" to "service_role";

grant references on table "public"."conversion_counts" to "service_role";

grant select on table "public"."conversion_counts" to "service_role";

grant trigger on table "public"."conversion_counts" to "service_role";

grant truncate on table "public"."conversion_counts" to "service_role";

grant update on table "public"."conversion_counts" to "service_role";

grant delete on table "public"."settings" to "anon";

grant insert on table "public"."settings" to "anon";

grant references on table "public"."settings" to "anon";

grant select on table "public"."settings" to "anon";

grant trigger on table "public"."settings" to "anon";

grant truncate on table "public"."settings" to "anon";

grant update on table "public"."settings" to "anon";

grant delete on table "public"."settings" to "authenticated";

grant insert on table "public"."settings" to "authenticated";

grant references on table "public"."settings" to "authenticated";

grant select on table "public"."settings" to "authenticated";

grant trigger on table "public"."settings" to "authenticated";

grant truncate on table "public"."settings" to "authenticated";

grant update on table "public"."settings" to "authenticated";

grant delete on table "public"."settings" to "service_role";

grant insert on table "public"."settings" to "service_role";

grant references on table "public"."settings" to "service_role";

grant select on table "public"."settings" to "service_role";

grant trigger on table "public"."settings" to "service_role";

grant truncate on table "public"."settings" to "service_role";

grant update on table "public"."settings" to "service_role";

grant delete on table "public"."users" to "anon";

grant insert on table "public"."users" to "anon";

grant references on table "public"."users" to "anon";

grant select on table "public"."users" to "anon";

grant trigger on table "public"."users" to "anon";

grant truncate on table "public"."users" to "anon";

grant update on table "public"."users" to "anon";

grant delete on table "public"."users" to "authenticated";

grant insert on table "public"."users" to "authenticated";

grant references on table "public"."users" to "authenticated";

grant select on table "public"."users" to "authenticated";

grant trigger on table "public"."users" to "authenticated";

grant truncate on table "public"."users" to "authenticated";

grant update on table "public"."users" to "authenticated";

grant delete on table "public"."users" to "service_role";

grant insert on table "public"."users" to "service_role";

grant references on table "public"."users" to "service_role";

grant select on table "public"."users" to "service_role";

grant trigger on table "public"."users" to "service_role";

grant truncate on table "public"."users" to "service_role";

grant update on table "public"."users" to "service_role";


  create policy "conversion_counts: insert own"
  on "public"."conversion_counts"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "conversion_counts: select own"
  on "public"."conversion_counts"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "conversion_counts: update own"
  on "public"."conversion_counts"
  as permissive
  for update
  to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));



  create policy "settings: insert own"
  on "public"."settings"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "settings: select own"
  on "public"."settings"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "settings: update own"
  on "public"."settings"
  as permissive
  for update
  to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));



  create policy "users: select own"
  on "public"."users"
  as permissive
  for select
  to public
using ((auth.uid() = id));



  create policy "users: update own"
  on "public"."users"
  as permissive
  for update
  to public
using ((auth.uid() = id));


CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


