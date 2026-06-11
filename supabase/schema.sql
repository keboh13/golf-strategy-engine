-- Golf Strategy Engine — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run

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

create policy "users can manage own settings"
  on public.user_settings
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

-- Anyone can read (even anon during unauthenticated fallback)
create policy "anyone can read course cache"
  on public.course_cache
  for select
  using (true);

-- Only authenticated users can write
create policy "authenticated users can write course cache"
  on public.course_cache
  for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated users can update course cache"
  on public.course_cache
  for update
  using (auth.role() = 'authenticated');

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
  add column if not exists cache_creation_tokens integer;

alter table public.api_usage enable row level security;

-- Users can only read their own usage
create policy "users can read own usage"
  on public.api_usage
  for select
  using (auth.uid() = user_id);

-- Only service role can insert (done from Edge Function with service role key)
-- Regular users cannot insert directly → prevents spoofing
-- (No insert policy for authenticated role; Edge Function uses service role which bypasses RLS)

create index if not exists api_usage_user_time_idx on public.api_usage(user_id, used_at desc);

-- ─── Helper: updated_at trigger ───────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();
