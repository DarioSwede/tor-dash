// Morning Brief module — ported from the original single-file app.js.
//
// Notable changes from that version:
// 1. loadBrief() now clears its root synchronously before the first
//    `await` on every call path (including the empty-state branch, which
//    previously didn't) and carries a request-id guard, so a call
//    superseded by a newer one drops its stale result instead of
//    appending a second "No brief yet." — this is the fix for the
//    confirmed dup-render race in the old version.
// 2. Rows may now carry `payload_encrypted` (an array of per-device
//    envelopes, see shell/crypto.js) instead of plaintext `payload` —
//    decrypted client-side before rendering, using whichever envelope (if
//    any) matches this device's registered key.
// 3. There is only ever one running brief now, not a morning/evening
//    pair picked via a toggle — whatever row was pushed most recently
//    (by created_at, not for_date, since same-day re-pushes are the
//    normal way new content replaces stale content) is simply "the"
//    brief. The `kind` column still exists on the table for now but is
//    no longer read from here.
// 4. A successful render marks this row's created_at as "seen" (see
//    shell/last-seen.js) -- that's what shell.js's sign-in routing
//    checks to decide whether landing here (instead of wherever the URL
//    hash points) is actually warranted.
// 5. (2026-07-25) Card-grid dashboard redesign: the single flowing list
//    became a hero header + a grid of small cards. ToDo briefly moved out
//    to a global slide-out drawer, then Log followed it (see
//    shell/log-drawer.js) -- but ToDo moved back in the same day as a
//    collapsed-by-default card in this module's own grid (see
//    mountTodoCard below), since Dario wanted it part of the brief again
//    rather than a separate always-present tab. See
//    backup/pre-card-redesign-2026-07-25 and
//    backup/pre-nav-redesign-2026-07-25 for the previous looks if either
//    round ever needs reverting.

import { setLastSeenBrief } from "../../shell/last-seen.js";
import { mountTodoPanel } from "../todo/module.js";
import { mountArchivePanel } from "../archive/module.js";
import { mountStatusCard } from "./status-check.js";

let requestSeq = 0;
let clockInterval = null;
let statusCard = null;

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}
// Small hand-drawn icons, built via the SVG DOM API (not innerHTML) --
// dom-utils.js documents payload.svg as the one deliberate innerHTML
// exception in the app, and these are static/hard-coded, not payload
// content, so building them the same way (real elements, not a markup
// string) keeps that claim true. Colors come from CSS classes, not
// attributes, so light/dark and has-custom-bg theming still works.
function icon(viewBox, cls, children) {
  const svg = svgEl("svg", { viewBox, class: `mb-icon ${cls}` });
  children.forEach((c) => svg.appendChild(c));
  return svg;
}
// Purely decorative per-slot glyphs next to the day's three "acts" --
// there's no real hourly forecast behind these (weather.py only gives
// today/tonight/tomorrow), so they just echo morning/midday/evening
// rather than claiming to be an actual per-slot forecast.
function iconSun() {
  return icon("0 0 24 24", "mb-icon-sun", [
    svgEl("circle", { cx: 12, cy: 12, r: 5, class: "mb-icon-fg-fill" }),
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((deg) =>
      svgEl("line", {
        x1: 12 + Math.cos((deg * Math.PI) / 180) * 8, y1: 12 + Math.sin((deg * Math.PI) / 180) * 8,
        x2: 12 + Math.cos((deg * Math.PI) / 180) * 10.5, y2: 12 + Math.sin((deg * Math.PI) / 180) * 10.5,
        class: "mb-icon-fg", "stroke-width": 1.6, "stroke-linecap": "round",
      })
    ),
  ]);
}
function iconCloudSun() {
  return icon("0 0 24 24", "mb-icon-cloudsun", [
    svgEl("circle", { cx: 8, cy: 8, r: 3.4, class: "mb-icon-fg-fill mb-icon-sun-part" }),
    svgEl("ellipse", { cx: 13, cy: 15, rx: 8, ry: 4.4, class: "mb-icon-bg" }),
    svgEl("circle", { cx: 8.5, cy: 12.5, r: 3.6, class: "mb-icon-bg" }),
  ]);
}
function iconMoon() {
  return icon("0 0 24 24", "mb-icon-moon", [
    svgEl("path", { d: "M18 13.5A7 7 0 1 1 10.5 6a5.4 5.4 0 0 0 7.5 7.5z", class: "mb-icon-fg-fill" }),
  ]);
}

