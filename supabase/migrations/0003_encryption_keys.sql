-- Per-device end-to-end encryption. Each signed-in device registers its
-- own ECDH P-256 public key here (private half never leaves that
-- device's browser — see web/shell/crypto.js); scripts/push_snapshot.py
-- encrypts sensitive payloads once per active device before writing.
--
-- RLS still restricts every row to darioswede@gmail.com, same as every
-- other table — this is confidentiality *on top of* that access control,
-- not a replacement for it: even a full database read (a breach, or an
-- RLS bug) only exposes ciphertext for anything using payload_encrypted.

create table if not exists public.encryption_keys (
  id              uuid primary key default gen_random_uuid(),
  device_label    text,
  algorithm       text not null default 'ECDH-P256',
  public_key_jwk  jsonb not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table public.encryption_keys enable row level security;

create policy "owner_all_encryption_keys" on public.encryption_keys
  for all using (public.is_owner()) with check (public.is_owner());

grant select, insert, update on public.encryption_keys to authenticated;

create index if not exists encryption_keys_active_idx
  on public.encryption_keys (created_at desc) where active;

-- Reusable encrypted-payload column, additive alongside the existing
-- plaintext `payload` — unencrypted rows/tables keep working unchanged.
-- Holds an array of envelopes, one per currently-active device (see
-- web/shell/crypto.js's envelope shape), so any signed-in device can
-- decrypt with its own local private key.
alter table public.briefing_snapshots alter column payload drop not null;
alter table public.briefing_snapshots add column if not exists payload_encrypted jsonb;
alter table public.briefing_snapshots add constraint briefing_snapshots_payload_present
  check (payload is not null or payload_encrypted is not null);
