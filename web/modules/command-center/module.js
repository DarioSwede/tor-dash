import { loadCommandCenter } from "./adapters.js";
import { mountStatusCard } from "../morning-brief/status-check.js";

let clockTimer = null;
let statusCancel = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function icon(name) {
  const icons = {
    calendar: "○", focus: "⌁", mission: "◉", depot: "↗", marketplace: "◇",
    expedition: "△", veteran: "✦", ai: "✣", links: "↳",
  };
  return node("span", "cc-icon", icons[name] || "•");
}

function statusDot(level) {
  const dot = node("span", `cc-dot cc-dot-${level || "neutral"}`);
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

function card(title, iconName, options = {}) {
  const section = node("section", `cc-card ${options.className || ""}`.trim());
  const head = node("div", "cc-card-head");
  const titleWrap = node("div", "cc-card-title-wrap");
  titleWrap.append(icon(iconName), node("h2", null, title));
  head.appendChild(titleWrap);
  if (options.action) head.appendChild(options.action);
  section.appendChild(head);
  return section;
}

function itemList(items, emptyText = "Ingen verifierad data ännu.") {
  const list = node("div", "cc-list");
  if (!items?.length) {
    list.appendChild(node("p", "cc-empty", emptyText));
    return list;
  }
  items.forEach((item) => {
    const row = node("div", "cc-list-row");
    row.appendChild(statusDot(item.level));
    const copy = node("div", "cc-list-copy");
    copy.append(node("strong", null, item.title), node("span", null, item.meta || ""));
    row.appendChild(copy);
    list.appendChild(row);
  });
  return list;
}

function deepLink(label, hash) {
  const link = node("a", "cc-link", label);
  link.href = hash;
  return link;
}

function timeLabel(value) {
  if (!value) return "saknas";
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}

function renderMissionStatus(data) {
  const root = node("div", "cc-mission");
  const summary = node("div", "cc-health-summary");
  const score = node("strong", "cc-health-score", String(data.score));
  score.appendChild(node("small", null, "/100"));
  const copy = node("div", "cc-health-copy");
  copy.append(
    node("strong", null, data.score >= 85 ? "Systemen mår bra" : data.score >= 60 ? "Begränsad lägesbild" : "Åtgärd kan krävas"),
    node("span", null, `${data.verifiedCount}/${data.services.length} tjänster verifierade`)
  );
  summary.append(score, copy);
  root.appendChild(summary);

  const categories = new Map();
  data.services.forEach((service) => {
    if (!categories.has(service.category)) categories.set(service.category, []);
    categories.get(service.category).push(service);
  });

  categories.forEach((services, category) => {
    root.appendChild(node("h3", "cc-service-category", category));
    services.sort((a, b) => b.priority - a.priority).forEach((service) => {
      const details = node("details", "cc-service-v2");
      const summaryRow = node("summary");
      const identity = node("div", "cc-service-identity");
      identity.append(statusDot(service.level), node("strong", null, service.name));
      const state = node("span", `cc-state cc-state-${service.level}`,
        service.level === "unknown" ? "Ej verifierad" : service.level === "ok" ? "Fungerar" : service.level === "warn" ? "Störning" : "Avbrott");
      summaryRow.append(identity, state);
      details.appendChild(summaryRow);

      const body = node("div", "cc-service-details");
      body.appendChild(node("p", null, service.text));
      const facts = node("dl");
      [
        ["Svarstid", service.responseMs == null ? "saknas" : `${service.responseMs} ms`],
        ["Senaste kontroll", timeLabel(service.checkedAt)],
        ["Senast lyckad", timeLabel(service.lastSuccess)],
        ["Kontrollmetod", service.method],
        ["Prioritet", `${service.priority}/5`],
      ].forEach(([term, value]) => {
        facts.append(node("dt", null, term), node("dd", null, value));
      });
      body.appendChild(facts);

      const history = node("div", "cc-status-history");
      history.setAttribute("aria-label", `24 timmars historik för ${service.name}`);
      if (!service.history.length) {
        history.appendChild(node("span", "cc-history-empty", "Historik byggs upp efter nästa kontroll"));
      } else {
        service.history.forEach((point) => {
          const mark = node("span", `cc-history-point cc-history-${point.level}`);
          mark.title = `${timeLabel(point.checkedAt)} · ${point.verified ? point.level : "ej verifierad"}`;
          history.appendChild(mark);
        });
      }
      body.appendChild(history);
      if (service.link) {
        const link = node("a", "cc-link", "Öppna statuskälla");
        link.href = service.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        body.appendChild(link);
      }
      details.appendChild(body);
      root.appendChild(details);
    });
  });
  return root;
}

function renderBrief(data) {
  const hero = node("section", "cc-hero");
  const top = node("div", "cc-hero-top");
  const identity = node("div");
  identity.append(
    node("p", "cc-kicker", data.eyebrow || "COMMAND BRIEF"),
    node("h1", null, data.headline)
  );
  const cities = [
    ["Stockholm", "Europe/Stockholm"],
    ["Hongkong", "Asia/Hong_Kong"],
    ["New York", "America/New_York"],
    ["Los Angeles", "America/Los_Angeles"],
    ["Moskva", "Europe/Moscow"],
  ];
  let selectedCity = cities[0];
  const clock = node("details", "cc-clock");
  const clockFace = node("summary", "cc-clock-face");
  const time = node("strong");
  const place = node("span", null, selectedCity[0]);
  clockFace.append(time, place);
  const cityMenu = node("div", "cc-clock-cities");
  cities.forEach((city) => {
    const button = node("button", null, city[0]);
    button.type = "button";
    button.addEventListener("click", () => {
      selectedCity = city;
      place.textContent = city[0];
      clock.open = false;
      tick();
    });
    cityMenu.appendChild(button);
  });
  clock.append(clockFace, cityMenu);
  const tick = () => {
    time.textContent = new Intl.DateTimeFormat("sv-SE", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: selectedCity[1],
    }).format(new Date());
  };
  tick();
  clearInterval(clockTimer);
  clockTimer = setInterval(tick, 1000);
  top.append(identity, clock);
  hero.appendChild(top);

  const triage = node("div", "cc-triage");
  [
    ["Execute", data.execute, "Saker att agera på nu", "execute"],
    ["Monitor", data.monitor, "Signaler att hålla under uppsikt", "monitor"],
    ["Opportunity", data.opportunity, "Möjligheter identifierade", "opportunity"],
  ].forEach(([label, count, copy, level]) => {
    const lane = node("div", "cc-triage-lane");
    lane.append(statusDot(level), node("strong", null, label), node("b", null, String(count)), node("span", null, copy));
    triage.appendChild(lane);
  });
  hero.appendChild(triage);
  return hero;
}

