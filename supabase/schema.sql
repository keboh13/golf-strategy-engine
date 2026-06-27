-- Golf Strategy Engine — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to re-run: every policy/trigger is dropped before being recreated.

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── user_profiles ───────────────────────────────────────────────────────────
-- One row per named profile per user (e.g. "Rachel – Tournament", "Rachel – Practice")
create table if not exists public.user_profiles (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  profile_name text not null,
  player_data  jsonb not null default '{}',  -- { name, handicap, ghin, miss, ballFlight, swingNotes, goals, strengths, clubs, ... }
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, profile_name)
);

alter table public.user_profiles enable row level security;

drop policy if exists "users can manage own profiles" on public.user_profiles;
create policy "users can manage own profiles"
  on public.user_profiles
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── scoring_history ─────────────────────────────────────────────────────────
-- One row per round logged by the user
create table if not exists public.scoring_history (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  round_data  jsonb not null default '{}',  -- full round object (date, course, score, holes, etc.)
  created_at  timestamptz not null default now()
);

alter table public.scoring_history enable row level security;

drop policy if exists "users can manage own history" on public.scoring_history;
create policy "users can manage own history"
  on public.scoring_history
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists scoring_history_user_idx on public.scoring_history(user_id);

-- ─── user_settings ───────────────────────────────────────────────────────────
-- Misc per-user settings (API keys if user supplies own, current profile name, etc.)
create table if not exists public.user_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  current_profile     text,
  golf_course_api_key text,   -- optional: user-supplied GolfCourseAPI key
  maps_key            text,   -- optional: user-supplied Google Maps key
  updated_at          timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "users can manage own settings" on public.user_settings;
create policy "users can manage own settings"
  on public.user_settings
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── prep_sessions ───────────────────────────────────────────────────────────
-- One row per (user, profile). Holds the minimal slice of Round Prep state
-- needed for cross-device resume: the picked course identity, tee box, tee
-- time, pace, the active prep step, and the chosen plan style. Last-write-wins.
-- Part 1.2 of the optimization plan — desktop-the-night-before, phone-the-
-- morning-of.
create table if not exists public.prep_sessions (
  user_id      uuid not null references auth.users(id) on delete cascade,
  profile_name text not null default 'Default',
  state        jsonb not null default '{}',
  updated_at   timestamptz not null default now(),
  primary key (user_id, profile_name)
);

alter table public.prep_sessions enable row level security;

drop policy if exists "users can manage own prep sessions" on public.prep_sessions;
create policy "users can manage own prep sessions"
  on public.prep_sessions
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── course_cache ─────────────────────────────────────────────────────────────
-- GLOBAL: any authenticated user can read; authenticated users can write
create table if not exists public.course_cache (
  cache_key   text primary key,   -- "<name_lower>|<location_lower>"
  course_data jsonb not null,
  source      text not null default 'unknown',  -- 'GolfCourseAPI' | 'OpenGolfAPI' | 'Claude'
  cached_at   timestamptz not null default now(),
  hit_count   integer not null default 0
);

alter table public.course_cache enable row level security;

drop policy if exists "anyone can read course cache" on public.course_cache;
create policy "anyone can read course cache"
  on public.course_cache
  for select
  using (true);

drop policy if exists "authenticated users can write course cache" on public.course_cache;
create policy "authenticated users can write course cache"
  on public.course_cache
  for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated users can update course cache" on public.course_cache;
create policy "authenticated users can update course cache"
  on public.course_cache
  for update
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can delete course cache" on public.course_cache;
create policy "authenticated users can delete course cache"
  on public.course_cache
  for delete
  using (auth.role() = 'authenticated');

