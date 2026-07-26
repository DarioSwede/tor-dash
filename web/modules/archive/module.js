// Arkiv — kvitton, bokningar och annat som ska sparas och hittas igen.
//
// Finns för ett konkret behov: inför Sarek och Holland samlas kvitton som
// sedan ska redovisas, och de får inte ligga utspridda i en inkorg (vilket
// är precis hur IKEA-kvittot 2026-07-26 gick förlorat).
//
// Två saker att förstå om formen, båda från supabase/migrations/0018_archive.sql:
//
// 1. Granskningskön först. Den timvisa Routine-körningen lägger in fynd som
//    status 'review'; ingenting räknas som arkiverat förrän Dario tryckt
//    Spara. Kön ligger därför överst och försvinner helt när den är tom --
//    ett falskt kvitto i ett redovisningsunderlag är värre än ett missat,
//    eftersom ingen upptäcker det förrän någon annan granskar.
//
// 2. Filer ligger i en PRIVAT bucket. Därför createSignedUrl vid klick i
//    stället för getPublicUrl som appearance.js använder för gate-bakgrunder
//    -- ett kvitto ska inte gå att nå med en gissad URL.

const KINDS = [
  { value: "kvitto", label: "Kvitto" },
  { value: "bokning", label: "Bokning" },
  { value: "faktura", label: "Faktura" },
  { value: "garanti", label: "Garanti" },
  { value: "ovrigt", label: "Övrigt" },
];

// Förslag, inte tvång -- fältet är fritext i databasen. Listan finns bara
// för att slippa stava "Utrustning" på fyra olika sätt.
const CATEGORIES = ["Resa", "Boende", "Transport", "Mat", "Utrustning", "Hemmet", "Prenumeration", "Övrigt"];

const BUCKET = "archive-files";

// Mountable in two places, deliberately: right now it's a collapsible card
// inside the Morning Brief (see that module's mountArchiveCard), but Dario
// may want it back as its own nav tab. Keeping the panel container-agnostic
// means that move is one line in modules/manifest.js plus deleting the card
// call -- no rewrite. Same shape modules/todo/module.js already uses.
//
// Two things make it portable:
//  - mountArchivePanel wraps itself in .module-archive, because module.css is
//    scoped to that class. Mounted inside the brief the surrounding element
//    is .module-morning-brief, so without the wrapper every rule here would
//    silently fail to match.
//  - ensureArchiveCss injects the stylesheet itself, since module-registry.js
//    only does that for modules listed in the manifest. The href is resolved
//    the same way the registry resolves it, so when this *is* a nav module
//    the guard sees the registry's link and doesn't add a second one.
const CSS_HREF = new URL("./module.css", import.meta.url).href;

