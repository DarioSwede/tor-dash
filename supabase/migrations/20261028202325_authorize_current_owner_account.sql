-- Tor Dash is intentionally owner-only. Authorize the two known owner
-- identities by their stable auth user IDs instead of a mutable email claim.
-- The first ID is the existing owner account; the second is the passkey
-- account explicitly approved on 2026-10-28.
create or replace function public.is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.uid()) in (
    '71b7ec61-4909-45da-bb70-278c0570f001'::uuid,
    '2388a520-796c-4524-95d5-b4b906869e48'::uuid
  );
$$;

comment on function public.is_owner() is
  'True only for the two explicitly authorized Tor Dash owner identities.';