-- ─── api_usage ───────────────────────────────────────────────────────────────
-- Rate limiting: count AI plan generations per user per day.
-- Token columns are nullable and back-filled after each Anthropic call completes.
create table if not exists public.api_usage (
  id                    uuid primary key default uuid_generate_v4(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  endpoint              text not null default 'generate',
  used_at               timestamptz not null default now(),
  input_tokens          integer,
  output_tokens         integer,
  cache_read_tokens     integer,
  cache_creation_tokens integer
);

-- Migration (idempotent): add token columns to existing deployments
alter table public.api_usage
  add column if not exists input_tokens          integer,
  add column if not exists output_tokens         integer,
  add column if not exists cache_read_tokens     integer,
  add column if not exists cache_creation_tokens integer,
  -- Per-phase wall-clock durations (Part 0.4 of the optimization plan).
  -- jsonb of { [stepId]: durationMs } captured server-side when a request
  -- finishes; the admin Usage tab charts p50/p95 off this column.
  add column if not exists phase_durations       jsonb;

alter table public.api_usage enable row level security;

drop policy if exists "users can read own usage" on public.api_usage;
create policy "users can read own usage"
  on public.api_usage
  for select
  using (auth.uid() = user_id);

-- Only service role can insert (done from Edge Function with service role key)
-- Regular users cannot insert directly → prevents spoofing
-- (No insert policy for authenticated role; Edge Function uses service role which bypasses RLS)

create index if not exists api_usage_user_time_idx on public.api_usage(user_id, used_at desc);

-- ─── course_geo ──────────────────────────────────────────────────────────────
-- GLOBAL: cached OSM/contributed course geometry, keyed by course_key.
-- The frontend (CourseHoleMap) reads this on cold load instead of refetching
-- from Overpass; tier 3 entries (no geometry) are persisted too so we don't
-- re-attempt fruitlessly.
create table if not exists public.course_geo (
  course_key   text primary key,
  tier         integer not null default 3,
  geojson      jsonb,
  bbox_by_hole jsonb,
  coverage     jsonb,
  source       text not null default 'osm',
  updated_at   timestamptz not null default now()
);

alter table public.course_geo enable row level security;

drop policy if exists "anyone can read course geo" on public.course_geo;
create policy "anyone can read course geo"
  on public.course_geo for select using (true);

drop policy if exists "authenticated users can write course geo" on public.course_geo;
create policy "authenticated users can write course geo"
  on public.course_geo for insert with check (auth.role() = 'authenticated');

drop policy if exists "authenticated users can update course geo" on public.course_geo;
create policy "authenticated users can update course geo"
  on public.course_geo for update using (auth.role() = 'authenticated');

-- ─── course_hole_hazards ─────────────────────────────────────────────────────
-- Per-hole hazards / design / nickname / prose / visual notes extracted from
-- yardage-book PDFs (api/course-ai.js: parsePdfAndPersist) or from per-hole
-- vision calls (api/course-ai.js: hazard-extract action). One row per
-- (course, hole). Globally readable; writes are gated to admins via the
-- service-role REST calls in api/course-ai.js (no direct client writes).
create table if not exists public.course_hole_hazards (
  course_key  text not null,
  hole_ref    integer not null check (hole_ref between 1 and 18),
  hazards     jsonb not null default '{}',
  source      text not null default 'pdf_vision',  -- 'pdf_vision' | 'vision' | 'manual'
  image_path  text,
  confidence  text,                                 -- 'high' | 'medium' | 'low'
  updated_at  timestamptz not null default now(),
  primary key (course_key, hole_ref)
);

alter table public.course_hole_hazards enable row level security;

drop policy if exists "anyone can read hole hazards" on public.course_hole_hazards;
create policy "anyone can read hole hazards"
  on public.course_hole_hazards for select using (true);

-- No insert/update/delete policies for `authenticated` — the API writes via
-- service role only (admin-gated in api/course-ai.js).

create index if not exists course_hole_hazards_key_idx
  on public.course_hole_hazards(course_key);

-- ─── course_hole_contrib ─────────────────────────────────────────────────────
-- User-contributed tee/pin pairs for individual holes. Used when OSM has no
-- centerline for a hole. One row per (course, hole). The frontend merges
-- these into the rendered geojson before computing distances, so a single
-- contribution unlocks the distance UI for that hole for every future user.
create table if not exists public.course_hole_contrib (
  course_key  text not null,
  hole_ref    integer not null check (hole_ref between 1 and 18),
  tee_lng     double precision not null,
  tee_lat     double precision not null,
  pin_lng     double precision not null,
  pin_lat     double precision not null,
  source      text not null default 'user',
  contributor uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (course_key, hole_ref)
);

alter table public.course_hole_contrib enable row level security;

drop policy if exists "anyone can read hole contributions" on public.course_hole_contrib;
create policy "anyone can read hole contributions"
  on public.course_hole_contrib for select using (true);

drop policy if exists "authenticated users can contribute holes" on public.course_hole_contrib;
create policy "authenticated users can contribute holes"
  on public.course_hole_contrib for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated users can update hole contributions" on public.course_hole_contrib;
create policy "authenticated users can update hole contributions"
  on public.course_hole_contrib for update
  using (auth.role() = 'authenticated');

create index if not exists course_hole_contrib_key_idx
  on public.course_hole_contrib(course_key);

-- ─── Helper: updated_at trigger ───────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ─── course_cache: admin-edit metadata columns ────────────────────────────────
-- edit_version is bumped on every admin save (manual edit or PDF re-parse).
-- Clients use it for lazy local-cache invalidation: if the DB row has a higher
-- edit_version than what's in localStorage, the local entry is refreshed.
alter table public.course_cache
  add column if not exists updated_at   timestamptz not null default now(),
  add column if not exists updated_by   uuid references auth.users(id) on delete set null,
  add column if not exists edit_version integer not null default 0;

-- ─── course_aliases ───────────────────────────────────────────────────────────
-- When an admin renames a course, the old cache_key is recorded here so that
-- search-by-old-name still resolves to the canonical row. One row per old key.
create table if not exists public.course_aliases (
  alias_key      text primary key,
  canonical_key  text not null references public.course_cache(cache_key) on delete cascade,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null
);

alter table public.course_aliases enable row level security;

drop policy if exists "anyone can read course aliases" on public.course_aliases;
create policy "anyone can read course aliases"
  on public.course_aliases for select using (true);

create index if not exists course_aliases_canonical_idx
  on public.course_aliases(canonical_key);

-- ─── user_roles ──────────────────────────────────────────────────────────────
-- Replaces the binary `admins` table with a small role enum so non-admin
-- admin-tier work (viewer dashboards, editor course CRUD) can be granted
-- without giving full user-management power. Part 4 step 9 of the
-- optimization plan. The legacy `admins` table is kept around for now so
-- existing rows still gate the same access — a migration block below
-- copies them into user_roles on first run.
create table if not exists public.user_roles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'viewer'
                 check (role in ('viewer','editor','admin','owner')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

alter table public.user_roles enable row level security;

-- Users can read their own role row (so the client can show role-aware UI).
drop policy if exists "users can read own role" on public.user_roles;
create policy "users can read own role"
  on public.user_roles for select using (auth.uid() = user_id);

-- Admins can read every row.
drop policy if exists "admins can read all roles" on public.user_roles;
create policy "admins can read all roles"
  on public.user_roles for select using (public.is_admin());

-- Only the service role writes to user_roles (api/admin-users.js issues the
-- grant). No client-side insert/update policy on purpose — prevents a user
-- from self-promoting.

-- Migration (idempotent): seed user_roles from the legacy admins table on
-- first run. Subsequent runs are no-ops because the upsert keeps the
-- already-stored role.
insert into public.user_roles (user_id, role, created_at)
select a.user_id, 'admin', coalesce(a.created_at, now())
from public.admins a
on conflict (user_id) do nothing;

-- ─── is_admin() helper ────────────────────────────────────────────────────────
-- Cheap SQL check used by RPC + RLS policies on admin-only paths. Returns
-- true when the caller is either present in the legacy admins table or has a
-- user_roles row with role in ('admin', 'owner'). Returns false for
-- unauthenticated callers.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'owner')
  ) or exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

