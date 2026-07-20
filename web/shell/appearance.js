// Gate background selection. Backed by public.app_settings, the one table
// in the whole app readable by the *anon* role (see
// supabase/migrations/0004_app_settings.sql) — deliberately, because the
// gate itself is shown before sign-in and needs to know which variant to
// render without an authenticated session. Writes are still owner-only
// (RLS), so only Tor can change it; anyone loading the gate can only read
// which non-sensitive cosmetic choice is currently selected.
//
// Two kinds of variant: a built-in SVG (skull/compass/globe/none) loaded
// from shell/gate-backgrounds/, or "custom" — an uploaded image stored in
// the public gate-backgrounds Storage bucket (see
// supabase/migrations/0006_gate_background_storage.sql), referenced by
// its public URL rather than embedded, so no repo change is needed to
// swap it.

const BUILTIN_VARIANTS = ["skull", "compass", "globe", "none"];
const DEFAULT_VALUE = { variant: "skull" };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

function svgPath(variant) {
  return `shell/gate-backgrounds/${variant}.svg`;
}

async function fetchValue(supabase) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "gate_background")
    .maybeSingle();
  const value = data?.value;
  if (value?.variant === "custom" && value.url) return value;
  if (BUILTIN_VARIANTS.includes(value?.variant)) return value;
  return DEFAULT_VALUE;
}

async function saveValue(supabase, value) {
  return supabase
    .from("app_settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", "gate_background");
}

async function applyValue(value) {
  const holder = document.querySelector("#gate .gate-vignette");
  if (!holder) return;
  holder.innerHTML = "";
  holder.classList.toggle("has-custom", value.variant === "custom");

  if (value.variant === "none") return;

  if (value.variant === "custom" && value.url) {
    const img = document.createElement("img");
    img.src = value.url;
    img.alt = "";
    holder.appendChild(img);
    return;
  }

  try {
    const svg = await (await fetch(svgPath(value.variant))).text();
    holder.innerHTML = svg;
  } catch {
    holder.innerHTML = "";
  }
}

// Called once at boot, before sign-in, so the gate shows the last saved
// choice rather than always defaulting to the skull.
export async function loadGateBackground(supabase) {
  const value = await fetchValue(supabase);
  await applyValue(value);
  return value;
}

export async function uploadCustomBackground(supabase, file) {
  if (!file.type.startsWith("image/")) throw new Error("Filen måste vara en bild.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Bilden är för stor (max 5 MB).");

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `custom.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("gate-backgrounds")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from("gate-backgrounds").getPublicUrl(path);
  // Cache-bust so a re-upload with the same filename shows immediately
  // rather than an old cached copy at the same URL.
  const url = `${pub.publicUrl}?t=${Date.now()}`;

  const value = { variant: "custom", url };
  const { error: saveError } = await saveValue(supabase, value);
  if (saveError) throw saveError;

  await applyValue(value);
  return value;
}

export function wireAppearancePicker(supabase, { pickerEl, msgEl, uploadInputEl }) {
  let current = DEFAULT_VALUE;

  function markSelected() {
    pickerEl.querySelectorAll(".bg-option").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.variant === current.variant);
    });
  }

  fetchValue(supabase).then((value) => { current = value; markSelected(); });

  pickerEl.querySelectorAll(".bg-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const variant = btn.dataset.variant;
      if (variant === current.variant) return;
      const value = { variant };
      msgEl.textContent = "Saving…";
      const { error } = await saveValue(supabase, value);
      if (error) {
        msgEl.textContent = `Couldn't save: ${error.message}`;
        return;
      }
      current = value;
      markSelected();
      await applyValue(value); // live preview on this page too
      msgEl.textContent = "Saved.";
    });
  });

  if (uploadInputEl) {
    uploadInputEl.addEventListener("change", async () => {
      const file = uploadInputEl.files[0];
      if (!file) return;
      msgEl.textContent = "Uploading…";
      try {
        current = await uploadCustomBackground(supabase, file);
        markSelected();
        msgEl.textContent = "Saved.";
      } catch (e) {
        msgEl.textContent = `Couldn't upload: ${e.message}`;
      } finally {
        uploadInputEl.value = "";
      }
    });
  }
}
