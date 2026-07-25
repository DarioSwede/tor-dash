// ToDo slide-out drawer -- global shell-level chrome (2026-07-25),
// moved out of the Morning Brief module so it stays reachable from every
// page, not just Brief (a fixed edge tab tied to one module's mount/
// unmount lifecycle would disappear the moment you switched to Sarek or
// Portfolio). Same open/close mechanics as shell.css's #side-nav drawer
// and shell/log-drawer.js's Log drawer: a fixed edge tab toggles a panel
// sliding in from the right, backed by a click-to-close backdrop.

import { mountTodoPanel } from "../modules/todo/module.js";

export function mountTodoDrawer(edgeTabStackEl, ctx) {
  const { el } = ctx;

  const backdrop = el("div", "todo-drawer-backdrop");
  const drawer = el("div", "todo-drawer");
  const drawerHeader = el("div", "todo-drawer-header");
  drawerHeader.appendChild(el("span", "todo-drawer-title", "ToDo"));
  const closeBtn = el("button", "todo-drawer-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Stäng ToDo");
  drawerHeader.appendChild(closeBtn);
  const body = el("div", "todo-drawer-body");
  drawer.append(drawerHeader, body);

  const tab = el("button", "edge-tab edge-tab-drawer", "ToDo");
  tab.type = "button";
  tab.setAttribute("aria-label", "Öppna ToDo");

  function setOpen(open) {
    drawer.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
  }
  tab.addEventListener("click", () => setOpen(true));
  closeBtn.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));

  document.body.append(backdrop, drawer);
  edgeTabStackEl.appendChild(tab);
  mountTodoPanel(body, ctx);

  return { close: () => setOpen(false) };
}