-- has_role(min) — hierarchy check for the four roles. Used by future RPC
-- guards (e.g. an editor can mutate course data but not grant roles).
--   viewer < editor < admin < owner
create or replace function public.has_role(min text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with rank as (
    select case lower(coalesce(min, ''))
      when 'viewer' then 1
      when 'editor' then 2
      when 'admin'  then 3
      when 'owner'  then 4
      else 999  -- unknown min → deny
    end as min_rank
  ),
  caller as (
    select case role
      when 'viewer' then 1
      when 'editor' then 2
      when 'admin'  then 3
      when 'owner'  then 4
      else 0
    end as r
    from public.user_roles
    where user_id = auth.uid()
  )
  select coalesce(max(c.r), 0) >= (select min_rank from rank)
  from caller c;
$$;

grant execute on function public.has_role(text) to authenticated;

-- ─── invites ─────────────────────────────────────────────────────────────────
-- Signed signup links the admin hands out (Part 4 step 10 of the optimization
-- plan). Each row carries the email the link is intended for, an optional
-- pre-assigned role (consumed once the user signs up), and an optional profile
-- name to seed for them. Tokens are uuid v4 so the join URL is unguessable.
create table if not exists public.invites (
  token         uuid primary key default uuid_generate_v4(),
  email         text not null,
  role          text not null default 'viewer'
                   check (role in ('viewer','editor','admin','owner')),
  profile_name  text,
  created_by    uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '14 days'),
  consumed_at   timestamptz,
  consumed_by   uuid references auth.users(id) on delete set null
);

