// Aktier (stocks) + Fonder (funds) + Allokering (allocation target) cards
// -- the core holdings, ported from FortPolio's js/modules/aktier.js,
// fonder.js, allokering.js. Sector/geography breakdown is folded into
// the top of the Aktier card itself rather than kept as a separate
// always-visible "Overview" header section (a deliberate trim from the
// original's three-donuts-above-everything layout).

import { el, trustedHtml } from "./dom.js";
import * as Format from "./format.js";
import * as Charts from "./charts.js";

const SECTOR_COLORS = ["#5B8DEF", "#9B6BCE", "#4FB8E0", "#E0A15C", "#7FA8C9", "#C97BB0", "#6FBF73", "#D98686", "#8FA6B2", "#B7A0E0"];
const FOREIGN_COLOR = "#5B8DEF";
const COLOR_AKTIER = "var(--pf-gold)";
const COLOR_FONDER = "#5B8DEF";
const MIN_SLICE_SHARE = 0.04;

export function holdingsBreakdown(doc) {
  const aktier = doc.stocks.filter((s) => s.curr === "SEK" && s.price != null).reduce((sum, s) => sum + s.price * s.antal, 0);
  const fonder = doc.funds.reduce((sum, f) => sum + f.varde, 0);
  return { aktier, fonder, total: aktier + fonder };
}

export function currentCost(doc) {
  const stockCostSEK = doc.stocks.filter((s) => s.curr === "SEK" && s.gav > 0).reduce((sum, s) => sum + s.gav * s.antal, 0);
  const fundCost = doc.funds.reduce((sum, f) => sum + f.kostnad, 0);
  return stockCostSEK + fundCost;
}

function sectorEntries(doc) {
  const totals = {};
  doc.stocks.forEach((s) => {
    if (s.price == null) return;
    const sec = (s.tags && s.tags[0]) || "Övrigt";
    totals[sec] = (totals[sec] || 0) + s.price * s.antal;
  });
  const total = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const main = [];
  let rest = 0;
  sorted.forEach(([label, val]) => {
    if (val / total >= MIN_SLICE_SHARE) main.push([label, val]);
    else rest += val;
  });
  if (rest > 0) {
    const other = main.find(([label]) => label === "Övrigt");
    if (other) other[1] += rest;
    else main.push(["Övrigt", rest]);
  }
  return main.sort((a, b) => b[1] - a[1]).map(([label, val], i) => ({
    label, val, color: label === "Övrigt" ? "var(--ink-grey)" : SECTOR_COLORS[i % SECTOR_COLORS.length],
  }));
}

function landEntries(doc) {
  const seValue = doc.stocks.filter((s) => s.land === "SE" && s.price != null).reduce((sum, s) => sum + s.price * s.antal, 0);
  const totalValue = doc.stocks.filter((s) => s.price != null).reduce((sum, s) => sum + s.price * s.antal, 0);
  return [
    { label: "Svenska", val: seValue, color: COLOR_AKTIER },
    { label: "Utländska", val: totalValue - seValue, color: FOREIGN_COLOR },
  ];
}

function distBlock(title, entries) {
  const block = el("div", "pf-dist-block");
  block.appendChild(el("div", "pf-chip-group-label", title));
  block.appendChild(trustedHtml("div", null, Charts.percentBar(entries)));
  return block;
}

function stockRow(s, hideAmounts, onOpenDetail, triggered) {
  const row = el("div", "pf-row pf-row-clickable");
  row.addEventListener("click", () => onOpenDetail(s));
  const value = (s.price ?? 0) * s.antal;
  const ch = s.price != null ? Format.pct(s.price, s.gav) : { text: "Ingen kurs", pos: true, flat: true };
  const category = (s.tags && s.tags[0]) || "";

  if (category) row.appendChild(el("div", "pf-row-category", category));
  const nameEl = el("div", "pf-row-name", `${Format.flag(s.land)} ${triggered ? "🔔 " : ""}${s.name}`);
  nameEl.title = s.name;
  row.appendChild(nameEl);

  const top = el("div", "pf-row-top");
  top.appendChild(el("span", "pf-price", s.price != null ? Format.price(s.price, s.curr) : "—"));
  const changeEl = el("span", `pf-change ${ch.flat ? "flat" : ch.pos ? "pos" : "neg"}`, (ch.flat ? "" : ch.pos ? "▲ " : "▼ ") + ch.text);
  top.appendChild(changeEl);
  row.appendChild(top);

  const sub = el("div", "pf-row-sub");
  sub.appendChild(el("span", "pf-value-amt", Format.amountIn(value, s.curr, hideAmounts)));
  row.appendChild(sub);

  if (s.sparkline) {
    row.appendChild(trustedHtml("div", "pf-row-sparkline", Charts.sparkline(s.sparkline, { color: ch.pos ? "var(--pf-gain)" : "var(--pf-loss)" })));
  }
  return row;
}

