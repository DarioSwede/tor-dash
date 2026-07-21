// Gate background: an uploaded image, plus a toggle for whether it's
// shown at all. Backed by public.app_settings, the one table in the
// whole app readable by the *anon* role (see
// supabase/migrations/0004_app_settings.sql) — deliberately, because the
// gate itself is shown before sign-in and needs to know whether/what to
// render without an authenticated session. Writes are still owner-only
// (RLS), so only Tor can change it.
//
// Value shape is { visible, url }. Turning the toggle off keeps `url`
// around rather than clearing it, so re-enabling doesn't require
// re-uploading — it's a visibility switch, not a delete.

const DEFAULT_VALUE = { visible: false, url: null };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

async function fetchValue(supabase) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "gate_background")
    .maybeSingle();
  const value = data?.value;
  if (value && typeof value === "object") {
    if (typeof value.visible === "boolean") {
      return { visible: value.visible, url: typeof value.url === "string" ? value.url : null };
    }
    // Migrates the pre-toggle { variant: "custom", url } shape so an
    // already-uploaded image doesn't just disappear after this change.
    if (value.variant === "custom" && typeof value.url === "string") {
      return { visible: true, url: value.url };
    }
  }
  return DEFAULT_VALUE;
}

async function saveValue(supabase, value) {
  return supabase
    .from("app_settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", "gate_background");
}

function applyValue(value) {
  const holder = document.querySelector("#gate .gate-vignette");
  if (!holder) return;
  holder.innerHTML = "";
  const show = value.visible && value.url;
  holder.classList.toggle("has-custom", Boolean(show));
  if (!show) return;

  const img = document.createElement("img");
  img.src = value.url;
  img.alt = "";
  holder.appendChild(img);
}

// Called once at boot, before sign-in, so the gate shows the last saved
// choice rather than always defaulting to blank.
export async function loadGateBackground(supabase) {
  const value = await fetchValue(supabase);
  applyValue(value);
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

  const value = { visible: true, url };
  const { error: saveError } = await saveValue(supabase, value);
  if (saveError) throw saveError;

  applyValue(value);
  return value;
}

export function wireAppearanceUpload(supabase, { msgEl, uploadInputEl, visibleToggleEl }) {
  let current = DEFAULT_VALUE;

  fetchValue(supabase).then((value) => {
    current = value;
    visibleToggleEl.checked = value.visible;
  });

  uploadInputEl.addEventListener("change", async () => {
    const file = uploadInputEl.files[0];
    if (!file) return;
    msgEl.textContent = "Uploading…";
    try {
      current = await uploadCustomBackground(supabase, file);
      visibleToggleEl.checked = current.visible;
      msgEl.textContent = "Saved.";
    } catch (e) {
      msgEl.textContent = `Couldn't upload: ${e.message}`;
    } finally {
      uploadInputEl.value = "";
    }
  });

  visibleToggleEl.addEventListener("change", async () => {
    const value = { ...current, visible: visibleToggleEl.checked };
    msgEl.textContent = "Saving…";
    const { error } = await saveValue(supabase, value);
    if (error) {
      msgEl.textContent = `Couldn't save: ${error.message}`;
      visibleToggleEl.checked = !visibleToggleEl.checked;
      return;
    }
    current = value;
    applyValue(value);
    msgEl.textContent = "Saved.";
  });
}
