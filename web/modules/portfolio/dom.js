// Tiny local DOM helpers for the portfolio module's card renderers.
// Kept local rather than importing shell/dom-utils.js across module
// boundaries (modules receive shared shell helpers via ctx injection,
// not direct imports -- see shell/module-registry.js) -- these two are
// small enough not to be worth threading through every card function's
// signature.

export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

// Wraps a *trusted* HTML/SVG string (chart output from charts.js, never
// concatenated with user-entered text) in a container element. Anything
// the user typed (names, notes, tags) must go through textContent
// instead -- same convention shell/dom-utils.js documents for the rest
// of the app.
export function trustedHtml(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.innerHTML = html;
  return e;
}
