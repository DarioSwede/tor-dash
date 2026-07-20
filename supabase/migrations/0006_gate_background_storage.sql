-- Storage bucket for a custom, uploaded gate background image (an
-- alternative to the built-in skull/compass/globe SVG variants). Public
-- bucket for the same reason app_settings is anon-readable: the gate is
-- shown before sign-in and needs to load the image without a session.
-- Uploads (insert/update/delete) are owner-only via storage.objects RLS,
-- mirroring the is_owner() pattern used everywhere else.

insert into storage.buckets (id, name, public)
values ('gate-backgrounds', 'gate-backgrounds', true)
on conflict (id) do nothing;

create policy "public_read_gate_backgrounds" on storage.objects
  for select using (bucket_id = 'gate-backgrounds');

create policy "owner_write_gate_backgrounds" on storage.objects
  for insert with check (bucket_id = 'gate-backgrounds' and public.is_owner());

create policy "owner_update_gate_backgrounds" on storage.objects
  for update using (bucket_id = 'gate-backgrounds' and public.is_owner());

create policy "owner_delete_gate_backgrounds" on storage.objects
  for delete using (bucket_id = 'gate-backgrounds' and public.is_owner());
