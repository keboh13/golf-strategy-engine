-- Post-round feedback: per-hole scores + notes, keyed on (user_id, brief_id).
-- Closes #123 — mobile users lose localStorage; this gives server-side persistence.

create table if not exists post_round_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  brief_id    text not null,
  scores      jsonb not null default '{}'::jsonb,
  notes       jsonb not null default '{}'::jsonb,
  general_notes text not null default '',
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Each user can have at most one feedback row per brief.
create unique index if not exists post_round_feedback_user_brief
  on post_round_feedback (user_id, brief_id);

-- Row-level security: users can only read/write their own rows.
alter table post_round_feedback enable row level security;

create policy "Users can select own post-round feedback"
  on post_round_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert own post-round feedback"
  on post_round_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can update own post-round feedback"
  on post_round_feedback for update
  using (auth.uid() = user_id);

create policy "Users can delete own post-round feedback"
  on post_round_feedback for delete
  using (auth.uid() = user_id);
