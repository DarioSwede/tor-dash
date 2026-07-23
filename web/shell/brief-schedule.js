// User-configurable window/cadence for the automated morning-brief
// refresh (see the "tor-dash brief refresh" Claude Routine, set up
// outside this repo — this file only owns the setting it reads at each
// firing). Stored in dashboard_settings (owner-only, same table/pattern
// as dashboard-background.js's background/top_bar_layout keys) rather
// than a dedicated table -- one more small settings blob doesn't need
// its own migration.
//
// The Routine itself fires on a fixed hourly cadence (the simplest
// schedule a cron trigger can express) and, on every firing, reads this
// value to decide whether *this particular hour* is actually inside the
// user's configured active window before it bothers gathering mail/
// calendar and pushing a new snapshot. That indirection is what makes
// "vilka tider" configurable from Settings without touching the
// underlying trigger -- the trigger's own schedule never changes, only
// what it does once awake.

const KEY = "brief_schedule";
const DEFAULT_VALUE = { enabled: true, startHour: 7, endHour: 22, intervalHours: 2 };

async function fetchValue(supabase) {
  const { data } = await supabase
    .from("dashboard_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  const value = data?.value;
  if (value && typeof value === "object") {
    return {
      enabled: value.enabled !== false,
      startHour: Number.isInteger(value.startHour) ? value.startHour : DEFAULT_VALUE.startHour,
      endHour: Number.isInteger(value.endHour) ? value.endHour : DEFAULT_VALUE.endHour,
      intervalHours: Number.isInteger(value.intervalHours) ? value.intervalHours : DEFAULT_VALUE.intervalHours,
    };
  }
  return DEFAULT_VALUE;
}

async function saveValue(supabase, value) {
  return supabase
    .from("dashboard_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export function wireBriefScheduleSetting(supabase, { enabledToggleEl, startSelectEl, endSelectEl, intervalSelectEl, msgEl }) {
  let current = DEFAULT_VALUE;
  let saveTimer = null;

  fetchValue(supabase).then((value) => {
    current = value;
    enabledToggleEl.checked = value.enabled;
    startSelectEl.value = String(value.startHour);
    endSelectEl.value = String(value.endHour);
    intervalSelectEl.value = String(value.intervalHours);
  });

  function scheduleSave(next) {
    current = next;
    clearTimeout(saveTimer);
    msgEl.textContent = "Sparar…";
    saveTimer = setTimeout(async () => {
      const { error } = await saveValue(supabase, current);
      msgEl.textContent = error ? `Kunde inte spara: ${error.message}` : "Sparat.";
    }, 400);
  }

  enabledToggleEl.addEventListener("change", () => scheduleSave({ ...current, enabled: enabledToggleEl.checked }));
  startSelectEl.addEventListener("change", () => scheduleSave({ ...current, startHour: Number(startSelectEl.value) }));
  endSelectEl.addEventListener("change", () => scheduleSave({ ...current, endHour: Number(endSelectEl.value) }));
  intervalSelectEl.addEventListener("change", () => scheduleSave({ ...current, intervalHours: Number(intervalSelectEl.value) }));
}
