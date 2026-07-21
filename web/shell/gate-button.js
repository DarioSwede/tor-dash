// Editable/hideable sign-in button text. Stored in public.app_settings
// under gate_button as { text, hidden }, anon-readable for the same
// reason as gate_title/gate_background/show_network_on_gate (see
// supabase/migrations/0011_gate_button_setting.sql) — the gate needs to
// render it before there's a session. Hiding the button entirely still
// leaves swipe-up-to-sign-in working (see auth.js's wireSwipeToSignIn),
// so it's a real "remove the button" option, not a trap.

const GATE_BUTTON_KEY = "gate_button";
const DEFAULT_VALUE = { text: "Sign in with security key", hidden: false };
const SAVE_DEBOUNCE_MS = 500;

async function fetchGateButton(supabase) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", GATE_BUTTON_KEY)
    .maybeSingle();
  const value = data?.value;
  if (value && typeof value === "object") {
    return {
      text: typeof value.text === "string" && value.text ? value.text : DEFAULT_VALUE.text,
      hidden: Boolean(value.hidden),
    };
  }
  return DEFAULT_VALUE;
}

async function saveGateButton(supabase, value) {
  return supabase
    .from("app_settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", GATE_BUTTON_KEY);
}

function applyGateButton(value) {
  const btn = document.getElementById("passkey-signin-btn");
  if (!btn) return;
  btn.textContent = value.text;
  btn.style.display = value.hidden ? "none" : "";
}

// Called once at boot, before sign-in, so the gate shows the last saved
// text/visibility rather than always defaulting to the built-in label.
export async function loadGateButton(supabase) {
  applyGateButton(await fetchGateButton(supabase));
}

export function wireGateButtonSetting(supabase, { textInputEl, hiddenToggleEl, msgEl }) {
  fetchGateButton(supabase).then((value) => {
    textInputEl.value = value.text;
    hiddenToggleEl.checked = value.hidden;
  });

  // Reads straight from the inputs at save time rather than tracking a
  // separate cached value, so a keystroke arriving mid-fetch can't be
  // clobbered by the initial load's .then() resolving after it.
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    msgEl.textContent = "Saving…";
    saveTimer = setTimeout(async () => {
      const value = { text: textInputEl.value || DEFAULT_VALUE.text, hidden: hiddenToggleEl.checked };
      const { error } = await saveGateButton(supabase, value);
      msgEl.textContent = error ? `Couldn't save: ${error.message}` : "Saved.";
    }, SAVE_DEBOUNCE_MS);
  }

  textInputEl.addEventListener("input", scheduleSave);
  hiddenToggleEl.addEventListener("change", scheduleSave);
}
