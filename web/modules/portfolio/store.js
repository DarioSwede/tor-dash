// Supabase-backed persistence, replacing FortPolio's original state.js
// (in-memory singleton) + storage.js (localStorage). One row in
// public.portfolio holds the whole document (see
// supabase/migrations/0013_portfolio.sql) -- same one-JSONB-document
// pattern sarek-gear's module already uses, for the same reason: this
// data is naturally one cohesive "your portfolio" object, not a set of
// independently-queried tables.

const DEFAULT_DATA = {
  stocks: [],
  funds: [],
  commoditySymbols: {},
  currencySymbols: {},
  watchlist: [{ symbol: "SMR", name: "NuScale Power", curr: "USD" }],
  ps: {},
  priceAlerts: {},
  targetAktier: 35,
  hideAmounts: false,
  valutorTrendPeriod: "day",
  valueHistory: [],
  fundHistory: {},
  veckansTips: [],
  redeyeNews: [],
  redeyeLastViewed: null,
};

export async function loadPortfolio(supabase) {
  const { data } = await supabase.from("portfolio").select("id, data").limit(1).maybeSingle();
  if (!data) return null;
  return { rowId: data.id, doc: { ...DEFAULT_DATA, ...data.data } };
}

let saveTimer = null;
export function schedulePortfolioSave(supabase, rowId, doc, onDone) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { error } = await supabase
      .from("portfolio")
      .update({ data: doc, updated_at: new Date().toISOString() })
      .eq("id", rowId);
    if (onDone) onDone(error);
  }, 500);
}

// ids are regenerated from array position on every load/mutation, same
// as FortPolio's original State.assignIds() -- priceAlerts/ps entries are
// keyed by these, so they follow array order, not a stable identity.
export function assignIds(doc) {
  doc.stocks.forEach((s, i) => { s.id = "s" + i; });
  doc.funds.forEach((f, i) => { f.id = "f" + i; });
}

// Snapshot of total value / fund NAVs, at most one point per hour, capped
// at 500 points -- ported from State.recordSnapshot().
export function recordSnapshot(doc, totalValue) {
  const now = new Date().toISOString();
  const hourKey = now.slice(0, 13);
  const lastHour = doc.valueHistory.length ? doc.valueHistory[doc.valueHistory.length - 1].t.slice(0, 13) : null;
  if (hourKey === lastHour) doc.valueHistory[doc.valueHistory.length - 1] = { t: now, total: totalValue };
  else doc.valueHistory.push({ t: now, total: totalValue });
  if (doc.valueHistory.length > 500) doc.valueHistory.shift();

  doc.funds.forEach((f) => {
    const hist = doc.fundHistory[f.id] || (doc.fundHistory[f.id] = []);
    const lastFundHour = hist.length ? hist[hist.length - 1].t.slice(0, 13) : null;
    if (hourKey === lastFundHour) hist[hist.length - 1] = { t: now, varde: f.varde };
    else hist.push({ t: now, varde: f.varde });
    if (hist.length > 500) hist.shift();
  });
}
