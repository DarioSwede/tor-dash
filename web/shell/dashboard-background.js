// Dashboard (signed-in view) background color and/or image — separate
// from appearance.js, which is the *gate's* background and has to be
// anon-readable since the gate renders pre-auth. This one only ever
// matters once signed in, so it lives in its own owner-only table
// (dashboard_settings, migration 0012) rather than the anon-readable
// app_settings — no reason to expose it before there's a session.
//
// Applied directly on <body> rather than #app or a dedicated overlay div:
// individual modules (Sarek's own dark theme, Morning Brief's
// band/wrap) paint their own opaque backgrounds by design and are left
// alone — this shows through in the toolbar/chrome and any margin a
// module doesn't cover, not as a forced override of a module's own look.

const KEY = "background";
const DEFAULT_VALUE = { color: null, showImage: false, imageUrl: null };
const DEFAULT_COLOR_SWATCH = "#fcfcfb"; // matches --bg in tokens.css, just for the <input type="color"> UI
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const SAVE_DEBOUNCE_MS = 500;

async function fetchValue(supabase) {
  const { data } = await supabase
    .from("dashboard_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  const value = data?.value;
  if (value && typeof value === "object") {
    return {
      color: typeof value.color === "string" ? value.color : null,
      showImage: Boolean(value.showImage),
      imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : null,
    };
  }
  return DEFAULT_VALUE;
}

async function saveValue(supabase, value) {
  return supabase
    .from("dashboard_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

function applyValue(value) {
  document.body.style.backgroundColor = value.color || "";
  const active = Boolean(value.showImage && value.imageUrl);
  if (active) {
    document.body.style.backgroundImage = `url("${value.imageUrl}")`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundAttachment = "fixed";
    document.body.style.backgroundRepeat = "no-repeat";
  } else {
    document.body.style.backgroundImage = "";
  }
  // Modules built on the shared .band-top/.band-bottom/.wrap primitives
  // (shell.css) paint their own opaque near-white surface across nearly
  // the entire content area by design -- fine normally, but it means a
  // custom background image would only ever be visible behind the
  // toolbar strip, defeating the point of setting one. This class lets
  // shell.css turn those surfaces semi-transparent (with a blur, so text
  // stays legible) only while a custom image is actually active.
  document.body.classList.toggle("has-custom-bg", active);
}

// Only meaningful once signed in — dashboard_settings is owner-only
// (RLS), so calling this before auth just returns the default anyway.
export async function loadDashboardBackground(supabase) {
  applyValue(await fetchValue(supabase));
}

export async function uploadDashboardBackground(supabase, file) {
  if (!file.type.startsWith("image/")) throw new Error("Filen måste vara en bild.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Bilden är för stor (max 5 MB).");

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  // Same public bucket the gate background uses (migration
  // 0006_gate_background_storage.sql) — a different filename, not a
  // separate bucket, since the policies there aren't filename-scoped.
  const path = `dashboard.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("gate-backgrounds")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from("gate-backgrounds").getPublicUrl(path);
  const url = `${pub.publicUrl}?t=${Date.now()}`; // cache-bust re-uploads of the same filename

  const current = await fetchValue(supabase);
  const value = { ...current, showImage: true, imageUrl: url };
  const { error: saveError } = await saveValue(supabase, value);
  if (saveError) throw saveError;

  applyValue(value);
  return value;
}

export function wireDashboardBackgroundSetting(supabase, { colorInputEl, resetBtnEl, visibleToggleEl, uploadInputEl, msgEl }) {
  let current = DEFAULT_VALUE;
  let saveTimer = null;

  fetchValue(supabase).then((value) => {
    current = value;
    colorInputEl.value = value.color || DEFAULT_COLOR_SWATCH;
    visibleToggleEl.checked = value.showImage;
  });

  // Applies immediately for live preview (matters especially for the
  // color input, which fires "input" continuously while dragging), saves
  // debounced so dragging the picker doesn't hammer the database.
  function scheduleSave(next) {
    current = next;
    applyValue(next);
    clearTimeout(saveTimer);
    msgEl.textContent = "Saving…";
    saveTimer = setTimeout(async () => {
      const { error } = await saveValue(supabase, current);
      msgEl.textContent = error ? `Couldn't save: ${error.message}` : "Saved.";
    }, SAVE_DEBOUNCE_MS);
  }

  colorInputEl.addEventListener("input", () => scheduleSave({ ...current, color: colorInputEl.value }));
  resetBtnEl.addEventListener("click", () => {
    colorInputEl.value = DEFAULT_COLOR_SWATCH;
    scheduleSave({ ...current, color: null });
  });
  visibleToggleEl.addEventListener("change", () => scheduleSave({ ...current, showImage: visibleToggleEl.checked }));

  uploadInputEl.addEventListener("change", async () => {
    const file = uploadInputEl.files[0];
    if (!file) return;
    msgEl.textContent = "Uploading…";
    try {
      current = await uploadDashboardBackground(supabase, file);
      visibleToggleEl.checked = current.showImage;
      msgEl.textContent = "Saved.";
    } catch (e) {
      msgEl.textContent = `Couldn't upload: ${e.message}`;
    } finally {
      uploadInputEl.value = "";
    }
  });
}
