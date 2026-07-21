// Råvaror (commodities), Valutor (currencies), Börsen (market status /
// world clock), Vinnare & förlorare (OMX30 movers) -- ported from
// FortPolio's js/modules/{ravaror,valutor,borsen,vinnareforlorare}.js.

import { el } from "./dom.js";
import * as Format from "./format.js";
import * as Market from "./market.js";
import { cardHeader } from "./cards-holdings.js";

function quoteRow({ id, badge, name, priceText, subLabel, changeText, changeClass, isOpen, symbolValue, onSymbolChange, onToggle }) {
  const row = el("div", "pf-row pf-row-clickable");
  row.addEventListener("click", onToggle);
  row.appendChild(el("div", "pf-row-category", badge));
  const top = el("div", "pf-row-top");
  top.appendChild(el("span", "pf-ticker", name));
  top.appendChild(el("span", "pf-price", priceText));
  row.appendChild(top);
  if (subLabel) row.appendChild(el("div", "pf-unit-suffix", subLabel));
  row.appendChild(el("span", `pf-change ${changeClass}`, changeText));
  if (isOpen) {
    const meta = el("div", "pf-meta");
    meta.addEventListener("click", (e) => e.stopPropagation());
    meta.appendChild(el("span", null, "Symbol:"));
    const input = document.createElement("input");
    input.className = "pf-field"; input.type = "text"; input.value = symbolValue;
    input.addEventListener("change", () => onSymbolChange(input.value));
    meta.appendChild(input);
    row.appendChild(meta);
  }
  return row;
}

export function buildRavarorCard(doc, commodities, { expanded, onToggle, onSetSymbol, onRefresh }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Råvaror", onRefresh));
  const body = el("div", "pf-card-body");
  const list = el("div", "pf-grid-list");
  const usdSek = (doc.currencies || []).find((c) => c.symbol === "USDSEK=X")?.price;

  commodities.forEach((c) => {
    const hasPrice = c.price != null;
    const ch = hasPrice && c.prevClose ? Format.pct(c.price, c.prevClose) : null;
    const [, perUnit] = (c.unit || "").split("/");
    const showSEK = hasPrice && usdSek;
    const displayPrice = showSEK ? c.price * usdSek : c.price;
    const displayCurr = showSEK ? "SEK" : "USD";
    const symbol = Format.currencySymbol(displayCurr);
    list.appendChild(quoteRow({
      id: c.id, badge: displayCurr, name: c.name,
      priceText: hasPrice ? `${symbol} ${displayPrice.toLocaleString("sv-SE", { maximumFractionDigits: 2 })}${perUnit ? ` /${perUnit}` : ""}` : "—",
      changeText: ch ? (ch.pos ? "▲ " : "▼ ") + ch.text : c.status === "error" ? "Ej tillgänglig" : "—",
      changeClass: ch ? (ch.pos ? "pos" : "neg") : "flat",
      isOpen: expanded.has(c.id), symbolValue: c.symbol,
      onSymbolChange: (v) => onSetSymbol(c.id, v), onToggle: () => onToggle(c.id),
    }));
  });
  body.appendChild(list);
  card.appendChild(body);
  return card;
}

export function buildValutorCard(doc, currencies, { expanded, onToggle, onSetSymbol, onTogglePeriod, onRefresh }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Valutor", onRefresh));
  const body = el("div", "pf-card-body");

  const period = doc.valutorTrendPeriod || "day";
  const switchRow = el("div", "pf-switch-row");
  switchRow.appendChild(el("span", "pf-hide-toggle-label", period === "year" ? "Trend: år" : "Trend: dag"));
  const sw = el("div", "pf-switch" + (period === "year" ? " on" : ""));
  sw.appendChild(el("div", "pf-knob"));
  sw.addEventListener("click", onTogglePeriod);
  switchRow.appendChild(sw);
  body.appendChild(switchRow);

  const list = el("div", "pf-grid-list");
  currencies.forEach((c) => {
    const hasPrice = c.price != null;
    const isFiat = c.unit === "SEK";
    const symbol = Format.currencySymbol(c.unit);
    let ch = null;
    if (hasPrice) {
      if (period === "year") { if (c.yearAgoPrice) ch = Format.pct(c.price, c.yearAgoPrice); }
      else if (c.prevClose) ch = Format.pct(c.price, c.prevClose);
    }
    const changeLabel = ch ? (ch.pos ? "▲ " : "▼ ") + ch.text : c.status === "error" ? "Ej tillgänglig" : period === "year" ? "Årshistorik saknas" : "—";
    const decimals = c.price != null && c.price < 1 ? 4 : 2;
    list.appendChild(quoteRow({
      id: c.id, badge: c.unit, name: c.name,
      priceText: hasPrice ? `${symbol} ${c.price.toLocaleString("sv-SE", { maximumFractionDigits: decimals })}` : "—",
      subLabel: isFiat ? `1 ${c.code} i ${c.unit}` : null,
      changeText: changeLabel, changeClass: ch ? (ch.pos ? "pos" : "neg") : "flat",
      isOpen: expanded.has(c.id), symbolValue: c.symbol,
      onSymbolChange: (v) => onSetSymbol(c.id, v), onToggle: () => onToggle(c.id),
    }));
  });
  body.appendChild(list);
  card.appendChild(body);
  return card;
}

