// Sarek packlist module — ported from a standalone local HTML app
// (Downloads/Sarek 2026/sarek-packlista-web/) that had its own bespoke
// slug/password sharing scheme (create_packlist/get_packlist RPCs). That
// scheme is dropped entirely here: auth is the shell's existing Supabase
// session (owner-only for now, see supabase/migrations/0005_*.sql), and
// persistence is one row in public.sarek_packlist holding
// { items, categories, settings } as a single JSONB document — the same
// shape the original app kept in memory, so nearly all of its
// calculation logic (totals, weight forecast, filtering/sorting) ports
// unchanged. Only the rendering layer is rewritten: the original built
// raw HTML strings with inline onclick="..." attributes, which is fine
// for data only the owner ever types in, but becomes a stored-XSS risk
// the moment this list is shared with other people (explicitly on the
// roadmap) — so every render here uses textContent/DOM methods, never
// innerHTML, for anything derived from user-entered text.

const DEFAULT_CATEGORIES = [
  { id: "ryggsack", name: "Ryggsäck", icon: "🎒", color: "#92c5ff" },
  { id: "ovrigt", name: "Övrigt", icon: "📦", color: "#a5d6ff" },
];

function uid() {
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function g(n) { return Math.round(Number(n) || 0).toLocaleString("sv-SE") + " g"; }
function kg(n) { return ((Number(n) || 0) / 1000).toFixed(2) + " kg"; }
function packedQty(i) { return Math.max(0, (Number(i.qty) || 0) - (i.worn ? 1 : 0)); }
function tot(i) { return (Number(i.weight) || 0) * packedQty(i); }

export default {
  id: "sarek-gear",
  navLabel: "Sarek",

  async mount(container, ctx) {
    const { supabase, el } = ctx;

    let rowId = null;
    let items = [];
    let categories = DEFAULT_CATEGORIES.slice();
    let settings = { days: 6, targetKg: 15, filter: "Alla", sort: "category", onlyShopping: false, query: "" };
    let tab = "pack";
    let saveTimer = null;
    let saveTag;

    function catById(id) {
      return categories.find((c) => c.id === id) || categories.find((c) => c.id === "ovrigt") || categories[0];
    }
    function totals() {
      let start = 0, cons = 0, missing = 0;
      for (const it of items) {
        const t = tot(it);
        start += t;
        if (it.consumable) cons += t;
        if (!it.owned) missing++;
      }
      return { start, base: start - cons, cons, missing };
    }
    function catsum() {
      const a = {};
      for (const it of items) a[it.category] = (a[it.category] || 0) + tot(it);
      return a;
    }
    function filtered() {
      let list = items.slice();
      const q = (settings.query || "").toLowerCase();
      if (settings.filter !== "Alla") list = list.filter((i) => i.category === settings.filter);
      if (settings.onlyShopping) list = list.filter((i) => !i.owned);
      if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || (i.note || "").toLowerCase().includes(q));
      list.sort((a, b) => {
        if (settings.sort === "weightDesc") return tot(b) - tot(a);
        if (settings.sort === "weightAsc") return tot(a) - tot(b);
        if (settings.sort === "name") return a.name.localeCompare(b.name, "sv");
        if (settings.sort === "shopping") return (a.owned ? 1 : 0) - (b.owned ? 1 : 0) || tot(b) - tot(a);
        return catById(a.category).name.localeCompare(catById(b.category).name, "sv") || tot(b) - tot(a);
      });
      return list;
    }
    function weightForecast() {
      const days = Math.max(1, Math.round(Number(settings.days) || 1));
      const t = totals();
      const pts = [];
      for (let d = 1; d <= days; d++) {
        const frac = days > 1 ? (d - 1) / (days - 1) : 1;
        pts.push({ day: d, weight: t.start - (t.start - t.base) * frac });
      }
      return pts;
    }

    // ---------- persistence ----------
    async function load() {
      const { data } = await supabase.from("sarek_packlist").select("id, data").limit(1).maybeSingle();
      if (data) {
        rowId = data.id;
        items = (data.data && data.data.items) || [];
        categories = (data.data && data.data.categories && data.data.categories.length) ? data.data.categories : DEFAULT_CATEGORIES.slice();
        settings = { ...settings, ...((data.data && data.data.settings) || {}) };
      }
    }
    function scheduleSave() {
      if (saveTag) saveTag.textContent = "Sparar…";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 700);
    }
    async function save() {
      if (!rowId) return;
      const { error } = await supabase
        .from("sarek_packlist")
        .update({ data: { items, categories, settings }, updated_at: new Date().toISOString() })
        .eq("id", rowId);
      if (saveTag) saveTag.textContent = error ? "Kunde inte spara" : "Sparat ✓";
    }

    // ---------- mutations ----------
    function updItem(id, key, val) {
      const it = items.find((i) => i.id === id);
      if (it) it[key] = val;
      scheduleSave();
    }
    function addItem() {
      items.push({ id: uid(), name: "Ny pryl", category: "ovrigt", weight: 0, qty: 1, owned: false, consumable: false, worn: false, note: "" });
      scheduleSave();
      renderTab();
    }
    function delItem(id) {
      if (!confirm("Ta bort prylen?")) return;
      items = items.filter((i) => i.id !== id);
      scheduleSave();
      renderTab();
    }
    function updCat(id, key, val) {
      const c = categories.find((c) => c.id === id);
      if (c) c[key] = val;
      scheduleSave();
    }
    function addCat() {
      categories.push({ id: uid(), name: "Ny kategori", icon: "📦", color: "#a5d6ff" });
      scheduleSave();
      renderTab();
    }
    function setSetting(key, val) {
      settings[key] = val;
      scheduleSave();
      renderTab();
    }

    // ---------- small DOM helpers ----------
    function input(type, value, onChange, opts = {}) {
      const i = document.createElement("input");
      i.type = type;
      if (type === "checkbox") i.checked = !!value; else i.value = value ?? "";
      if (opts.className) i.className = opts.className;
      if (opts.placeholder) i.placeholder = opts.placeholder;
      i.addEventListener("change", () => onChange(type === "checkbox" ? i.checked : type === "number" ? Number(i.value) : i.value));
      return i;
    }
    function select(options, value, onChange) {
      const s = document.createElement("select");
      for (const [v, label] of options) {
        const o = document.createElement("option");
        o.value = v; o.textContent = label; o.selected = v === value;
        s.appendChild(o);
      }
      s.addEventListener("change", () => onChange(s.value));
      return s;
    }
    function labeled(text, node) {
      const l = document.createElement("label");
      l.append(text + " ", node);
      return l;
    }

    // ---------- views ----------
    function controlsBar() {
      const bar = el("section", "sk-controls");
      bar.appendChild(input("text", settings.query, (v) => setSetting("query", v), { placeholder: "Sök pryl…" }));
      bar.appendChild(select([["Alla", "Alla"], ...categories.map((c) => [c.id, c.name])], settings.filter, (v) => setSetting("filter", v)));
      bar.appendChild(select([
        ["category", "Sortera: kategori"], ["weightDesc", "Tyngst först"], ["weightAsc", "Lättast först"],
        ["name", "Namn A–Ö"], ["shopping", "Inköp först"],
      ], settings.sort, (v) => setSetting("sort", v)));
      bar.appendChild(labeled("", input("checkbox", settings.onlyShopping, (v) => setSetting("onlyShopping", v))));
      bar.lastChild.prepend("Endast inköp ");
      bar.appendChild(labeled("Dagar", input("number", settings.days, (v) => setSetting("days", v), { className: "sk-num" })));
      bar.appendChild(labeled("Mål kg", input("number", settings.targetKg, (v) => setSetting("targetKg", v), { className: "sk-num" })));
      return bar;
    }

    function itemRow(it) {
      const c = catById(it.category);
      const tr = document.createElement("tr");
      const iconTd = document.createElement("td"); iconTd.className = "sk-icon"; iconTd.textContent = c.icon;
      const nameTd = document.createElement("td"); nameTd.className = "sk-rowname";
      nameTd.appendChild(input("text", it.name, (v) => updItem(it.id, "name", v)));
      const noteEl = document.createElement("small"); noteEl.textContent = it.note || ""; nameTd.appendChild(noteEl);
      const catTd = document.createElement("td");
      catTd.appendChild(select(categories.map((k) => [k.id, k.name]), it.category, (v) => { updItem(it.id, "category", v); renderTab(); }));
      const weightTd = document.createElement("td");
      weightTd.appendChild(input("number", it.weight, (v) => updItem(it.id, "weight", v), { className: "sk-num" }));
      const qtyTd = document.createElement("td");
      qtyTd.appendChild(input("number", it.qty, (v) => updItem(it.id, "qty", v), { className: "sk-num" }));
      const totTd = document.createElement("td"); const b = document.createElement("b"); b.textContent = g(tot(it)); totTd.appendChild(b);
      const ownedTd = document.createElement("td"); ownedTd.appendChild(input("checkbox", it.owned, (v) => { updItem(it.id, "owned", v); }));
      const consTd = document.createElement("td"); consTd.appendChild(input("checkbox", it.consumable, (v) => updItem(it.id, "consumable", v)));
      const wornTd = document.createElement("td"); wornTd.appendChild(input("checkbox", it.worn, (v) => { updItem(it.id, "worn", v); renderTab(); }));
      const delTd = document.createElement("td");
      const delBtn = document.createElement("button"); delBtn.className = "sk-ghost"; delBtn.textContent = "🗑️";
      delBtn.addEventListener("click", () => delItem(it.id));
      delTd.appendChild(delBtn);
      tr.append(iconTd, nameTd, catTd, weightTd, qtyTd, totTd, ownedTd, consTd, wornTd, delTd);
      return tr;
    }

    function summaryCard() {
      const t = totals();
      const pct = Math.min(100, (t.start / (settings.targetKg * 1000)) * 100);
      const card = el("section", "sk-card");
      card.appendChild(el("h2", null, "Sammanfattning"));
      const stats = el("div", "sk-twostats");
      const s1 = el("div"); s1.append("Total"); const b1 = el("b", null, kg(t.start)); s1.appendChild(b1);
      const s2 = el("div"); s2.append("Grundvikt"); const b2 = el("b", null, kg(t.base)); s2.appendChild(b2);
      stats.append(s1, s2);
      card.appendChild(stats);
      const bar = el("div", "sk-bar"); const barFill = el("span"); barFill.style.width = pct + "%"; bar.appendChild(barFill);
      card.appendChild(bar);
      card.appendChild(el("p", "sk-note", `Mål: ${settings.targetKg} kg · Kvar: ${kg(Math.max(0, settings.targetKg * 1000 - t.start))} · Inköp: ${t.missing}`));
      return card;
    }

    function forecastCard() {
      const pts = weightForecast();
      const card = el("section", "sk-card");
      card.appendChild(el("h2", null, "Viktprognos"));
      if (pts.length < 2) {
        card.appendChild(el("p", "sk-note", 'Lägg till fler dagar (fältet "Dagar" ovan) för att se hur vikten minskar under turen.'));
        return card;
      }
      const w = 320, h = 140, pad = 26;
      const vals = pts.map((p) => p.weight);
      let maxW = Math.max(...vals), minW = Math.min(...vals);
      if (maxW === minW) { maxW += 1; minW -= 1; }
      const stepX = (w - 2 * pad) / (pts.length - 1);
      const X = (i) => pad + i * stepX;
      const Y = (v) => h - pad - ((v - minW) / (maxW - minW)) * (h - 2 * pad);
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("class", "sk-forecast-chart");
      const axis = document.createElementNS(svgNS, "line");
      axis.setAttribute("x1", pad); axis.setAttribute("y1", h - pad); axis.setAttribute("x2", w - pad); axis.setAttribute("y2", h - pad);
      axis.setAttribute("stroke", "currentColor"); axis.setAttribute("stroke-width", "1"); axis.setAttribute("opacity", "0.3");
      svg.appendChild(axis);
      const line = document.createElementNS(svgNS, "polyline");
      line.setAttribute("points", pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.weight).toFixed(1)}`).join(" "));
      line.setAttribute("fill", "none"); line.setAttribute("stroke", "currentColor"); line.setAttribute("stroke-width", "2.5");
      svg.appendChild(line);
      pts.forEach((p, i) => {
        const dot = document.createElementNS(svgNS, "circle");
        dot.setAttribute("cx", X(i).toFixed(1)); dot.setAttribute("cy", Y(p.weight).toFixed(1)); dot.setAttribute("r", "3.2");
        dot.setAttribute("fill", "currentColor");
        svg.appendChild(dot);
      });
      card.appendChild(svg);
      card.appendChild(el("p", "sk-note", `Dag 1: ${kg(pts[0].weight)} → Dag ${pts.length}: ${kg(pts[pts.length - 1].weight)} · antar jämn förbrukning över dagarna.`));
      return card;
    }

    function catCard() {
      const cs = catsum();
      const card = el("section", "sk-card");
      card.appendChild(el("h2", null, "Vikt per kategori"));
      const entries = Object.entries(cs).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...entries.map(([, v]) => v));
      for (const [id, weight] of entries) {
        const c = catById(id);
        const row = el("div", "sk-cat");
        row.appendChild(el("span", null, `${c.icon} ${c.name}`));
        const track = el("div", "sk-track"); const bar = el("i"); bar.style.width = (weight / max) * 100 + "%"; bar.style.background = c.color;
        track.appendChild(bar);
        row.appendChild(track);
        row.appendChild(el("b", null, kg(weight)));
        card.appendChild(row);
      }
      return card;
    }

    function quickCard() {
      const card = el("section", "sk-card");
      card.appendChild(el("h2", null, "Snabbfilter"));
      const chips = el("div", "sk-chips");
      const allBtn = document.createElement("button"); allBtn.textContent = "🌐 Alla";
      allBtn.addEventListener("click", () => setSetting("filter", "Alla"));
      chips.appendChild(allBtn);
      for (const c of categories) {
        const btn = document.createElement("button"); btn.textContent = `${c.icon} ${c.name}`;
        btn.addEventListener("click", () => setSetting("filter", c.id));
        chips.appendChild(btn);
      }
      card.appendChild(chips);
      return card;
    }

    function packView() {
      const wrap = el("div");
      wrap.appendChild(controlsBar());
      const grid = el("div", "sk-grid");
      const wide = el("section", "sk-card sk-wide");
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      thead.innerHTML = ""; // structural only, no user data
      const headRow = document.createElement("tr");
      ["", "Artikel", "Kategori", "Vikt", "Antal", "Total", "Har", "Förbrukas", "Bär på mig", ""].forEach((h) => {
        const th = document.createElement("th"); th.textContent = h; headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      filtered().forEach((it) => tbody.appendChild(itemRow(it)));
      table.appendChild(tbody);
      wide.appendChild(table);
      const addBtn = document.createElement("button"); addBtn.className = "sk-add"; addBtn.textContent = "＋ Lägg till pryl";
      addBtn.addEventListener("click", addItem);
      wide.appendChild(addBtn);
      const footer = el("div", "sk-table-footer");
      footer.append("Total visad vikt ");
      footer.appendChild(el("b", null, g(filtered().reduce((s, i) => s + tot(i), 0))));
      wide.appendChild(footer);
      grid.appendChild(wide);
      const aside = el("aside", "sk-stack");
      aside.append(summaryCard(), forecastCard(), catCard(), quickCard());
      grid.appendChild(aside);
      wrap.appendChild(grid);
      return wrap;
    }

    function shopView() {
      const wrap = el("div");
      wrap.appendChild(controlsBar());
      const list = items.filter((i) => !i.owned);
      const card = el("section", "sk-card sk-wide");
      const h = el("h2", null, `Inköpslista `); const badge = el("span", "sk-badge", String(list.length)); h.appendChild(badge);
      card.appendChild(h);
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["Köpt", "Artikel", "Kategori", "Total vikt", "Notering"].forEach((t) => { const th = document.createElement("th"); th.textContent = t; headRow.appendChild(th); });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const it of list) {
        const c = catById(it.category);
        const tr = document.createElement("tr");
        const ownedTd = document.createElement("td");
        ownedTd.appendChild(input("checkbox", it.owned, (v) => { updItem(it.id, "owned", v); renderTab(); }));
        const nameTd = document.createElement("td"); nameTd.textContent = it.name;
        const catTd = document.createElement("td"); catTd.textContent = `${c.icon} ${c.name}`;
        const wTd = document.createElement("td"); wTd.textContent = g(tot(it));
        const noteTd = document.createElement("td"); noteTd.appendChild(input("text", it.note, (v) => updItem(it.id, "note", v)));
        tr.append(ownedTd, nameTd, catTd, wTd, noteTd);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      card.appendChild(table);
      wrap.appendChild(card);
      return wrap;
    }

    function settingsTabView() {
      const grid = el("div", "sk-grid");
      const left = el("section", "sk-card sk-wide");
      left.appendChild(el("h2", null, "Kategorier"));
      left.appendChild(el("p", "sk-note", "Byt namn, ikon eller färg på en kategori, eller lägg till en ny."));
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["", "Namn", "Färg"].forEach((t) => { const th = document.createElement("th"); th.textContent = t; headRow.appendChild(th); });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const c of categories) {
        const tr = document.createElement("tr");
        const iconTd = document.createElement("td");
        iconTd.appendChild(input("text", c.icon, (v) => updCat(c.id, "icon", v), { className: "sk-icon-input" }));
        const nameTd = document.createElement("td");
        nameTd.appendChild(input("text", c.name, (v) => { updCat(c.id, "name", v); renderTab(); }));
        const colorTd = document.createElement("td");
        colorTd.appendChild(input("color", c.color, (v) => { updCat(c.id, "color", v); renderTab(); }, { className: "sk-color-input" }));
        tr.append(iconTd, nameTd, colorTd);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      left.appendChild(table);
      const addBtn = document.createElement("button"); addBtn.className = "sk-add"; addBtn.textContent = "＋ Lägg till kategori";
      addBtn.addEventListener("click", addCat);
      left.appendChild(addBtn);
      grid.appendChild(left);
      return grid;
    }

    function printView() {
      const list = filtered(), t = totals();
      const page = el("section", "sk-print-page");
      page.appendChild(el("h1", null, "Sarek – Packlista"));
      page.appendChild(el("p", null, `Startvikt: ${kg(t.start)} · Grundvikt: ${kg(t.base)} · Dagar: ${settings.days}`));
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["✓", "Artikel", "Kategori", "Vikt", "Antal", "Total", "På mig", "Notering"].forEach((h) => { const th = document.createElement("th"); th.textContent = h; headRow.appendChild(th); });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const it of list) {
        const tr = document.createElement("tr");
        ["□", it.name, catById(it.category).name, g(it.weight), String(it.qty), g(tot(it)), it.worn ? "✓" : "", it.note || ""].forEach((v) => {
          const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      page.appendChild(table);
      return page;
    }

    // ---------- shell (nav + header) ----------
    function exportJson() {
      const blob = new Blob([JSON.stringify({ items, categories, settings }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sarek-packlista.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    function importJson(file) {
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          if (data.categories && data.categories.length) categories = data.categories;
          if (data.items) items = data.items;
          if (data.settings) settings = { ...settings, ...data.settings };
          scheduleSave();
          renderTab();
        } catch (e) {
          alert("Kunde inte läsa JSON: " + e.message);
        }
      };
      r.readAsText(file);
    }

    const root = el("div", "sk-app");
    container.appendChild(root);

    function renderTab() {
      root.innerHTML = "";

      const side = el("aside", "sk-side");
      const brand = el("div", "sk-brand"); brand.append("⛰️ Sarek"); side.appendChild(brand);
      const navDiv = el("div");
      [["pack", "Packlista"], ["shop", "Inköp"], ["print", "A4 utskrift"], ["settings", "Inställningar"]].forEach(([t, label]) => {
        const btn = document.createElement("button");
        btn.className = "sk-nav" + (tab === t ? " active" : "");
        btn.textContent = label;
        btn.addEventListener("click", () => { tab = t; renderTab(); });
        navDiv.appendChild(btn);
      });
      side.appendChild(navDiv);

      const bottom = el("div", "sk-side-bottom");
      const printBtn = document.createElement("button"); printBtn.textContent = "🖨️ Skriv ut"; printBtn.addEventListener("click", () => window.print());
      const exportBtn = document.createElement("button"); exportBtn.textContent = "⬇️ Exportera JSON"; exportBtn.addEventListener("click", exportJson);
      const importLabel = document.createElement("label"); importLabel.className = "sk-import"; importLabel.textContent = "⬆️ Importera JSON";
      const importInput = document.createElement("input"); importInput.type = "file"; importInput.accept = "application/json";
      importInput.addEventListener("change", () => { if (importInput.files[0]) importJson(importInput.files[0]); });
      importLabel.appendChild(importInput);
      saveTag = el("div", "sk-save-tag");
      bottom.append(printBtn, exportBtn, importLabel, saveTag);
      side.appendChild(bottom);

      const main = el("main");
      const t = totals();
      const header = el("header", "sk-top");
      const titleWrap = el("div");
      titleWrap.appendChild(el("small", null, "Packlista & viktdashboard"));
      titleWrap.appendChild(el("h1", null, tab === "shop" ? "Inköp" : tab === "print" ? "A4 utskrift" : tab === "settings" ? "Inställningar" : "All utrustning"));
      header.appendChild(titleWrap);
      const stats = el("div", "sk-stats-top");
      [["Startvikt", kg(t.start)], ["Grundvikt", kg(t.base)], ["Inköp", String(t.missing)]].forEach(([label, val]) => {
        const stat = el("div", "sk-stat"); stat.appendChild(el("span", null, label)); stat.appendChild(el("b", null, val));
        stats.appendChild(stat);
      });
      header.appendChild(stats);
      main.appendChild(header);

      main.appendChild(
        tab === "shop" ? shopView() : tab === "print" ? printView() : tab === "settings" ? settingsTabView() : packView()
      );

      root.append(side, main);
    }

    await load();
    if (!rowId) {
      root.appendChild(el("div", "empty-state", "Kunde inte hämta packlistan. Kör migrationen supabase/migrations/0005_sarek_packlist.sql om du inte redan gjort det."));
      return;
    }
    renderTab();
  },
};
