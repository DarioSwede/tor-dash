// Live market data, ported from FortPolio's js/core/market.js almost
// unchanged -- it was already framework-agnostic (no State/DOM
// dependency). Tries Yahoo Finance directly, falls back to two free
// CORS proxies if the direct call is blocked.

const PROXIES = [
  (target) => target,
  (target) => "https://corsproxy.io/?url=" + encodeURIComponent(target),
  (target) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(target),
];

async function fetchWithFallbacks(target, extract) {
  let lastErr;
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(target));
      if (!res.ok) throw new Error("http " + res.status);
      const data = await res.json();
      return extract(data);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("alla försök misslyckades");
}

export async function fetchQuote(symbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  return fetchWithFallbacks(target, (data) => {
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null) throw new Error("inget pris i svar");
    return meta;
  });
}

export async function fetchQuoteWithFallbacks(symbols) {
  for (const sym of symbols) {
    try {
      return { meta: await fetchQuote(sym), symbolUsed: sym };
    } catch {
      // try the next candidate
    }
  }
  throw new Error("alla symboler misslyckades");
}

// Shared fetch loop: skip if no symbol, try to fetch, count ok/fail.
// Sequential (not Promise.all) deliberately -- concurrent calls would
// hit Yahoo/the free CORS proxies harder and increase rate-limit risk.
export async function fetchEach(items, worker, onFail) {
  let ok = 0, fail = 0;
  for (const item of items) {
    if (!item.symbol) continue;
    try {
      await worker(item);
      ok++;
    } catch (e) {
      fail++;
      if (onFail) onFail(item, e);
    }
  }
  return { ok, fail };
}

// Yahoo reports London-listed stocks (e.g. ENQ.L) in pence (currency
// "GBp"/"GBX"), not pounds -- otherwise the price looks 100x too high and
// the % change vs. a GBP-entered cost basis is nonsense. All price data
// should go through this before being stored.
export function normalizeQuote(meta) {
  const isPence = meta.currency === "GBp" || meta.currency === "GBX";
  const divisor = isPence ? 100 : 1;
  const prevRaw = meta.chartPreviousClose ?? meta.previousClose;
  return {
    price: meta.regularMarketPrice != null ? meta.regularMarketPrice / divisor : null,
    prevClose: prevRaw != null ? prevRaw / divisor : null,
    currency: isPence ? "GBP" : meta.currency,
  };
}

export async function fetchHistory(symbol, range = "1mo", interval = "1d") {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  return fetchWithFallbacks(target, (data) => {
    const result = data?.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!closes || !closes.length) throw new Error("ingen historik i svar");
    const isPence = result.meta?.currency === "GBp" || result.meta?.currency === "GBX";
    const divisor = isPence ? 100 : 1;
    return closes.filter((v) => v != null).map((v) => v / divisor);
  });
}

export async function fetchDividendHistory(symbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=div`;
  return fetchWithFallbacks(target, (data) => {
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error("inget svar för symbolen");
    const divs = result.events?.dividends;
    if (!divs) return [];
    return Object.values(divs)
      .map((d) => ({ date: d.date, amount: d.amount }))
      .sort((a, b) => b.date - a.date);
  });
}

export async function fetchDividendCalendar(symbol) {
  const target = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents,summaryDetail`;
  return fetchWithFallbacks(target, (data) => {
    const result = data?.quoteSummary?.result?.[0];
    if (!result) throw new Error("inget svar för symbolen");
    return {
      exDiv: result.calendarEvents?.exDividendDate?.fmt || null,
      payDate: result.calendarEvents?.dividendDate?.fmt || null,
      yieldPct: result.summaryDetail?.dividendYield?.fmt || null,
      rate: result.summaryDetail?.dividendRate?.fmt || null,
    };
  });
}

export function stockholmNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
}

export function exchangeStatus(ex) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: ex.tz }));
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && minutes >= ex.open[0] && minutes < ex.open[1];
  return { isOpen, localTime: now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) };
}