function addStockForm(onAdd) {
  const box = el("div", "pf-text-box");
  box.appendChild(el("h3", null, "Lägg till aktie"));
  const row1 = el("div", "pf-row-inputs");
  const nameInput = document.createElement("input"); nameInput.className = "pf-field"; nameInput.placeholder = "Namn, t.ex. Atlas Copco A";
  const symInput = document.createElement("input"); symInput.className = "pf-field"; symInput.placeholder = "Symbol, t.ex. ATCO-A.ST";
  row1.append(nameInput, symInput);
  box.appendChild(row1);
  const row2 = el("div", "pf-row-inputs");
  const antalInput = document.createElement("input"); antalInput.className = "pf-field pf-field-num"; antalInput.type = "number"; antalInput.placeholder = "Antal";
  const gavInput = document.createElement("input"); gavInput.className = "pf-field pf-field-num"; gavInput.type = "number"; gavInput.step = "0.01"; gavInput.placeholder = "GAV";
  const currInput = document.createElement("input"); currInput.className = "pf-field pf-field-num"; currInput.value = "SEK"; currInput.placeholder = "Valuta";
  const landInput = document.createElement("input"); landInput.className = "pf-field pf-field-num"; landInput.value = "SE"; landInput.placeholder = "Land";
  row2.append(antalInput, gavInput, currInput, landInput);
  box.appendChild(row2);
  const actions = el("div", "pf-actions-row");
  const addBtn = el("button", "pf-btn pf-btn-gold", "Lägg till");
  addBtn.addEventListener("click", () => {
    if (!nameInput.value.trim()) return;
    onAdd({
      name: nameInput.value.trim(), symbol: symInput.value.trim(),
      antal: Number(antalInput.value) || 0, gav: Number(gavInput.value) || 0,
      curr: currInput.value.trim() || "SEK", land: landInput.value.trim() || "SE", tags: [],
    });
    nameInput.value = ""; symInput.value = ""; antalInput.value = ""; gavInput.value = "";
  });
  actions.appendChild(addBtn);
  box.appendChild(actions);
  return box;
}

function addFundForm(onAdd) {
  const box = el("div", "pf-text-box");
  box.appendChild(el("h3", null, "Lägg till fond"));
  const row = el("div", "pf-row-inputs");
  const nameInput = document.createElement("input"); nameInput.className = "pf-field"; nameInput.placeholder = "Namn";
  const kostnadInput = document.createElement("input"); kostnadInput.className = "pf-field pf-field-num"; kostnadInput.type = "number"; kostnadInput.placeholder = "Inköpsvärde";
  const vardeInput = document.createElement("input"); vardeInput.className = "pf-field pf-field-num"; vardeInput.type = "number"; vardeInput.placeholder = "Nuvarande värde";
  row.append(nameInput, kostnadInput, vardeInput);
  box.appendChild(row);
  const actions = el("div", "pf-actions-row");
  const addBtn = el("button", "pf-btn pf-btn-gold", "Lägg till");
  addBtn.addEventListener("click", () => {
    if (!nameInput.value.trim()) return;
    onAdd({ name: nameInput.value.trim(), kostnad: Number(kostnadInput.value) || 0, varde: Number(vardeInput.value) || 0 });
    nameInput.value = ""; kostnadInput.value = ""; vardeInput.value = "";
  });
  actions.appendChild(addBtn);
  box.appendChild(actions);
  return box;
}

