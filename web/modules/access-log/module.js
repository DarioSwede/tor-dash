// Access log — shows who's hit the gate: page views, sign-in attempts,
// successes, and failures, each with IP + best-effort ISP name and method
// (tap vs swipe). Read-only here; rows are written by
// shell/access-log.js from the gate, before there's a session (see
// supabase/migrations/0009_access_log.sql) — anyone can insert, only the
// owner can read, which is the entire point: seeing attempts from people
// who never got in.
//
// Two views of the same categorized rows: a table for wider screens
// (dense, good for scanning many rows at once) and a card list for
// narrow ones, built from the same .item/.item-title/.item-detail shell
// primitives the Morning Brief module uses -- collapsed title, tap to
// reveal detail -- so the log reads like the rest of the dashboard
// instead of a cramped table forced into a phone-width column. Both are
// always in the DOM; a CSS media query (module.css) shows one and hides
// the other, so there's one row-building pass, not two.
//
// getBadgeCount() backs the nav dot (see shell/module-registry.js):
// counts rows newer than this device's last-seen marker. load() bumps
// that marker to "now" on every successful fetch -- opening the tab is
// what clears its own dot, same as the Brief marks itself seen on render.

import { getLastSeenLog, setLastSeenLog } from "../../shell/last-seen.js";

const EVENT_LABEL = {
  gate_view: "Besök",
  signin_attempt: "Inloggningsförsök",
  signin_success: "Inloggad",
  signin_failure: "Misslyckad inloggning",
};

// Category rules, applied per row using stats about every other row from
// the same IP (see categorize() below):
//   ok     - this row is a successful sign-in.
//   danger - this row is a failed sign-in AND this IP has failed more
//            than once (a repeated, not one-off, failure -- the actual
//            warning signal).
//   warn   - this row is a view/attempt AND this IP has visited more
//            than once AND has never once signed in successfully
//            (recurring, unauthenticated interest).
//   null   - anything else (a lone view, a lone attempt, or a single
//            failure with no repeat history) -- not enough of a pattern
//            yet to color it.
function categorize(rows) {
  const byIp = new Map();
  for (const row of rows) {
    const key = row.ip_v4 || row.ip_v6 || "unknown";
    if (!byIp.has(key)) byIp.set(key, []);
    byIp.get(key).push(row);
  }

  return rows.map((row) => {
    const key = row.ip_v4 || row.ip_v6 || "unknown";
    const group = byIp.get(key);
    const hasSuccess = group.some((r) => r.event === "signin_success");
    const failureCount = group.filter((r) => r.event === "signin_failure").length;

    let category = null;
    if (row.event === "signin_success") {
      category = "ok";
    } else if (row.event === "signin_failure" && failureCount > 1) {
      category = "danger";
    } else if ((row.event === "gate_view" || row.event === "signin_attempt") && !hasSuccess && group.length > 1) {
      category = "warn";
    }
    return { ...row, category };
  });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "medium" });
}

function fmtTimeShort(iso) {
  return new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

// Card titles are one line by design (see the ellipsis rule on
// .item-title-text) -- the "YYYY-MM-DD " half of fmtTimeShort is most of
// what pushed a title past that width, and it's dead weight for the
// overwhelming majority of rows anyway (freshly logged, i.e. today).
// Only a row old enough to be from a different calendar day pays for a
// full date in its title.
function fmtTimeCompact(iso) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  return isToday ? d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) : fmtTimeShort(iso);
}

function fmtTimeOfDay(iso) {
  return new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

// Collapses consecutive rows (rows already sorted newest-first) that
// share both IP and event into one group -- a burst of plain "Besök"
// gate_view pings from the same visitor is the common case, but any
// repeat of the same event from the same IP merges the same way.
// "Consecutive" on purpose, not "same IP anywhere in the list": a
// success sitting between two view/attempt rows from that IP is a real
// change in what happened and shouldn't be swallowed into one summary
// line. category is identical for every row in a group by construction
// (categorize() derives it from event + that IP's aggregate stats, both
// fixed within a group), so there's nothing to reconcile there.
function groupConsecutive(rows) {
  const groups = [];
  for (const row of rows) {
    const key = row.ip_v4 || row.ip_v6 || "unknown";
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.event === row.event) {
      last.instances.push(row);
    } else {
      groups.push({
        key, event: row.event, category: row.category,
        ip_v4: row.ip_v4, ip_v6: row.ip_v6, org: row.org,
        instances: [row],
      });
    }
  }
  return groups;
}

