// Generic DOM builders shared by every module. Text always goes through
// textContent (never innerHTML) — the only exception anywhere in the app
// is the isSafeSvg-gated drawing string in the Morning Brief module.

export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

// Renders one numbered {title, url?, sentence, button?} row — the shape
// used by "needs attention" / "resolved" / custom section lists. Reusable
// by any future module that wants the same numbered-list look.
//
// Collapsed by default: only the title shows, so a long list of items
// reads as a compact stack of headlines. Clicking/tapping the title (or
// Enter/Space when it has focus) reveals the sentence and any button
// underneath it. A source URL is a separate small "↗" affordance next to
// the title text, not the title itself, so opening the source and
// expanding the detail don't fight over the same click.
export function renderItem(item, index) {
  const row = el("div", "item");
  row.appendChild(el("div", "item-num", String(index + 1)));

  const body = el("div", "item-body");

  const title = document.createElement("div");
  title.className = "item-title";
  title.setAttribute("role", "button");
  title.setAttribute("tabindex", "0");
  title.setAttribute("aria-expanded", "false");

  title.appendChild(el("span", "item-title-text", item.title));

  if (item.url) {
    const link = document.createElement("a");
    link.className = "item-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "↗";
    link.title = "Öppna källa i ny flik";
    link.setAttribute("aria-label", "Öppna källa i ny flik");
    link.addEventListener("click", (e) => e.stopPropagation());
    title.appendChild(link);
  }

  function toggle() {
    const expanded = row.classList.toggle("expanded");
    title.setAttribute("aria-expanded", String(expanded));
  }
  title.addEventListener("click", toggle);
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  body.appendChild(title);

  const detail = el("div", "item-detail");
  const detailInner = el("div", "item-detail-inner");
  detailInner.appendChild(el("p", "item-sentence", item.sentence));

  if (item.button && item.button.label && item.button.href) {
    const btn = document.createElement("a");
    btn.className = "btn";
    btn.href = item.button.href;
    btn.target = "_blank";
    btn.rel = "noopener noreferrer";
    btn.textContent = item.button.label;
    detailInner.appendChild(btn);
  }
  detail.appendChild(detailInner);
  body.appendChild(detail);

  row.appendChild(body);
  return row;
}
