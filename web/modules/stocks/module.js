// Simple stocks watchlist -- ticker, optional note, optional target
// price. No live price fetching, no currency/allocation/history -- that
// richer feature set already exists in the standalone FortPolio app, and
// this module is deliberately a small first step, not an attempt to port
// it. Kept fully self-contained (this file, its module.css, and the
// pre-provisioned stocks_watchlist table from 0001_init.sql -- nothing
// else touches or reads it) specifically so replacing it wholesale with
// a real FortPolio port later is a one-folder-delete + one manifest.js
// line + one `drop table`, no untangling required.

export default {
  id: "stocks",
  navLabel: "Aktier",

  async mount(container, ctx) {
    const { supabase, el } = ctx;

    const wrap = el("div", "wrap");
    container.appendChild(wrap);

    const form = document.createElement("form");
    form.className = "stocks-form";

    const tickerInput = document.createElement("input");
    tickerInput.type = "text";
    tickerInput.placeholder = "Ticker (t.ex. AAPL)";
    tickerInput.required = true;
    tickerInput.className = "stocks-input";

    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.placeholder = "Anteckning (valfri)";
    noteInput.className = "stocks-input";

    const targetInput = document.createElement("input");
    targetInput.type = "number";
    targetInput.step = "0.01";
    targetInput.placeholder = "Målkurs (valfri)";
    targetInput.className = "stocks-input stocks-input-num";

    const addBtn = document.createElement("button");
    addBtn.type = "submit";
    addBtn.className = "btn";
    addBtn.textContent = "Lägg till";

    form.append(tickerInput, noteInput, targetInput, addBtn);
    wrap.appendChild(form);

    const listEl = document.createElement("div");
    wrap.appendChild(listEl);

    async function load() {
      listEl.innerHTML = "";
      const { data, error } = await supabase
        .from("stocks_watchlist")
        .select("id, ticker, note, target_price, added_at")
        .order("added_at", { ascending: false });

      if (error) {
        listEl.appendChild(el("div", "empty-state", `Kunde inte hämta bevakningslistan: ${error.message}`));
        return;
      }
      if (!data.length) {
        listEl.appendChild(el("div", "empty-state", "Inga aktier bevakas än."));
        return;
      }

      const table = document.createElement("table");
      table.className = "stocks-table";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["Ticker", "Anteckning", "Målkurs", "Tillagd", ""].forEach((h) => {
        const th = document.createElement("th");
        th.textContent = h;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const row of data) {
        const tr = document.createElement("tr");
        [
          row.ticker,
          row.note || "—",
          row.target_price != null ? row.target_price : "—",
          new Date(row.added_at).toLocaleDateString("sv-SE"),
        ].forEach((value) => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        });

        const delTd = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.className = "remove-link";
        delBtn.textContent = "Ta bort";
        delBtn.addEventListener("click", async () => {
          if (!confirm(`Ta bort ${row.ticker} från bevakningslistan?`)) return;
          const { error: delError } = await supabase.from("stocks_watchlist").delete().eq("id", row.id);
          if (delError) { alert(`Kunde inte ta bort: ${delError.message}`); return; }
          await load();
        });
        delTd.appendChild(delBtn);
        tr.appendChild(delTd);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      listEl.appendChild(table);
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ticker = tickerInput.value.trim().toUpperCase();
      if (!ticker) return;

      addBtn.disabled = true;
      const { error } = await supabase.from("stocks_watchlist").insert({
        ticker,
        note: noteInput.value.trim() || null,
        target_price: targetInput.value ? Number(targetInput.value) : null,
      });
      addBtn.disabled = false;

      if (error) { alert(`Kunde inte lägga till: ${error.message}`); return; }
      tickerInput.value = "";
      noteInput.value = "";
      targetInput.value = "";
      await load();
    });

    await load();
  },
};
