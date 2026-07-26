-- Arkiv: kvitton, bokningar och annat som ska sparas och hittas igen.
--
-- Byggt för ett konkret behov: inför Sarek och Holland samlas kvitton som
-- sedan ska redovisas, och de får inte ligga utspridda i en inkorg där de
-- går att missa (vilket är precis vad som hände med IKEA-kvittot 2026-07-26).
--
-- Två saker som styr formen:
--
-- 1. `status` är en granskningskö, inte ett arkivtillstånd. Den timvisa
--    Routine-körningen får bara skapa rader med status 'review'; Dario
--    bekräftar ('kept') eller slänger ('discarded') i UI:t. Poängen är att
--    ett feltolkat nyhetsbrev aldrig ska kunna smyga in i ett underlag som
--    lämnas till en redovisning -- ett falskt kvitto där är värre än ett
--    missat, eftersom det inte syns förrän någon annan granskar det.
--
-- 2. Både `email_message_id` och `file_path` finns, för att de svarar på
--    olika frågor. Länken tar dig till originalet i sammanhang; filen är
--    det som faktiskt överlever att mejlet raderas och som går att lämna
--    ifrån sig vid redovisning. Unikt index på email_message_id är
--    dubblettskyddet -- Routinen kör varje timme över samma 7-dagarsfönster
--    och skulle annars återskapa samma kvitto om och om igen, inklusive
--    sådana Dario redan slängt.
--
-- Samma owner-only RLS som todos/dashboard_settings. Ingen kryptering:
-- samma nivå som todos, och kolumnerna måste gå att filtrera och summera
-- på serversidan (belopp per resa) vilket krypterad payload omöjliggör.

create table if not exists public.archive_items (
  id                bigint generated always as identity primary key,

  kind              text not null default 'kvitto'
                      check (kind in ('kvitto', 'bokning', 'faktura', 'garanti', 'ovrigt')),
  title             text not null,
  vendor            text,
  occurred_on       date,
  amount            numeric(12,2),
  currency          text not null default 'SEK',

  -- Fri kategori (Mat, Boende, Transport, Utrustning ...) och fri
  -- resetagg ("Sarek 2026", "Holland 2026"). Medvetet text och inte
  -- uppslagstabeller: kategorierna kommer ändras oftare än schemat, och
  -- en felstavning är ett mycket mindre problem än en migration varje
  -- gång en ny resa dyker upp.
  category          text,
  trip              text,

  notes             text,

  -- Spårbarhet tillbaka till källan.
  email_message_id  text,
  email_link        text,

  -- Fil i storage-bucketen 'archive-files' (privat, se nedan).
  file_path         text,
  file_name         text,
  file_size         bigint,

  status            text not null default 'review'
                      check (status in ('review', 'kept', 'discarded')),
  source            text not null default 'manual'
                      check (source in ('manual', 'claude')),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Dubblettskydd för det automatiska inflödet. Partiellt, så att manuellt
-- inlagda rader (utan mejlkoppling) inte krockar med varandra.
create unique index if not exists archive_items_email_message_id_key
  on public.archive_items (email_message_id)
  where email_message_id is not null;

-- Vanligaste vyerna: granskningskön, och "allt som hör till en resa".
create index if not exists archive_items_status_idx on public.archive_items (status);
create index if not exists archive_items_trip_idx on public.archive_items (trip) where trip is not null;
create index if not exists archive_items_occurred_idx on public.archive_items (occurred_on desc nulls last);

alter table public.archive_items enable row level security;

create policy "owner_all_archive_items" on public.archive_items
  for all using (public.is_owner()) with check (public.is_owner());

grant select, insert, update, delete on public.archive_items to authenticated;

-- Service role behöver komma åt tabellen för att Routine-körningen ska
-- kunna lägga in hittade kvitton -- samma mönster som 0015 gjorde för
-- de övriga tabellerna.
grant select, insert, update, delete on public.archive_items to service_role;

-- ---------------------------------------------------------------------
-- Storage: själva kvittofilerna.
--
-- PRIVAT bucket, till skillnad från 'gate-backgrounds' som är publik av
-- nödvändighet (den visas före inloggning). Här gäller motsatsen: ett
-- kvitto innehåller belopp, datum och köpställe, och ska aldrig gå att
-- nå med bara en gissad URL. Läsning kräver därför en inloggad ägare och
-- går via signed URLs, inte getPublicUrl.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('archive-files', 'archive-files', false)
on conflict (id) do nothing;

create policy "owner_read_archive_files" on storage.objects
  for select using (bucket_id = 'archive-files' and public.is_owner());

create policy "owner_write_archive_files" on storage.objects
  for insert with check (bucket_id = 'archive-files' and public.is_owner());

create policy "owner_update_archive_files" on storage.objects
  for update using (bucket_id = 'archive-files' and public.is_owner());

create policy "owner_delete_archive_files" on storage.objects
  for delete using (bucket_id = 'archive-files' and public.is_owner());
