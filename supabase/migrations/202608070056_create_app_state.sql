create table if not exists public.app_state (
  key text not null,
  owner text not null default 'global',
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (key, owner)
);

create index if not exists app_state_owner_idx
  on public.app_state (owner);

alter table public.app_state enable row level security;

create policy "Authenticated users can read app state"
on public.app_state
for select
to authenticated
using (true);

create policy "Authenticated users can create app state"
on public.app_state
for insert
to authenticated
with check (true);

create policy "Authenticated users can update app state"
on public.app_state
for update
to authenticated
using (true)
with check (true);

create policy "Authenticated users can delete app state"
on public.app_state
for delete
to authenticated
using (true);
