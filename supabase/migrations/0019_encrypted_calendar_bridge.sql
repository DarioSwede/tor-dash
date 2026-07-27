-- End-to-end encrypted calendar snapshots uploaded by the local Mac bridge.
-- Supabase stores only per-device envelopes; titles, locations, calendar
-- names and dates exist only inside AES-GCM ciphertext.
create table if not exists public.calendar_snapshots (
  owner_id          uuid primary key references auth.users(id) on delete cascade,
  payload_encrypted jsonb not null,
  created_at        timestamptz not null default now()
);

alter table public.calendar_snapshots enable row level security;

create policy "owner_select_calendar_snapshots" on public.calendar_snapshots
  for select to authenticated
  using ((select auth.uid()) = owner_id and public.is_owner());

grant select on public.calendar_snapshots to authenticated;

-- A random, narrowly-scoped bridge token authenticates only the calendar-sync
-- function. Its SHA-256 hash is stored; the raw token remains in macOS Keychain.
create table if not exists public.calendar_bridge_tokens (
  owner_id    uuid primary key references auth.users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

alter table public.calendar_bridge_tokens enable row level security;
revoke all on public.calendar_bridge_tokens from anon, authenticated;
