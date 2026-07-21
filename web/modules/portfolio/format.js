// Number/text formatting, ported from FortPolio's js/core/format.js.
// hideAmounts is passed in per-call rather than read off a global
// singleton (this module's state lives in module.js's closure, not a
// global State object like the original app).

export function kr(v) {
  return Math.round(v).toLocaleString("sv-SE") + " kr";
}

export function amount(v, hideAmounts) {
  return hideAmounts ? "•••" : kr(v);
}

// Like amount(), but for a currency other than SEK -- "kr" would be
// wrong (and contradictory) on an amount already in e.g. GBP.
export function amountIn(v, curr, hideAmounts) {
  if (hideAmounts) return "•••";
  if (curr === "SEK") return kr(v);
  return Math.round(v).toLocaleString("sv-SE") + " " + curr;
}

export function price(v, curr) {
  const dec = v < 5 ? 4 : 2;
  return v.toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " " + curr;
}

export function pct(cur, prev) {
  if (!prev || prev === 0) return { text: "Ny position", pos: true, raw: 0, flat: true };
  const p = ((cur - prev) / prev) * 100;
  return { text: (p >= 0 ? "+" : "") + p.toFixed(1).replace(".", ",") + "%", pos: p >= 0, raw: p };
}

export function pctShort(p) {
  return (p >= 0 ? "+" : "") + p.toFixed(2).replace(".", ",") + "%";
}

// ISO 3166-1 alpha-2 country code -> flag emoji via Unicode regional
// indicators -- works for any valid two-letter code with no hardcoded table.
export function flag(land) {
  if (!land || land.length !== 2) return "🏳️";
  const points = [...land.toUpperCase()].map((c) => 0x1F1E6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...points);
}

const CURRENCY_SYMBOLS = { SEK: "kr", USD: "$", EUR: "€", GBP: "£", CAD: "$", BTC: "₿" };
export function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || code || "";
}
