// Small inline SVG sparklines/bars, ported from FortPolio's
// js/core/charts.js unchanged -- no external charting library, just a
// polyline normalized into a small box.

export function sparkline(values, { width = 72, height = 24, color = "var(--pf-gain)", strokeWidth = 1.5, responsive = false } = {}) {
  const clean = values.filter((v) => typeof v === "number" && !isNaN(v));
  if (clean.length < 2) {
    return `<svg width="${responsive ? "100%" : width}" height="${height}" class="pf-sparkline pf-sparkline-empty"></svg>`;
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = (max - min) || 1;
  const stepX = width / (clean.length - 1);
  const pad = strokeWidth;
  const points = clean.map((v, i) => {
    const x = i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const svgWidth = responsive ? "100%" : width;
  return `<svg width="${svgWidth}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="pf-sparkline">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// Just the bar itself (no legend) -- for callers building their own
// legend, e.g. with target-deviation dots.
export function barOnly(entries, { height = 8 } = {}) {
  const total = entries.reduce((s, e) => s + e.val, 0) || 1;
  const segs = entries.map((e) => `<span style="flex:${Math.max(e.val / total, 0.001)}; background:${e.color};"></span>`).join("");
  return `<div class="pf-percent-bar" style="height:${height}px;">${segs}</div>`;
}

// Compact horizontal distribution bar -- replaces a pie+legend when
// there's only room for one row. entries: [{label, val, color}].
export function percentBar(entries, opts = {}) {
  const total = entries.reduce((s, e) => s + e.val, 0) || 1;
  const legend = entries.map((e) => {
    const p = (e.val / total) * 100;
    return `<span class="pf-bar-legend-item"><span class="pf-dot" style="background:${e.color}"></span>${e.label} <b>${p.toFixed(0)}%</b></span>`;
  }).join("");
  return `${barOnly(entries, opts)}<div class="pf-bar-legend">${legend}</div>`;
}
