// Driftstatus card for the Morning Brief.
//
// Why the Statuspage services below are fetched live in the browser rather
// than riding along in the pushed snapshot like every other section: a
// status check is only worth anything if it's current. The brief is
// rewritten hourly at best, so a snapshot-carried "BankID fungerar" could
// be 59 minutes stale exactly when it matters (right as you're about to
// sign into the bank). These endpoints are public, unauthenticated,
// CORS-open and tiny, so the browser can just ask them directly.
//
// Every source in STATUSPAGE_SOURCES is an Atlassian Statuspage instance,
// which all expose the same documented /api/v2/summary.json shape:
//   { status: { indicator: "none"|"minor"|"major"|"critical"|"maintenance",
//               description: "All Systems Operational" },
//     incidents: [ { name, impact, shortlink, ... } ], components: [...] }
// That's the whole reason the list is one line per service -- adding any
// other Statuspage-hosted service needs no new parsing code.
//
// What can't live here: Telia, Gmail and Loopia. Swedish telcos publish
// driftinformation as HTML with no CORS; Gmail is on Google's own Workspace
// dashboard (real JSON, but not Statuspage and not CORS-open); Loopia has
// no status API at all. All three are checked server-side by
// scripts/status_check.py and arrive via payload.service_status.
//
// Downdetector deliberately isn't a source anywhere: it has no official
// public API (Ookla/Accenture never shipped one), so every "Downdetector
// API" out there is an unofficial scraper of a Cloudflare-protected page.
//
// Layout (2026-07-25, per Dario): everything on ONE strip of dots rather
// than a row per service. A healthy day is then just a line of green and
// nothing to read; only the services that are actually degraded get a
// written explanation underneath.

const STATUSPAGE_SOURCES = [
  // GitHub Pages serves this dashboard, and Supabase stores everything in
  // it -- if either is down, what you're looking at is already degraded,
  // so they're worth knowing about first.
  { name: "GitHub", url: "https://www.githubstatus.com" },
  { name: "Supabase", url: "https://status.supabase.com" },
  { name: "BankID", url: "https://status.bankid.com" },
  { name: "Claude", url: "https://status.claude.com" },
  { name: "OpenAI", url: "https://status.openai.com" },
  { name: "ChatGPT", url: "https://status.openai.com" },
];

// Services checked server-side (scripts/status_check.py) and delivered via
// payload.service_status.
//
// They are listed here as well, rather than only being rendered when the
// payload happens to carry them, because otherwise a service silently
// vanishes from the card whenever the snapshot predates the check or the
// check couldn't run -- which is exactly what happened the first time this
// shipped, and reads as "you forgot Loopia" rather than "not checked yet".
// A grey dot saying so is the honest state; an absent chip is a lie by
// omission.
const SERVER_CHECKED = [
  { name: "Telia", link: "https://www.telia.se/privat/support/driftinformation" },
  { name: "Gmail", link: "https://www.google.com/appsstatus/dashboard/" },
  { name: "Loopia mail", link: "https://webmail.loopia.se/" },
];

// Statuspage's own severity vocabulary, collapsed to the three states this
// card actually distinguishes. "maintenance" folds into warn deliberately:
// from where Dario sits, planned or not, it's the same practical fact --
// this might not work right now, and here's why.
const LEVEL_BY_INDICATOR = {
  none: "ok",
  minor: "warn",
  major: "down",
  critical: "down",
  maintenance: "warn",
};

// Fallback wording, used when a service reports a level but has no incident
// worth naming. Swedish, to match the rest of the brief -- Statuspage's own
// `description` is always English ("All Systems Operational").
const TEXT_BY_LEVEL = {
  ok: "Allt fungerar",
  warn: "Störning",
  down: "Nere",
  unknown: "Kunde inte kontrolleras",
};

// What counts as "something is wrong" -- drives the amber/red dot, the
// written explanation, and the card's count badge. "unknown" deliberately
// does NOT: a check that couldn't run is not evidence of an outage, and
// treating it as one would cry wolf every time the wifi hiccups. It stays a
// quiet grey dot with the reason in its tooltip.
const isProblem = (level) => level === "warn" || level === "down";

