// Start (2026-10-28): the page Tor lands on after signing in. Every link
// -- the Tor Dash sections and the external projects -- lives in the top
// navigation row (shell.css's "Top navigation" block), so this page
// deliberately shows nothing of its own: just the dashboard background.

export default {
  id: "start",
  navLabel: "Start",
  mount(container) {
    container.appendChild(Object.assign(document.createElement("div"), { className: "st-root" }));
  },
};
