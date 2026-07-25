// Driftstatus card for the Morning Brief.
//
// Why this fetches live in the browser instead of riding along in the
// pushed snapshot like every other section: a status check is only worth
// anything if it's current. The brief is rewritten hourly at best, so a
// snapshot-carried "BankID fungerar" could be 59 minutes stale exactly
// when it matters (right as you're about to sign into the bank). These
// endpoints are public, unauthenticated, CORS-open and tiny, so the
// browser can just ask them directly on every mount.
//
// Every source here is an Atlassian Statuspage instance, which all expose
// the same documented /api/v2/summary.json shape:
//   { status: { indicator: "none"|"minor"|"major"|"critical"|"maintenance",
//               description: "All Systems Operational" },
//     incidents: [ { name, impact, shortlink, ... } ], components: [...] }
// That's the whole reason the list below is one line per service -- adding
// any other Statuspage-hosted service is just another entry, no new
// parsing code.
//
// Downdetector deliberately isn't a source: it has no official public API
// (Ookla/Accenture never shipped one), so every "Downdetector API" out
// there is an unofficial scraper of a Cloudflare-protected page. Same
// reason Telia/Tele2/Swedbank aren't here -- Swedish telcos and banks
// publish driftinformation as HTML only, with no CORS, so they can't be
// read from the browser at all. Those arrive via payload.service_status
// instead (see scripts/status_check.py), which the routine fills in
// server-side where CORS doesn't apply.

const STATUSPAGE_SOURCES = [
  // GitHub Pages serves this dashboard, and Supabase stores everything in
  // it -- if either is down, what you're looking at is already degraded,
  // so they're worth knowing about first.
  { name: "GitHub", url: "https://www.githubstatus.com" },
  { name: "Supabase", url: "https://status.supabase.com" },
  { name: "BankID", url: "https://status.bankid.com" },
  { name: "Claude", url: "https://status.claude.com" },
  { name: "OpenAI", url: "https://status.openai.com" },
];

// Statuspage's own severity vocabulary, collapsed to the four levels this
// card actually draws a dot for.
const LEVEL_BY_INDICATOR = {
  none: "ok",
  minor: "warn",
  major: "down",
  critical: "down",
  maintenance: "maint",
};

// Fallback wording, used when a service reports a level but no incident
// worth naming. Swedish, to match the rest of the brief -- Statuspage's
// own `description` is always English ("All Systems Operational").
const TEXT_BY_LEVEL = {
  ok: "Allt fungerar",
  warn: "Mindre störning",
  down: "Driftstörning",
  maint: "Underhåll pågår",
  unknown: "Kunde inte kontrolleras",
  loading: "Kontrollerar…",
};

// What counts as "something is wrong" -- drives both the red row text and
// the card's headline count, so a glance at the badge answers "is anything
// broken right now" without reading the rows. Maintenance counts: planned
// or not, it's still a reason something might not work for you this
// minute. "unknown" deliberately does *not* -- a check that couldn't run
// is not evidence of an outage, and colouring it red would cry wolf every
// time the wifi hiccups.
const isProblem = (level) => level === "warn" || level === "down" || level === "maint";