function weatherText(code) {
  if (code === 0) return ["☀", "Klart"];
  if ([1, 2].includes(code)) return ["◒", "Växlande molnighet"];
  if (code === 3) return ["☁", "Mulet"];
  if ([45, 48].includes(code)) return ["≋", "Dimma"];
  if ([51, 53, 55, 56, 57].includes(code)) return ["☂", "Duggregn"];
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ["☂", "Regn"];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ["❄", "Snö"];
  if ([95, 96, 99].includes(code)) return ["ϟ", "Åska"];
  return ["○", "Väderläge"];
}

function renderWeather(weather) {
  const section = node("section", "cc-weather");
  section.appendChild(node("p", "cc-weather-label", "Väder Stockholm"));
  if (!weather || !Number.isFinite(weather.temperature)) {
    section.appendChild(node("p", "cc-weather-unavailable", "Vädret kunde inte hämtas just nu."));
    return section;
  }
  const [symbol, condition] = weatherText(weather.code);
  const body = node("div", "cc-weather-body");
  body.appendChild(node("span", "cc-weather-symbol", symbol));
  const copy = node("div", "cc-weather-copy");
  const current = Math.round(weather.temperature);
  const high = Math.round(weather.high);
  copy.append(
    node("strong", null, `${condition}, ${current}° nu — upp mot ${high}°`),
    node("span", null, `Lägst ${Math.round(weather.low)}° · Risk för nederbörd ${Math.round(weather.rainRisk || 0)}%`)
  );
  body.appendChild(copy);
  const source = node("a", "cc-weather-source", weather.source);
  source.href = "https://open-meteo.com/";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  body.appendChild(source);
  section.appendChild(body);
  return section;
}

