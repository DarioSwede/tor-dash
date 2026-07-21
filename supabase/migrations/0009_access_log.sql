-- Access log: records gate views and sign-in attempts/successes/failures,
-- each tagged with IP + best-effort ISP name (see web/shell/network.js
-- and web/shell/access-log.js). Deliberately anon-insertable -- the whole
-- point is to see unauthenticated attempts, which by definition come from
-- someone who never gets a session -- with reads locked to the owner via
-- the same is_owner() pattern as everywhere else (see 0001_init.sql).
--
-- Trade-off worth knowing: anon insert with no rate limiting means anyone
-- can write junk rows (the length checks below just cap how big each one
-- can be). Acceptable for a personal single-user log; would need a real
-- rate limit or a Cloudflare Turnstile-style check to harden further.

create table if not exists public.access_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  event       text not null check (event in ('gate_view','signin_attempt','signin_success','signin_failure')),
  method      text check (method is null or length(method) <= 40),
  ip_v4       text check (ip_v4 is null or length(ip_v4) <= 64),
  ip_v6       text check (ip_v6 is null or length(ip_v6) <= 64),
  org         text check (org is null or length(org) <= 200),
  user_agent  text check (user_agent is null or length(user_agent) <= 300),
  detail      text check (detail is null or length(detail) <= 300)
);

alter table public.access_log enable row level security;

create policy "anyone_insert_access_log" on public.access_log
  for insert with check (true);

create policy "owner_select_access_log" on public.access_log
  for select using (public.is_owner());

grant insert on public.access_log to anon;
grant insert, select on public.access_log to authenticated;
