-- Small key-value settings table for cosmetic, non-sensitive dashboard
-- preferences — right now just which gate background variant is shown.
--
-- Unlike every other table, this one is readable by the *anon* role too
-- (not just authenticated), because the gate itself, shown before sign-in,
-- needs to know which background to render. There is nothing sensitive
-- here (a background choice, not personal data), so public read is an
-- intentional, scoped exception -- writes are still owner-only via RLS.

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "public_select_app_settings" on public.app_settings
  for select using (true);

create policy "owner_write_app_settings" on public.app_settings
  for insert with check (public.is_owner());

create policy "owner_update_app_settings" on public.app_settings
  for update using (public.is_owner()) with check (public.is_owner());

grant select on public.app_settings to anon;
grant select, insert, update on public.app_settings to authenticated;

insert into public.app_settings (key, value)
values ('gate_background', '{"variant": "skull"}')
on conflict (key) do nothing;