function renderTimeline(calendar) {
  const shell = node("div", "cc-timeline-shell");
  const controls = node("div", "cc-timeline-controls");
  const zoomGroup = node("div", "cc-timeline-zoom");
  const todayBtn = node("button", "cc-timeline-btn", "Idag");
  const detail = node("div", "cc-timeline-detail");
  detail.hidden = true;
  todayBtn.type = "button";
  [
    ["7 dagar", 120],
    ["14 dagar", 72],
    ["Månad", 38],
  ].forEach(([label, scale], index) => {
    const button = node("button", `cc-timeline-btn${index === 1 ? " active" : ""}`, label);
    button.type = "button";
    button.dataset.scale = String(scale);
    zoomGroup.appendChild(button);
  });
  controls.append(zoomGroup, todayBtn);
  shell.appendChild(controls);

  if (calendar.sourceState === "locked") {
    shell.appendChild(node("p", "cc-calendar-notice", "Mac-kalendern är krypterad för en annan webbadress. Öppna livesidan eller registrera den här adressen som en egen enhet."));
  }

  if (!calendar.anchorDate || !calendar.events.length) {
    shell.appendChild(node("p", "cc-empty", "Tidslinjen fylls när en ansluten kalender innehåller händelser."));
    return shell;
  }

  const DAY_MS = 86400000;
  const atNoon = (value) => new Date(`${value}T12:00:00`);
  const anchor = atNoon(calendar.anchorDate);
  const eventDates = calendar.events.flatMap((event) => [atNoon(event.start), atNoon(event.end)]);
  const earliest = new Date(Math.min(anchor.getTime() - 60 * DAY_MS, ...eventDates.map((d) => d.getTime() - 7 * DAY_MS)));
  const latest = new Date(Math.max(anchor.getTime() + 60 * DAY_MS, ...eventDates.map((d) => d.getTime() + 7 * DAY_MS)));
  const start = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate(), 12);
  const end = new Date(latest.getFullYear(), latest.getMonth(), latest.getDate(), 12);
  const totalDays = Math.round((end - start) / DAY_MS) + 1;
  const indexFor = (value) => Math.round((atNoon(value) - start) / DAY_MS);

  // Greedy lane assignment prevents overlapping event bands from covering
  // one another while keeping the board compact.
  const laneEnds = [];
  const positioned = calendar.events
    .map((event) => ({ ...event, startIndex: indexFor(event.start), endIndex: indexFor(event.end) }))
    .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex)
    .map((event) => {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd < event.startIndex);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = event.endIndex;
      return { ...event, lane };
    });

  const viewport = node("div", "cc-timeline-viewport");
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Dragbar kalendertidslinje. Dra åt vänster för historik och åt höger för kommande händelser.");
  const board = node("div", "cc-timeline-board");
  const axis = node("div", "cc-timeline-axis");
  const tracks = node("div", "cc-timeline-tracks");
  tracks.style.height = `${Math.max(1, laneEnds.length) * 42 + 16}px`;

  for (let i = 0; i < totalDays; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const day = node("div", "cc-timeline-day");
    if (date.toDateString() === anchor.toDateString()) day.classList.add("is-today");
    if ([0, 6].includes(date.getDay())) day.classList.add("is-weekend");
    const month = date.getDate() === 1
      ? new Intl.DateTimeFormat("sv-SE", { month: "short" }).format(date)
      : "";
    day.append(
      node("span", null, month || new Intl.DateTimeFormat("sv-SE", { weekday: "short" }).format(date)),
      node("strong", null, String(date.getDate()))
    );
    axis.appendChild(day);
  }

  const todayLine = node("div", "cc-timeline-today-line");
  todayLine.appendChild(node("span", null, "Idag"));
  board.append(axis, tracks, todayLine);

  positioned.forEach((event) => {
    const bar = node("div", `cc-timeline-event cc-timeline-event-${event.kind || "span"}`);
    if (/^#[0-9a-f]{6}$/i.test(event.color || "")) bar.style.setProperty("--cc-event-color", event.color);
    bar.dataset.startIndex = String(event.startIndex);
    bar.dataset.endIndex = String(event.endIndex);
    bar.style.top = `${event.lane * 42 + 10}px`;
    bar.title = event.meta ? `${event.title} — ${event.meta}` : event.title;
    bar.tabIndex = 0;
    bar.setAttribute("role", "button");
    bar.setAttribute("aria-label", bar.title);
    const label = node("div", "cc-timeline-event-label");
    label.append(node("strong", null, event.title), node("span", null, event.meta || ""));
    bar.appendChild(label);
    tracks.appendChild(bar);
  });
  viewport.appendChild(board);
  shell.append(viewport, detail);

  function showEventDetail(bar) {
    tracks.querySelectorAll(".cc-timeline-event").forEach((item) => item.classList.toggle("is-selected", item === bar));
    const eventTitle = bar.querySelector("strong")?.textContent || "";
    const eventMeta = bar.querySelector("span")?.textContent || "";
    detail.innerHTML = "";
    detail.append(node("strong", null, eventTitle), node("span", null, eventMeta || "Ingen ytterligare information"));
    detail.hidden = false;
  }

  tracks.addEventListener("click", (event) => {
    const bar = event.target.closest(".cc-timeline-event");
    if (bar) showEventDetail(bar);
  });
  tracks.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const bar = event.target.closest(".cc-timeline-event");
    if (!bar) return;
    event.preventDefault();
    showEventDetail(bar);
  });

  let dayWidth = 72;
  function updateEventLabels() {
    tracks.querySelectorAll(".cc-timeline-event").forEach((bar) => {
      const label = bar.querySelector(".cc-timeline-event-label");
      const visibleInset = Math.max(10, viewport.scrollLeft - bar.offsetLeft + 10);
      const maxInset = Math.max(10, bar.offsetWidth - label.offsetWidth - 10);
      label.style.transform = `translateX(${Math.min(visibleInset, maxInset)}px)`;
    });
  }

  function applyScale(nextWidth, keepCenter = true) {
    const oldWidth = dayWidth;
    const centerDay = keepCenter
      ? (viewport.scrollLeft + viewport.clientWidth / 2) / oldWidth
      : indexFor(calendar.anchorDate) + .5;
    dayWidth = nextWidth;
    board.style.setProperty("--cc-day-width", `${dayWidth}px`);
    board.style.width = `${totalDays * dayWidth}px`;
    todayLine.style.left = `${(indexFor(calendar.anchorDate) + .5) * dayWidth}px`;
    tracks.querySelectorAll(".cc-timeline-event").forEach((bar) => {
      const startIndex = Number(bar.dataset.startIndex);
      const endIndex = Number(bar.dataset.endIndex);
      bar.style.left = `${startIndex * dayWidth + 4}px`;
      bar.style.width = `${Math.max(dayWidth - 8, (endIndex - startIndex + 1) * dayWidth - 8)}px`;
    });
    viewport.scrollLeft = centerDay * dayWidth - viewport.clientWidth / 2;
    updateEventLabels();
  }

  function centerToday() {
    applyScale(dayWidth, false);
  }

  zoomGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-scale]");
    if (!button) return;
    zoomGroup.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    applyScale(Number(button.dataset.scale));
  });
  todayBtn.addEventListener("click", centerToday);

  let dragging = false;
  let dragStartX = 0;
  let dragStartScroll = 0;
  viewport.addEventListener("pointerdown", (event) => {
    dragging = true;
    dragStartX = event.clientX;
    dragStartScroll = viewport.scrollLeft;
    viewport.classList.add("dragging");
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (dragging) viewport.scrollLeft = dragStartScroll - (event.clientX - dragStartX);
  });
  viewport.addEventListener("pointerup", () => {
    dragging = false;
    viewport.classList.remove("dragging");
  });
  viewport.addEventListener("pointercancel", () => {
    dragging = false;
    viewport.classList.remove("dragging");
  });
  viewport.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      viewport.scrollLeft += event.deltaY;
    }
  }, { passive: false });
  viewport.addEventListener("scroll", updateEventLabels);
  viewport.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      viewport.scrollLeft += event.key === "ArrowLeft" ? -dayWidth : dayWidth;
    }
  });

  requestAnimationFrame(() => {
    applyScale(dayWidth, false);
  });
  return shell;
}

