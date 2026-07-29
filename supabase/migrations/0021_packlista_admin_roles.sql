-- Shared role model for Packlista administration in Tor-dash.
alter table public.users
  add column if not exists role text not null default 'user'
  check (role in ('user', 'admin'));

-- Bootstrap the owner account. The UUID is the existing confirmed account,
-- resolved before this migration was applied.
update public.users
set role = 'admin', updated_at = now()
where id = '71b7ec61-4909-45da-bb70-278c0570f001';

-- Users may maintain their own display name, but never their own role.
revoke insert, update on public.users from authenticated;
grant select on public.users to authenticated;
grant insert (id, display_name, updated_at) on public.users to authenticated;
grant update (display_name, updated_at) on public.users to authenticated;

-- The protected admin Edge Function uses service_role after checking the
-- caller's role.
grant select, insert, update, delete on public.users to service_role;
