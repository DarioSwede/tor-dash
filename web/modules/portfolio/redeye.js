// Redeye news calendar -- ported from FortPolio's js/core/redeye.js.
// No backend can pull email automatically from a static site, so like
// Dagens tips this is paste-based, shown as a calendar for a better
// sense of when things came in rather than a flat list.

import { el } from "./dom.js";

const MONTH_NAMES = ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"];
const WEEKDAY_LABELS = ["M", "T", "O", "T", "F", "L", "S"];

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function hasUnread(doc) {
  const lastViewed = doc.redeyeLastViewed;
  return (doc.redeyeNews || []).some((e) => !lastViewed || (e.addedAt && e.addedAt > lastViewed));
}

function entriesFor(doc, dateStr) {
  return (doc.redeyeNews || []).filter((e) => e.date === dateStr).sort((a, b) => (a.addedAt || "").localeCompare(b.addedAt || ""));
}

export function buildRedeyeCalendar(doc, viewYear, viewMonth, selectedDate, { onSelectDay }) {
  const wrap = el("div", "pf-cal");
  const y = viewYear, m = viewMonth;
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstWeekday = (first.getDay() + 6) % 7; // Monday-first
  const today = todayStr();
  const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;

  const countByDay = {};
  (doc.redeyeNews || []).forEach((e) => {
    if (e.date && e.date.slice(0, 7) === monthPrefix) countByDay[e.date] = (countByDay[e.date] || 0) + 1;
  });

  const header = el("div", "pf-cal-header");
  const prevBtn = el("button", "pf-icon-btn", "‹");
  const title = el("span", "pf-cal-title", `${MONTH_NAMES[m]} ${y}`);
  const nextBtn = el("button", "pf-icon-btn", "›");
  header.append(prevBtn, title, nextBtn);
  wrap.appendChild(header);

  const weekdays = el("div", "pf-cal-grid pf-cal-weekdays");
  WEEKDAY_LABELS.forEach((w) => weekdays.appendChild(el("div", "pf-cal-weekday", w)));
  wrap.appendChild(weekdays);

  const grid = el("div", "pf-cal-grid");
  for (let i = 0; i < firstWeekday; i++) grid.appendChild(el("div", "pf-cal-cell empty"));
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthPrefix}-${String(d).padStart(2, "0")}`;
    const count = countByDay[dateStr] || 0;
    const cls = ["pf-cal-cell"];
    if (dateStr === today) cls.push("today");
    if (dateStr === selectedDate) cls.push("selected");
    if (count) cls.push("has-entries");
    const cell = el("div", cls.join(" "));
    cell.appendChild(el("span", "pf-cal-day-num", String(d)));
    if (count) cell.appendChild(el("span", "pf-cal-dot"));
    cell.addEventListener("click", () => onSelectDay(dateStr));
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);

  return { el: wrap, prevBtn, nextBtn };
}

export function buildRedeyeEntries(doc, selectedDate, { onRemove, onAdd }) {
  const wrap = el("div");
  const entries = selectedDate ? entriesFor(doc, selectedDate) : [];
  const dateLabel = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })
    : "";

  const h = el("h3", "pf-cal-date-label", dateLabel);
  wrap.appendChild(h);

  if (!entries.length) {
    wrap.appendChild(el("div", "pf-empty-note", "Inga sparade nyheter den här dagen."));
  } else {
    entries.forEach((e) => {
      const entry = el("div", "pf-redeye-entry");
      entry.appendChild(el("div", "pf-redeye-entry-title", e.title || "(utan rubrik)"));
      if (e.content) {
        const content = el("div", "pf-redeye-entry-content");
        e.content.split("\n").forEach((line, i) => {
          if (i > 0) content.appendChild(document.createElement("br"));
          content.appendChild(document.createTextNode(line));
        });
        entry.appendChild(content);
      }
      const removeBtn = el("button", "pf-btn-small", "Ta bort");
      removeBtn.addEventListener("click", () => onRemove(e.id));
      entry.appendChild(removeBtn);
      wrap.appendChild(entry);
    });
  }

  const box = el("div", "pf-text-box");
  box.appendChild(el("h3", null, "Lägg till nyhet"));
  box.appendChild(el("p", null, "Klistra in texten från mejlet (eller skriv en egen anteckning)."));
  const row = el("div", "pf-row-inputs");
  const dateInput = document.createElement("input");
  dateInput.className = "pf-field"; dateInput.type = "date"; dateInput.value = selectedDate || todayStr();
  const titleInput = document.createElement("input");
  titleInput.className = "pf-field"; titleInput.placeholder = "Rubrik";
  row.append(dateInput, titleInput);
  box.appendChild(row);
  const contentInput = document.createElement("textarea");
  contentInput.className = "pf-field"; contentInput.placeholder = "Klistra in text från Redeye här...";
  box.appendChild(contentInput);
  const actions = el("div", "pf-actions-row");
  const addBtn = el("button", "pf-btn pf-btn-gold", "Lägg till");
  addBtn.addEventListener("click", () => onAdd(dateInput.value, titleInput.value.trim(), contentInput.value.trim()));
  actions.appendChild(addBtn);
  box.appendChild(actions);
  wrap.appendChild(box);

  return wrap;
}
