-- Replaces the sarek_gear stub from 0001_init.sql, which never matched
-- the actual packing-list app's data model (it's missing weight,
-- consumable, worn, and editable categories) and was never written to by
-- anything. The real app (previously a standalone local HTML file with
-- its own slug/password sharing scheme) keeps one document per list:
-- items + categories + settings together, which maps far more naturally
-- onto a single JSONB blob than a normalized items table would, and lets
-- the module port over the existing app's logic almost unchanged.
--
-- Single-owner for now (see the "flytta rättighetstilldelning till en
-- egen fas" decision) -- same is_owner() gate as everything else. When
-- sharing is designed later, this table is exactly where a
-- user_access-style check would replace is_owner() in the policies below.

drop table if exists public.sarek_gear;

create table if not exists public.sarek_packlist (
  id          uuid primary key default gen_random_uuid(),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.sarek_packlist enable row level security;

create policy "owner_all_sarek_packlist" on public.sarek_packlist
  for all using (public.is_owner()) with check (public.is_owner());

grant select, insert, update, delete on public.sarek_packlist to authenticated;

-- Seeded once with the same defaults the standalone app shipped with, so
-- the module doesn't start empty. Safe to re-run (only inserts if the
-- table is empty).
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
