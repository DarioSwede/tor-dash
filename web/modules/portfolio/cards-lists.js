// Bevakningslista (watchlist), Utdelningar (dividends), Dagens tips --
// ported from FortPolio's js/modules/{bevakning,utdelning,veckanstips}.js.

import { el, trustedHtml } from "./dom.js";
import * as Format from "./format.js";
import * as Charts from "./charts.js";
import { cardHeader } from "./cards-holdings.js";

export function buildBevakningCard(doc, { addOpen, onToggleAdd, onAdd, onRemove, onSetAlert, onRefresh, triggeredIds }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Bevakningslista", onRefresh));
  const body = el("div", "pf-card-body");

  const list = el("div", "pf-grid-list");
  if (!doc.watchlist.length) {
    list.appendChild(el("div", "pf-empty-note", "Inga bevakade aktier än."));
  } else {
    doc.watchlist.forEach((w, i) => {
      const row = el("div", "pf-row");
      const top = el("div", "pf-row-top");
      const triggered = triggeredIds && triggeredIds.has("w" + i);
      top.appendChild(el("span", "pf-ticker", (triggered ? "🔔 " : "") + w.name));
      top.appendChild(el("span", "pf-price", w.price != null ? Format.price(w.price, w.curr) : "—"));
      row.appendChild(top);

      const sub = el("div", "pf-row-sub");
      const nameLine = el("div", "pf-name-line");
      nameLine.appendChild(el("span", "pf-badge", w.symbol));
      sub.appendChild(nameLine);
      const ch = w.price != null && w.prevClose ? Format.pct(w.price, w.prevClose) : null;
      if (ch) sub.appendChild(el("span", `pf-change ${ch.flat ? "flat" : ch.pos ? "pos" : "neg"}`, (ch.flat ? "" : ch.pos ? "▲ " : "▼ ") + ch.text));
      else sub.appendChild(el("span", "pf-name", "Ej hämtat"));
      row.appendChild(sub);

      if (w.sparkline) {
        const down = w.price != null && w.prevClose != null && w.price < w.prevClose;
        row.appendChild(trustedHtml("div", "pf-row-sparkline", Charts.sparkline(w.sparkline, { color: down ? "var(--pf-loss)" : "var(--pf-gain)" })));
      }

      const alert = doc.priceAlerts["w" + i] || {};
      const meta = el("div", "pf-meta");
      meta.appendChild(el("span", null, "Alarm över:"));
      const above = document.createElement("input");
      above.className = "pf-field"; above.type = "text"; above.placeholder = "pris";
      above.value = alert.above != null ? alert.above : "";
      above.addEventListener("change", () => onSetAlert(i, "above", above.value));
      meta.appendChild(above);
      meta.appendChild(el("span", null, "under:"));
      const below = document.createElement("input");
      below.className = "pf-field"; below.type = "text"; below.placeholder = "pris";
      below.value = alert.below != null ? alert.below : "";
      below.addEventListener("change", () => onSetAlert(i, "below", below.value));
      meta.appendChild(below);
      row.appendChild(meta);

      const actions = el("div", "pf-actions-row");
      const removeBtn = el("button", "pf-btn-small", "Ta bort");
      removeBtn.addEventListener("click", () => onRemove(i));
      actions.appendChild(removeBtn);
      row.appendChild(actions);

      list.appendChild(row);
    });
  }
  body.appendChild(list);

  const box = el("div", "pf-text-box");
  const boxHead = el("div", "pf-box-head");
  boxHead.appendChild(el("h3", null, "Lägg till bevakning"));
  const toggleBtn = el("button", "pf-icon-btn", addOpen ? "✕" : "⚙");
  toggleBtn.title = addOpen ? "Dölj" : "Lägg till bevakning";
  toggleBtn.addEventListener("click", onToggleAdd);
  boxHead.appendChild(toggleBtn);
  box.appendChild(boxHead);

  if (addOpen) {
    const inputs = el("div", "pf-row-inputs");
    const nameInput = document.createElement("input");
    nameInput.className = "pf-field"; nameInput.placeholder = "Namn, t.ex. NuScale Power";
    const symInput = document.createElement("input");
    symInput.className = "pf-field"; symInput.placeholder = "Symbol, t.ex. SMR";
    inputs.append(nameInput, symInput);
    box.appendChild(inputs);
    const actions = el("div", "pf-actions-row");
    const addBtn = el("button", "pf-btn pf-btn-gold", "Lägg till");
    addBtn.addEventListener("click", () => onAdd(nameInput.value.trim(), symInput.value.trim()));
    actions.appendChild(addBtn);
    box.appendChild(actions);
  }
  body.appendChild(box);

  card.appendChild(body);
  return card;
}

