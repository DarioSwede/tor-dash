-- Adds the app_settings row backing the "also show on the sign-in page"
-- toggle for the public-IP/VPN status line (see web/shell/network.js).
-- Off by default -- that line shows the owner's real IP address, and the
-- gate is a public, internet-facing page (see 0004_app_settings.sql for
-- why app_settings itself is anon-readable; the same reasoning applies
-- here -- the gate needs to read this before there's a session).

insert into public.app_settings (key, value)
values ('show_network_on_gate', 'false')
on conflict (key) do nothing;
