// Loads every module listed in modules/manifest.js, builds nav from the
// registry, and hash-routes between them. Adding a future module is one
// new folder + one line in manifest.js — nothing here needs to change.
//
// Each module default-exports:
//   { id, navLabel, mount(container, ctx), unmount(container)? }
// mount() owns everything inside `container` until unmount() (if present)
// is called on module switch. A module that throws during mount renders
// its own inline error and does not affect nav or other modules.

import { MODULES, MODULES_BASE_URL } from "../modules/manifest.js";

const registry = new Map(); // id -> module object
let activeId = null;
let contentEl = null;
let navEl = null;
let ctx = null;

async function loadModule(entry) {
  // Resolved relative to manifest.js's own location, not relative to this
  // file (module-registry.js lives in shell/, one level away from
  // modules/) — dynamic import() otherwise resolves a relative specifier
  // against the *calling* module's URL, which silently 404s here.
  const jsUrl = new URL(entry.path, MODULES_BASE_URL).href;
  if (entry.css) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(entry.css, MODULES_BASE_URL).href;
    document.head.appendChild(link);
  }
  const mod = await import(jsUrl);
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

  // Load each module independently — one bad module (a 404, a syntax
  // error) must not take down nav or every other module with it. This is
  // the difference between "one broken module" and "a blank page."
  const results = await Promise.allSettled(MODULES.map(loadModule));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`Failed to load module "${MODULES[i].id}":`, r.reason);
  });

  if (!registry.size) {
    contentEl.innerHTML = "";
    const errEl = document.createElement("div");
    errEl.className = "module-error";
    errEl.textContent = "No sections could be loaded. Check the console for details.";
    contentEl.appendChild(errEl);
    return;
  }

  window.addEventListener("hashchange", () => {
    const id = location.hash.replace(/^#/, "");
    activate(registry.has(id) ? id : registry.keys().next().value);
  });

  const initial = location.hash.replace(/^#/, "");
  await activate(registry.has(initial) ? initial : registry.keys().next().value);
}
