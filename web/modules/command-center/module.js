import { loadCommandCenter } from "./adapters.js";

let clockTimer = null;

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

function renderBrief(data) {
  const hero = node("section", "cc-hero");
  const top = node("div", "cc-hero-top");
  const identity = node("div");
  identity.append(
    node("p", "cc-kicker", data.eyebrow || "COMMAND BRIEF"),
    node("h1", null, data.headline)
  );
  const clock = node("div", "cc-clock");
  const time = node("strong");
  const place = node("span", null, "STOCKHOLM");
  clock.append(time, place);
  const tick = () => { time.textContent = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(new Date()); };
  tick();
  clearInterval(clockTimer);
  clockTimer = setInterval(tick, 30000);
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

function renderTimeline(calendar) {
  const shell = node("div", "cc-timeline-shell");
  const controls = node("div", "cc-timeline-controls");
  const zoomGroup = node("div", "cc-timeline-zoom");
  const todayBtn = node("button", "cc-timeline-btn", "Idag");
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

  if (!calendar.anchorDate || !calendar.events.length) {
    shell.appendChild(node("p", "cc-empty", "Tidslinjen fylls när briefen innehåller kalenderhändelser."));
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
    day.append(
      node("span", null, new Intl.DateTimeFormat("sv-SE", { weekday: "short" }).format(date)),
      node("strong", null, String(date.getDate()))
    );
    axis.appendChild(day);
  }

  const todayLine = node("div", "cc-timeline-today-line");
  todayLine.appendChild(node("span", null, "Idag"));
  board.append(axis, tracks, todayLine);

  positioned.forEach((event) => {
    const bar = node("div", `cc-timeline-event cc-timeline-event-${event.kind || "span"}`);
    bar.dataset.startIndex = String(event.startIndex);
    bar.dataset.endIndex = String(event.endIndex);
    bar.style.top = `${event.lane * 42 + 10}px`;
    bar.title = event.meta ? `${event.title} — ${event.meta}` : event.title;
    const label = node("div", "cc-timeline-event-label");
    label.append(node("strong", null, event.title), node("span", null, event.meta || ""));
    bar.appendChild(label);
    tracks.appendChild(bar);
  });
  viewport.appendChild(board);
  shell.appendChild(viewport);

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

  const mission = card("Mission Status", "mission", { action: deepLink("Öppna Brief", "#morning-brief") });
  const missionList = node("div", "cc-service-grid");
  data.missionStatus.forEach((service) => {
    const row = node("div", "cc-service");
    row.append(statusDot(service.level), node("strong", null, service.name), node("span", null, service.text));
    missionList.appendChild(row);
  });
  mission.appendChild(missionList);

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

  [mission, depot, marketplace, expedition, veteran, aiInbox].forEach((section) => grid.appendChild(section));
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
  },
  async mount(container, ctx) {
    const loading = node("div", "cc-loading", "Bygger lägesbild…");
    container.appendChild(loading);
    const data = await loadCommandCenter(ctx);
    container.innerHTML = "";
    container.appendChild(render(data));
  },
};
