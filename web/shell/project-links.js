// Projektrad (2026-10-28): a slim strip under the top bar linking out to
// Tor's other projects. Deliberately a sibling of .top-bar rather than a
// cell inside it -- that grid has a long history of reflow collisions
// (see shell.css), and these links must stay reachable on every screen.
//
// Every entry opens in a new tab: the other projects have their own
// sign-in (Omvärld is not on the shared Supabase auth), so leaving Tor
// Dash in place avoids losing this session. Adding or changing a project
// is one line in PROJECTS below.

const PROJECTS = [
  { label: "Packlista", url: "https://packlista.utiskogen.se/" },
  { label: "Fyndindex", url: "https://darioswede.github.io/fyndindex/" },
  { label: "Omvärld", url: "https://omvarld.torbjornzimmerman.se/" },
  { label: "Ljusarkiv", url: "https://galleri.torbjornzimmerman.se/" },
];

export function mountProjectLinks(container) {
  if (!container || container.dataset.mounted === "1") return;
  container.dataset.mounted = "1";

  const heading = document.createElement("span");
  heading.className = "project-bar-label";
  heading.textContent = "Projekt";
  container.appendChild(heading);

  for (const { label, url } of PROJECTS) {
    const a = document.createElement("a");
    a.className = "project-bar-link";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = " ↗";
    a.appendChild(arrow);
    a.setAttribute("aria-label", `${label} (öppnas i ny flik)`);
    container.appendChild(a);
  }
}
