// Editable/clearable gate title (the "Dashboard" line above the sign-in
// button). Stored in public.app_settings under gate_title, anon-readable
// for the same reason as gate_background and show_network_on_gate (see
// supabase/migrations/0008_gate_title_setting.sql) -- the gate needs to
// render it before there's a session. An empty string means "no title" --
// the element hides itself rather than showing a blank line.

const GATE_TITLE_KEY = "gate_title";
const DEFAULT_TITLE = "Dashboard";
const SAVE_DEBOUNCE_MS = 500;

async function fetchGateTitle(supabase) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", GATE_TITLE_KEY)
    .maybeSingle();
  return typeof data?.value === "string" ? data.value : DEFAULT_TITLE;
}

async function saveGateTitle(supabase, text) {
  // upsert rather than update: an update against a key that doesn't
  // exist yet (migration not run, or the row was never seeded) silently
  // matches zero rows and reports success anyway — this creates the row
  // if it's missing instead of quietly no-op'ing.
  return supabase
    .from("app_settings")
    .upsert({ key: GATE_TITLE_KEY, value: text, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

function applyGateTitle(text) {
  const el = document.getElementById("gate-eyebrow");
  if (!el) return;
  el.textContent = text;
  el.style.display = text ? "" : "none";
}

// Called once at boot, before sign-in, so the gate shows the last saved
// title rather than always defaulting to "Dashboard".
export async function loadGateTitle(supabase) {
  applyGateTitle(await fetchGateTitle(supabase));
}

export function wireGateTitleSetting(supabase, { inputEl, msgEl }) {
  fetchGateTitle(supabase).then((text) => { inputEl.value = text; });

  let saveTimer = null;
  inputEl.addEventListener("input", () => {
    clearTimeout(saveTimer);
    msgEl.textContent = "Saving…";
    saveTimer = setTimeout(async () => {
      const text = inputEl.value; // empty string is valid -- hides the title
      const { error } = await saveGateTitle(supabase, text);
      msgEl.textContent = error ? `Couldn't save: ${error.message}` : "Saved.";
    }, SAVE_DEBOUNCE_MS);
  });
}