export function buildBorsenCard(omxData, exchanges, { onRefresh }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Börsen idag", onRefresh, false));
  const body = el("div", "pf-card-body");

  const now = Market.stockholmNow();
  const day = now.getDay();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const isOpenSE = day >= 1 && day <= 5 && minutesNow >= 540 && minutesNow < 1050;

  const status = el("div", "pf-market-status");
  status.appendChild(el("div", `pf-status-dot ${isOpenSE ? "open" : "closed"}`));
  status.appendChild(el("div", "pf-status-text", isOpenSE ? "Stockholmsbörsen är öppen" : "Stockholmsbörsen är stängd"));
  body.appendChild(status);

  const omx = omxData || { value: null, changePct: null, status: "idle", symbolUsed: null };
  const ch = omx.value != null && omx.changePct != null ? { pos: omx.changePct >= 0, text: Format.pctShort(omx.changePct) } : null;
  const indexBox = el("div", "pf-index-box");
  const left = el("div"); left.appendChild(el("div", "pf-index-name", "OMX Stockholm 30")); left.appendChild(el("div", "pf-index-sub", omx.symbolUsed || "^OMX"));
  indexBox.appendChild(left);
  const right = el("div", "pf-index-val");
  right.appendChild(el("div", null, omx.value != null ? omx.value.toLocaleString("sv-SE", { maximumFractionDigits: 2 }) : omx.status === "error" ? "Kunde inte hämta" : "—"));
  if (ch) right.appendChild(el("div", `pf-change ${ch.pos ? "pos" : "neg"}`, (ch.pos ? "▲ " : "▼ ") + ch.text));
  indexBox.appendChild(right);
  body.appendChild(indexBox);

  const list = el("div");
  exchanges.forEach((ex) => {
    const st = Market.exchangeStatus(ex);
    const row = el("div", "pf-exch-row");
    const nameEl = el("div", "pf-exch-name");
    nameEl.appendChild(el("span", `pf-status-dot ${st.isOpen ? "open" : "closed"}`));
    nameEl.append(` ${ex.flag} ${ex.name}`);
    row.appendChild(nameEl);
    row.appendChild(el("div", "pf-exch-time", st.localTime));
    list.appendChild(row);
  });
  body.appendChild(list);
  body.appendChild(el("div", "pf-hours-note", "Standardöppettider, lokal tid. Tar inte hänsyn till röda dagar/halvdagar."));

  card.appendChild(body);
  return card;
}

export function buildVinnareForlorareCard(omxs30List, { onRefresh }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Dagens vinnare & förlorare", onRefresh, false));
  const body = el("div", "pf-card-body");

  const list = omxs30List.filter((s) => s.changePct != null);
  if (!list.length) {
    body.appendChild(el("div", "pf-empty-note", "Tryck ↻ i kortets hörn för att hämta dagens rörelser bland OMX30-bolagen."));
    card.appendChild(body);
    return card;
  }
  const sorted = list.slice().sort((a, b) => b.changePct - a.changePct);
  const section = (label, items) => {
    const wrap = el("div");
    wrap.appendChild(el("div", "pf-chip-group-label", label));
    items.forEach((s, i) => {
      const pos = s.changePct >= 0;
      const row = el("div", "pf-mover-row");
      row.appendChild(el("span", "pf-mover-rank", (i + 1) + "."));
      row.appendChild(el("span", "pf-ticker", s.name));
      row.appendChild(el("span", `pf-change ${pos ? "pos" : "neg"}`, (pos ? "▲ " : "▼ ") + Format.pctShort(s.changePct)));
      wrap.appendChild(row);
    });
    return wrap;
  };
  body.appendChild(section("Vinnare", sorted.slice(0, 5)));
  body.appendChild(section("Förlorare", sorted.slice(-5).reverse()));
  body.appendChild(el("div", "pf-hours-note", `Baserat på en lista över ${omxs30List.length} av OMX30-bolagen — inte hela börsen, och listan bör stämmas av då och då eftersom indexet balanseras om.`));

  card.appendChild(body);
  return card;
}