function ensureArchiveCss() {
  if (document.querySelector(`link[rel="stylesheet"][href="${CSS_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_HREF;
  document.head.appendChild(link);
}

function fmtAmount(row) {
  if (row.amount == null) return "";
  const n = Number(row.amount);
  return `${n.toLocaleString("sv-SE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} ${row.currency || "SEK"}`;
}

function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  const months = ["jan", "feb", "mars", "april", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
  return `${day} ${months[m - 1]} ${y}`;
}

/**
 * The archive UI, independent of where it's mounted.
 *
 * `opts.onReviewCount(n)` fires after every load with the number of items
 * still waiting to be reviewed -- that's what lets a collapsed card badge
 * itself, so a pending receipt isn't invisible behind a shut accordion.
 */
export async function mountArchivePanel(container, ctx, opts = {}) {
  const { supabase, el } = ctx;
  ensureArchiveCss();

  // Own scoping wrapper -- see the note by CSS_HREF above.
  const scope = el("div", "module-archive");
  const page = el("div", "band band-top archive-page");
  const wrap = el("div", "wrap");
  page.appendChild(wrap);
  scope.appendChild(page);
  container.appendChild(scope);

  const reviewRoot = el("div", "archive-review");
  const toolbar = el("div", "archive-toolbar");
  const listRoot = el("div", "archive-list");
  wrap.append(reviewRoot, toolbar, listRoot);

  let rows = [];
  let filterTrip = "";
  let filterKind = "";
  let query = "";

  // ---- Läsning -------------------------------------------------------

  async function load() {
    listRoot.innerHTML = "";
    listRoot.appendChild(el("div", "empty-state", "Laddar…"));

    const { data, error } = await supabase
      .from("archive_items")
      .select("id, kind, title, vendor, occurred_on, amount, currency, category, trip, notes, email_link, file_path, file_name, status, source, created_at")
      .neq("status", "discarded")
      .order("occurred_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      listRoot.innerHTML = "";
      listRoot.appendChild(el(
        "div", "empty-state",
        `Kunde inte hämta arkivet: ${error.message}. Kör supabase/migrations/0018_archive.sql om du inte redan gjort det.`
      ));
      return;
    }
    rows = data || [];
    render();
    opts.onReviewCount?.(rows.filter((r) => r.status === "review").length);
  }

  // ---- Skrivning -----------------------------------------------------

  async function patch(id, fields) {
    const { error } = await supabase
      .from("archive_items")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      window.alert(`Kunde inte spara: ${error.message}`);
      return false;
    }
    await load();
    return true;
  }

  // Filen tas bort först, sedan raden. Omvänd ordning kan lämna en
  // föräldralös fil i bucketen som ingenting längre pekar på.
  async function removeRow(row) {
    if (!window.confirm(`Ta bort "${row.title}" ur arkivet?`)) return;
    if (row.file_path) await supabase.storage.from(BUCKET).remove([row.file_path]);
    const { error } = await supabase.from("archive_items").delete().eq("id", row.id);
    if (error) { window.alert(`Kunde inte ta bort: ${error.message}`); return; }
    await load();
  }

  // Privat bucket -> signerad, tidsbegränsad URL i stället för publik.
  async function openFile(row) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.file_path, 60);
    if (error || !data?.signedUrl) {
      window.alert(`Kunde inte öppna filen: ${error?.message || "okänt fel"}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function uploadFile(row, file) {
    // Radens id i sökvägen gör att två kvitton med samma filnamn aldrig
    // skriver över varandra.
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${row.id}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (error) { window.alert(`Uppladdning misslyckades: ${error.message}`); return; }
    if (row.file_path) await supabase.storage.from(BUCKET).remove([row.file_path]);
    await patch(row.id, { file_path: path, file_name: file.name, file_size: file.size });
  }

  // ---- Rendering -----------------------------------------------------

  function metaLine(row) {
    const bits = [];
    if (row.occurred_on) bits.push(fmtDate(row.occurred_on));
    if (row.vendor) bits.push(row.vendor);
    const amount = fmtAmount(row);
    if (amount) bits.push(amount);
    return bits.join(" · ");
  }

  function tagRow(row) {
    const tags = el("div", "archive-tags");
    const kind = KINDS.find((k) => k.value === row.kind);
    tags.appendChild(el("span", `archive-tag archive-tag-${row.kind}`, kind ? kind.label : row.kind));
    if (row.category) tags.appendChild(el("span", "archive-tag", row.category));
    if (row.trip) tags.appendChild(el("span", "archive-tag archive-tag-trip", row.trip));
    if (row.source === "claude") tags.appendChild(el("span", "archive-tag archive-tag-auto", "🤖 hittad"));
    return tags;
  }

  function attachmentControls(row) {
    const box = el("div", "archive-attach");

    if (row.file_path) {
      const open = el("button", "archive-link", row.file_name || "Öppna fil");
      open.type = "button";
      open.addEventListener("click", () => openFile(row));
      box.appendChild(open);
    } else {
      const label = el("label", "archive-upload");
      label.textContent = "Bifoga fil";
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,application/pdf";
      input.addEventListener("change", () => {
        if (input.files && input.files[0]) uploadFile(row, input.files[0]);
      });
      label.appendChild(input);
      box.appendChild(label);
    }

    if (row.email_link) {
      const mail = document.createElement("a");
      mail.className = "archive-link";
      mail.href = row.email_link;
      mail.target = "_blank";
      mail.rel = "noopener noreferrer";
      mail.textContent = "Mejlet ↗";
      box.appendChild(mail);
    }
    return box;
  }

  function renderReviewCard(row) {
    const card = el("div", "archive-item archive-item-review");
    const body = el("div", "archive-body");
    body.appendChild(el("div", "archive-title", row.title));
    const meta = metaLine(row);
    if (meta) body.appendChild(el("div", "archive-meta", meta));
    body.appendChild(tagRow(row));
    body.appendChild(attachmentControls(row));
    card.appendChild(body);

    const actions = el("div", "archive-actions");
    const keep = el("button", "btn archive-keep", "Spara");
    keep.type = "button";
    keep.addEventListener("click", () => patch(row.id, { status: "kept" }));
    const drop = el("button", "archive-discard", "Släng");
    drop.type = "button";
    drop.addEventListener("click", () => patch(row.id, { status: "discarded" }));
    actions.append(keep, drop);
    card.appendChild(actions);
    return card;
  }

  function renderItem(row) {
    const card = el("div", "archive-item");
    const body = el("div", "archive-body");
    body.appendChild(el("div", "archive-title", row.title));
    const meta = metaLine(row);
    if (meta) body.appendChild(el("div", "archive-meta", meta));
    body.appendChild(tagRow(row));
    if (row.notes) body.appendChild(el("div", "archive-notes", row.notes));
    body.appendChild(attachmentControls(row));
    card.appendChild(body);

    const actions = el("div", "archive-actions");
    const del = el("button", "archive-discard", "Ta bort");
    del.type = "button";
    del.addEventListener("click", () => removeRow(row));
    actions.appendChild(del);
    card.appendChild(actions);
    return card;
  }

  function renderToolbar() {
    toolbar.innerHTML = "";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "text-input archive-search";
    search.placeholder = "Sök i arkivet…";
    search.value = query;
    search.addEventListener("input", () => { query = search.value; renderList(); });
    toolbar.appendChild(search);

    const trips = [...new Set(rows.filter((r) => r.trip).map((r) => r.trip))].sort();
    if (trips.length) {
      const sel = document.createElement("select");
      sel.className = "archive-select";
      sel.setAttribute("aria-label", "Filtrera på resa");
      [["", "Alla resor"], ...trips.map((t) => [t, t])].forEach(([v, l]) => {
        const o = document.createElement("option");
        o.value = v; o.textContent = l; o.selected = v === filterTrip;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => { filterTrip = sel.value; renderList(); });
      toolbar.appendChild(sel);
    }

    const kindSel = document.createElement("select");
    kindSel.className = "archive-select";
    kindSel.setAttribute("aria-label", "Filtrera på typ");
    [["", "Alla typer"], ...KINDS.map((k) => [k.value, k.label])].forEach(([v, l]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = l; o.selected = v === filterKind;
      kindSel.appendChild(o);
    });
    kindSel.addEventListener("change", () => { filterKind = kindSel.value; renderList(); });
    toolbar.appendChild(kindSel);

    const addBtn = el("button", "btn", "Lägg till");
    addBtn.type = "button";
    addBtn.addEventListener("click", openForm);
    toolbar.appendChild(addBtn);
  }

  function visibleRows() {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => r.status === "kept")
      .filter((r) => !filterTrip || r.trip === filterTrip)
      .filter((r) => !filterKind || r.kind === filterKind)
      .filter((r) => !q || [r.title, r.vendor, r.category, r.trip, r.notes]
        .some((v) => v && String(v).toLowerCase().includes(q)));
  }

  function renderList() {
    listRoot.innerHTML = "";
    const shown = visibleRows();

    if (!shown.length) {
      listRoot.appendChild(el("div", "empty-state",
        rows.some((r) => r.status === "kept")
          ? "Inget matchar filtret."
          : "Arkivet är tomt än. Lägg till något, eller vänta på att en körning hittar ett kvitto i mejlen."));
      return;
    }

    // Summering per filtrerat urval -- hela poängen med resetaggen är
    // att kunna svara på "vad kostade Sarek" utan att räkna för hand.
    // Summeras per valuta, aldrig över dem: 3 499 SEK + 412 EUR är inte
    // 3 911 av någonting, och en resa till Holland har med säkerhet båda.
    const perCurrency = new Map();
    for (const r of shown) {
      if (r.amount == null) continue;
      const cur = r.currency || "SEK";
      perCurrency.set(cur, (perCurrency.get(cur) || 0) + Number(r.amount));
    }
    if (perCurrency.size) {
      const sums = [...perCurrency.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([cur, sum]) => `${sum.toLocaleString("sv-SE")} ${cur}`)
        .join(" + ");
      const n = shown.length;
      listRoot.appendChild(el("div", "archive-total", `${n} ${n === 1 ? "post" : "poster"} · ${sums}`));
    }

    shown.forEach((row) => listRoot.appendChild(renderItem(row)));
  }

  function renderReview() {
    reviewRoot.innerHTML = "";
    const pending = rows.filter((r) => r.status === "review");
    if (!pending.length) return;   // tom kö syns inte alls

    const head = el("div", "archive-review-head");
    head.appendChild(el("h2", "archive-review-title", "Att granska"));
    head.appendChild(el("span", "archive-review-count", String(pending.length)));
    reviewRoot.appendChild(head);
    pending.forEach((row) => reviewRoot.appendChild(renderReviewCard(row)));
  }

  function render() {
    renderReview();
    renderToolbar();
    renderList();
  }

  // ---- Formulär för manuell post -------------------------------------

  function openForm() {
    const form = el("form", "archive-form");

    function field(labelText, node) {
      const l = el("label", "archive-field");
      l.appendChild(el("span", "archive-field-label", labelText));
      l.appendChild(node);
      return l;
    }
    function input(type, placeholder) {
      const i = document.createElement("input");
      i.type = type; i.className = "text-input";
      if (placeholder) i.placeholder = placeholder;
      return i;
    }

    const title = input("text", "T.ex. IKEA Kungens Kurva");
    title.required = true;
    const kind = document.createElement("select");
    kind.className = "archive-select";
    KINDS.forEach((k) => {
      const o = document.createElement("option");
      o.value = k.value; o.textContent = k.label;
      kind.appendChild(o);
    });
    const date = input("date");
    date.valueAsDate = new Date();
    const amount = input("number", "0");
    amount.step = "0.01";
    const vendor = input("text", "Butik/leverantör");
    const trip = input("text", "T.ex. Sarek 2026");
    const category = input("text", "Kategori");
    const catList = document.createElement("datalist");
    catList.id = "archive-categories";
    CATEGORIES.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      catList.appendChild(o);
    });
    category.setAttribute("list", "archive-categories");
    const notes = input("text", "Anteckning");

    form.append(
      field("Vad", title), field("Typ", kind), field("Datum", date),
      field("Belopp", amount), field("Var", vendor),
      field("Resa", trip), field("Kategori", category), field("Not", notes), catList
    );

    const actions = el("div", "archive-form-actions");
    const save = el("button", "btn", "Spara");
    save.type = "submit";
    const cancel = el("button", "archive-discard", "Avbryt");
    cancel.type = "button";
    cancel.addEventListener("click", () => form.remove());
    actions.append(save, cancel);
    form.appendChild(actions);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!title.value.trim()) return;
      save.disabled = true;
      // Manuellt inlagt är per definition redan granskat -> 'kept'.
      const { error } = await supabase.from("archive_items").insert({
        title: title.value.trim(),
        kind: kind.value,
        occurred_on: date.value || null,
        amount: amount.value === "" ? null : Number(amount.value),
        vendor: vendor.value.trim() || null,
        trip: trip.value.trim() || null,
        category: category.value.trim() || null,
        notes: notes.value.trim() || null,
        status: "kept",
        source: "manual",
      });
      save.disabled = false;
      if (error) { window.alert(`Kunde inte spara: ${error.message}`); return; }
      form.remove();
      await load();
    });

    toolbar.insertAdjacentElement("afterend", form);
    title.focus();
  }

  await load();
}

// Nav-module wrapper. Not currently listed in modules/manifest.js -- the
// archive lives inside the Morning Brief for now (2026-07-26) -- but kept
// intact so putting it back on its own tab is one line there and nothing
// else. The registry contract is documented in shell/module-registry.js.
export default {
  id: "archive",
  navLabel: "Arkiv",
  async mount(container, ctx) {
    await mountArchivePanel(container, ctx);
  },
};
