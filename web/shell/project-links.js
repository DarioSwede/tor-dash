// Tor's projects outside Tor Dash -- one list shared by the slim project
// bar under the top bar (mountProjectLinks) and the Start portal module
// (modules/start). Adding or moving a project is one entry here.
//
// `access` describes how sign-in relates to Tor Dash today, so the portal
// can say honestly which projects already accept the same YubiKey and
// which still have their own login until they move under utiskogen.se:
//   "shared"   -- same Supabase project and passkey domain (utiskogen.se)
//   "separate" -- its own sign-in for now; planned to move under utiskogen.se
//   "public"   -- publicly viewable, with a separately protected admin part
//
// Every link opens in a new tab: the other projects keep their own
// session, so leaving Tor Dash in place avoids losing this one. The
// project bar is deliberately a sibling of .top-bar rather than a cell
// inside it -- that grid has a long history of reflow collisions (see
// shell.css).

export const PROJECTS = [
  {
    id: "packlista",
    label: "Packlista",
    url: "https://packlista.utiskogen.se/",
    description: "Den fristående packlisteappen, med egna konton för andra användare.",
    access: "shared",
  },
  {
    id: "fyndindex",
    label: "Fyndindex",
    url: "https://darioswede.github.io/fyndindex/",
    description: "Bevakning av andrahandsmarknaden.",
    access: "separate",
    note: "Ligger kvar på github.io, så YubiKeyn fungerar inte där ännu.",
  },
  {
    id: "omvarld",
    label: "Omvärld",
    url: "https://omvarld.torbjornzimmerman.se/",
    description: "Säkerhetscentralen: hotbild, polishändelser och karta.",
    access: "separate",
    note: "Egen inloggning tills flytten till utiskogen.se.",
  },
  {
    id: "ljusarkiv",
    label: "Ljusarkiv",
    url: "https://galleri.torbjornzimmerman.se/",
    description: "Fotogalleriet. Galleriet är publikt, administrationen krypterad.",
    access: "public",
    note: "Admindelen har egen inloggning.",
  },
];

export const ACCESS_LABELS = {
  shared: "Samma YubiKey",
  separate: "Egen inloggning",
  public: "Publikt + admin",
};

export function mountProjectLinks(container) {
  if (!container || container.dataset.mounted === "1") return;
  container.dataset.mounted = "1";

  const start = document.createElement("a");
  start.className = "project-bar-link project-bar-home";
  start.href = "#start";
  start.textContent = "Start";
  container.appendChild(start);

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
