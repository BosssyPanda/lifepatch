-- LifePatch cloud saves. Run this in the Supabase SQL editor.

create table if not exists public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('story', 'infinite')),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, mode)
);

alter table public.saves enable row level security;

-- Each user can only see and write their own saves.
create policy "own saves - select" on public.saves
  for select using (auth.uid() = user_id);

create policy "own saves - insert" on public.saves
  for insert with check (auth.uid() = user_id);

create policy "own saves - update" on public.saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own saves - delete" on public.saves
  for delete using (auth.uid() = user_id);
