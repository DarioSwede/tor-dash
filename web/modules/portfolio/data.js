// Static reference data ported from FortPolio's js/data.js -- none of
// this is sensitive (commodity/exchange/index lists, not your holdings),
// so it lives in the module bundle rather than the portfolio table.

export const COMMODITIES = [
  { id: "c0", name: "Guld", symbol: "GC=F", unit: "USD/oz" },
  { id: "c1", name: "Silver", symbol: "SI=F", unit: "USD/oz" },
  { id: "c2", name: "Platina", symbol: "PL=F", unit: "USD/oz" },
  { id: "c3", name: "Koppar", symbol: "HG=F", unit: "USD/lb" },
  { id: "c4", name: "Olja (WTI)", symbol: "CL=F", unit: "USD/fat" },
  { id: "c5", name: "Naturgas", symbol: "NG=F", unit: "USD/MMBtu" },
];

// open/close are minutes from midnight, local time.
export const EXCHANGES = [
  { name: "Stockholm (OMX)", tz: "Europe/Stockholm", open: [540, 1050], flag: "🇸🇪", lat: 59.33, lon: 18.07 },
  { name: "London (LSE)", tz: "Europe/London", open: [480, 990], flag: "🇬🇧", lat: 51.51, lon: -0.13 },
  { name: "Frankfurt (DAX)", tz: "Europe/Berlin", open: [540, 1050], flag: "🇩🇪", lat: 50.11, lon: 8.68 },
  { name: "New York (NYSE)", tz: "America/New_York", open: [570, 960], flag: "🇺🇸", lat: 40.71, lon: -74.01 },
  { name: "Toronto (TSX)", tz: "America/Toronto", open: [570, 960], flag: "🇨🇦", lat: 43.65, lon: -79.38 },
  { name: "São Paulo (B3)", tz: "America/Sao_Paulo", open: [600, 1020], flag: "🇧🇷", lat: -23.55, lon: -46.63 },
  { name: "Johannesburg (JSE)", tz: "Africa/Johannesburg", open: [540, 1020], flag: "🇿🇦", lat: -26.20, lon: 28.05 },
  { name: "Mumbai (BSE)", tz: "Asia/Kolkata", open: [555, 930], flag: "🇮🇳", lat: 19.08, lon: 72.88 },
  { name: "Shanghai (SSE)", tz: "Asia/Shanghai", open: [570, 900], flag: "🇨🇳", lat: 31.23, lon: 121.47 },
  { name: "Hong Kong (HKEX)", tz: "Asia/Hong_Kong", open: [570, 960], flag: "🇭🇰", lat: 22.32, lon: 114.17 },
  { name: "Tokyo (Nikkei)", tz: "Asia/Tokyo", open: [540, 900], flag: "🇯🇵", lat: 35.68, lon: 139.69 },
  { name: "Sydney (ASX)", tz: "Australia/Sydney", open: [600, 960], flag: "🇦🇺", lat: -33.87, lon: 151.21 },
];

export const OMX_CANDIDATES = ["^OMX", "OMXS30.ST", "^OMXS30"];

// OMX Stockholm 30 rebalances twice a year (jan/jul) -- this list is a
// well-founded but not guaranteed-current snapshot; check against
// nasdaqomxnordic.com occasionally and edit the list here if needed.
export const OMXS30_LIST = [
  { name: "ABB", symbol: "ABB.ST" },
  { name: "Alfa Laval", symbol: "ALFA.ST" },
  { name: "Assa Abloy B", symbol: "ASSA-B.ST" },
  { name: "AstraZeneca", symbol: "AZN.ST" },
  { name: "Atlas Copco A", symbol: "ATCO-A.ST" },
  { name: "Atlas Copco B", symbol: "ATCO-B.ST" },
  { name: "Boliden", symbol: "BOL.ST" },
  { name: "Electrolux B", symbol: "ELUX-B.ST" },
  { name: "Ericsson B", symbol: "ERIC-B.ST" },
  { name: "Essity B", symbol: "ESSITY-B.ST" },
  { name: "Evolution", symbol: "EVO.ST" },
  { name: "Getinge B", symbol: "GETI-B.ST" },
  { name: "Hennes & Mauritz B", symbol: "HM-B.ST" },
  { name: "Hexagon B", symbol: "HEXA-B.ST" },
  { name: "Investor B", symbol: "INVE-B.ST" },
  { name: "Nordea Bank", symbol: "NDA-SE.ST" },
  { name: "Sandvik", symbol: "SAND.ST" },
  { name: "SCA B", symbol: "SCA-B.ST" },
  { name: "SEB A", symbol: "SEB-A.ST" },
  { name: "Skanska B", symbol: "SKA-B.ST" },
  { name: "SKF B", symbol: "SKF-B.ST" },
  { name: "SSAB B", symbol: "SSAB-B.ST" },
  { name: "Swedbank A", symbol: "SWED-A.ST" },
  { name: "Telia Company", symbol: "TELIA.ST" },
  { name: "Volvo B", symbol: "VOLV-B.ST" },
  { name: "Epiroc A", symbol: "EPI-A.ST" },
  { name: "EQT", symbol: "EQT.ST" },
  { name: "Addtech B", symbol: "ADDT-B.ST" },
];

// Currencies against SEK (bitcoin in USD). code is the currency the
// quote comes back in -- used to show SEK's own value against it
// (1 SEK in USD/GBP/EUR) rather than the other way round.
export const DEFAULT_CURRENCIES = [
  { id: "cur0", name: "Dollar", symbol: "USDSEK=X", unit: "SEK", code: "USD" },
  { id: "cur1", name: "Pund", symbol: "GBPSEK=X", unit: "SEK", code: "GBP" },
  { id: "cur2", name: "Euro", symbol: "EURSEK=X", unit: "SEK", code: "EUR" },
  { id: "cur3", name: "Bitcoin", symbol: "BTC-USD", unit: "USD", code: null },
];