async function runLookup(lookupIp, ip, resultEl, triggerBtn) {
  triggerBtn.disabled = true;
  triggerBtn.textContent = "Slår upp…";
  const result = await lookupIp(ip);
  const parts = [
    result.hostname,
    result.org || result.asn,
    [result.city, result.country].filter(Boolean).join(", ") || null,
  ].filter(Boolean);
  resultEl.textContent = parts.length ? parts.join(" · ") : "Ingen data hittades.";
  triggerBtn.remove();
}

export default {
  id: "access-log",
  navLabel: "Log",

  async mount(container, ctx) {
    const { supabase, el, lookupIp } = ctx;

    // Same card shell as the Morning Brief (.band.band-top > .wrap) --
    // without it, this module sat directly on the raw fixed background
    // image with none of the frosted-card contrast handling (blur, the
    // darker has-custom-bg text override, the rounded floating card),
    // which is exactly why it read as washed-out/illegible next to Brief.
    const card = el("div", "band band-top");
    const wrap = el("div", "wrap");

    const toolbar = el("div", "log-toolbar");
    const allBtn = el("button", "active", "Alla");
    const failBtn = el("button", "", "Bara misslyckade inloggningar");
    toolbar.append(allBtn, failBtn);
    wrap.appendChild(toolbar);

    const listRoot = el("div");
    wrap.appendChild(listRoot);
    card.appendChild(wrap);
    container.appendChild(card);

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

    function renderTable(groups) {
      const wrap = el("div", "log-table-wrap");
      const table = document.createElement("table");
      table.className = "log-table";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["När", "Händelse", "Metod", "IP", "Nätverk", "Detalj", "Slå upp"].forEach((h) => {
        const th = document.createElement("th");
        th.textContent = h;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const group of groups) {
        const [latest] = group.instances;
        const count = group.instances.length;
        const tr = document.createElement("tr");
        tr.className = `log-row log-${group.event}${group.category ? ` log-cat-${group.category}` : ""}`;
        const ips = [group.ip_v4, group.ip_v6].filter(Boolean).join(" · ") || "—";
        const eventLabel = EVENT_LABEL[group.event] || group.event;

        // Merged detail column: every instance's time, plus its own
        // detail text next to it only when that instance actually has
        // one (mirrors what the single-row case showed, just repeated
        // per instance instead of collapsing distinct details away).
        const detailText = count === 1
          ? (latest.detail || "")
          : group.instances.map((r) => {
              const t = fmtTimeOfDay(r.created_at);
              return r.detail ? `${t} (${r.detail})` : t;
            }).reverse().join(", ");

        [
          fmtTime(latest.created_at),
          count > 1 ? `${eventLabel} ×${count}` : eventLabel,
          count === 1 ? (latest.method || "—") : "—",
          ips,
          group.org || "—",
          detailText,
        ].forEach((value) => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        });

        const lookupTd = document.createElement("td");
        const lookupTarget = group.ip_v4 || group.ip_v6;
        if (lookupTarget) {
          const lookupBtn = document.createElement("button");
          lookupBtn.className = "lookup-btn";
          lookupBtn.textContent = "Slå upp";
          lookupBtn.addEventListener("click", () => runLookup(lookupIp, lookupTarget, lookupTd, lookupBtn));
          lookupTd.appendChild(lookupBtn);
        } else {
          lookupTd.textContent = "—";
        }
        tr.appendChild(lookupTd);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }

    // Mobile card list: reuses the shell's .item/.item-title/.item-detail
    // primitives (same collapsed-title-until-tapped behavior as the
    // Morning Brief's items) instead of a second bespoke component, so
    // "same style as Brief" is literally the same CSS, not a lookalike.
    function renderCards(groups) {
      const wrap = el("div", "log-cards");
      groups.forEach((group, i) => {
        const [latest] = group.instances;
        const count = group.instances.length;
        const item = el("div", `item log-item${group.category ? ` log-cat-${group.category}` : ""}`);
        item.appendChild(el("div", "item-num", String(i + 1)));

        const body = el("div", "item-body");

        const title = document.createElement("div");
        title.className = "item-title";
        title.setAttribute("role", "button");
        title.setAttribute("tabindex", "0");
        title.setAttribute("aria-expanded", "false");
        title.appendChild(el("span", "status-dot", ""));
        const eventLabel = EVENT_LABEL[group.event] || group.event;
        title.appendChild(el(
          "span", "item-title-text",
          count > 1
            ? `${eventLabel} ×${count} · senast ${fmtTimeCompact(latest.created_at)}`
            : `${eventLabel} · ${fmtTimeCompact(latest.created_at)}`
        ));

        function toggle() {
          const expanded = item.classList.toggle("expanded");
          title.setAttribute("aria-expanded", String(expanded));
        }
        title.addEventListener("click", toggle);
        title.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        });
        body.appendChild(title);

        const detail = el("div", "item-detail");
        const inner = el("div", "item-detail-inner");
        const ips = [group.ip_v4, group.ip_v6].filter(Boolean).join(" · ") || "—";
        const lines = [
          `IP: ${ips}`,
          group.org ? `Nätverk: ${group.org}` : null,
          count === 1 && latest.method ? `Metod: ${latest.method}` : null,
          count === 1 && latest.detail ? `Detalj: ${latest.detail}` : null,
        ].filter(Boolean);
        inner.appendChild(el("p", "item-sentence", lines.join(" · ")));

        // Merged entries keep every individual timestamp visible instead
        // of only the summary -- collapsing rows should hide repetition,
        // not the underlying facts.
        if (count > 1) {
          const times = group.instances.map((r) => {
            const t = fmtTimeOfDay(r.created_at);
            return r.detail ? `${t} (${r.detail})` : t;
          }).reverse().join(", ");
          inner.appendChild(el("p", "item-sentence", `Tider: ${times}`));
        }

        const lookupTarget = group.ip_v4 || group.ip_v6;
        if (lookupTarget) {
          const lookupResult = el("p", "item-sentence log-lookup-result", "");
          const lookupBtn = document.createElement("button");
          lookupBtn.className = "btn";
          lookupBtn.textContent = "Slå upp";
          lookupBtn.addEventListener("click", () => runLookup(lookupIp, lookupTarget, lookupResult, lookupBtn));
          inner.appendChild(lookupBtn);
          inner.appendChild(lookupResult);
        }

        detail.appendChild(inner);
        body.appendChild(detail);
        item.appendChild(body);
        wrap.appendChild(item);
      });
      return wrap;
    }

    function render() {
      listRoot.innerHTML = "";
      const visible = filter === "failed" ? rows.filter((r) => r.event === "signin_failure") : rows;
      if (!visible.length) {
        listRoot.appendChild(el("div", "empty-state", "Inga loggposter ännu."));
        return;
      }
      const groups = groupConsecutive(visible);
      listRoot.appendChild(renderTable(groups));
      listRoot.appendChild(renderCards(groups));
    }

    async function load() {
      listRoot.innerHTML = "";
      listRoot.appendChild(el("div", "empty-state", "Laddar…"));

      const { data, error } = await supabase
        .from("access_log")
        .select("created_at, event, method, ip_v4, ip_v6, org, user_agent, detail")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        listRoot.innerHTML = "";
        listRoot.appendChild(el(
          "div", "empty-state",
          `Kunde inte hämta loggen: ${error.message}. Kör supabase/migrations/0009_access_log.sql om du inte redan gjort det.`
        ));
        return;
      }
      rows = categorize(data || []);
      render();
      setLastSeenLog(new Date().toISOString());
    }

    await load();
  },

  async getBadgeCount(ctx) {
    const lastSeen = getLastSeenLog();
    if (!lastSeen) return 0; // never opened on this device yet -- nothing to compare against, not "everything is unseen"
    const { count, error } = await ctx.supabase
      .from("access_log")
      .select("id", { count: "exact", head: true })
      .gt("created_at", lastSeen);
    return error ? 0 : (count || 0);
  },
};
