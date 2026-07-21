// Access log — shows who's hit the gate: page views, sign-in attempts,
// successes, and failures, each with IP + best-effort ISP name and method
// (tap vs swipe). Read-only here; rows are written by
// shell/access-log.js from the gate, before there's a session (see
// supabase/migrations/0009_access_log.sql) — anyone can insert, only the
// owner can read, which is the entire point: seeing attempts from people
// who never got in.

const EVENT_LABEL = {
  gate_view: "Visited",
  signin_attempt: "Attempt",
  signin_success: "Signed in",
  signin_failure: "Failed",
};

function fmtTime(iso) {
  return new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "medium" });
}

export default {
  id: "access-log",
  navLabel: "Log",

  async mount(container, ctx) {
    const { supabase, el, lookupIp } = ctx;

    const toolbar = el("div", "log-toolbar");
    const allBtn = el("button", "active", "All");
    const failBtn = el("button", "", "Failed sign-ins only");
    toolbar.append(allBtn, failBtn);

    const listRoot = el("div");
    container.append(toolbar, listRoot);

    let rows = [];
    let filter = "all";

    function setFilter(f) {
      filter = f;
      allBtn.classList.toggle("active", f === "all");
      failBtn.classList.toggle("active", f === "failed");
      render();
    }
    allBtn.addEventListener("click", () => setFilter("all"));
    failBtn.addEventListener("click", () => setFilter("failed"));

    function render() {
      listRoot.innerHTML = "";
      const visible = filter === "failed" ? rows.filter((r) => r.event === "signin_failure") : rows;
      if (!visible.length) {
        listRoot.appendChild(el("div", "empty-state", "No log entries yet."));
        return;
      }

      const wrap = el("div", "wrap");
      const table = document.createElement("table");
      table.className = "log-table";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["When", "Event", "Method", "IP", "Network", "Detail", "Lookup"].forEach((h) => {
        const th = document.createElement("th");
        th.textContent = h;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const row of visible) {
        const tr = document.createElement("tr");
        tr.className = `log-row log-${row.event}`;
        const ips = [row.ip_v4, row.ip_v6].filter(Boolean).join(" · ") || "—";
        [
          fmtTime(row.created_at),
          EVENT_LABEL[row.event] || row.event,
          row.method || "—",
          ips,
          row.org || "—",
          row.detail || "",
        ].forEach((value) => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        });

        const lookupTd = document.createElement("td");
        const lookupTarget = row.ip_v4 || row.ip_v6;
        if (lookupTarget) {
          const lookupBtn = document.createElement("button");
          lookupBtn.className = "lookup-btn";
          lookupBtn.textContent = "Lookup";
          lookupBtn.addEventListener("click", async () => {
            lookupBtn.disabled = true;
            lookupBtn.textContent = "Looking up…";
            const result = await lookupIp(lookupTarget);
            const parts = [
              result.hostname,
              result.org || result.asn,
              [result.city, result.country].filter(Boolean).join(", ") || null,
            ].filter(Boolean);
            lookupTd.textContent = parts.length ? parts.join(" · ") : "No data found.";
          });
          lookupTd.appendChild(lookupBtn);
        } else {
          lookupTd.textContent = "—";
        }
        tr.appendChild(lookupTd);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      listRoot.appendChild(wrap);
    }

    async function load() {
      listRoot.innerHTML = "";
      listRoot.appendChild(el("div", "empty-state", "Loading…"));

      const { data, error } = await supabase
        .from("access_log")
        .select("created_at, event, method, ip_v4, ip_v6, org, user_agent, detail")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        listRoot.innerHTML = "";
        listRoot.appendChild(el(
          "div", "empty-state",
          `Couldn't load the log: ${error.message}. Run supabase/migrations/0009_access_log.sql if you haven't yet.`
        ));
        return;
      }
      rows = data || [];
      render();
    }

    await load();
  },
};
