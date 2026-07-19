-- Tor's personal dashboard: briefing snapshots + future modules (Sarek gear, stocks)
-- Single-user app. RLS is scoped to one allowed email via auth.jwt(), not a generic
-- "any authenticated user" rule, so the anon key + Supabase Auth magic link is safe
-- to ship in a public GitHub Pages repo.

-- ---------------------------------------------------------------------------
-- Helper: the only email allowed to read/write anything in this project.
-- Change this if the owning address ever changes.
-- ---------------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'darioswede@gmail.com';
$$;

-- ---------------------------------------------------------------------------
-- briefing_snapshots: one row per (kind, for_date). The scheduled Claude task
-- upserts here after each morning/evening run; the frontend reads the latest.
-- ---------------------------------------------------------------------------
create table if not exists public.briefing_snapshots (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('morning', 'evening')),
  for_date     date not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  unique (kind, for_date)
);

alter table public.briefing_snapshots enable row level security;

create policy "owner_select_snapshots" on public.briefing_snapshots
  for select using (public.is_owner());

create policy "owner_write_snapshots" on public.briefing_snapshots
  for insert with check (public.is_owner());

create policy "owner_update_snapshots" on public.briefing_snapshots
  for update using (public.is_owner()) with check (public.is_owner());

-- Service-role key (used by the scheduled push script, never shipped to the
-- browser) bypasses RLS automatically, so the policies above only gate the
-- browser-side anon key used by the frontend.

-- ---------------------------------------------------------------------------
-- sarek_gear: eventual replacement for the local HTML packing list, so the
-- gear state is shared/live instead of trapped in one browser's localStorage.
-- ---------------------------------------------------------------------------
create table if not exists public.sarek_gear (
  id           bigint generated always as identity primary key,
  category     text not null,
  item         text not null,
  owned        boolean not null default false,
  qty          integer not null default 1,
  notes        text,
  updated_at   timestamptz not null default now()
);

alter table public.sarek_gear enable row level security;

create policy "owner_all_sarek_gear" on public.sarek_gear
  for all using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- stocks_watchlist: placeholder for the future "aktier" module. Kept minimal
-- until the actual data source (broker export, API, or manual entry) is decided.
-- ---------------------------------------------------------------------------
create table if not exists public.stocks_watchlist (
  id            bigint generated always as identity primary key,
  ticker        text not null,
  note          text,
  target_price  numeric,
  added_at      timestamptz not null default now()
);

alter table public.stocks_watchlist enable row level security;

create policy "owner_all_stocks_watchlist" on public.stocks_watchlist
  for all using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Helpful index: the frontend always asks for "latest snapshot of kind X"
-- ---------------------------------------------------------------------------
create index if not exists briefing_snapshots_kind_date_idx
  on public.briefing_snapshots (kind, for_date desc);
