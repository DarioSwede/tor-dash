// Passkey management (list + remove) for the Settings panel — separate
// from wireSecurityPanel's registration flow in auth.js, which only adds
// new ones. Uses supabase.auth.passkey.list()/.delete({passkeyId}) --
// part of the same experimental Passkeys API as registerPasskey() /
// signInWithPasskey() (see supabase-client.js's
// `experimental: { passkey: true }` opt-in). Supabase's own docs mark
// this Beta and say the shape may change without notice, so this reads
// defensively (falls back to "Unnamed passkey", tolerates a missing
// created_at) rather than assuming every field is always present.

import { el } from "./dom-utils.js";

export async function fetchPasskeys(supabase) {
  const { data, error } = await supabase.auth.passkey.list();
  return { passkeys: data || [], error };
}

export async function removePasskey(supabase, passkeyId) {
  return supabase.auth.passkey.delete({ passkeyId });
}

export async function renderPasskeyList(supabase, listEl) {
  listEl.innerHTML = "";
  const { passkeys, error } = await fetchPasskeys(supabase);

  if (error) {
    listEl.appendChild(el("p", null, `Couldn't load passkeys: ${error.message}`));
    return;
  }
  if (!passkeys.length) {
    listEl.appendChild(el("p", null, "No passkeys registered yet."));
    return;
  }

  for (const pk of passkeys) {
    const label = pk.friendly_name || "Unnamed passkey";
    const created = pk.created_at ? new Date(pk.created_at).toLocaleDateString() : "";

    const row = el("div", "device-row");
    row.appendChild(el("span", null, created ? `${label} · ${created}` : label));

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      // Losing your only passkey is a real self-lockout risk, especially
      // with magic link disabled — see SECURITY_CHECKLIST.md. Make that
      // explicit rather than letting a misclick be silently fatal.
      const warning = passkeys.length === 1
        ? `Remove your only passkey ("${label}")? You won't be able to sign in afterward unless you still have another way in (e.g. via the Supabase dashboard). This can't be undone from here.`
        : `Remove passkey "${label}"? You won't be able to sign in with it anymore.`;
      if (!confirm(warning)) return;

      removeBtn.disabled = true;
      removeBtn.textContent = "Removing…";
      const { error: delError } = await removePasskey(supabase, pk.id);
      if (delError) {
        alert(`Couldn't remove: ${delError.message}`);
        removeBtn.disabled = false;
        removeBtn.textContent = "Remove";
        return;
      }
      await renderPasskeyList(supabase, listEl);
    });
    row.appendChild(removeBtn);
    listEl.appendChild(row);
  }
}
