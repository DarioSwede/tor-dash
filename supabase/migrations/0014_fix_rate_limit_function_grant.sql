-- Fixes a real bug in 0010_access_log_rate_limit.sql: it assumed
-- service_role automatically bypasses function-level EXECUTE grants the
-- same way it bypasses RLS policies on tables. Those are two different
-- Postgres permission systems -- BYPASSRLS only affects row-level
-- security, not function execute privileges. Revoking EXECUTE from
-- PUBLIC (which 0010 did) removes the implicit grant every role
-- including service_role would otherwise inherit, and nothing in 0010
-- re-granted it explicitly -- so the log-access Edge Function's
-- service_role client got "permission denied for function
-- check_and_bump_rate_limit" on every call once deployed.

grant execute on function public.check_and_bump_rate_limit(text, integer, integer) to service_role;