export function buildUtdelningCard(doc, dividendData, { fetching, onFetchAll }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Utdelningar", null, false));
  const body = el("div", "pf-card-body");

  const btn = el("button", "pf-btn pf-btn-gold", fetching ? "Hämtar …" : "Hämta utdelningsdata");
  btn.disabled = fetching;
  btn.addEventListener("click", onFetchAll);
  body.appendChild(btn);
  body.appendChild(el("p", "pf-note", "Historik är pålitlig data från samma källa som kurserna. Kommande ex-dag/direktavkastning är bästa försök och kan saknas för vissa bolag."));

  const list = el("div", "pf-grid-list");
  const withSymbols = doc.stocks.filter((s) => s.symbol);
  if (!withSymbols.length) {
    list.appendChild(el("div", "pf-empty-note", "Inga aktier med symbol att slå upp."));
  } else {
    withSymbols.forEach((s) => {
      const d = dividendData[s.symbol];
      const row = el("div", "pf-row");
      if (!d) {
        row.appendChild(el("div", "pf-row-top", null));
        row.lastChild.appendChild(el("span", "pf-ticker", s.name));
        row.appendChild(el("span", "pf-name", "Ej hämtat än"));
        list.appendChild(row);
        return;
      }
      const last = d.history && d.history[0];
      if (!last && !d.calendar) {
        const top = el("div", "pf-row-top"); top.appendChild(el("span", "pf-ticker", s.name)); row.appendChild(top);
        const warn = el("span", "pf-name", "Ingen utdelningsdata hittad"); warn.style.color = "var(--pf-loss)";
        row.appendChild(warn);
        list.appendChild(row);
        return;
      }
      const top = el("div", "pf-row-top");
      top.appendChild(el("span", "pf-ticker", s.name));
      top.appendChild(el("span", "pf-price", last ? String(last.amount) : "—"));
      row.appendChild(top);
      const sub = el("div", "pf-row-sub");
      sub.appendChild(el("span", "pf-name", `Senast: ${last ? new Date(last.date * 1000).toLocaleDateString("sv-SE") : "—"}`));
      if (d.calendar?.yieldPct) sub.appendChild(el("span", "pf-name", `Direktavkastning: ${d.calendar.yieldPct}`));
      row.appendChild(sub);
      if (d.calendar?.exDiv) {
        const exDiv = el("div", "pf-row-sub");
        exDiv.appendChild(el("span", "pf-name", `Nästa ex-dag: ${d.calendar.exDiv}`));
        row.appendChild(exDiv);
      }
      list.appendChild(row);
    });
  }
  body.appendChild(list);

  card.appendChild(body);
  return card;
}

export function buildVeckansTipsCard(doc, { onSave }) {
  const card = el("div", "pf-card");
  card.appendChild(cardHeader("Dagens tips", null, false));
  const body = el("div", "pf-card-body");

  const saved = doc.veckansTips || [];
  if (!saved.length) {
    body.appendChild(el("div", "pf-empty-note", "Inga tips inlagda idag — klistra in nedan."));
  } else {
    const list = el("div", "pf-grid-list");
    saved.forEach((tip) => {
      const row = el("div", "pf-row");
      const top = el("div", "pf-row-top"); top.appendChild(el("span", "pf-ticker", tip.bolag));
      row.appendChild(top);
      row.appendChild(el("div", "pf-name", tip.kommentar || ""));
      row.appendChild(el("div", "pf-meta-text", tip.datum || ""));
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  const box = el("div", "pf-text-box");
  box.appendChild(el("h3", null, "Klistra in dagens tips"));
  const p = el("p", null, null);
  p.innerHTML = 'Kopiera texten från Signallistan (eller annan källa) hit, en rad per bolag: <code>Bolag - kommentar</code>. Ersätter gårdagens tips.';
  box.appendChild(p);
  const textarea = document.createElement("textarea");
  textarea.className = "pf-field"; textarea.placeholder = "t.ex. Atlas Copco A - stark orderingång enligt Di";
  box.appendChild(textarea);
  const actions = el("div", "pf-actions-row");
  const saveBtn = el("button", "pf-btn pf-btn-gold", "Spara tips");
  saveBtn.addEventListener("click", () => onSave(textarea.value));
  actions.appendChild(saveBtn);
  box.appendChild(actions);
  body.appendChild(box);

  card.appendChild(body);
  return card;
}