// Click-to-cycle world clock, next to the brief's weather icon. Always
// starts on Stockholm on a fresh mount (i.e. every login/page load) --
// there's deliberately no persisted "last city" state, since that's
// exactly what was asked for: Stockholm as the default you land on, not
// whatever you last clicked to in a previous session.
const WORLD_CLOCK_CITIES = [
  { label: "Stockholm", tz: "Europe/Stockholm" },
  { label: "Peking", tz: "Asia/Shanghai" },
  { label: "Kiev", tz: "Europe/Kyiv" },
  { label: "New York", tz: "America/New_York" },
  { label: "Los Angeles", tz: "America/Los_Angeles" },
];

function renderWorldClock(el) {
  let idx = 0;
  const clockEl = el("div", "world-clock");
  clockEl.setAttribute("role", "button");
  clockEl.setAttribute("tabindex", "0");
  clockEl.title = "Klicka för att växla stad";
  const timeEl = el("div", "world-clock-time");
  const cityEl = el("div", "world-clock-city");
  clockEl.append(timeEl, cityEl);

  function tick() {
    const { label, tz } = WORLD_CLOCK_CITIES[idx];
    timeEl.textContent = new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date());
    cityEl.textContent = label;
  }
  function cycle() {
    idx = (idx + 1) % WORLD_CLOCK_CITIES.length;
    tick();
  }
  clockEl.addEventListener("click", cycle);
  clockEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycle(); }
  });

  tick();
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(tick, 1000);
  return clockEl;
}

