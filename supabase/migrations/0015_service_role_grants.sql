-- Systemic fix: service_role has been missing baseline table/function
-- grants on every table in this project (app_settings, access_log,
-- portfolio, access_log_rate_limit at minimum -- discovered while
-- debugging the log-access Edge Function, which calls
-- check_and_bump_rate_limit as service_role and got "permission denied
-- for table access_log_rate_limit"). Standard Supabase projects usually
-- configure default privileges so service_role -- which bypasses RLS via
-- BYPASSRLS -- also gets implicit table/function grants on every new
-- table without each migration needing to state it explicitly. That
-- configuration is evidently not in place here, so every migration in
-- this repo so far has silently relied on an assumption that didn't hold.
--
-- This grants service_role access to everything that exists today, and
-- configures default privileges so every table/sequence/function created
-- from now on gets the same grant automatically -- this class of bug
-- (a new table works fine as owner in the SQL editor, then mysteriously
-- 403s the moment service_role touches it) should not recur.

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
