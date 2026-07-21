-- 0005_sarek_packlist.sql was only partially applied in some earlier run:
-- the table, RLS, and policy exist, but the `grant ... to authenticated`
-- line never ran. PostgREST excludes tables the API roles have zero
-- privilege on from its schema cache, so the REST API returned
-- PGRST205 "table not found" even though the table is really there --
-- and re-running 0005 as-is fails on `create policy` (not idempotent,
-- unlike `create table if not exists`).
--
-- This is idempotent and safe to run regardless of how far 0005 got:
-- drops+recreates the policy, (re)grants privileges, and asks PostgREST
-- to reload its schema cache so the table becomes visible over REST
-- immediately instead of waiting for the next auto-detected DDL change.

alter table public.sarek_packlist enable row level security;

drop policy if exists "owner_all_sarek_packlist" on public.sarek_packlist;
create policy "owner_all_sarek_packlist" on public.sarek_packlist
  for all using (public.is_owner()) with check (public.is_owner());

grant select, insert, update, delete on public.sarek_packlist to authenticated;

insert into public.sarek_packlist (data)
select '{
  "categories": [
    {"id":"ryggsack","name":"Ryggsäck","icon":"🎒","color":"#92c5ff"},
    {"id":"bo","name":"Bo","icon":"⛺","color":"#7ee787"},
    {"id":"sova","name":"Sova","icon":"🛏️","color":"#58a6ff"},
    {"id":"mat","name":"Mat","icon":"🍲","color":"#f2cc60"},
    {"id":"kok","name":"Kök","icon":"🔥","color":"#ffa657"},
    {"id":"bransle","name":"Bränsle","icon":"⛽","color":"#f78166"},
    {"id":"klader","name":"Kläder","icon":"🧥","color":"#d2a8ff"},
    {"id":"sakerhet","name":"Säkerhet","icon":"🩹","color":"#ff7b72"},
    {"id":"kamera","name":"Kamera","icon":"📷","color":"#79c0ff"},
    {"id":"navigation","name":"Navigation","icon":"🧭","color":"#d29922"},
    {"id":"elektronik","name":"Elektronik","icon":"🔋","color":"#56d364"},
    {"id":"vatten","name":"Vatten","icon":"💧","color":"#39c5cf"},
    {"id":"ovrigt","name":"Övrigt","icon":"📦","color":"#a5d6ff"}
  ],
  "items": [
    {"id":"seed-1","name":"Osprey Ariel Pro 65 / Aether Plus 70","category":"ryggsack","weight":2700,"qty":1,"owned":false,"consumable":false,"worn":false,"note":"Byt vikt när ryggsäcken är bestämd."},
    {"id":"seed-2","name":"Urberg 2 Person UL tält","category":"bo","weight":2090,"qty":1,"owned":true,"consumable":false,"worn":false,"note":""},
    {"id":"seed-3","name":"Exped Dura 6R liggunderlag","category":"sova","weight":885,"qty":1,"owned":true,"consumable":false,"worn":false,"note":""},
    {"id":"seed-4","name":"Alu foldable sleeping mat","category":"sova","weight":350,"qty":1,"owned":false,"consumable":false,"worn":false,"note":"Kan kapas till 6–8 sektioner."},
    {"id":"seed-5","name":"Sea to Summit Aeros Premium kudde","category":"sova","weight":79,"qty":1,"owned":false,"consumable":false,"worn":false,"note":""},
    {"id":"seed-6","name":"Sovsäck -5°C komfort","category":"sova","weight":1200,"qty":1,"owned":false,"consumable":false,"worn":false,"note":""},
    {"id":"seed-7","name":"Fire-Maple Star X5","category":"kok","weight":600,"qty":1,"owned":true,"consumable":false,"worn":false,"note":""},
    {"id":"seed-8","name":"Gas 230 g","category":"bransle","weight":370,"qty":2,"owned":false,"consumable":true,"worn":false,"note":"Bränsle räknas som förbrukning."},
    {"id":"seed-9","name":"Frystorkad mat","category":"mat","weight":150,"qty":12,"owned":false,"consumable":true,"worn":false,"note":"Ändra antal efter måltider."},
    {"id":"seed-10","name":"Regnjacka / skaljacka","category":"klader","weight":550,"qty":1,"owned":false,"consumable":false,"worn":false,"note":""},
    {"id":"seed-11","name":"Regnbyxor / skalbyxor","category":"klader","weight":450,"qty":1,"owned":false,"consumable":false,"worn":false,"note":""},
    {"id":"seed-12","name":"Första hjälpen","category":"sakerhet","weight":250,"qty":1,"owned":false,"consumable":false,"worn":false,"note":""},
    {"id":"seed-13","name":"Pannlampa","category":"elektronik","weight":90,"qty":1,"owned":false,"consumable":false,"worn":false,"note":""}
  ],
  "settings": {"days":6,"targetKg":15,"filter":"Alla","sort":"category","onlyShopping":false,"query":""}
}'::jsonb
where not exists (select 1 from public.sarek_packlist);

notify pgrst, 'reload schema';
