-- Captures a GRANT that was previously only run manually in the Supabase
-- SQL editor and never committed. Without this, RLS policies never even
-- get evaluated — Postgres denies the `authenticated` role at the table
-- level first, with a hard "permission denied for table X" error, which
-- is what the app was actually hitting before this was patched live.
--
-- RLS (see 0001_init.sql) is still what does the real per-row gating;
-- this just lets the role attempt the query at all.

grant usage on schema public to authenticated;

grant select, insert, update on public.briefing_snapshots to authenticated;
grant select, insert, update, delete on public.sarek_gear to authenticated;        -- matches its "for all" policy
grant select, insert, update, delete on public.stocks_watchlist to authenticated;  -- matches its "for all" policy
