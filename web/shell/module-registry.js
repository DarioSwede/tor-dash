// Loads every module listed in modules/manifest.js, builds nav from the
// registry, and hash-routes between them. Adding a future module is one
// new folder + one line in manifest.js — nothing here needs to change.
//
// Each module default-exports:
//   { id, navLabel, mount(container, ctx), unmount(container)?, getBadgeCount(ctx)? }
// mount() owns everything inside `container` until unmount() (if present)
// is called on module switch. A module that throws during mount renders
// its own inline error and does not affect nav or other modules.
//
// getBadgeCount(ctx) is optional: if present, it's awaited once at boot
// (for every module, so the nav shows unseen state even before visiting
// a tab) and again right after that specific module's mount() resolves
// (since mounting is usually what marks its own content "seen" and
// should clear its own dot). See modules/access-log/module.js.

import { MODULES, MODULES_BASE_URL } from "../modules/manifest.js";

const registry = new Map(); // id -> module object
const badges = new Map(); // id -> unseen count (0/absent = no dot)
let activeId = null;
let contentEl = null;
let navEl = null;
let ctx = null;
let activationToken = 0; // guards against overlapping activate() calls (see below)

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
  // Returns the loaded module rather than inserting into `registry`
  // itself -- these run in parallel via Promise.allSettled below, and
  // whichever import() happens to resolve first would otherwise decide
  // Map insertion order. Since a Map iterates in insertion order and
  // both nav order and "no hash yet, no preferred id" default both fall
  // back to "the first entry in registry", that meant nav button order
  // (and which tab a fresh sign-in landed on) could silently shuffle
  // between reloads depending on network/parse timing -- inserting
  // every entry in MODULES' own order, after all settle, makes it
  // deterministic.
  return (await import(jsUrl)).default;
}

async function refreshBadge(id, mod) {
  if (typeof mod.getBadgeCount !== "function") return;
  try {
    badges.set(id, await mod.getBadgeCount(ctx));
  } catch (e) {
    console.error(`getBadgeCount(${id}) failed:`, e);
  }
}

function buildNav() {
  navEl.innerHTML = "";
  for (const [id, mod] of registry) {
    const btn = document.createElement("button");
    btn.textContent = mod.navLabel || id;
    btn.dataset.moduleId = id;
    btn.className = id === activeId ? "active" : "";
    if (badges.get(id) > 0) btn.appendChild(document.createElement("span")).className = "nav-badge";
    btn.addEventListener("click", () => {
      if (id !== activeId) location.hash = `#${id}`;
    });
    navEl.appendChild(btn);
  }
}

async function activate(id) {
  const mod = registry.get(id) || registry.values().next().value;
  if (!mod) return;

  // mount() awaits a real network round-trip (a module's own data load), so
  // if the user switches tabs again before that resolves, a second activate()
  // starts running concurrently with the first. The prevMod.unmount() call
  // below runs synchronously at the top of *every* activate() -- including
  // this newer one -- so it always cleans up whatever was still active
  // (even a same-or-different module still mid-mount from an overlapping
  // call), before that older mount() gets a chance to finish and clobber
  // things. Without it, two live instances of the same module could end up
  // fighting over one database row: the older one's delayed autosave firing
  // after the newer one's, silently reverting edits, and its still-attached
  // listeners producing what looks like "dead" buttons. `token` here only
  // guards the catch-block below (skip showing a stale error banner).
  const token = ++activationToken;

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
    if (token !== activationToken) return; // superseded while mount() was failing
    console.error(`mount(${mod.id}) failed:`, e);
    contentEl.innerHTML = "";
    const errEl = document.createElement("div");
    errEl.className = "module-error";
    errEl.textContent = `This section couldn't load: ${e.message || e}`;
    contentEl.appendChild(errEl);
    return;
  }

  if (token === activationToken) {
    // Visiting a module is usually what marks its own content "seen" (see
    // access-log's mount(), which updates its last-seen marker before this
    // runs) -- recompute just this module's badge so its dot clears
    // without waiting for the next full page load.
    await refreshBadge(mod.id, mod);
    if (token === activationToken) buildNav();
  }
}

export async function initModules(navElement, contentElement, sharedCtx, preferredInitialId) {
  navEl = navElement;
  contentEl = contentElement;
  ctx = sharedCtx;

  // Load each module independently — one bad module (a 404, a syntax
  // error) must not take down nav or every other module with it. This is
  // the difference between "one broken module" and "a blank page." The
  // registry itself is still filled in MODULES' order (see loadModule's
  // comment) once every promise has settled, not as each one resolves.
  const results = await Promise.allSettled(MODULES.map(loadModule));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      registry.set(MODULES[i].id, r.value);
    } else {
      console.error(`Failed to load module "${MODULES[i].id}":`, r.reason);
    }
  });

  if (!registry.size) {
    contentEl.innerHTML = "";
    const errEl = document.createElement("div");
    errEl.className = "module-error";
    errEl.textContent = "No sections could be loaded. Check the console for details.";
    contentEl.appendChild(errEl);
    return;
  }

  // Every module's badge up front, in parallel, so the nav shows unseen
  // state even for tabs not visited yet this session -- not just the one
  // that happens to get activated first.
  await Promise.all(Array.from(registry.entries()).map(([id, mod]) => refreshBadge(id, mod)));

  window.addEventListener("hashchange", () => {
    const id = location.hash.replace(/^#/, "");
    activate(registry.has(id) ? id : registry.keys().next().value);
  });

  const hashId = location.hash.replace(/^#/, "");
  const initial = (preferredInitialId && registry.has(preferredInitialId))
    ? preferredInitialId
    : (registry.has(hashId) ? hashId : registry.keys().next().value);
  // Sync the address bar without location.hash's side effect of firing
  // hashchange (which would race a second, redundant activate() against
  // the one below) -- replaceState is silent.
  history.replaceState(null, "", `#${initial}`);
  await activate(initial);
}
