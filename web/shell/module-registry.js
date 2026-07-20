// Loads every module listed in modules/manifest.js, builds nav from the
// registry, and hash-routes between them. Adding a future module is one
// new folder + one line in manifest.js — nothing here needs to change.
//
// Each module default-exports:
//   { id, navLabel, mount(container, ctx), unmount(container)? }
// mount() owns everything inside `container` until unmount() (if present)
// is called on module switch. A module that throws during mount renders
// its own inline error and does not affect nav or other modules.

import { MODULES } from "../modules/manifest.js";

const registry = new Map(); // id -> module object
let activeId = null;
let contentEl = null;
let navEl = null;
let ctx = null;

async function loadModule(entry) {
  if (entry.css) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = entry.css;
    document.head.appendChild(link);
  }
  const mod = await import(entry.path);
  registry.set(entry.id, mod.default);
}

function buildNav() {
  navEl.innerHTML = "";
  for (const [id, mod] of registry) {
    const btn = document.createElement("button");
    btn.textContent = mod.navLabel || id;
    btn.dataset.moduleId = id;
    btn.className = id === activeId ? "active" : "";
    btn.addEventListener("click", () => {
      if (id !== activeId) location.hash = `#${id}`;
    });
    navEl.appendChild(btn);
  }
}

async function activate(id) {
  const mod = registry.get(id) || registry.values().next().value;
  if (!mod) return;

  const prevId = activeId;
  const prevMod = prevId ? registry.get(prevId) : null;
  if (prevMod && typeof prevMod.unmount === "function") {
    try { prevMod.unmount(contentEl); } catch (e) { console.error(`unmount(${prevId}) failed:`, e); }
  }

  activeId = mod.id;
  contentEl.className = `module-${mod.id}`;
  contentEl.innerHTML = "";
  buildNav();

  try {
    await mod.mount(contentEl, ctx);
  } catch (e) {
    console.error(`mount(${mod.id}) failed:`, e);
    contentEl.innerHTML = "";
    const errEl = document.createElement("div");
    errEl.className = "module-error";
    errEl.textContent = `This section couldn't load: ${e.message || e}`;
    contentEl.appendChild(errEl);
  }
}

export async function initModules(navElement, contentElement, sharedCtx) {
  navEl = navElement;
  contentEl = contentElement;
  ctx = sharedCtx;

  await Promise.all(MODULES.map(loadModule));

  window.addEventListener("hashchange", () => {
    const id = location.hash.replace(/^#/, "");
    activate(registry.has(id) ? id : registry.keys().next().value);
  });

  const initial = location.hash.replace(/^#/, "");
  await activate(registry.has(initial) ? initial : registry.keys().next().value);
}
