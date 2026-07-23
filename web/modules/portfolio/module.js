// Portfolio -- full port of the standalone FortPolio app: stocks, funds,
// commodities, currencies, a watchlist, price alerts, dividends, a
// weekly-tips paste box, and a Redeye news calendar. Replaces the
// earlier "stocks" watchlist stub now that the whole app is being
// brought in (see supabase/migrations/0013_portfolio.sql).
//
// Deliberate differences from the original:
// - Persistence is one Supabase row (public.portfolio) instead of
//   localStorage + a password-encrypted GitHub-pushed blob -- this
//   whole dashboard is already behind passkey auth + RLS, so a second
//   password layer on top is redundant. See import-fortpolio.js for a
//   one-time client-side-decrypt import of holdings from the old blob.
// - Layout is a responsive CSS grid, not the original's custom drag/
//   resize masonry engine -- explicitly simpler and more predictable on
//   narrow screens, which was the point of rebuilding it at all.
// - The price-paste and P/S-paste text boxes from the original Aktier
//   card aren't ported (manual price override is still available per
//   stock, via the detail panel) -- a deliberate trim, not an oversight.
// - Adding a new stock/fund now has an actual UI (the original had none
//   -- new positions had to be added by hand-editing the encrypted blob
//   before re-encrypting).

import { el, trustedHtml } from "./dom.js";
import * as Format from "./format.js";
import * as Market from "./market.js";
import * as Charts from "./charts.js";
import { COMMODITIES, EXCHANGES, OMX_CANDIDATES, OMXS30_LIST, DEFAULT_CURRENCIES } from "./data.js";
import { loadPortfolio, schedulePortfolioSave, assignIds, recordSnapshot } from "./store.js";
import { decryptFortPolioHoldings, mapImportedHoldings } from "./import-fortpolio.js";
import { buildAktierCard, buildFonderCard, buildAllokeringCard, holdingsBreakdown, currentCost } from "./cards-holdings.js";
import { buildRavarorCard, buildValutorCard, buildBorsenCard, buildVinnareForlorareCard } from "./cards-market.js";
import { buildBevakningCard, buildUtdelningCard, buildVeckansTipsCard } from "./cards-lists.js";
import * as Redeye from "./redeye.js";
import * as Alerts from "./alerts.js";

const OPEN_INTERVAL_MS = 2 * 60 * 1000;
const CLOSED_INTERVAL_MS = 60 * 60 * 1000;

