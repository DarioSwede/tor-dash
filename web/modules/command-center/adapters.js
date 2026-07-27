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

function missionStatus(brief) {
  const rows = brief?.service_status || [];
  if (!rows.length) {
    return [
      { name: "Gmail", level: "unknown", text: "Inväntar nästa brief" },
      { name: "Kalender", level: "unknown", text: "Inväntar nästa brief" },
      { name: "Driftstatus", level: "unknown", text: "Öppna Brief för livekontroll" },
    ];
  }
  return rows.slice(0, 6).map((row) => ({
    name: row.name,
    level: row.level || "unknown",
    text: row.text || "Status saknas",
  }));
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
  const [briefResult, todoResult, portfolioResult, expeditionResult] = await Promise.allSettled([
    latestBrief(ctx), openTodos(ctx), portfolio(ctx), expedition(ctx),
  ]);
  const brief = briefResult.status === "fulfilled" ? briefResult.value : null;
  const todos = todoResult.status === "fulfilled" ? todoResult.value : [];
  const portfolioDoc = portfolioResult.status === "fulfilled" ? portfolioResult.value : null;
  const expeditionData = expeditionResult.status === "fulfilled" ? expeditionResult.value : null;
  const focus = attentionItems(brief, todos);

  return {
    brief: {
      eyebrow: brief ? `${brief.day_name || ""} · ${brief.date_label || brief.forDate || ""}` : "COMMAND BRIEF",
      headline: brief?.headline || "God morgon, Tor. Lägesbilden är redo.",
      updatedAt: brief?.createdAt || null,
      execute: focus.filter((item) => item.level === "execute").length,
      monitor: missionStatus(brief).filter((item) => ["warn", "unknown"].includes(item.level)).length,
      opportunity: MOCK.marketplace.items.filter((item) => item.level === "opportunity").length,
    },
    focus,
    missionStatus: missionStatus(brief),
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
