// Defense-in-depth allowlist gate for any module that renders an
// AI-generated SVG string via innerHTML (currently only the Morning Brief
// module's terrain drawing). The string is meant to be pure geometry
// written by a scheduled task, never raw calendar/email text — but that
// task's reasoning processes untrusted third-party content to produce it,
// so a prompt-injection or generation bug could in principle smuggle
// something unsafe into the one field any module renders via innerHTML.
// Unrecognized tags, event-handler attributes, hrefs, or embedded
// scripts/comments make the caller skip rendering rather than trust it
// blindly. scripts/push_snapshot.py has an identical is_safe_svg() as a
// second layer, so unsafe SVG is rejected before it's even written.

const SVG_ALLOWED_TAGS = new Set([
  "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon",
  "rect", "text", "tspan", "defs", "lineargradient", "radialgradient", "stop",
]);

export function isSafeSvg(svg) {
  if (typeof svg !== "string" || svg.length > 20000) return false;
  if (!/^\s*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return false;
  if (/<!--|<!\[CDATA\[|<\?/.test(svg)) return false;
  const tags = svg.match(/<\/?([a-zA-Z][\w:-]*)/g) || [];
  for (const t of tags) {
    if (!SVG_ALLOWED_TAGS.has(t.replace(/^<\/?/, "").toLowerCase())) return false;
  }
  if (/\son[a-z]+\s*=/i.test(svg)) return false;
  if (/\bhref\s*=/i.test(svg)) return false;
  if (/javascript:/i.test(svg)) return false;
  return true;
}
