-- Full portfolio module (replaces the "stocks" watchlist stub -- see
-- README-equivalent note in web/modules/portfolio/module.js): stocks,
-- funds, commodities, currencies, a watchlist, price alerts, value
-- history, dividend-tip pastes, and a Redeye news calendar, ported from
-- the standalone FortPolio app. One JSONB document, same pattern as
-- sarek_packlist -- the whole shape is a single cohesive "your portfolio
-- state" object in the original app too, so normalizing it into many
-- tables would fight the source material for no benefit.
--
-- Owner-only end to end (is_owner() RLS, same as sarek_packlist/
-- encryption_keys) -- this is financial position data, more sensitive
-- than most other tables in this project.

create table if not exists public.portfolio (
  id          uuid primary key default gen_random_uuid(),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.portfolio enable row level security;

create policy "owner_all_portfolio" on public.portfolio
  for all using (public.is_owner()) with check (public.is_owner());

grant select, insert, update, delete on public.portfolio to authenticated;

-- Seeded once with sane empty defaults, matching FortPolio's own
-- fallback shape, so the module doesn't start on undefined fields.
insert into public.portfolio (data)
select '{
  "stocks": [],
  "funds": [],
  "commoditySymbols": {},
  "currencySymbols": {},
  "watchlist": [{"symbol":"SMR","name":"NuScale Power","curr":"USD"}],
  "ps": {},
  "priceAlerts": {},
  "targetAktier": 35,
  "hideAmounts": false,
  "valutorTrendPeriod": "day",
  "valueHistory": [],
  "fundHistory": {},
  "veckansTips": [],
  "dividends": {},
  "redeyeNews": [],
  "redeyeLastViewed": null,
  "hiddenCards": []
}'::jsonb
where not exists (select 1 from public.portfolio);