create index if not exists invites_email_idx        on public.invites(email);
create index if not exists invites_created_at_idx   on public.invites(created_at desc);

alter table public.invites enable row level security;

-- Admins read every invite they themselves issued + everyone else's. No
-- client-side insert/update — that goes through api/admin-invites.js so the
-- service role can attribute created_by and stamp audit_log in lockstep.
drop policy if exists "admins read invites" on public.invites;
create policy "admins read invites"
  on public.invites for select using (public.is_admin());

-- ─── audit_log ───────────────────────────────────────────────────────────────
-- Append-only record of every admin-side mutation (Part 4 step 10 of the
-- optimization plan). Built up by api/admin-* endpoints whenever they grant a
-- role, issue/revoke an invite, soft-delete a user, etc. payload holds the
-- specifics (target email, prior role, etc.) so the future Audit sub-tab can
-- render a rich row without separate lookups.
create table if not exists public.audit_log (
  id              bigserial primary key,
  actor_user_id   uuid references auth.users(id) on delete set null,
  action          text not null,                  -- 'invite.create' | 'invite.revoke' | 'role.grant' | 'user.delete' | ...
  target_type     text,                           -- 'user' | 'invite' | 'course'
  target_id       text,                           -- text so we can store uuids, cache_keys, emails, etc.
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx on public.audit_log(created_at desc);
create index if not exists audit_log_actor_idx      on public.audit_log(actor_user_id, created_at desc);
create index if not exists audit_log_target_idx     on public.audit_log(target_type, target_id);

alter table public.audit_log enable row level security;

drop policy if exists "admins read audit log" on public.audit_log;
create policy "admins read audit log"
  on public.audit_log for select using (public.is_admin());

-- No insert/update/delete policies — only the service role writes.

-- ─── user_soft_deletes ────────────────────────────────────────────────────────
create table if not exists public.user_soft_deletes (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  deleted_at     timestamptz not null default now(),
  deleted_by     uuid references auth.users(id) on delete set null,
  restore_before timestamptz not null
);
alter table public.user_soft_deletes enable row level security;

-- ─── course_reparse_queue ────────────────────────────────────────────────────
create table if not exists public.course_reparse_queue (
  id            uuid primary key default uuid_generate_v4(),
  course_key    text not null,
  course_name   text not null,
  location      text not null default '',
  pdf_url       text not null,
  status        text not null default 'pending'
                  check (status in ('pending','running','pending_approval','approved','rejected','error')),
  submitted_by  uuid references auth.users(id) on delete set null,
  submitted_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  result_data   jsonb,
  error_msg     text,
  approved_by   uuid references auth.users(id) on delete set null,
  approved_at   timestamptz
);
create index if not exists course_reparse_queue_status_idx on public.course_reparse_queue(status, submitted_at desc);
alter table public.course_reparse_queue enable row level security;

-- ─── admin_rename_course RPC ──────────────────────────────────────────────────
-- Atomically migrate a course from old_key → new_key across course_cache,
-- course_hole_hazards, course_geo, and course_hole_contrib. Inserts an alias
-- row so old-name searches still resolve. new_course_data should already have
-- name/location updated to the new values.
create or replace function public.admin_rename_course(
  old_key         text,
  new_key         text,
  new_course_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if old_key is null or new_key is null or old_key = '' or new_key = '' then
    raise exception 'old_key and new_key are required';
  end if;

  if old_key = new_key then
    -- nothing to migrate; just update the row
    update public.course_cache
       set course_data  = new_course_data,
           updated_at   = now(),
           updated_by   = caller_id,
           edit_version = edit_version + 1
     where cache_key = old_key;
    return;
  end if;

  if exists (select 1 from public.course_cache where cache_key = new_key) then
    raise exception 'a course already exists at the new key: %', new_key;
  end if;

  -- 1. Copy course_cache row to new_key
  insert into public.course_cache (cache_key, course_data, source, cached_at, hit_count, updated_at, updated_by, edit_version)
  select new_key,
         new_course_data,
         source,
         cached_at,
         hit_count,
         now(),
         caller_id,
         edit_version + 1
    from public.course_cache
   where cache_key = old_key;

  -- 2. Re-key dependent rows
  update public.course_hole_hazards  set course_key = new_key where course_key = old_key;
  update public.course_geo           set course_key = new_key where course_key = old_key;
  update public.course_hole_contrib  set course_key = new_key where course_key = old_key;

  -- 3. Insert alias row so old-name search still resolves
  insert into public.course_aliases (alias_key, canonical_key, created_by)
  values (old_key, new_key, caller_id)
  on conflict (alias_key) do update set canonical_key = excluded.canonical_key;

  -- 4. If new_key was previously aliased to something else, repoint
  update public.course_aliases set canonical_key = new_key where canonical_key = old_key;

  -- 5. Delete the old course_cache row LAST (FK from aliases prevents earlier delete)
  delete from public.course_cache where cache_key = old_key;
end;
$$;

grant execute on function public.admin_rename_course(text, text, jsonb) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ─── rec_log ─────────────────────────────────────────────────────────────────
-- Audit log of every recommendation request: full prompt + full response.
-- Lets us replay/diff plans, debug bad outputs, and build evals.
-- Service role writes; users read only their own rows; admins read all.
create table if not exists public.rec_log (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete set null,
  course_key      text,
  model           text not null,
  prompt          text not null,
  prompt_hash     text not null,                  -- sha256 hex of prompt; lets us dedupe replays
  response        text,
  validation      jsonb,                          -- output of validatePlanContract() at completion
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz not null default now()
);

-- Migration (idempotent): per-phase wall-clock durations for the generation
-- pipeline (rate-limit check, prompt build, model stream, audit write).
-- Part 0.4 of the optimization plan — feeds the loading-UI expected-time bands
-- and the admin Usage dashboard.
alter table public.rec_log
  add column if not exists phase_durations jsonb;

create index if not exists rec_log_user_time_idx on public.rec_log(user_id, created_at desc);
create index if not exists rec_log_course_idx    on public.rec_log(course_key, created_at desc);

alter table public.rec_log enable row level security;

drop policy if exists "users can read own rec_log" on public.rec_log;
create policy "users can read own rec_log"
  on public.rec_log for select using (auth.uid() = user_id);

drop policy if exists "admins can read all rec_log" on public.rec_log;
create policy "admins can read all rec_log"
  on public.rec_log for select using (public.is_admin());

-- ─── rec_quality ─────────────────────────────────────────────────────────────
-- Human ratings of recommendations. One row per rating per rec_log entry.
-- Powers the eval harness (which prompt versions perform).
create table if not exists public.rec_quality (
  id          uuid primary key default uuid_generate_v4(),
  rec_log_id  uuid not null references public.rec_log(id) on delete cascade,
  rater_id    uuid references auth.users(id) on delete set null,
  rating      integer not null check (rating between 1 and 5),
  dimension   text,                               -- 'accuracy' | 'strategy' | 'clarity' | 'overall'
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists rec_quality_log_idx on public.rec_quality(rec_log_id);

-- Unique index so upsert on (rec_log_id, rater_id, dimension) works — lets
-- the user change their rating without producing duplicate rows.
create unique index if not exists rec_quality_rater_dimension_idx
  on public.rec_quality (rec_log_id, rater_id, dimension);

alter table public.rec_quality enable row level security;

drop policy if exists "users can write own ratings" on public.rec_quality;
create policy "users can write own ratings"
  on public.rec_quality for insert with check (auth.uid() = rater_id);

drop policy if exists "users can update own ratings" on public.rec_quality;
create policy "users can update own ratings"
  on public.rec_quality for update using (auth.uid() = rater_id);

drop policy if exists "users can read own ratings" on public.rec_quality;
create policy "users can read own ratings"
  on public.rec_quality for select using (auth.uid() = rater_id);

drop policy if exists "admins can read all ratings" on public.rec_quality;
create policy "admins can read all ratings"
  on public.rec_quality for select using (public.is_admin());
