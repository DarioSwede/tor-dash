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
export function renderItem(item, index) {
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
