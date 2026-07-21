-- Dashboard (signed-in view) background: color and/or an optional
-- uploaded image. Separate table from app_settings -- unlike the gate's
-- background (which must be anon-readable since the gate renders before
-- there's a session, see 0004_app_settings.sql), this only ever matters
-- once signed in, so it's owner-only end to end, same is_owner() pattern
-- as encryption_keys/sarek_packlist. No reason to expose it any wider.

create table if not exists public.dashboard_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.dashboard_settings enable row level security;

create policy "owner_all_dashboard_settings" on public.dashboard_settings
  for all using (public.is_owner()) with check (public.is_owner());

grant select, insert, update on public.dashboard_settings to authenticated;

insert into public.dashboard_settings (key, value)
values ('background', '{"color":null,"showImage":false,"imageUrl":null}')
on conflict (key) do nothing;