async function fetchStatuspage(baseUrl, signal) {
  const resp = await fetch(`${baseUrl}/api/v2/summary.json`, {
    signal,
    // No credentials, no custom headers -- keeps this a CORS "simple
    // request" so it never triggers a preflight these status pages might
    // not answer.
    credentials: "omit",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  const indicator = data?.status?.indicator;
  const level = LEVEL_BY_INDICATOR[indicator] || "unknown";

  // An active incident's own name ("Elevated API error rates") says far
  // more than the generic per-level phrase, so it wins when there is one.
  // scheduled_maintenances are deliberately not treated the same way --
  // they're routinely scheduled weeks out, and naming a maintenance
  // window that starts next Tuesday as if it were happening now would be
  // actively misleading. The indicator already reports it as "maintenance"
  // if it's actually in progress.
  const incident = Array.isArray(data?.incidents) ? data.incidents[0] : null;
  const text = incident?.name || TEXT_BY_LEVEL[level] || TEXT_BY_LEVEL.unknown;

  return { level, text };
}

// One row: coloured dot, service name (linking out to the full status
// page), and the current state in words. Returns handles so the caller can
// fill the row in once its fetch settles, rather than rebuilding the row.
function buildRow(el, name, link) {
  const row = el("div", "status-row");

  const dot = el("span", "status-dot status-dot-loading");
  row.appendChild(dot);

  let nameEl;
  if (link) {
    nameEl = el("a", "status-name");
    nameEl.href = link;
    nameEl.target = "_blank";
    nameEl.rel = "noopener noreferrer";
    nameEl.textContent = name;
    nameEl.title = `Öppna ${name}s statussida`;
  } else {
    nameEl = el("span", "status-name", name);
  }
  row.appendChild(nameEl);

  const textEl = el("span", "status-text", TEXT_BY_LEVEL.loading);
  row.appendChild(textEl);

  return {
    row,
    set(level, text) {
      dot.className = `status-dot status-dot-${level}`;
      textEl.textContent = text;
      // Text severity tracks the dot rather than being one blanket red --
      // a blue "maintenance" dot next to red text reads as two different
      // claims about the same row.
      textEl.className = isProblem(level) ? `status-text status-text-${level}` : "status-text";
    },
  };
}

/**
 * Builds the Driftstatus card. Returns { card, cancel } -- `cancel` aborts
 * any still-in-flight fetches, so a re-render (or an unmount) can't have
 * an old mount's responses writing into a detached card.
 *
 * `extraEntries` are pre-checked services carried in the snapshot
 * (payload.service_status), for sources the browser can't reach itself.
 */
export function mountStatusCard(el, extraEntries) {
  const card = el("div", "mb-card mb-status-card");

  const head = el("div", "mb-card-head");
  head.appendChild(el("h2", "mb-card-heading", "Driftstatus"));
  // Deliberately built detached and only appended once something is
  // actually wrong -- the `hidden` property is not enough here, because
  // .mb-count-badge sets `display:inline-flex`, which beats the UA
  // stylesheet's [hidden]{display:none} on specificity and leaves an
  // empty red circle sitting there on a perfectly healthy day.
  const badge = el("span", "mb-count-badge");
  card.appendChild(head);

  const controller = new AbortController();
  // A status page that hangs shouldn't leave a row spinning forever --
  // after this the row just reports that it couldn't be checked, which is
  // itself useful information.
  const timeout = setTimeout(() => controller.abort(), 8000);

  let problems = 0;
  function countProblem(level) {
    if (!isProblem(level)) return;
    problems += 1;
    badge.textContent = String(problems);
    if (!badge.isConnected) head.appendChild(badge);
  }

  const inFlight = STATUSPAGE_SOURCES.map((src) => {
    const { row, set } = buildRow(el, src.name, src.url);
    card.appendChild(row);

    return fetchStatuspage(src.url, controller.signal)
      .then(({ level, text }) => {
        set(level, text);
        countProblem(level);
      })
      .catch(() => {
        // Offline, blocked, aborted, or a status page having its own bad
        // day -- all the same to this card: it simply doesn't know. Not
        // counted as a problem, since "I couldn't check" isn't evidence
        // that anything is actually down.
        set("unknown", TEXT_BY_LEVEL.unknown);
      });
  });

  // Once every row has settled the abort timer has nothing left to guard,
  // so drop it rather than let it fire minutes later into a card that may
  // by then have been replaced by a re-render.
  Promise.allSettled(inFlight).then(() => clearTimeout(timeout));

  // Snapshot-carried entries (Telia and friends) render exactly like the
  // live ones, just already resolved.
  for (const entry of extraEntries || []) {
    if (!entry || !entry.name) continue;
    const level = Object.prototype.hasOwnProperty.call(TEXT_BY_LEVEL, entry.level) ? entry.level : "unknown";
    const { row, set } = buildRow(el, entry.name, entry.link);
    card.appendChild(row);
    set(level, entry.text || TEXT_BY_LEVEL[level]);
    countProblem(level);
  }

  return {
    card,
    cancel() {
      clearTimeout(timeout);
      controller.abort();
    },
  };
}
