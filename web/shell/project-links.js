// Tor's projects outside Tor Dash, shown as plain name-only buttons in the
// top navigation row after the Tor Dash sections (see shell.css's "Top
// navigation" block). Adding or moving a project is one line here.
//
// Every external link opens in a new tab: the other projects keep their
// own session, so leaving Tor Dash in place avoids losing this one.
// Fyndindex, Omvärld and Ljusarkiv's admin still have their own sign-in
// until they move under utiskogen.se.

export const PROJECTS = [
  { id: "packlista", label: "Packlista", url: "https://packlista.utiskogen.se/" },
  { id: "fyndindex", label: "Fyndindex", url: "https://darioswede.github.io/fyndindex/" },
  { id: "omvarld", label: "Omvärld", url: "https://omvarld.torbjornzimmerman.se/" },
  { id: "ljusarkiv", label: "Ljusarkiv", url: "https://galleri.torbjornzimmerman.se/" },
];

export function mountProjectLinks(container) {
  if (!container || container.dataset.mounted === "1") return;
  container.dataset.mounted = "1";

  const sep = document.createElement("span");
  sep.className = "project-bar-sep";
  sep.setAttribute("aria-hidden", "true");
  container.appendChild(sep);

  for (const { label, url } of PROJECTS) {
    const a = document.createElement("a");
    a.className = "project-bar-link";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    a.setAttribute("aria-label", `${label} (öppnas i ny flik)`);
    container.appendChild(a);
  }

  // Sign-out sits last in the row, pushed to the far right (2026-10-28).
  // Moved, not cloned, so auth.js's existing click wiring still applies.
  const signout = document.getElementById("signout-btn");
  if (signout) container.appendChild(signout);
}
