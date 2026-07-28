// Command Center data boundary.
//
// The view only consumes the normalized shape returned by loadCommandCenter().
// Replace a mock adapter below when a private API becomes available; no layout
// code needs to change. Existing Supabase data is always preferred and every
// adapter fails soft so one unavailable source cannot blank the dashboard.

const MOCK = {
  marketplace: {
    source: "mock",
    items: [
      { title: "Tradera-bevakningar", meta: "3 objekt slutar idag", level: "opportunity" },
      { title: "Paket & leveranser", meta: "Ingen verifierad datakälla", level: "neutral" },
    ],
  },
  veteran: {
    source: "mock",
    items: [
      { title: "Veteranprojekt", meta: "Nästa milstolpe saknar datakälla", level: "neutral" },
      { title: "Dokument & sponsorer", meta: "Adapter redo för Drive eller Notion", level: "neutral" },
    ],
  },
  aiInbox: {
    source: "derived",
    items: [
      { title: "Koppla privata datakällor", meta: "Marketplace och Veteran visar mockdata", level: "monitor" },
    ],
  },
};

function localDateIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentDateLabel(date = new Date()) {
  const label = new Intl.DateTimeFormat("sv-SE", {
    weekday: "long", day: "numeric", month: "long",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function isDateInRange(date, start, end) {
  return Boolean(start && end && date >= start && date <= end);
}

function buildDailyHeadline(calendar, focus = []) {
  const today = calendar.anchorDate || localDateIso();
  const activeVacation = calendar.events.find((event) =>
    /semester|ledig|vacation/i.test(`${event.title || ""} ${event.meta || ""}`)
    && isDateInRange(today, event.start, event.end)
  );
  if (activeVacation) return "Semestern är igång — njut av ledigheten.";

  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = localDateIso(tomorrow);
  const vacationTomorrow = calendar.events.some((event) =>
    /semester|ledig|vacation/i.test(`${event.title || ""} ${event.meta || ""}`)
    && event.start === tomorrowIso
  );
  if (vacationTomorrow) return "Semestern börjar imorgon — varva ner.";

  if (focus.length) return `${focus.length} ${focus.length === 1 ? "sak" : "saker"} behöver din uppmärksamhet idag.`;
  return "Dagens lägesbild är uppdaterad.";
}

async function latestBrief(ctx) {
  const { data, error } = await ctx.supabase
    .from("briefing_snapshots")
    .select("payload, payload_encrypted, for_date, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  let payload = data.payload;
  if (!payload && data.payload_encrypted) payload = await ctx.decryptPayload(data.payload_encrypted);
  return payload ? { ...payload, createdAt: data.created_at, forDate: data.for_date } : null;
}

async function openTodos(ctx) {
  const { data, error } = await ctx.supabase
    .from("todos")
    .select("id, text, needs_claude, claude_status, created_at")
    .eq("done", false)
    .order("created_at", { ascending: true })
    .limit(6);
  return error ? [] : (data || []);
}

async function portfolio(ctx) {
  const { data, error } = await ctx.supabase.from("portfolio").select("data").limit(1).maybeSingle();
  if (error || !data?.data) return null;
  const doc = data.data;
  return {
    stocks: doc.stocks || [],
    funds: doc.funds || [],
    watchlist: doc.watchlist || [],
    alerts: doc.priceAlerts || {},
  };
}

async function expedition(ctx) {
  const { data, error } = await ctx.supabase.from("sarek_packlist").select("data, updated_at").limit(1).maybeSingle();
  if (error || !data?.data) return null;
  const items = Array.isArray(data.data) ? data.data : (data.data.items || []);
  const packed = items.filter((item) => item.packed || item.done || item.checked || item.owned).length;
  return { packed, total: items.length, updatedAt: data.updated_at };
}

async function calendarFeeds(ctx) {
  const { data, error } = await ctx.supabase
    .from("calendar_snapshots")
    .select("payload_encrypted, created_at")
    .maybeSingle();
  if (error || !data?.payload_encrypted) return [];
  const payload = await ctx.decryptPayload(data.payload_encrypted);
  if (!Array.isArray(payload?.events)) return [];
  return payload.events.map((event) => {
      const time = event.all_day ? null : new Intl.DateTimeFormat("sv-SE", {
        hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm",
      }).format(new Date(event.start_at));
      return {
        uid: `mac:${event.external_id}`,
        title: event.title,
        meta: [time, event.location, event.calendar_name].filter(Boolean).join(" · "),
        start: event.start_date,
        end: event.end_date,
        kind: event.all_day || event.end_date !== event.start_date ? "span" : "calendar",
        calendar: event.calendar_name,
        color: event.color,
        source: "mac",
      };
    }).filter((event) => event?.title && event?.start && event?.end);
}

async function statusHistory(ctx) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ctx.supabase
    .from("service_status_checks")
    .select("service_key, name, category, priority, level, verified, text, method, response_ms, checked_at, details")
    .gte("checked_at", since)
    .order("checked_at", { ascending: false })
    .limit(500);
  return error ? [] : (data || []);
}

function attentionItems(brief, todos) {
  const fromBrief = (brief?.needs_attention || []).slice(0, 3).map((item) => ({
    title: item.title,
    meta: item.sentence || "Kräver uppmärksamhet",
    level: "execute",
  }));
  const fromTodos = todos.slice(0, Math.max(0, 4 - fromBrief.length)).map((todo) => ({
    title: todo.text,
    meta: todo.needs_claude ? "Överlämnad till AI" : "Öppen uppgift",
    level: todo.needs_claude ? "monitor" : "execute",
  }));
  return [...fromBrief, ...fromTodos];
}

function calendarSummary(brief, feedEvents = []) {
  if (!brief && !feedEvents.length) return { acts: [], context: [], tomorrow: null, events: [], anchorDate: localDateIso() };

  // "Today" belongs to the device clock, not to the newest snapshot. A
  // delayed brief must never move the red today-line backwards in time.
  const anchorDate = localDateIso();
  const briefDate = brief?.forDate || brief?.createdAt?.slice(0, 10) || anchorDate;
  const briefAnchor = new Date(`${briefDate}T12:00:00`);
  const iso = (date) => date.toISOString().slice(0, 10);
  const shift = (days) => {
    const date = new Date(briefAnchor);
    date.setDate(date.getDate() + days);
    return iso(date);
  };

  const MONTHS = {
    januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5,
    juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11,
  };
  function parseSwedishRange(text) {
    const match = String(text || "").toLowerCase().match(
      /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[–-]\s*(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/
    );
    if (!match) return null;
    let startYear = briefAnchor.getFullYear();
    let endYear = startYear;
    const startMonth = MONTHS[match[2]];
    const endMonth = MONTHS[match[4]];
    if (endMonth < startMonth) endYear += 1;
    return {
      start: iso(new Date(startYear, startMonth, Number(match[1]), 12)),
      end: iso(new Date(endYear, endMonth, Number(match[3]), 12)),
    };
  }

  const acts = (brief?.acts || []).map((act) => ({
    time: act.time || "Idag",
    note: act.note || "",
  }));

  // Multi-day events such as vacations are deliberately stored in a
  // plain "Bakgrund" section by the brief producer. Calendar-specific
  // sections are accepted too so the adapter remains useful if the
  // producer later starts naming the section more explicitly.
  const context = (brief?.sections || [])
    .filter((section) => /bakgrund|kalender|schema/i.test(section.heading || ""))
    .flatMap((section) => (section.items || []).map((item) => ({
      title: item.title || section.heading || "Kalender",
      meta: item.sentence || "",
      source: section.source || null,
      start: item.start_date || item.start || null,
      end: item.end_date || item.end || null,
    })));

  const events = [
    ...context.map((item) => {
      const parsed = parseSwedishRange(item.meta);
      return {
        title: item.title,
        meta: item.meta,
        start: item.start || parsed?.start || briefDate,
        end: item.end || parsed?.end || item.start || parsed?.start || briefDate,
        kind: "span",
      };
    }),
    ...acts.filter((act) => act.note).map((act) => ({
      title: act.time,
      meta: act.note,
      start: briefDate,
      end: briefDate,
      kind: "today",
    })),
  ];
  if (brief?.tomorrow_line) {
    events.push({ title: "Imorgon", meta: brief.tomorrow_line, start: shift(1), end: shift(1), kind: "future" });
  }

  const seen = new Set();
  const mergedEvents = [...feedEvents, ...events].filter((event) => {
    const key = event.uid || `${String(event.title).toLowerCase()}|${event.start}|${event.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    acts,
    context,
    tomorrow: brief?.tomorrow_line || null,
    events: mergedEvents,
    anchorDate,
    briefDate,
    isStale: briefDate !== anchorDate,
  };
}

function missionStatus(brief, history = []) {
  const rows = brief?.service_status || [];
  const groups = new Map();
  history.forEach((row) => {
    const key = row.service_key || String(row.name || "").toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const carried = new Map(rows.map((row) => [row.service_key || String(row.name || "").toLowerCase().split(" ")[0], row]));
  const definitions = [
    { key: "gmail", name: "Gmail", category: "Kommunikation", priority: 5 },
    { key: "loopia", name: "Loopia mail", category: "Kommunikation", priority: 5 },
    { key: "telia", name: "Telia", category: "Anslutning", priority: 4 },
  ];
  const services = definitions.map((definition) => {
    const checks = groups.get(definition.key) || [];
    const latest = checks[0] || carried.get(definition.key) || {};
    const lastSuccess = checks.find((item) => item.verified && item.level === "ok")?.checked_at || null;
    return {
      ...definition,
      level: ["ok", "warn", "down", "unknown"].includes(latest.level) ? latest.level : "unknown",
      verified: latest.verified ?? (latest.level && latest.level !== "unknown"),
      text: latest.text || "Ingen verifierad kontroll ännu",
      method: latest.method || "Väntar på nästa statuskörning",
      responseMs: latest.response_ms ?? null,
      checkedAt: latest.checked_at || brief?.createdAt || null,
      lastSuccess,
      link: latest.link || latest.details?.link || null,
      history: checks.slice().reverse().map((item) => ({
        level: item.level,
        verified: item.verified,
        checkedAt: item.checked_at,
      })),
    };
  });

  const verifiedServices = services.filter((item) => item.verified);
  const weights = verifiedServices.reduce((sum, item) => sum + item.priority, 0);
  const points = { ok: 100, warn: 60, down: 0, unknown: 50 };
  const score = weights
    ? Math.round(verifiedServices.reduce((sum, item) => sum + points[item.level] * item.priority, 0) / weights)
    : null;
  return {
    score,
    verifiedCount: verifiedServices.length,
    services,
  };
}

function depotSummary(doc) {
  if (!doc) return { source: "unavailable", items: [] };
  const alertCount = Object.values(doc.alerts).filter(Boolean).length;
  return {
    source: "supabase",
    items: [
      { title: "Innehav", meta: `${doc.stocks.length} aktier · ${doc.funds.length} fonder`, level: "neutral" },
      { title: "Bevakning", meta: `${doc.watchlist.length} bolag · ${alertCount} prisvarningar`, level: alertCount ? "monitor" : "neutral" },
    ],
  };
}

function expeditionSummary(data) {
  if (!data) return { source: "unavailable", items: [] };
  const remaining = Math.max(0, data.total - data.packed);
  return {
    source: "supabase",
    items: [
      { title: "Sarek packlista", meta: data.total ? `${data.packed}/${data.total} klara · ${remaining} återstår` : "Listan är tom", level: remaining ? "monitor" : "ok" },
    ],
  };
}

export async function loadCommandCenter(ctx) {
  const [briefResult, todoResult, portfolioResult, expeditionResult, calendarResult, statusResult] = await Promise.allSettled([
    latestBrief(ctx), openTodos(ctx), portfolio(ctx), expedition(ctx), calendarFeeds(ctx), statusHistory(ctx),
  ]);
  const brief = briefResult.status === "fulfilled" ? briefResult.value : null;
  const todos = todoResult.status === "fulfilled" ? todoResult.value : [];
  const portfolioDoc = portfolioResult.status === "fulfilled" ? portfolioResult.value : null;
  const expeditionData = expeditionResult.status === "fulfilled" ? expeditionResult.value : null;
  const feedEvents = calendarResult.status === "fulfilled" ? calendarResult.value : [];
  const statusRows = statusResult.status === "fulfilled" ? statusResult.value : [];
  const todayLabel = currentDateLabel();
  const briefDate = brief?.forDate || brief?.createdAt?.slice(0, 10) || null;
  const isFresh = briefDate === localDateIso();
  const currentBrief = isFresh ? brief : null;
  const focus = attentionItems(currentBrief, todos);
  const calendar = calendarSummary(currentBrief, feedEvents);
  const mission = missionStatus(currentBrief, statusRows);
  const staleSuffix = briefDate && briefDate !== localDateIso()
    ? ` · Livekalender · Brief ${new Intl.DateTimeFormat("sv-SE", {
      day: "numeric", month: "long",
    }).format(new Date(`${briefDate}T12:00:00`))}`
    : "";

  return {
    brief: {
      eyebrow: `${todayLabel}${staleSuffix}`,
      headline: isFresh && brief?.headline ? brief.headline : buildDailyHeadline(calendar, focus),
      updatedAt: brief?.createdAt || null,
      execute: focus.filter((item) => item.level === "execute").length,
      monitor: mission.services.filter((item) => ["warn", "down"].includes(item.level)).length,
      opportunity: MOCK.marketplace.items.filter((item) => item.level === "opportunity").length,
    },
    calendar,
    focus,
    missionStatus: mission,
    depot: depotSummary(portfolioDoc),
    marketplace: MOCK.marketplace,
    expedition: expeditionSummary(expeditionData),
    veteran: MOCK.veteran,
    aiInbox: {
      ...MOCK.aiInbox,
      items: [
        ...todos.filter((todo) => todo.claude_status === "requested").slice(0, 2).map((todo) => ({
          title: todo.text, meta: "AI arbetar med uppgiften", level: "monitor",
        })),
        ...MOCK.aiInbox.items,
      ],
    },
  };
}

export { MOCK };
