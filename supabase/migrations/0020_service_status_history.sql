-- Mission Status v2: verified service checks and a rolling history.
-- The scheduled status script writes with service_role. The signed-in owner
-- may only read rows; browser clients cannot manufacture or alter status.

create table if not exists public.service_status_checks (
  id              bigint generated always as identity primary key,
  service_key     text not null,
  name            text not null,
  category        text not null,
  priority        smallint not null check (priority between 1 and 5),
  level           text not null check (level in ('ok', 'warn', 'down', 'unknown')),
  verified        boolean not null,
  text            text not null,
  method          text not null,
  response_ms     integer check (response_ms is null or response_ms >= 0),
  checked_at      timestamptz not null default now(),
  details         jsonb not null default '{}'::jsonb
);

alter table public.service_status_checks enable row level security;

create policy "owner_select_service_status_checks"
  on public.service_status_checks
  for select
  to authenticated
  using (public.is_owner());

grant select on public.service_status_checks to authenticated;

create index if not exists service_status_checks_service_time_idx
  on public.service_status_checks (service_key, checked_at desc);

create index if not exists service_status_checks_recent_idx
  on public.service_status_checks (checked_at desc);
