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
    focus: "⌁", mission: "◉", depot: "↗", marketplace: "◇",
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

function render(data) {
  const page = node("main", "command-center");
  page.appendChild(renderBrief(data.brief));

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