function render(data) {
  const page = node("main", "command-center");
  page.appendChild(renderBrief(data.brief));
  const carriedStatus = data.missionStatus.services.map((service) => ({
    name: service.name,
    level: service.level,
    text: service.text,
    link: service.link,
  }));
  const status = mountStatusCard(node, carriedStatus);
  status.card.classList.add("cc-command-status");
  statusCancel = status.cancel;
  page.appendChild(status.card);
  page.appendChild(renderWeather(data.weather));

  const calendar = card("Kalender", "calendar", {
    className: "cc-calendar",
    action: deepLink("Öppna hela briefen", "#morning-brief"),
  });
  calendar.appendChild(renderTimeline(data.calendar));
  page.appendChild(calendar);

  const focus = card("Dagens fokus", "focus", { className: "cc-focus" });
  focus.appendChild(itemList(data.focus, "Inget kräver din uppmärksamhet just nu."));
  page.appendChild(focus);

  const grid = node("div", "cc-grid");

  const depot = card("Depot 103", "depot", { action: deepLink("Öppna depot", "#portfolio") });
  depot.appendChild(itemList(data.depot.items));

  const marketplace = card("Marketplace", "marketplace");
  marketplace.appendChild(itemList(data.marketplace.items));
  marketplace.appendChild(node("p", "cc-source", "Mockdata · adapter väntar på privata API:er"));

  const expedition = card("Expedition", "expedition", { action: deepLink("Öppna Sarek", "#sarek-gear") });
  expedition.appendChild(itemList(data.expedition.items));

  const veteran = card("Veteran", "veteran");
  veteran.appendChild(itemList(data.veteran.items));
  veteran.appendChild(node("p", "cc-source", "Mockdata · adapter redo för dokumentkälla"));

  const aiInbox = card("AI Inbox", "ai");
  aiInbox.appendChild(itemList(data.aiInbox.items, "AI har inga öppna rekommendationer."));

  [depot, marketplace, expedition, veteran, aiInbox].forEach((section) => grid.appendChild(section));
  page.appendChild(grid);

  const shortcuts = card("Snabblänkar", "links", { className: "cc-shortcuts" });
  const links = node("nav", "cc-pills");
  [
    ["Morning Brief", "#morning-brief"],
    ["Depot 103", "#portfolio"],
    ["Sarek", "#sarek-gear"],
  ].forEach(([label, href]) => links.appendChild(deepLink(label, href)));
  shortcuts.appendChild(links);
  page.appendChild(shortcuts);
  return page;
}

export default {
  id: "command-center",
  navLabel: "Command",
  unmount() {
    clearInterval(clockTimer);
    clockTimer = null;
    statusCancel?.();
    statusCancel = null;
  },
  async mount(container, ctx) {
    const loading = node("div", "cc-loading", "Bygger lägesbild…");
    container.appendChild(loading);
    const data = await loadCommandCenter(ctx);
    container.innerHTML = "";
    container.appendChild(render(data));
  },
};