export default {
  id: "portfolio",
  navLabel: "Portfolio",

  async mount(container, ctx) {
    const { supabase } = ctx;

    const loaded = await loadPortfolio(supabase);
    if (!loaded) {
      container.appendChild(el("div", "empty-state", "Kunde inte hämta portföljen. Kör migrationen supabase/migrations/0013_portfolio.sql om du inte redan gjort det."));
      return;
    }
    const { rowId } = loaded;
    const doc = loaded.doc;
    assignIds(doc);

    // Runtime-only state -- prices, sparklines, UI toggles -- none of
    // this is persisted; it's rebuilt by fetching/refreshing each time.
    const commodities = COMMODITIES.map((c) => ({ ...c, symbol: doc.commoditySymbols[c.id] || c.symbol, price: null, prevClose: null, status: "idle" }));
    const currencies = DEFAULT_CURRENCIES.map((c) => ({ ...c, symbol: doc.currencySymbols[c.id] || c.symbol, price: null, prevClose: null, yearAgoPrice: null, status: "idle" }));
    const omxs30List = OMXS30_LIST.map((s) => ({ ...s, changePct: null }));
    let omxData = { value: null, changePct: null, status: "idle", symbolUsed: null };
    const dividendData = {};
    let dividendsFetching = false;

    let aktierFilter = "all";
    const ravarorExpanded = new Set();
    const valutorExpanded = new Set();
    let bevakningAddOpen = false;
    let detailStock = null;
    let redeyeView = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: Redeye.todayStr() };

    let autoRefreshTimer = null;
    let autoRefreshPaused = false;

    function save() {
      schedulePortfolioSave(supabase, rowId, doc, (error) => {
        if (error) console.error("Kunde inte spara portföljen:", error);
      });
    }

    function stockholmIsOpen() {
      const ex = EXCHANGES.find((e) => e.name.includes("Stockholm"));
      return ex ? Market.exchangeStatus(ex).isOpen : false;
    }

    // ---------- header ----------
    function renderHeader() {
      headerEl.innerHTML = "";
      const { aktier, fonder, total } = holdingsBreakdown(doc);
      const cost = currentCost(doc);
      const diff = total - cost;
      const pct = cost ? (diff / cost) * 100 : 0;

      const totalWrap = el("div", "pf-header-total");
      const totalRow = el("div", "pf-header-total-row");
      totalRow.appendChild(el("span", "pf-header-total-value", Format.amount(total, doc.hideAmounts)));
      const hideBtn = el("button", "pf-hide-toggle", doc.hideAmounts ? "Visa belopp" : "Dölj belopp");
      hideBtn.addEventListener("click", () => { doc.hideAmounts = !doc.hideAmounts; save(); renderAll(); });
      totalRow.appendChild(hideBtn);
      totalWrap.appendChild(totalRow);

      const sign = pct >= 0 ? "+" : "";
      const changeEl = el("span", `pf-change ${pct < 0 ? "neg" : "pos"}`, `${sign}${pct.toFixed(1).replace(".", ",")}% · ${sign}${Format.amount(Math.abs(diff), doc.hideAmounts)} sen köp`);
      totalWrap.appendChild(changeEl);

      const breakdown = el("div", "pf-header-breakdown");
      const aktierStat = el("div", "pf-header-stat"); aktierStat.appendChild(el("span", null, "Aktier")); aktierStat.appendChild(el("b", null, Format.amount(aktier, doc.hideAmounts)));
      const fonderStat = el("div", "pf-header-stat"); fonderStat.appendChild(el("span", null, "Fonder")); fonderStat.appendChild(el("b", null, Format.amount(fonder, doc.hideAmounts)));
      breakdown.append(aktierStat, fonderStat);
      totalWrap.appendChild(breakdown);
      headerEl.appendChild(totalWrap);

      if (doc.valueHistory.length >= 2) {
        const values = doc.valueHistory.map((h) => h.total);
        const first = values[0], last = values[values.length - 1];
        const histDiff = last - first;
        const histPct = first ? (histDiff / first) * 100 : 0;
        const pos = histPct >= 0;
        const chartWrap = el("div", "pf-header-chart");
        chartWrap.appendChild(trustedHtml("div", null, Charts.sparkline(values, { responsive: true, width: 220, height: 44, strokeWidth: 2, color: pos ? "var(--pf-gain)" : "var(--pf-loss)" })));
        const changeLine = el("div", "pf-header-chart-change");
        changeLine.appendChild(el("span", `pf-change ${pos ? "pos" : "neg"}`, (pos ? "▲ " : "▼ ") + Format.pctShort(histPct)));
        changeLine.append(` · ${Format.amount(histDiff, doc.hideAmounts)} sedan ${new Date(doc.valueHistory[0].t).toLocaleDateString("sv-SE")}`);
        chartWrap.appendChild(changeLine);
        headerEl.appendChild(chartWrap);
      }

      const marketRow = el("div", "pf-market-indicator" + (stockholmIsOpen() ? " open" : " closed"));
      const flagSpan = el("span", "pf-market-flag" + (stockholmIsOpen() ? "" : " closed"), "🇸🇪");
      marketRow.append(flagSpan, stockholmIsOpen() ? "Svenska börsen öppen" : "Svenska börsen stängd");
      headerEl.appendChild(marketRow);
    }

    // ---------- market refresh ----------
    async function refreshCommodities() {
      const result = await Market.fetchEach(commodities, async (c) => {
        const q = Market.normalizeQuote(await Market.fetchQuote(c.symbol));
        c.price = q.price; c.prevClose = q.prevClose; c.status = "ok";
      }, (c) => { c.status = "error"; });
      renderCard("ravaror");
      return result;
    }
    async function refreshCurrencies() {
      const result = await Market.fetchEach(currencies, async (c) => {
        const q = Market.normalizeQuote(await Market.fetchQuote(c.symbol));
        c.price = q.price; c.prevClose = q.prevClose; c.status = "ok";
        try { const hist = await Market.fetchHistory(c.symbol, "1y", "1mo"); if (hist?.length) c.yearAgoPrice = hist[0]; } catch { /* not critical */ }
      }, (c) => { c.status = "error"; });
      renderCard("valutor");
      return result;
    }
    async function refreshStocks() {
      const result = await Market.fetchEach(doc.stocks, async (s) => {
        let quoteErr = null;
        try { s.price = Market.normalizeQuote(await Market.fetchQuote(s.symbol)).price; } catch (e) { quoteErr = e; }
        try { s.sparkline = await Market.fetchHistory(s.symbol); } catch { /* no chart right now */ }
        if (quoteErr) throw quoteErr;
      });
      renderCard("aktier"); renderCard("allokering"); renderHeader();
      return result;
    }
    async function refreshWatchlist() {
      const result = await Market.fetchEach(doc.watchlist, async (w) => {
        let quoteErr = null;
        try {
          const q = Market.normalizeQuote(await Market.fetchQuote(w.symbol));
          w.price = q.price; w.prevClose = q.prevClose; w.curr = q.currency || w.curr;
        } catch (e) { quoteErr = e; }
        try { w.sparkline = await Market.fetchHistory(w.symbol); } catch { /* no chart right now */ }
        if (quoteErr) throw quoteErr;
      });
      renderCard("bevakning");
      return result;
    }
    async function refreshOMXS30() {
      const result = await Market.fetchEach(omxs30List, async (s) => {
        const meta = await Market.fetchQuote(s.symbol);
        const prev = meta.chartPreviousClose ?? meta.previousClose;
        if (prev) s.changePct = ((meta.regularMarketPrice - prev) / prev) * 100;
      });
      renderCard("vinnareforlorare");
      return result;
    }
    async function refreshOMXIndex() {
      let ok = 0, fail = 0;
      try {
        const { meta, symbolUsed } = await Market.fetchQuoteWithFallbacks(OMX_CANDIDATES);
        omxData.value = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose ?? meta.previousClose;
        omxData.changePct = prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : null;
        omxData.symbolUsed = symbolUsed; omxData.status = "ok"; ok++;
      } catch { omxData.status = "error"; fail++; }
      renderCard("borsen");
      return { ok, fail };
    }

    async function refreshAll() {
      await refreshCommodities(); await refreshCurrencies(); await refreshStocks();
      await refreshWatchlist(); await refreshOMXS30(); await refreshOMXIndex();
      recordSnapshot(doc, holdingsBreakdown(doc).total);
      save();
      renderHeader();
    }

    function scheduleNextAutoRefresh() {
      clearTimeout(autoRefreshTimer);
      if (autoRefreshPaused) return;
      const interval = stockholmIsOpen() ? OPEN_INTERVAL_MS : CLOSED_INTERVAL_MS;
      autoRefreshTimer = setTimeout(async () => { await refreshAll(); scheduleNextAutoRefresh(); }, interval);
    }

    // ---------- stock detail overlay ----------
    function openDetail(s) { detailStock = s; renderDetail(); }
    function closeDetail() { detailStock = null; renderDetail(); }
    function renderDetail() {
      detailEl.innerHTML = "";
      if (!detailStock) { detailEl.classList.remove("open"); return; }
      detailEl.classList.add("open");
      const s = detailStock;
      const ch = Format.pct(s.price, s.gav);
      const panel = el("div", "pf-detail-panel");

      const closeBtn = el("button", "pf-close-btn", "×");
      closeBtn.addEventListener("click", closeDetail);
      panel.appendChild(closeBtn);
      panel.appendChild(el("h3", "pf-detail-title", `${Format.flag(s.land)} ${s.name}`));

      if (s.sparkline) panel.appendChild(trustedHtml("div", "pf-big-sparkline", Charts.sparkline(s.sparkline, { responsive: true, width: 300, height: 70, strokeWidth: 2, color: ch.pos ? "var(--pf-gain)" : "var(--pf-loss)" })));

      const priceRow = el("div", "pf-settings-row");
      priceRow.appendChild(el("span", null, "Kurs"));
      const priceVal = el("span", null, s.price != null ? Format.price(s.price, s.curr) : "—");
      priceVal.appendChild(el("span", `pf-change ${ch.flat ? "flat" : ch.pos ? "pos" : "neg"}`, " " + (ch.flat ? "" : ch.pos ? "▲ " : "▼ ") + ch.text));
      priceRow.appendChild(priceVal);
      panel.appendChild(priceRow);

      const holdRow = el("div", "pf-settings-row");
      holdRow.appendChild(el("span", null, "Innehav"));
      holdRow.appendChild(el("span", null, `${s.antal} st · GAV ${s.gav.toLocaleString("sv-SE", { minimumFractionDigits: 2 })} ${s.curr}`));
      panel.appendChild(holdRow);

      const valueRow = el("div", "pf-settings-row");
      valueRow.appendChild(el("span", null, "Marknadsvärde"));
      valueRow.appendChild(el("span", "pf-value-amt", Format.amountIn((s.price ?? 0) * s.antal, s.curr, doc.hideAmounts)));
      panel.appendChild(valueRow);

      const field = (label, inputEl) => {
        const row = el("div", "pf-settings-row pf-settings-row-col");
        row.appendChild(el("span", null, label));
        row.appendChild(inputEl);
        return row;
      };

      const symbolInput = document.createElement("input");
      symbolInput.className = "pf-field"; symbolInput.type = "text"; symbolInput.value = s.symbol || ""; symbolInput.placeholder = "ex. ATCO-A.ST";
      symbolInput.addEventListener("change", () => { s.symbol = symbolInput.value.trim(); s.guess = false; save(); });
      panel.appendChild(field("Symbol", symbolInput));

      const priceInput = document.createElement("input");
      priceInput.className = "pf-field"; priceInput.type = "text"; priceInput.value = s.price != null ? String(s.price) : "";
      priceInput.addEventListener("change", () => {
        const num = parseFloat(priceInput.value.replace(",", "."));
        if (!isNaN(num)) { s.price = num; save(); renderCard("aktier"); renderHeader(); }
      });
      panel.appendChild(field("Manuell kurs", priceInput));

      const antalInput = document.createElement("input");
      antalInput.className = "pf-field"; antalInput.type = "number"; antalInput.value = s.antal;
      antalInput.addEventListener("change", () => { s.antal = Number(antalInput.value) || 0; save(); renderCard("aktier"); renderHeader(); });
      panel.appendChild(field("Antal", antalInput));

      const gavInput = document.createElement("input");
      gavInput.className = "pf-field"; gavInput.type = "number"; gavInput.step = "0.01"; gavInput.value = s.gav;
      gavInput.addEventListener("change", () => { s.gav = Number(gavInput.value) || 0; save(); renderCard("aktier"); renderHeader(); });
      panel.appendChild(field("GAV", gavInput));

      const alert = doc.priceAlerts[s.id] || {};
      const alertRow = el("div", "pf-settings-row pf-settings-row-col");
      alertRow.appendChild(el("span", null, "Prisalarm"));
      const alertInputs = el("div", "pf-row-inputs");
      const aboveInput = document.createElement("input");
      aboveInput.className = "pf-field"; aboveInput.type = "text"; aboveInput.placeholder = "över"; aboveInput.value = alert.above != null ? alert.above : "";
      aboveInput.addEventListener("change", () => setAlert(s.id, "above", aboveInput.value));
      const belowInput = document.createElement("input");
      belowInput.className = "pf-field"; belowInput.type = "text"; belowInput.placeholder = "under"; belowInput.value = alert.below != null ? alert.below : "";
      belowInput.addEventListener("change", () => setAlert(s.id, "below", belowInput.value));
      alertInputs.append(aboveInput, belowInput);
      alertRow.appendChild(alertInputs);
      panel.appendChild(alertRow);

      const removeBtn = el("button", "pf-btn", "Ta bort innehav");
      removeBtn.addEventListener("click", () => {
        if (!confirm(`Ta bort ${s.name} från portföljen?`)) return;
        removeStockAt(doc.stocks.indexOf(s));
        save(); closeDetail(); renderCard("aktier"); renderCard("allokering"); renderHeader();
      });
      panel.appendChild(removeBtn);

      detailEl.appendChild(panel);
    }

    function setAlert(id, kind, val) {
      const num = parseFloat(String(val).replace(",", "."));
      const alert = doc.priceAlerts[id] || (doc.priceAlerts[id] = {});
      if (val === "" || isNaN(num)) delete alert[kind]; else alert[kind] = num;
      if (alert.above == null && alert.below == null) delete doc.priceAlerts[id];
      save();
    }

    // Removing a stock shifts its priceAlerts/ps entries the same way
    // watchlist removal already does for "w"-prefixed keys -- ids are
    // array-position-based (assignIds()), so anything keyed by a later
    // stock's id needs to move down one to stay attached to the right
    // stock, not silently end up on whatever now occupies that slot.
    function removeStockAt(i) {
      if (i < 0) return;
      doc.stocks.splice(i, 1);
      const shiftKeyed = (obj) => {
        const shifted = {};
        Object.keys(obj).forEach((key) => {
          if (!key.startsWith("s")) { shifted[key] = obj[key]; return; }
          const idx = parseInt(key.slice(1), 10);
          if (isNaN(idx)) { shifted[key] = obj[key]; return; }
          if (idx < i) shifted[key] = obj[key];
          else if (idx > i) shifted["s" + (idx - 1)] = obj[key];
        });
        return shifted;
      };
      doc.priceAlerts = shiftKeyed(doc.priceAlerts);
      doc.ps = shiftKeyed(doc.ps);
      assignIds(doc);
    }

    // ---------- card registry + grid ----------
    const cardEls = {};
    function renderCard(id) {
      const target = cardEls[id];
      if (!target) return;
      target.innerHTML = "";
      target.appendChild(buildCard(id));
    }
    // Recomputed right before each render that shows alert badges --
    // Alerts.check() also fires a notification on a fresh crossing, so
    // this is a side-effecting call, not a pure read.
    function computeTriggeredIds() {
      const ids = new Set();
      doc.stocks.forEach((s) => { if (Alerts.check(doc.priceAlerts, s.id, s.name, s.price)) ids.add(s.id); });
      doc.watchlist.forEach((w, i) => { if (Alerts.check(doc.priceAlerts, "w" + i, w.name, w.price)) ids.add("w" + i); });
      return ids;
    }

    function buildCard(id) {
      switch (id) {
        case "borsen": return buildBorsenCard(omxData, EXCHANGES, { onRefresh: refreshOMXIndex });
        case "aktier": return buildAktierCard(doc, {
          hideAmounts: doc.hideAmounts, filter: aktierFilter,
          onSetFilter: (f) => { aktierFilter = f; renderCard("aktier"); },
          onOpenDetail: openDetail, onRefresh: refreshStocks,
          onAddStock: (stock) => { doc.stocks.push(stock); assignIds(doc); save(); renderCard("aktier"); renderCard("allokering"); renderHeader(); },
          triggeredIds: computeTriggeredIds(),
        });
        case "fonder": return buildFonderCard(doc, {
          onRefresh: null,
          onAddFund: (fund) => { doc.funds.push(fund); assignIds(doc); save(); renderCard("fonder"); renderCard("allokering"); renderHeader(); },
        });
        case "ravaror": return buildRavarorCard(doc, commodities, {
          expanded: ravarorExpanded,
          onToggle: (id2) => { ravarorExpanded.has(id2) ? ravarorExpanded.delete(id2) : ravarorExpanded.add(id2); renderCard("ravaror"); },
          onSetSymbol: (id2, v) => { doc.commoditySymbols[id2] = v.trim(); const c = commodities.find((x) => x.id === id2); if (c) c.symbol = v.trim(); save(); },
          onRefresh: refreshCommodities,
        });
        case "valutor": return buildValutorCard(doc, currencies, {
          expanded: valutorExpanded,
          onToggle: (id2) => { valutorExpanded.has(id2) ? valutorExpanded.delete(id2) : valutorExpanded.add(id2); renderCard("valutor"); },
          onSetSymbol: (id2, v) => { doc.currencySymbols[id2] = v.trim(); const c = currencies.find((x) => x.id === id2); if (c) c.symbol = v.trim(); save(); },
          onTogglePeriod: () => { doc.valutorTrendPeriod = doc.valutorTrendPeriod === "year" ? "day" : "year"; save(); renderCard("valutor"); },
          onRefresh: refreshCurrencies,
        });
        case "bevakning": return buildBevakningCard(doc, {
          addOpen: bevakningAddOpen,
          onToggleAdd: () => { bevakningAddOpen = !bevakningAddOpen; renderCard("bevakning"); },
          onAdd: (name, symbol) => { if (!name || !symbol) return; doc.watchlist.push({ symbol, name, curr: "USD", price: null, prevClose: null }); save(); renderCard("bevakning"); },
          onRemove: (i) => {
            doc.watchlist.splice(i, 1);
            const shifted = {};
            Object.keys(doc.priceAlerts).forEach((key) => {
              if (!key.startsWith("w")) { shifted[key] = doc.priceAlerts[key]; return; }
              const idx = parseInt(key.slice(1), 10);
              if (idx < i) shifted[key] = doc.priceAlerts[key];
              else if (idx > i) shifted["w" + (idx - 1)] = doc.priceAlerts[key];
            });
            doc.priceAlerts = shifted;
            save(); renderCard("bevakning");
          },
          onSetAlert: (i, kind, val) => { setAlert("w" + i, kind, val); renderCard("bevakning"); },
          onRefresh: refreshWatchlist,
          triggeredIds: computeTriggeredIds(),
        });
        case "allokering": return buildAllokeringCard(doc, {
          onSetTarget: (val) => { let n = parseFloat(val); if (isNaN(n)) n = 35; doc.targetAktier = Math.max(0, Math.min(100, n)); save(); renderCard("allokering"); },
        });
        case "vinnareforlorare": return buildVinnareForlorareCard(omxs30List, { onRefresh: refreshOMXS30 });
        case "utdelning": return buildUtdelningCard(doc, dividendData, {
          fetching: dividendsFetching,
          onFetchAll: async () => {
            if (dividendsFetching) return;
            dividendsFetching = true; renderCard("utdelning");
            for (const s of doc.stocks.filter((x) => x.symbol)) {
              const entry = { history: null, calendar: null };
              try { entry.history = await Market.fetchDividendHistory(s.symbol); } catch { /* no history */ }
              try { entry.calendar = await Market.fetchDividendCalendar(s.symbol); } catch { /* best effort */ }
              dividendData[s.symbol] = entry;
            }
            dividendsFetching = false; renderCard("utdelning");
          },
        });
        case "veckanstips": return buildVeckansTipsCard(doc, {
          onSave: (raw) => {
            const today = new Date().toLocaleDateString("sv-SE");
            doc.veckansTips = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
              const [bolag, ...rest] = line.split(" - ");
              return { bolag: bolag.trim(), kommentar: rest.join(" - ").trim(), datum: today };
            }).slice(0, 30);
            save(); renderCard("veckanstips");
          },
        });
        case "redeye": return buildRedeyeCard();
        default: return el("div");
      }
    }

    function buildRedeyeCard() {
      const card = el("div", "pf-card");
      const head = el("div", "pf-card-head");
      head.appendChild(el("h2", "pf-section-title", "Redeye-nyheter"));
      card.appendChild(head);
      const body = el("div", "pf-card-body");
      const { el: calEl, prevBtn, nextBtn } = Redeye.buildRedeyeCalendar(doc, redeyeView.year, redeyeView.month, redeyeView.selected, {
        onSelectDay: (d) => { redeyeView.selected = d; renderCard("redeye"); },
      });
      prevBtn.addEventListener("click", () => { redeyeView.month--; if (redeyeView.month < 0) { redeyeView.month = 11; redeyeView.year--; } renderCard("redeye"); });
      nextBtn.addEventListener("click", () => { redeyeView.month++; if (redeyeView.month > 11) { redeyeView.month = 0; redeyeView.year++; } renderCard("redeye"); });
      body.appendChild(calEl);
      body.appendChild(Redeye.buildRedeyeEntries(doc, redeyeView.selected, {
        onRemove: (id) => { doc.redeyeNews = doc.redeyeNews.filter((e) => e.id !== id); save(); renderCard("redeye"); },
        onAdd: (date, title, content) => {
          if (!title && !content) return;
          doc.redeyeNews.push({ id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: date || Redeye.todayStr(), title, content, addedAt: new Date().toISOString() });
          save();
          const [y, m] = (date || Redeye.todayStr()).split("-").map(Number);
          redeyeView.year = y; redeyeView.month = m - 1; redeyeView.selected = date || Redeye.todayStr();
          renderCard("redeye");
        },
      }));
      card.appendChild(body);
      return card;
    }

    // Three placement groups instead of one flat CARD_ORDER, per the
    // desktop redesign: allokering/valutor/ravaror move up next to the
    // header total (headerSideEl, styled compact -- see module.css) as
    // "at a glance" stats rather than full cards in the scroll; aktier/
    // fonder/borsen/vinnareforlorare get a dedicated named-area grid
    // (topGridEl) wide enough to give aktier a real two-column holdings
    // list and put börsen+vinnare in their own right-hand column; the
    // remaining cards keep the original simple auto-fit flow (gridEl).
    // Same buildCard(id)/cardEls[id] machinery throughout -- only which
    // container a slot lands in changed, not how a card is built or
    // refreshed.
    const HEADER_SIDE_CARDS = ["allokering", "valutor", "ravaror"];
    const TOP_GRID_CARDS = ["vinnareforlorare", "aktier", "fonder", "borsen"];
    const REST_CARDS = ["bevakning", "utdelning", "veckanstips", "redeye"];

    function renderGroup(container, ids, extraClass) {
      container.innerHTML = "";
      ids.forEach((id) => {
        const holder = el("div", "pf-card-slot" + (extraClass ? ` ${extraClass}` : ""));
        holder.dataset.cardId = id;
        cardEls[id] = holder;
        holder.appendChild(buildCard(id));
        container.appendChild(holder);
      });
    }

    function renderAll() {
      renderHeader();
      renderGroup(headerSideEl, HEADER_SIDE_CARDS);
      renderGroup(topGridEl, TOP_GRID_CARDS);
      renderGroup(gridEl, REST_CARDS);
    }

    // ---------- import from FortPolio ----------
    function openImportDialog() {
      const password = prompt("FortPolio-lösenord (avkrypteras lokalt i webbläsaren, skickas aldrig någonstans):");
      if (!password) return;
      importMsgEl.textContent = "Avkrypterar…";
      decryptFortPolioHoldings(password).then((decrypted) => {
        const { stocks, funds } = mapImportedHoldings(decrypted);
        if (!confirm(`Hittade ${stocks.length} aktier och ${funds.length} fonder. Ersätta nuvarande innehav i tor-dash?`)) {
          importMsgEl.textContent = "";
          return;
        }
        doc.stocks = stocks; doc.funds = funds;
        assignIds(doc); save();
        renderCard("aktier"); renderCard("fonder"); renderCard("allokering"); renderHeader();
        importMsgEl.textContent = `Importerat: ${stocks.length} aktier, ${funds.length} fonder.`;
      }).catch(() => {
        importMsgEl.textContent = "Fel lösenord eller korrupt data.";
      });
    }

    // ---------- shell ----------
    const root = el("div", "pf-app");
    const headerEl = el("div", "pf-header");
    const headerSideEl = el("div", "pf-header-side");
    const headerRow = el("div", "pf-header-row");
    headerRow.append(headerEl, headerSideEl);
    const toolbar = el("div", "pf-toolbar");
    const importBtn = el("button", "pf-btn", "Importera från FortPolio");
    importBtn.addEventListener("click", openImportDialog);
    const notifyBtn = el("button", "pf-btn-small", "Aktivera prisalarm-notiser");
    notifyBtn.addEventListener("click", async () => {
      const ok = await Alerts.ensurePermission();
      notifyBtn.textContent = ok ? "✓ Notiser aktiverade" : "Notiser blockerade av webbläsaren";
      notifyBtn.disabled = ok;
    });
    const importMsgEl = el("span", "pf-import-msg");
    toolbar.append(importBtn, notifyBtn, importMsgEl);
    const topGridEl = el("div", "pf-top-grid");
    const gridEl = el("div", "pf-grid");
    const detailEl = el("div", "pf-detail-overlay");
    root.append(headerRow, toolbar, topGridEl, gridEl, detailEl);
    container.appendChild(root);

    renderAll();
    await refreshAll();
    scheduleNextAutoRefresh();

    this._cleanup = () => clearTimeout(autoRefreshTimer);
  },

  unmount() {
    if (this._cleanup) this._cleanup();
  },
};
