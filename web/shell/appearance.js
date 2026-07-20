// Gate background selection. Backed by public.app_settings, the one table
// in the whole app readable by the *anon* role (see
// supabase/migrations/0004_app_settings.sql) — deliberately, because the
// gate itself is shown before sign-in and needs to know which variant to
// render without an authenticated session. Writes are still owner-only
// (RLS), so only Tor can change it; anyone loading the gate can only read
// which non-sensitive cosmetic choice is currently selected.

const VARIANTS = ["skull", "compass", "globe", "none"];
const DEFAULT_VARIANT = "skull";

function svgPath(variant) {
  return `shell/gate-backgrounds/${variant}.svg`;
}

async function fetchVariant(supabase) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "gate_background")
    .maybeSingle();
  const variant = data?.value?.variant;
  return VARIANTS.includes(variant) ? variant : DEFAULT_VARIANT;
}

async function applyVariant(variant) {
  const holder = document.querySelector("#gate .gate-vignette");
  if (!holder) return;
  if (variant === "none") {
    holder.innerHTML = "";
    return;
  }
  try {
    const svg = await (await fetch(svgPath(variant))).text();
    holder.innerHTML = svg;
  } catch {
    holder.innerHTML = "";
  }
}

// Called once at boot, before sign-in, so the gate shows the last saved
// choice rather than always defaulting to the skull.
export async function loadGateBackground(supabase) {
  const variant = await fetchVariant(supabase);
  await applyVariant(variant);
  return variant;
}

export function wireAppearancePicker(supabase, { pickerEl, msgEl }) {
  let current = DEFAULT_VARIANT;

  function markSelected() {
    pickerEl.querySelectorAll(".bg-option").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.variant === current);
    });
  }

  fetchVariant(supabase).then((variant) => { current = variant; markSelected(); });

  pickerEl.querySelectorAll(".bg-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const variant = btn.dataset.variant;
      if (variant === current) return;
      msgEl.textContent = "Saving…";
      const { error } = await supabase
        .from("app_settings")
        .update({ value: { variant }, updated_at: new Date().toISOString() })
        .eq("key", "gate_background");
      if (error) {
        msgEl.textContent = `Couldn't save: ${error.message}`;
        return;
      }
      current = variant;
      markSelected();
      await applyVariant(variant); // live preview on this page too
      msgEl.textContent = "Saved.";
    });
  });
}
