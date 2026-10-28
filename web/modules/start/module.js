// Start (2026-10-28): the portal Tor lands on after signing in. Tor Dash
// is the single front door under utiskogen.se -- its passkey sign-in
// (RP ID utiskogen.se, both YubiKeys + Touch ID) is the one every project
// is meant to share. This page lists what lives behind that door: the
// Tor Dash sections themselves, and the external projects from
// shell/project-links.js with an honest note on how each one signs in
// today. Static by design -- no database reads, so it always renders,
// even when something else is down.

import { PROJECTS, ACCESS_LABELS } from "../../shell/project-links.js";

const SECTIONS = [
  { id: "command-center", label: "Command", description: "Läget just nu: väder, kalender och driftstatus." },
  { id: "morning-brief", label: "Brief", description: "Morgonbriefen, ToDo och arkivet." },
  { id: "sarek-gear", label: "Sarek", description: "Packlistan för Sarek med vikter." },
  { id: "portfolio", label: "Portfolio", description: "Portföljen och marknadsläget." },
];

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function sectionCard({ id, label, description }) {
  const a = node("a", "st-card st-card-internal");
  a.href = `#${id}`;
  a.appendChild(node("span", "st-card-title", label));
  a.appendChild(node("span", "st-card-desc", description));
  return a;
}

function projectCard({ label, url, description, access, note }) {
  const a = node("a", "st-card st-card-external");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.setAttribute("aria-label", `${label} (öppnas i ny flik)`);

  const head = node("span", "st-card-head");
  head.appendChild(node("span", "st-card-title", label));
  head.appendChild(node("span", "st-card-arrow", "↗"));
  a.appendChild(head);

  a.appendChild(node("span", "st-card-desc", description));

  const foot = node("span", "st-card-foot");
  foot.appendChild(node("span", `st-badge st-badge-${access}`, ACCESS_LABELS[access] || access));
  if (note) foot.appendChild(node("span", "st-card-note", note));
  a.appendChild(foot);
  return a;
}

export default {
  id: "start",
  navLabel: "Start",

  mount(container) {
    const root = node("div", "st-root");

    const header = node("header", "st-header");
    header.appendChild(node("h1", "st-title headline-font", "Utiskogen"));
    header.appendChild(node("p", "st-lede", "Alla projekt bakom en inloggning."));
    root.appendChild(header);

    root.appendChild(node("h2", "st-section-title", "I Tor Dash"));
    const internal = node("div", "st-grid");
    SECTIONS.forEach((s) => internal.appendChild(sectionCard(s)));
    root.appendChild(internal);

    root.appendChild(node("h2", "st-section-title", "Projekt"));
    const external = node("div", "st-grid");
    PROJECTS.forEach((p) => external.appendChild(projectCard(p)));
    root.appendChild(external);

    container.appendChild(root);
  },
};
