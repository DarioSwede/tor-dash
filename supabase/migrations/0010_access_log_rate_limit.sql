-- Closes the gap noted in 0009_access_log.sql: anon insert with no rate
-- limiting meant anyone could flood access_log and bury real signal
-- under spam. Rate-limiting by a client-self-reported IP would have been
-- trivially spoofable (just lie in the request body), so the limit has
-- to be enforced server-side against the *actual* request source IP --
-- which means access_log can no longer be written to directly from the
-- browser. All writes now go through the log-access Edge Function (see
-- supabase/functions/log-access/), which reads the real source IP from
-- the platform-set header, checks it against the table below using the
-- service_role key (bypasses RLS), and only then inserts.

drop policy if exists "anyone_insert_access_log" on public.access_log;
revoke insert on public.access_log from anon;
revoke insert on public.access_log from authenticated;

-- Fixed-window counter per IP. Not RLS-granted to anon/authenticated at
-- all -- only the Edge Function's service_role key ever touches it.
create table if not exists public.access_log_rate_limit (
  ip           text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

alter table public.access_log_rate_limit enable row level security;

-- Atomic check-and-bump: resets the window if it's expired, otherwise
-- increments and reports whether the caller is still under p_max. A
-- single INSERT ... ON CONFLICT keeps this race-free under concurrent
-- requests from the same IP, which a read-then-write from the Edge
-- Function itself couldn't guarantee.
create or replace function public.check_and_bump_rate_limit(
  p_ip text, p_max integer, p_window_seconds integer
)
returns boolean
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.access_log_rate_limit (ip, window_start, count)
  values (p_ip, now(), 1)
  on conflict (ip) do update
    set count = case
          when public.access_log_rate_limit.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else public.access_log_rate_limit.count + 1
        end,
        window_start = case
          when public.access_log_rate_limit.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else public.access_log_rate_limit.window_start
        end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- Not callable by anon/authenticated -- only the Edge Function's
-- service_role key, which ignores function-level grants entirely, so
-- this is defense-in-depth rather than the actual gate.
revoke all on function public.check_and_bump_rate_limit(text, integer, integer) from public, anon, authenticated;