export function buildAktierCard(doc, { hideAmounts, filter, onSetFilter, onOpenDetail, onRefresh, onAddStock, triggeredIds }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Aktier", onRefresh));
  const body = el("div", "pf-card-body");

  const filters = [
    { k: "all", label: "Alla" }, { k: "winners", label: "Vinnare" }, { k: "losers", label: "Förlorare" },
    { k: "swedish", label: "Svenska" }, { k: "foreign", label: "Utländska" },
  ];
  const chipRow = el("div", "pf-chip-row");
  filters.forEach((f) => {
    const chip = el("button", "pf-chip" + (filter === f.k ? " active" : ""), f.label);
    chip.addEventListener("click", () => onSetFilter(f.k));
    chipRow.appendChild(chip);
  });
  body.appendChild(chipRow);

  const matches = (s) => {
    const ch = Format.pct(s.price, s.gav);
    if (filter === "all") return true;
    if (filter === "winners") return ch.pos && !ch.flat;
    if (filter === "losers") return !ch.pos && !ch.flat;
    if (filter === "swedish") return s.land === "SE";
    if (filter === "foreign") return s.land !== "SE";
    return true;
  };
  const filtered = doc.stocks.filter(matches).slice().sort((a, b) => Format.pct(b.price, b.gav).raw - Format.pct(a.price, a.gav).raw);

  const list = el("div", "pf-grid-list");
  if (!filtered.length) list.appendChild(el("div", "pf-empty-note", "Inga aktier matchar filtret."));
  else filtered.forEach((s) => list.appendChild(stockRow(s, hideAmounts, onOpenDetail, triggeredIds && triggeredIds.has(s.id))));
  body.appendChild(list);
  body.appendChild(addStockForm(onAddStock));

  card.appendChild(body);
  return card;
}

export function buildFonderCard(doc, { onRefresh, onAddFund }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Fonder (NAV manuellt)", onRefresh, false));
  const body = el("div", "pf-card-body");
  const list = el("div", "pf-grid-list");
  if (!doc.funds.length) {
    list.appendChild(el("div", "pf-empty-note", "Inga fonder tillagda."));
  } else {
    doc.funds.slice().sort((a, b) => Format.pct(b.varde, b.kostnad).raw - Format.pct(a.varde, a.kostnad).raw).forEach((f) => {
      const row = el("div", "pf-row");
      const top = el("div", "pf-row-top");
      top.appendChild(el("span", "pf-ticker", f.name));
      top.appendChild(el("span", "pf-price", Format.amount(f.varde)));
      row.appendChild(top);
      const ch = Format.pct(f.varde, f.kostnad);
      const sub = el("div", "pf-row-sub");
      sub.appendChild(el("span", "pf-name", `Inköpsvärde ${Format.amount(f.kostnad)}`));
      sub.appendChild(el("span", `pf-change ${ch.pos ? "pos" : "neg"}`, (ch.pos ? "▲ " : "▼ ") + ch.text));
      row.appendChild(sub);
      const hist = (doc.fundHistory[f.id] || []).map((h) => h.varde);
      if (hist.length >= 2) row.appendChild(trustedHtml("div", "pf-row-sparkline", Charts.sparkline(hist, { color: ch.pos ? "var(--pf-gain)" : "var(--pf-loss)" })));
      list.appendChild(row);
    });
  }
  body.appendChild(list);
  body.appendChild(addFundForm(onAddFund));
  card.appendChild(body);
  return card;
}

function deviationColor(actual, target) {
  const diff = Math.abs(actual - target);
  if (diff <= 3) return "var(--pf-gain)";
  if (diff <= 8) return "var(--pf-warn)";
  return "var(--pf-loss)";
}