async function fetchStatuspage(baseUrl, signal) {
  const request = (path) => fetch(`${baseUrl}${path}`, {
    signal,
    credentials: "omit",
  }).then((resp) => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  });
  const [data, incidentData] = await Promise.all([
    request("/api/v2/summary.json"),
    request("/api/v2/incidents.json").catch(() => ({ incidents: [] })),
  ]);

  const indicator = data?.status?.indicator;
  const level = LEVEL_BY_INDICATOR[indicator] || "unknown";

  // An active incident's own name ("Elevated API error rates") says far
  // more than the generic per-level phrase, so it wins when there is one.
  // scheduled_maintenances are deliberately not consulted -- they're
  // routinely scheduled weeks out, and naming a window that starts next
  // Tuesday as if it were happening now would be actively misleading. The
  // indicator already says "maintenance" if one is actually in progress.
  const incident = Array.isArray(data?.incidents) ? data.incidents[0] : null;
  const text = incident?.name || TEXT_BY_LEVEL[level] || TEXT_BY_LEVEL.unknown;

  const days = 45;
  const today = new Date();
  const history = Array.from({ length: days }, (_, index) => ({
    level: "ok",
    checkedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - index - 1)).toISOString(),
  }));
  for (const pastIncident of incidentData?.incidents || []) {
    const timestamp = pastIncident.started_at || pastIncident.created_at;
    if (!timestamp) continue;
    const age = Math.floor((today - new Date(timestamp)) / 86400000);
    if (age < 0 || age >= days) continue;
    const point = history[days - age - 1];
    point.level = ["major", "critical"].includes(pastIncident.impact) ? "down" : "warn";
    point.text = pastIncident.name;
  }

  return { level, text, history };
}

/**
 * Builds the Driftstatus card. Returns { card, cancel } -- `cancel` aborts
 * any still-in-flight fetches, so a re-render (or an unmount) can't have an
 * old mount's responses writing into a detached card.
 *
 * `extraEntries` are pre-checked services carried in the snapshot
 * (payload.service_status), for sources the browser can't reach itself.
 */
