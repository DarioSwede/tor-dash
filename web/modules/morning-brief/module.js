// Morning Brief module — ported from the original single-file app.js.
//
// Notable changes from that version:
// 1. loadBrief() now clears its root synchronously before the first
//    `await` on every call path (including the empty-state branch, which
//    previously didn't) and carries a request-id guard, so a call
//    superseded by a newer one drops its stale result instead of
//    appending a second "No brief yet." — this is the fix for the
//    confirmed dup-render race in the old version.
// 2. Rows may now carry `payload_encrypted` (an array of per-device
//    envelopes, see shell/crypto.js) instead of plaintext `payload` —
//    decrypted client-side before rendering, using whichever envelope (if
//    any) matches this device's registered key.
// 3. There is only ever one running brief now, not a morning/evening
//    pair picked via a toggle — whatever row was pushed most recently
//    (by created_at, not for_date, since same-day re-pushes are the
//    normal way new content replaces stale content) is simply "the"
//    brief. The `kind` column still exists on the table for now but is
//    no longer read from here.
// 4. A successful render marks this row's created_at as "seen" (see
//    shell/last-seen.js) -- that's what shell.js's sign-in routing
//    checks to decide whether landing here (instead of wherever the URL
//    hash points) is actually warranted.

import { setLastSeenBrief } from "../../shell/last-seen.js";

let requestSeq = 0;

export default {
  id: "morning-brief",
  navLabel: "Brief",

  async mount(container, ctx) {
    const { supabase, el, renderItem, isSafeSvg, decryptPayload } = ctx;

    const briefRoot = el("div");
    container.append(briefRoot);

    async function loadBrief() {
      const myRequest = ++requestSeq;
      briefRoot.innerHTML = ""; // synchronous, before any await — every branch below can safely append

      const { data, error } = await supabase
        .from("briefing_snapshots")
        .select("payload, payload_encrypted, for_date, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (myRequest !== requestSeq) return; // a newer call started; this response is stale

      if (error) {
        briefRoot.appendChild(el("div", "empty-state", `Kunde inte hämta briefen: ${error.message}`));
        return;
      }
      if (!data) {
        briefRoot.appendChild(el("div", "empty-state", "Ingen brief ännu."));
        return;
      }

      let payload = data.payload;
      if (!payload && data.payload_encrypted) {
        payload = await decryptPayload(data.payload_encrypted);
        if (myRequest !== requestSeq) return; // check again — the decrypt await can also be superseded
        if (!payload) {
          briefRoot.appendChild(el(
            "div", "empty-state",
            "Den här briefen är krypterad för en annan enhet. Öppna Säkerhet och sätt upp kryptering här för att läsa den."
          ));
          return;
        }
      }
      render(payload);
      setLastSeenBrief(data.created_at);
    }

    // One seamless card, not a two-band split -- there's only one running
    // brief now (see the module-level comment above), so a hard seam
    // between a "header half" and a "list half" no longer means anything,
    // and it used to cost two independent paddings' worth of dead space
    // right where acts meets the first section heading.
    function render(payload) {
      briefRoot.innerHTML = "";

      const card = el("div", "band band-top");
      const wrap = el("div", "wrap");
      wrap.appendChild(el("div", "day-date", `${payload.day_name} · ${payload.date_label}`));
      wrap.appendChild(el("h1", "headline headline-font", payload.headline));

      if (payload.svg && isSafeSvg(payload.svg)) {
        const holder = document.createElement("div");
        holder.innerHTML = payload.svg;
        const svgEl = holder.querySelector("svg");
        if (svgEl) {
          svgEl.classList.add("drawing");
          wrap.appendChild(svgEl);
        }
      } else if (payload.svg) {
        console.warn("Skipped rendering payload.svg: failed the safety allowlist check.");
      }

      const acts = el("div", "acts");
      (payload.acts || []).forEach((act) => {
        const a = el("div", "act");
        a.appendChild(el("div", "act-time", act.time));
        a.appendChild(el("div", "act-note", act.note));
        acts.appendChild(a);
      });
      if (acts.children.length) wrap.appendChild(acts);

      if (payload.quiet_line) {
        wrap.appendChild(el("div", "quiet-line", payload.quiet_line));
      } else {
        if ((payload.needs_attention || []).length) {
          wrap.appendChild(el("h2", "section-heading", "Kräver uppmärksamhet"));
          payload.needs_attention.forEach((item, i) => wrap.appendChild(renderItem(item, i)));
        }
        if ((payload.resolved || []).length) {
          wrap.appendChild(el("h2", "section-heading", "Avklarat"));
          payload.resolved.forEach((item, i) => wrap.appendChild(renderItem(item, i)));
        }
      }

      (payload.sections || []).forEach((section) => {
        if (!section.items || !section.items.length) return;
        wrap.appendChild(el("h2", "section-heading", section.heading));
        section.items.forEach((item, i) => wrap.appendChild(renderItem(item, i)));
      });

      card.appendChild(wrap);
      briefRoot.appendChild(card);
    }

    await loadBrief();
  },
};
