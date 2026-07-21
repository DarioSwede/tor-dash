-- Adds the app_settings row backing the editable/hideable sign-in button
-- (see web/shell/gate-button.js). Anon-readable for the same reason as
-- gate_title/gate_background/show_network_on_gate -- the gate needs to
-- render it before there's a session. Seeded with the current hardcoded
-- label so behavior is unchanged until someone edits it in Settings.
-- Hiding the button (hidden:true) still leaves swipe-up-to-sign-in
-- working (see auth.js), so it's a real removal, not a dead end.

insert into public.app_settings (key, value)
values ('gate_button', '{"text":"Sign in with security key","hidden":false}')
on conflict (key) do nothing;