export function mountStatusCard(el, extraEntries, options = {}) {
  const sources = options.sources || STATUSPAGE_SOURCES;
  const includeServerChecked = options.includeServerChecked !== false;
  const detailsByName = new Map((options.details || []).map((detail) => [detail.name, detail]));
  const card = el("div", "mb-card mb-status-card");

  const head = el("div", "mb-card-head");
  const heading = options.expandable
    ? el("button", "mb-card-heading status-master-toggle", "Driftstatus")
    : el("h2", "mb-card-heading", "Driftstatus");
  if (options.expandable) {
    heading.type = "button";
    heading.setAttribute("aria-expanded", "false");
  }
  head.appendChild(heading);
  // Deliberately built detached and only appended once something is
  // actually wrong -- the `hidden` property is not enough here, because
  // .mb-count-badge sets `display:inline-flex`, which beats the UA
  // stylesheet's [hidden]{display:none} on specificity and would leave an
  // empty red circle sitting there on a perfectly healthy day.
  const badge = el("span", "mb-count-badge");
  card.appendChild(head);

  const strip = el("div", "status-strip");
  card.appendChild(strip);
  const notes = el("div", "status-notes");
  card.appendChild(notes);
  const expanded = el("div", "status-expanded");
  expanded.hidden = true;
  if (options.expandable) {
    card.appendChild(expanded);
    heading.addEventListener("click", () => {
      expanded.hidden = !expanded.hidden;
      heading.setAttribute("aria-expanded", String(!expanded.hidden));
      options.onExpandedChange?.(!expanded.hidden);
    });
  }

  // Every service's latest known state, keyed by name. Kept as one map
  // rather than per-chip state because the explanations underneath have to
  // be re-sorted across *all* services (worst first) every time any single
  // one resolves.
  const state = new Map();

  function chip(name, link) {
    const node = link ? el("a", "status-chip") : el("span", "status-chip");
    if (link) {
      node.href = link;
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    }
    node.appendChild(el("span", "status-dot"));
    node.appendChild(el("span", "status-chip-name", name));
    strip.appendChild(node);
    return node;
  }

  function refresh() {
    let problems = 0;
    for (const { level } of state.values()) if (isProblem(level)) problems += 1;

    if (problems) {
      badge.textContent = String(problems);
      if (!badge.isConnected) head.appendChild(badge);
    } else if (badge.isConnected) {
      badge.remove();
    }

    // Explanations exist only for what's actually wrong: on a good day the
    // card is just the green strip, with nothing to read. Worst first, so
    // an outage is never buried under a list of minor warnings.
    notes.textContent = "";
    const ranked = [...state.entries()]
      .filter(([, s]) => isProblem(s.level))
      .sort((a, b) => (a[1].level === b[1].level ? 0 : a[1].level === "down" ? -1 : 1));
    for (const [name, s] of ranked) {
      const note = el("p", `status-note status-note-${s.level}`);
      note.appendChild(el("span", "status-note-name", `${name}:`));
      note.appendChild(document.createTextNode(` ${s.text}`));
      notes.appendChild(note);
    }

    if (options.expandable) {
      expanded.textContent = "";
      const groups = new Map();
      for (const [name, serviceState] of state) {
        const detail = detailsByName.get(name);
        const category = detail?.category || "Plattformar";
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push({ name, serviceState, detail });
      }
      for (const [category, services] of groups) {
        const group = el("section", "status-expanded-group");
        group.appendChild(el("h3", "status-expanded-category", category));
        const serviceGrid = el("div", "status-expanded-grid");
        serviceGrid.dataset.count = String(services.length);
        serviceGrid.style.setProperty("--status-columns", String(Math.min(services.length, 3)));
        for (const { name, serviceState, detail } of services) {
          const row = el("details", "status-expanded-service");
          const summary = el("summary");
          const identity = el("span", "status-expanded-identity");
          identity.append(el("span", `status-dot status-dot-${serviceState.level}`), el("strong", null, name));
          const stateLabel = serviceState.level === "ok" ? "Fungerar"
            : serviceState.level === "warn" ? "Störning"
              : serviceState.level === "down" ? "Avbrott"
                : serviceState.level === "loading" ? "Kontrolleras" : "Ej verifierad";
          const historyPoints = detail?.history?.length ? detail.history : serviceState.history;
          const knownPoints = (historyPoints || []).filter((point) => point.level !== "unknown");
          const healthyPoints = knownPoints.filter((point) => point.level === "ok").length;
          const availability = knownPoints.length
            ? `${Math.round((healthyPoints / knownPoints.length) * 1000) / 10}% utan störning`
            : stateLabel;
          const overview = el("span", "status-expanded-overview");
          overview.appendChild(el("span", `status-expanded-state status-expanded-state-${serviceState.level}`, availability));
          if (historyPoints?.length) {
            const history = el("span", "status-expanded-history");
            historyPoints.forEach((point) => {
              const mark = el("span", `status-history-point status-history-${point.level}`);
              const date = point.checkedAt ? new Date(point.checkedAt).toLocaleString("sv-SE") : "";
              mark.title = `${date}${point.text ? ` – ${point.text}` : ""}` || point.level;
              history.appendChild(mark);
            });
            overview.appendChild(history);
          }
          summary.append(identity, overview);
          row.appendChild(summary);
          const body = el("div", "status-expanded-body");
          body.appendChild(el("p", null, serviceState.text));
          const facts = [
            ["Svarstid", detail?.responseMs == null ? null : `${detail.responseMs} ms`],
            ["Senaste kontroll", (detail?.checkedAt || serviceState.checkedAt) ? new Date(detail?.checkedAt || serviceState.checkedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) : null],
            ["Senast lyckad", detail?.lastSuccess ? new Date(detail.lastSuccess).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) : null],
            ["Kontrollmetod", detail?.method || (serviceState.level === "loading" ? "Direkt statuskontroll pågår" : "Offentlig statussida")],
            ["Prioritet", detail?.priority ? `${detail.priority}/5` : null],
          ].filter(([, value]) => value != null);
          if (facts.length) {
            const list = el("dl");
            facts.forEach(([term, value]) => list.append(el("dt", null, term), el("dd", null, value)));
            body.appendChild(list);
          }
          const link = detail?.link || serviceState.link;
          if (link) {
            const anchor = el("a", "status-expanded-link", "Öppna statuskälla");
            anchor.href = link;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            body.appendChild(anchor);
          }
          row.appendChild(body);
          serviceGrid.appendChild(row);
        }
        group.appendChild(serviceGrid);
        expanded.appendChild(group);
      }
    }
  }

  function set(name, node, level, text, history = null) {
    state.set(name, { level, text, history, link: node.href || null, checkedAt: new Date().toISOString() });
    // Full replacement, which also clears the initial -loading class.
    node.className = `status-chip status-chip-${level}`;
    node.dataset.statusDetail = `${name}: ${text}`;
    // The tooltip is where an "unknown" chip explains itself -- it has no
    // written note by design (it isn't a fault), but silently grey with no
    // way to find out why would just be mysterious.
    node.title = `${name}: ${text}`;
    refresh();
  }

  const controller = new AbortController();
  // A status page that hangs shouldn't leave a dot pulsing forever -- after
  // this the chip just reports that it couldn't be checked, which is itself
  // useful information.
  const timeout = setTimeout(() => controller.abort(), 8000);

  const inFlight = sources.map((src) => {
    const node = chip(src.name, src.url);
    node.classList.add("status-chip-loading");
    state.set(src.name, { level: "loading", text: TEXT_BY_LEVEL.unknown });

    return fetchStatuspage(src.url, controller.signal)
      .then(({ level, text, history }) => set(src.name, node, level, text, history))
      .catch((err) => {
        // Offline, blocked, aborted, or a status page having its own bad
        // day -- all the same to this card: it simply doesn't know.
        set(src.name, node, "unknown", `${TEXT_BY_LEVEL.unknown} (${err.name === "AbortError" ? "tidsgräns" : "nätverksfel"})`);
      });
  });

  // Snapshot-carried entries render exactly like the live ones, just
  // already resolved. Every SERVER_CHECKED service gets a chip whether or
  // not the payload actually has a result for it -- an unchecked service
  // shows as grey with the reason in its tooltip rather than disappearing.
  const carried = new Map(
    (extraEntries || []).filter((e) => e && e.name).map((e) => [e.name, e])
  );
  const shown = [
    ...(includeServerChecked ? SERVER_CHECKED.map((s) => ({ ...s, entry: carried.get(s.name) })) : []),
    // Anything the payload adds beyond the known list still renders, so a
    // new source can be introduced server-side without a frontend change.
    ...[...carried.values()]
      .filter((e) => !includeServerChecked || !SERVER_CHECKED.some((s) => s.name === e.name))
      .map((e) => ({ name: e.name, link: e.link, entry: e })),
  ];

  for (const { name, link, entry } of shown) {
    const node = chip(name, entry?.link || link);
    if (!entry) {
      set(name, node, "unknown", "Ingen statuskoll i senaste briefen");
      continue;
    }
    const level = ["ok", "warn", "down", "unknown"].includes(entry.level) ? entry.level : "unknown";
    set(name, node, level, entry.text || TEXT_BY_LEVEL[level]);
  }

  refresh();

  // Once every row has settled the abort timer has nothing left to guard,
  // so drop it rather than let it fire minutes later into a card that may
  // by then have been replaced by a re-render.
  Promise.allSettled(inFlight).then(() => clearTimeout(timeout));

  return {
    card,
    cancel() {
      clearTimeout(timeout);
      controller.abort();
    },
  };
}