export default {
  id: "morning-brief",
  navLabel: "Brief",

  unmount() {
    clearInterval(clockInterval);
    clockInterval = null;
    statusCard?.cancel();
    statusCard = null;
  },

  async mount(container, ctx) {
    const { supabase, el, renderItem, isSafeSvg, decryptPayload } = ctx;

    const briefRoot = el("div", "brief-main");
    container.appendChild(briefRoot);

    async function loadBrief() {
      const myRequest = ++requestSeq;
      briefRoot.innerHTML = ""; // synchronous, before any await — every branch below can safely append

      const { data, error } = await supabase
        .from("briefing_snapshots")
        .select("payload, payload_encrypted, for_date, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (myRequest !== requestSeq) return; // a newer call started; this response is stale

      if (error) {
        briefRoot.appendChild(el("div", "empty-state", `Kunde inte hämta briefen: ${error.message}`));
        return;
      }
      if (!data) {
        briefRoot.appendChild(el("div", "empty-state", "Ingen brief ännu."));
        return;
      }

      let payload = data.payload;
      if (!payload && data.payload_encrypted) {
        payload = await decryptPayload(data.payload_encrypted);
        if (myRequest !== requestSeq) return; // check again — the decrypt await can also be superseded
        if (!payload) {
          briefRoot.appendChild(el(
            "div", "empty-state",
            "Den här briefen är krypterad för en annan enhet. Öppna Säkerhet och sätt upp kryptering här för att läsa den."
          ));
          return;
        }
      }
      render(payload);
      setLastSeenBrief(data.created_at);
    }

    // Non-interactive line for a `section.plain` item (see the README's
    // payload-shape note on multi-day calendar background context, e.g.
    // "Nettan is on vacation") -- title + sentence both always visible,
    // no chevron/click. Collapsed-by-default via renderItem is right for
    // needs_attention/resolved/news, where the point is a scannable list
    // of *titles*; it's wrong here, where the whole point is a quick
    // glance at the one short fact (how long, which calendar) without
    // having to tap each line to find that out.
    function renderPlainItem(item) {
      const row = el("div", "plain-item");
      row.appendChild(el("p", "plain-item-title", item.title));
      if (item.sentence) row.appendChild(el("p", "plain-item-sentence", item.sentence));
      return row;
    }

    function mbCard(extraClass) {
      return el("div", extraClass ? `mb-card ${extraClass}` : "mb-card");
    }
    function mbCardHeading(text, countBadgeText) {
      const head = el("div", "mb-card-head");
      head.appendChild(el("h2", "mb-card-heading", text));
      if (countBadgeText != null) head.appendChild(el("span", "mb-count-badge", String(countBadgeText)));
      return head;
    }

    // Card-grid dashboard. A hero card (day/headline/acts/clock/pin, its
    // own distinct background tint), then the weather detail card, then
    // a responsive grid of small cards -- needs_attention/resolved get
    // an icon-led checklist look (green check / red alert, re-skinning
    // renderItem's existing item-num bullet purely via CSS -- see
    // module.css's .mb-check-list/.mb-alert-list), every other
    // payload.sections entry becomes its own plain card, and "Väder
    // Stockholm" (matched by heading text, as before) is pulled out to
    // become that full-width detail card instead of living in the grid.
    function render(payload) {
      briefRoot.innerHTML = "";

      const page = el("div", "band band-top mb-page");
      const wrap = el("div", "wrap");

      // ---- Hero (its own card, tinted differently from the plain white
      // cards below so it reads as "the featured one") ----
      const hero = el("div", "mb-card mb-hero");
      const heroMain = el("div", "mb-hero-main");
      heroMain.appendChild(el("div", "day-date", `${payload.day_name} · ${payload.date_label}`));
      heroMain.appendChild(el("h1", "headline headline-font", payload.headline));

      const acts = el("div", "acts");
      const actIcons = [iconSun, iconCloudSun, iconMoon];
      (payload.acts || []).forEach((act, i) => {
        const a = el("div", "act");
        const iconWrap = el("div", "act-icon");
        iconWrap.appendChild((actIcons[i] || iconCloudSun)());
        a.appendChild(iconWrap);
        a.appendChild(el("div", "act-time", act.time));
        a.appendChild(el("div", "act-note", act.note));
        acts.appendChild(a);
      });
      if (acts.children.length) heroMain.appendChild(acts);

      // Short forward-looking heads-up, separate from acts (today's own
      // schedule) and quiet_line (today's status) -- a one-line answer
      // to "what happens tomorrow" so that doesn't require waiting for
      // tomorrow's own brief to find out. Optional: omitted entirely
      // when there's nothing worth a heads-up about.
      if (payload.tomorrow_line) {
        heroMain.appendChild(el("div", "tomorrow-line", `Imorgon: ${payload.tomorrow_line}`));
      }
      if (payload.quiet_line) {
        heroMain.appendChild(el("div", "quiet-line", payload.quiet_line));
      }
      hero.appendChild(heroMain);

      // Just the clock now -- a separate location-pin line under it used
      // to duplicate the city name the clock's own world-clock-city label
      // already shows, so it was dropped rather than kept in sync with
      // two copies of the same text (see backup/pre-nav-redesign-
      // 2026-07-25 for that version).
      const heroSide = el("div", "mb-hero-side");
      heroSide.appendChild(renderWorldClock(el));
      hero.appendChild(heroSide);

      wrap.appendChild(hero);

      // ---- Weather detail card (full width, right above Avklarat) ----
      // "Väder Stockholm" (matched by heading text) is pulled out of the
      // normal sections list to become this instead of a grid card.
      const sections = (payload.sections || []).slice();
      const weatherIdx = sections.findIndex((s) => s.heading === "Väder Stockholm");
      const weatherSection = weatherIdx >= 0 ? sections.splice(weatherIdx, 1)[0] : null;
      const weatherItem = weatherSection && weatherSection.items && weatherSection.items[0];
      if (weatherItem) {
        const wcard = mbCard("mb-weather-card");
        wcard.appendChild(mbCardHeading(weatherSection.heading));
        const body = el("div", "mb-weather-body");
        if (payload.svg && isSafeSvg(payload.svg)) {
          const holder = document.createElement("div");
          holder.innerHTML = payload.svg; // the one documented innerHTML exception (isSafeSvg-gated)
          const svgNode = holder.querySelector("svg");
          if (svgNode) {
            svgNode.classList.add("mb-weather-icon");
            body.appendChild(svgNode);
          }
        } else if (payload.svg) {
          console.warn("Skipped rendering payload.svg: failed the safety allowlist check.");
        }
        const text = el("div", "mb-weather-text");
        text.appendChild(el("p", "mb-weather-title", weatherItem.title));
        if (weatherItem.sentence) text.appendChild(el("p", "mb-weather-sentence", weatherItem.sentence));
        body.appendChild(text);
        wcard.appendChild(body);
        if (weatherSection.source) wcard.appendChild(el("p", "section-source", weatherSection.source));
        wrap.appendChild(wcard);
      }

      // ---- Driftstatus (full width, above the grid) ----
      // Unlike every other card here its content isn't in the payload at
      // all: the Statuspage services are fetched live on each render,
      // because an hour-stale "BankID fungerar" is worth nothing. Full
      // width rather than a grid cell so the whole strip of services fits
      // on one line, which is the entire point of the layout. Any previous
      // card's in-flight fetches are cancelled first so their responses
      // can't land in a card that's just been thrown away.
      statusCard?.cancel();
      statusCard = mountStatusCard(el, payload.service_status);
      wrap.appendChild(statusCard.card);

      // ---- Card grid ----
      const grid = el("div", "mb-grid");

      if (!payload.quiet_line) {
        if ((payload.needs_attention || []).length) {
          const card = mbCard("mb-alert-list");
          card.appendChild(mbCardHeading("Viktigt att göra", payload.needs_attention.length));
          payload.needs_attention.forEach((item, i) => {
            const withDefaultBadge = item.badge ? item : { ...item, badge: "Viktigt", badgeVariant: "urgent" };
            card.appendChild(renderItem(withDefaultBadge, i));
          });
          grid.appendChild(card);
        }
        if ((payload.resolved || []).length) {
          const card = mbCard("mb-check-list");
          card.appendChild(mbCardHeading("Avklarat"));
          payload.resolved.forEach((item, i) => card.appendChild(renderItem(item, i)));
          grid.appendChild(card);
        }
      }

      sections.forEach((section) => {
        if (!section.items || !section.items.length) return;
        const card = mbCard();
        card.appendChild(mbCardHeading(section.heading));
        if (section.source) card.appendChild(el("p", "section-source", section.source));
        if (section.plain) {
          section.items.forEach((item) => card.appendChild(renderPlainItem(item)));
        } else {
          section.items.forEach((item, i) => card.appendChild(renderItem(item, i)));
        }
        grid.appendChild(card);
      });

      // ToDo card -- collapsed by default (Dario wants it out of the way
      // until he actually wants it), expands in place on click instead of
      // sliding out as a separate panel. Mounted once per render() call,
      // same as every other card here -- ToDo keeps its own independent
      // load/save cycle regardless (see modules/todo/module.js).
      grid.appendChild(mountTodoCard(el, ctx));
      grid.appendChild(mountArchiveCard(el, ctx));

      if (grid.children.length) wrap.appendChild(grid);

      page.appendChild(wrap);
      briefRoot.appendChild(page);
    }

    await loadBrief();
  },
};

// Collapsed-by-default card: only the heading (+ chevron) shows until
// clicked, same grid-rows-0fr-to-1fr accordion trick shell.css's
// .item-detail already uses for the same "hidden until tapped" effect,
// just with its own class names since this wraps a whole mounted module
// rather than one row of text.
//
// Shared by ToDo and Arkiv rather than copied: both are whole panels that
// belong to the brief but shouldn't take up room until asked for. Returns
// the card plus a setBadge, because a panel that's shut still needs a way
// to say "there's something in here" -- Arkiv's review queue is invisible
// otherwise.
function mountFoldCard(el, title, mountBody) {
  const card = el("div", "mb-card mb-fold-card");
  const head = el("div", "mb-fold-head");
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  head.setAttribute("aria-expanded", "false");
  head.appendChild(el("h2", "mb-card-heading", title));

  // Built detached and only attached when non-zero -- .mb-count-badge sets
  // display:inline-flex, which beats the UA stylesheet's [hidden] rule on
  // specificity and would otherwise leave an empty circle sitting there.
  const badge = el("span", "mb-count-badge");

  const bodyOuter = el("div", "mb-fold-body");
  const bodyInner = el("div", "mb-fold-body-inner");
  bodyOuter.appendChild(bodyInner);

  function toggle() {
    const expanded = card.classList.toggle("expanded");
    head.setAttribute("aria-expanded", String(expanded));
  }
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  });

  function setBadge(n) {
    if (n > 0) {
      badge.textContent = String(n);
      if (!badge.isConnected) head.appendChild(badge);
    } else if (badge.isConnected) {
      badge.remove();
    }
  }

  card.append(head, bodyOuter);
  // setBadge is handed to the body mounter rather than only returned, so a
  // panel can wire it up without closing over a binding that isn't assigned
  // yet at call time.
  mountBody(bodyInner, setBadge);

  return card;
}

function mountTodoCard(el, ctx) {
  return mountFoldCard(el, "ToDo", (body) => mountTodoPanel(body, ctx));
}

// Arkiv lives inside the brief for now (2026-07-26), but the panel itself is
// container-agnostic -- see modules/archive/module.js. Moving it back out to
// its own nav tab is one line in modules/manifest.js plus deleting this call.
function mountArchiveCard(el, ctx) {
  return mountFoldCard(el, "Arkiv", (body, setBadge) =>
    mountArchivePanel(body, ctx, { onReviewCount: setBadge })
  );
}
