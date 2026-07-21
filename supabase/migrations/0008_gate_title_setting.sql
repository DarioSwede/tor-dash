-- Adds the app_settings row backing the editable/clearable gate title
-- (see web/shell/gate-title.js). Anon-readable for the same reason as
-- gate_background and show_network_on_gate -- the gate needs to render
-- this text before there's a session. Seeded with the current hardcoded
-- text so behavior is unchanged until someone edits it in Settings; an
-- empty string means "no title text" (the field hides itself).

insert into public.app_settings (key, value)
values ('gate_title', '"Dashboard"')
on conflict (key) do nothing;