// Bar + legend are one clickable toggle (same collapsed-until-tapped
// idiom as the Brief/Log items and Valutor/Råvaror's own symbol
// editor) that reveals the "Mål aktier" target input below it -- Dario
// specifically wanted clicking the allocation bar itself to be how you
// get to the editable target, not a separately-visible input row.
// Sektor/Geografi moved here from the Aktier card (see buildAktierCard)
// -- same "portfolio breakdown, all in one place" card instead of
// splitting it across two cards -- and stay always visible, since
// they're read-only context, not something to hide behind a click.
export function buildAllokeringCard(doc, { expanded, onToggle, onSetTarget }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Allokering", null, false));
  const body = el("div", "pf-card-body");

  const { aktier: stockValueSEK, fonder: fundValue } = holdingsBreakdown(doc);
  const total = stockValueSEK + fundValue || 1;
  const actualAktier = (stockValueSEK / total) * 100;
  const actualFonder = (fundValue / total) * 100;
  const targetFonder = 100 - doc.targetAktier;

  const toggle = el("div", "pf-allokering-toggle");
  toggle.setAttribute("role", "button");
  toggle.setAttribute("tabindex", "0");
  toggle.setAttribute("aria-expanded", String(!!expanded));
  const activate = () => onToggle();
  toggle.addEventListener("click", activate);
  toggle.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });

  toggle.appendChild(trustedHtml("div", null, Charts.barOnly([
    { val: stockValueSEK, color: COLOR_AKTIER }, { val: fundValue, color: COLOR_FONDER },
  ])));
  const legend = el("div", "pf-bar-legend");
  const item1 = el("span", "pf-bar-legend-item");
  const dot1 = el("span", "pf-dot"); dot1.style.background = COLOR_AKTIER;
  item1.append(dot1, `Aktier `, el("b", null, actualAktier.toFixed(0) + "%"), ` · mål ${doc.targetAktier}% `);
  const dev1 = el("span", "pf-dot"); dev1.style.background = deviationColor(actualAktier, doc.targetAktier); dev1.title = "Avvikelse mot mål";
  item1.appendChild(dev1);
  const item2 = el("span", "pf-bar-legend-item");
  const dot2 = el("span", "pf-dot"); dot2.style.background = COLOR_FONDER;
  item2.append(dot2, `Fonder `, el("b", null, actualFonder.toFixed(0) + "%"), ` · mål ${targetFonder}% `);
  const dev2 = el("span", "pf-dot"); dev2.style.background = deviationColor(actualFonder, targetFonder); dev2.title = "Avvikelse mot mål";
  item2.appendChild(dev2);
  legend.append(item1, item2);
  toggle.appendChild(legend);
  body.appendChild(toggle);

  if (expanded) {
    const targetRow = el("div", "pf-target-row");
    targetRow.appendChild(el("label", null, "Mål aktier"));
    const input = document.createElement("input");
    input.type = "number"; input.min = "0"; input.max = "100"; input.value = doc.targetAktier; input.className = "pf-field pf-field-num";
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("change", () => onSetTarget(input.value));
    targetRow.appendChild(input);
    targetRow.appendChild(el("span", "pf-unit", "%"));
    targetRow.appendChild(el("label", null, "Fonder"));
    targetRow.appendChild(el("span", "pf-mono", targetFonder + "%"));
    body.appendChild(targetRow);
  }

  if (doc.stocks.length) {
    const overview = el("div", "pf-overview-row");
    overview.appendChild(distBlock("Sektor", sectorEntries(doc)));
    overview.appendChild(distBlock("Geografi", landEntries(doc)));
    body.appendChild(overview);
  }

  card.appendChild(body);
  return card;
}

export function cardHeader(title, onRefresh, showStamp = true) {
  const head = el("div", "pf-card-head");
  head.appendChild(el("h2", "pf-section-title", title));
  if (onRefresh) {
    const wrap = el("div", "pf-module-refresh");
    const stamp = showStamp ? el("span", "pf-module-stamp") : null;
    const btn = el("button", "pf-icon-btn", "↻");
    btn.title = "Uppdatera";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = "…";
      try {
        const result = await onRefresh();
        const time = new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
        if (stamp) stamp.textContent = result && result.fail ? `${time} (${result.fail} fel)` : time;
      } catch {
        if (stamp) stamp.textContent = "Fel";
      } finally {
        btn.disabled = false;
        btn.textContent = prevText;
      }
    });
    if (stamp) wrap.appendChild(stamp);
    wrap.appendChild(btn);
    head.appendChild(wrap);
  }
  return head;
}
