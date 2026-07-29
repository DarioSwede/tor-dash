// Admin controls for Packlista. The browser only sends the signed-in user's
// session to the Edge Function; all privileged Auth operations stay server-side.

async function invokeAdmin(supabase, body) {
  const { data, error } = await supabase.functions.invoke("packlista-admin", { body });
  if (!error) return data;
  let message = error.message || "Anropet misslyckades.";
  try {
    const details = await error.context?.json();
    if (details?.error) message = details.error;
  } catch {
    // Keep the original message when the response has no JSON body.
  }
  throw new Error(message);
}

function formatDate(value) {
  return value
    ? new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
    : "Aldrig";
}

export function wireAdminPanel(supabase) {
  const section = document.getElementById("admin-settings");
  const form = document.getElementById("admin-invite-form");
  const emailInput = document.getElementById("admin-invite-email");
  const message = document.getElementById("admin-msg");
  const list = document.getElementById("admin-users-list");
  const refreshButton = document.getElementById("admin-refresh-users");
  let currentUserId = null;

  async function renderUsers() {
    message.textContent = "Hämtar användare…";
    list.replaceChildren();
    try {
      const result = await invokeAdmin(supabase, { action: "list" });
      for (const user of result.users || []) {
        const row = document.createElement("article");
        row.className = "admin-user-row";

        const identity = document.createElement("div");
        const email = document.createElement("strong");
        email.textContent = user.email || "Ingen e-post";
        const meta = document.createElement("span");
        const confirmed = user.confirmedAt ? "Bekräftad" : "Inbjuden";
        meta.textContent = `${confirmed} · Senast inloggad: ${formatDate(user.lastSignInAt)}`;
        identity.append(email, meta);

        const role = document.createElement("select");
        role.className = "text-input admin-role-select";
        role.setAttribute("aria-label", `Behörighet för ${user.email}`);
        [["user", "Användare"], ["admin", "Administratör"]].forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          option.selected = user.role === value;
          role.append(option);
        });
        role.addEventListener("change", async () => {
          role.disabled = true;
          message.textContent = "Sparar behörighet…";
          try {
            await invokeAdmin(supabase, { action: "set_role", userId: user.id, role: role.value });
            message.textContent = "Behörigheten är sparad.";
          } catch (error) {
            message.textContent = error.message;
            role.value = user.role;
          } finally {
            role.disabled = false;
          }
        });

        if (user.id === currentUserId) email.append(document.createTextNode(" (du)"));
        row.append(identity, role);
        list.append(row);
      }
      if (!list.children.length) {
        const empty = document.createElement("p");
        empty.textContent = "Inga användare ännu.";
        list.append(empty);
      }
      message.textContent = "";
    } catch (error) {
      message.textContent = error.message;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector("button");
    button.disabled = true;
    message.textContent = "Skickar inbjudan…";
    try {
      await invokeAdmin(supabase, { action: "invite", email: emailInput.value.trim() });
      message.textContent = `Inbjudan skickad till ${emailInput.value.trim()}.`;
      emailInput.value = "";
      await renderUsers();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  refreshButton.addEventListener("click", renderUsers);

  return {
    async forSession(session) {
      currentUserId = session?.user?.id || null;
      section.hidden = true;
      if (!currentUserId) return;
      const { data, error } = await supabase
        .from("users")
        .select("role")
        .eq("id", currentUserId)
        .maybeSingle();
      if (!error && data?.role === "admin") {
        section.hidden = false;
        await renderUsers();
      }
    },
    clear() {
      currentUserId = null;
      section.hidden = true;
      list.replaceChildren();
      message.textContent = "";
    },
  };
}
