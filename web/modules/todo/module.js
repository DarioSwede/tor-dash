// ToDo panel — a personal checklist that doubles as a way to hand a
// task to the "tor-dash brief refresh" Claude Routine (see that
// Routine's own prompt, set up outside this repo) instead of just
// jotting a reminder. Every row's `done` (Dario checked it off himself)
// and `claude_status` (whether/how the Routine should act on it) are
// independent -- see supabase/migrations/0017_todos.sql for why they
// live on the same row rather than two tables.
//
// Not a nav-registered module anymore -- it's embedded directly inside
// the Morning Brief module (see mountTodoPanel's caller there) as a
// permanently-visible right-hand card instead of its own tab, so there's
// no more "have you visited this tab yet" state to badge -- it's always
// on screen right alongside the brief. That's also why the old
// getBadgeCount/last-seen-todo bookkeeping is gone entirely rather than
// ported over: there's nothing left for it to mean.

export async function mountTodoPanel(container, ctx) {
  const { supabase, el } = ctx;

  const card = el("div", "band band-top todo-panel");
  const wrap = el("div", "wrap");

  const form = el("form", "todo-form");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-input";
  input.placeholder = "Lägg till en sak att göra…";
  input.setAttribute("aria-label", "Ny todo-text");
  const addBtn = document.createElement("button");
  addBtn.type = "submit";
  addBtn.className = "btn";
  addBtn.textContent = "Lägg till";
  form.append(input, addBtn);
  wrap.appendChild(form);

  const openRoot = el("div", "todo-list");
  wrap.appendChild(openRoot);

  const doneToggle = el("button", "todo-done-toggle", "Klart (0)");
  wrap.appendChild(doneToggle);
  const doneRoot = el("div", "todo-list todo-done-list hidden");
  wrap.appendChild(doneRoot);

  card.appendChild(wrap);
  container.appendChild(card);

  let rows = [];
  let doneExpanded = false;

  doneToggle.addEventListener("click", () => {
    doneExpanded = !doneExpanded;
    doneRoot.classList.toggle("hidden", !doneExpanded);
    doneToggle.classList.toggle("active", doneExpanded);
  });

  async function load() {
    openRoot.innerHTML = "";
    openRoot.appendChild(el("div", "empty-state", "Laddar…"));
    const { data, error } = await supabase
      .from("todos")
      .select("id, text, done, done_at, needs_claude, claude_status, claude_note, created_at, updated_at")
      .order("created_at", { ascending: true });

    if (error) {
      openRoot.innerHTML = "";
      openRoot.appendChild(el(
        "div", "empty-state",
        `Kunde inte hämta todos: ${error.message}. Kör supabase/migrations/0017_todos.sql om du inte redan gjort det.`
      ));
      return;
    }
    rows = data || [];
    render();
  }

  async function toggleDone(row) {
    const done = !row.done;
    const { error } = await supabase
      .from("todos")
      .update({ done, done_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!error) await load();
  }

  async function askClaude(row) {
    const { error } = await supabase
      .from("todos")
      .update({ needs_claude: true, claude_status: "requested", claude_note: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!error) await load();
  }

  async function clearClaude(row) {
    const { error } = await supabase
      .from("todos")
      .update({ needs_claude: false, claude_status: "none", claude_note: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!error) await load();
  }

  function renderRow(row) {
    const item = el("div", `todo-item${row.done ? " todo-done" : ""}`);

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "todo-check";
    check.checked = row.done;
    check.setAttribute("aria-label", `Markera "${row.text}" som klar`);
    check.addEventListener("change", () => toggleDone(row));
    item.appendChild(check);

    const body = el("div", "todo-body");
    body.appendChild(el("div", "todo-text", row.text));

    if (row.claude_status === "requested") {
      body.appendChild(el("div", "todo-claude-note todo-claude-pending", "🤖 Väntar på Claude…"));
    } else if (row.claude_status === "done" && row.claude_note) {
      const note = el("div", "todo-claude-note todo-claude-done", `🤖 ${row.claude_note}`);
      const clear = el("button", "todo-claude-clear", "Rensa");
      clear.type = "button";
      clear.addEventListener("click", () => clearClaude(row));
      note.appendChild(clear);
      body.appendChild(note);
    }
    item.appendChild(body);

    if (!row.done && row.claude_status === "none") {
      const claudeBtn = el("button", "todo-claude-btn", "🤖");
      claudeBtn.type = "button";
      claudeBtn.title = "Be Claude göra/fortsätta med det här";
      claudeBtn.setAttribute("aria-label", "Be Claude göra/fortsätta med det här");
      claudeBtn.addEventListener("click", () => askClaude(row));
      item.appendChild(claudeBtn);
    }

    return item;
  }

  function render() {
    openRoot.innerHTML = "";
    doneRoot.innerHTML = "";

    const open = rows.filter((r) => !r.done);
    const done = rows.filter((r) => r.done).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));

    if (!open.length) {
      openRoot.appendChild(el("div", "empty-state", "Inget att göra just nu."));
    } else {
      open.forEach((row) => openRoot.appendChild(renderRow(row)));
    }

    doneToggle.textContent = `Klart (${done.length})`;
    done.forEach((row) => doneRoot.appendChild(renderRow(row)));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addBtn.disabled = true;
    const { error } = await supabase.from("todos").insert({ text });
    addBtn.disabled = false;
    if (!error) {
      input.value = "";
      await load();
    }
  });

  await load();
}
