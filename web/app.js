// Dashboard frontend logic.
// - Auth: Supabase magic link (passwordless). RLS in the database restricts
//   every row to one email (see supabase/migrations/0001_init.sql), so the
//   anon key below being public is fine by design.
// - Data: reads the latest row from briefing_snapshots for whichever
//   kind ("morning" | "evening") is toggled, and renders it.
//
// All text values coming from the payload are inserted with textContent,
// never innerHTML, except the pre-built terrain SVG string. That string is
// meant to be pure geometry (see isSafeSvg below) written by our own
// scheduled task, never raw calendar/email text — but that task's
// reasoning processes untrusted third-party content (mail/calendar) to
// produce it, so a prompt-injection or generation bug could in principle
// smuggle something unsafe into the one field we render via innerHTML.
// isSafeSvg() is a defense-in-depth allowlist gate for exactly that case:
// unrecognized tags, event-handler attributes, hrefs, or embedded
// scripts/comments make the drawing get skipped rather than trusted blindly.

const SVG_ALLOWED_TAGS = new Set([
  "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon",
  "rect", "text", "tspan", "defs", "lineargradient", "radialgradient", "stop",
]);

function isSafeSvg(svg) {
  if (typeof svg !== "string" || svg.length > 20000) return false;
  if (!/^\s*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return false;
  if (/<!--|<!\[CDATA\[|<\?/.test(svg)) return false;
  const tags = svg.match(/<\/?([a-zA-Z][\w:-]*)/g) || [];
  for (const t of tags) {
    if (!SVG_ALLOWED_TAGS.has(t.replace(/^<\/?/, "").toLowerCase())) return false;
  }
  if (/\son[a-z]+\s*=/i.test(svg)) return false;
  if (/\bhref\s*=/i.test(svg)) return false;
  if (/javascript:/i.test(svg)) return false;
  return true;
}

(function () {
  const cfg = window.DASHBOARD_CONFIG || {};
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT-REF")) {
    document.getElementById("gate-msg").textContent =
      "config.js is not set up yet — copy config.example.js to config.js and fill in your Supabase project values.";
    return;
  }

  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const gateEl = document.getElementById("gate");
  const appEl = document.getElementById("app");
  const gateMsg = document.getElementById("gate-msg");
  const briefRoot = document.getElementById("brief-root");

  let currentKind = "morning";

  // ---------- auth ----------

  document.getElementById("send-link-btn").addEventListener("click", async () => {
    const email = document.getElementById("email-input").value.trim();
    if (!email) return;
    gateMsg.textContent = "Sending…";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    });
    gateMsg.textContent = error ? `Error: ${error.message}` : "Check your inbox for the sign-in link.";
  });

  document.getElementById("signout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.reload();
  });

  document.getElementById("toggle-morning").addEventListener("click", () => switchKind("morning"));
  document.getElementById("toggle-evening").addEventListener("click", () => switchKind("evening"));

  function switchKind(kind) {
    currentKind = kind;
    document.getElementById("toggle-morning").classList.toggle("active", kind === "morning");
    document.getElementById("toggle-evening").classList.toggle("active", kind === "evening");
    loadBrief();
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      gateEl.style.display = "none";
      appEl.style.display = "block";
      loadBrief();
    } else {
      gateEl.style.display = "block";
      appEl.style.display = "none";
    }
  });

  supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
      gateEl.style.display = "none";
      appEl.style.display = "block";
      loadBrief();
    }
  });

  // ---------- data + render ----------

  async function loadBrief() {
    briefRoot.innerHTML = "";
    const { data, error } = await supabase
      .from("briefing_snapshots")
      .select("payload, for_date, created_at")
      .eq("kind", currentKind)
      .order("for_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      briefRoot.innerHTML = "";
      const p = document.createElement("div");
      p.className = "empty-state";
      p.textContent = `Couldn't load the ${currentKind} brief: ${error.message}`;
      briefRoot.appendChild(p);
      return;
    }

    if (!data) {
      const p = document.createElement("div");
      p.className = "empty-state";
      p.textContent = `No ${currentKind} brief yet.`;
      briefRoot.appendChild(p);
      return;
    }

    render(data.payload);
  }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function renderItem(item, index) {
    const row = el("div", "item");
    row.appendChild(el("div", "item-num", String(index + 1)));

    const body = el("div", "item-body");
    const title = el("p", "item-title");
    if (item.url) {
      const a = document.createElement("a");
      a.href = item.url;
      a.textContent = item.title;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      title.appendChild(a);
    } else {
      title.textContent = item.title;
    }
    body.appendChild(title);
    body.appendChild(el("p", "item-sentence", item.sentence));

    if (item.button && item.button.label && item.button.href) {
      const btn = document.createElement("a");
      btn.className = "btn";
      btn.href = item.button.href;
      btn.target = "_blank";
      btn.rel = "noopener noreferrer";
      btn.textContent = item.button.label;
      body.appendChild(btn);
    }

    row.appendChild(body);
    return row;
  }

  function render(payload) {
    briefRoot.innerHTML = "";

    // top band
    const top = el("div", "band band-top");
    const topWrap = el("div", "wrap");
    topWrap.appendChild(el("div", "day-date", `${payload.day_name} · ${payload.date_label}`));
    topWrap.appendChild(el("h1", "headline headline-font", payload.headline));

    if (payload.svg && isSafeSvg(payload.svg)) {
      const holder = document.createElement("div");
      holder.innerHTML = payload.svg;
      const svgEl = holder.querySelector("svg");
      if (svgEl) {
        svgEl.classList.add("drawing");
        topWrap.appendChild(svgEl);
      }
    } else if (payload.svg) {
      console.warn("Skipped rendering payload.svg: failed the safety allowlist check.");
    }

    const acts = el("div", "acts");
    (payload.acts || []).forEach((act) => {
      const a = el("div", "act");
      a.appendChild(el("div", "act-time", act.time));
      a.appendChild(el("div", "act-note", act.note));
      acts.appendChild(a);
    });
    topWrap.appendChild(acts);
    top.appendChild(topWrap);
    briefRoot.appendChild(top);

    // bottom band
    const bottom = el("div", "band band-bottom");
    const bottomWrap = el("div", "wrap bottom");

    if (payload.quiet_line) {
      bottomWrap.appendChild(el("div", "quiet-line", payload.quiet_line));
    } else {
      if ((payload.needs_attention || []).length) {
        bottomWrap.appendChild(el("h2", "section-heading", "Needs attention"));
        payload.needs_attention.forEach((item, i) => bottomWrap.appendChild(renderItem(item, i)));
      }
      if ((payload.resolved || []).length) {
        bottomWrap.appendChild(el("h2", "section-heading", "Resolved"));
        payload.resolved.forEach((item, i) => bottomWrap.appendChild(renderItem(item, i)));
      }
    }

    (payload.sections || []).forEach((section) => {
      if (!section.items || !section.items.length) return;
      bottomWrap.appendChild(el("h2", "section-heading", section.heading));
      section.items.forEach((item, i) => bottomWrap.appendChild(renderItem(item, i)));
    });

    bottom.appendChild(bottomWrap);
    briefRoot.appendChild(bottom);
  }
})();
