// Log slide-out drawer -- Access Log (modules/access-log/module.js)
// used to be a normal hash-routed nav tab like Brief/Sarek/Portfolio;
// now (2026-07-25) it opens as a drawer instead, same as ToDo, so
// checking it doesn't navigate away from whatever page you're actually
// on. Deliberately NOT registered in modules/manifest.js any more --
// module-registry.js's generic mount/unmount/hash-routing/badge system
// is built for "this replaces the page," which isn't what a drawer is,
// so this file owns the whole (much smaller) lifecycle itself instead of
// bending that shared system to fit a case it wasn't designed for.

const MODULE_JS_URL = new URL("../modules/access-log/module.js", import.meta.url);
const MODULE_CSS_URL = new URL("../modules/access-log/module.css", import.meta.url);

let cssLoaded = false;
function ensureCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MODULE_CSS_URL.href;
  document.head.appendChild(link);
}

export function mountLogDrawer(edgeTabStackEl, ctx) {
  const { el } = ctx;

  const backdrop = el("div", "log-drawer-backdrop");
  const drawer = el("div", "log-drawer");
  const drawerHeader = el("div", "log-drawer-header");
  drawerHeader.appendChild(el("span", "log-drawer-title", "Log"));
  const closeBtn = el("button", "log-drawer-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Stäng Log");
  drawerHeader.appendChild(closeBtn);
  const body = el("div", "log-drawer-body module-access-log");
  drawer.append(drawerHeader, body);

  const tab = el("button", "edge-tab edge-tab-drawer", "Log");
  tab.type = "button";
  tab.setAttribute("aria-label", "Öppna Log");
  const badge = el("span", "nav-badge");
  badge.style.display = "none";
  tab.appendChild(badge);

  let mod = null;
  let mounting = null;

  async function open() {
    drawer.classList.add("open");
    backdrop.classList.add("open");
    badge.style.display = "none"; // opening is what marks the log "seen" (see the module's own getBadgeCount/last-seen)

    // Fresh mount every open -- re-fetches the latest rows, and matches
    // how module-registry.js's own activate() always tears down and
    // remounts a module rather than trying to keep a stale instance
    // alive across visits.
    if (typeof mod?.unmount === "function") {
      try { mod.unmount(body); } catch (e) { console.error("unmount(access-log) failed:", e); }
    }
    body.innerHTML = "";
    if (!mounting) {
      ensureCss();
      mounting = import(MODULE_JS_URL.href).then((m) => { mod = m.default; return mod; });
    }
    try {
      const loadedMod = await mounting;
      await loadedMod.mount(body, ctx);
    } catch (e) {
      console.error("mount(access-log) failed:", e);
      body.innerHTML = "";
      body.appendChild(el("div", "module-error", `This section couldn't load: ${e.message || e}`));
    }
  }
  function close() {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
  }

  tab.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  document.body.append(backdrop, drawer);
  edgeTabStackEl.appendChild(tab);

  // Badge dot up front (unseen rows since last visit), same signal
  // module-registry.js's getBadgeCount system provides for the other
  // modules -- computed independently here since Log isn't part of that
  // registry any more.
  import(MODULE_JS_URL.href).then(async (m) => {
    mod = m.default;
    if (typeof mod.getBadgeCount !== "function") return;
    try {
      const count = await mod.getBadgeCount(ctx);
      if (count > 0) badge.style.display = "";
    } catch (e) {
      console.error("getBadgeCount(access-log) failed:", e);
    }
  });

  return { close };
}
