// Morning Brief module — ported from the original single-file app.js.
//
// Two things changed from that version:
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

let requestSeq = 0;

export default {
  id: "morning-brief",
  navLabel: "Brief",

  async mount(container, ctx) {
    const { supabase, el, renderItem, isSafeSvg, decryptPayload } = ctx;

    const toggle = el("div", "toggle");
    const morningBtn = el("button", "active", "Morning");
    const eveningBtn = el("button", "", "Evening");
    toggle.append(morningBtn, eveningBtn);

    const briefRoot = el("div");
    container.append(toggle, briefRoot);

    let currentKind = "morning";

    function switchKind(kind) {
      currentKind = kind;
      morningBtn.classList.toggle("active", kind === "morning");
      eveningBtn.classList.toggle("active", kind === "evening");
      loadBrief();
    }
    morningBtn.addEventListener("click", () => switchKind("morning"));
    eveningBtn.addEventListener("click", () => switchKind("evening"));

    async function loadBrief() {
      const myRequest = ++requestSeq;
      briefRoot.innerHTML = ""; // synchronous, before any await — every branch below can safely append

      const { data, error } = await supabase
        .from("briefing_snapshots")
        .select("payload, payload_encrypted, for_date, created_at")
        .eq("kind", currentKind)
        .order("for_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (myRequest !== requestSeq) return; // a newer call started; this response is stale

      if (error) {
        briefRoot.appendChild(el("div", "empty-state", `Couldn't load the ${currentKind} brief: ${error.message}`));
        return;
      }
      if (!data) {
        briefRoot.appendChild(el("div", "empty-state", `No ${currentKind} brief yet.`));
        return;
      }

      let payload = data.payload;
      if (!payload && data.payload_encrypted) {
        payload = await decryptPayload(data.payload_encrypted);
        if (myRequest !== requestSeq) return; // check again — the decrypt await can also be superseded
        if (!payload) {
          briefRoot.appendChild(el(
            "div", "empty-state",
            "This brief is encrypted for a different device. Open Security and set up encryption here to read it."
          ));
          return;
        }
      }
      render(payload);
    }

    function render(payload) {
      briefRoot.innerHTML = "";

      // top band
      const top = el("div", "band band-top");
      const topWrap = el("div", "wrap");
      topWrap.appendChild(el("div", "day-date", `${payload.day_name} · ${payload.date_label}`));
      topWrap.appendChild(el("h1", "headline headline-font", payload.headline));

      if (payload.svg && isSafeSvg(payload.svg)) {
        const holder = document.createElement("div");
        holder.innerHTML = payload.svg;
        const svgEl = holder.querySelector("svg");
        if (svgEl) {
          svgEl.classList.add("drawing");
          topWrap.appendChild(svgEl);
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
      topWrap.appendChild(acts);
      top.appendChild(topWrap);
      briefRoot.appendChild(top);

      // bottom band
      const bottom = el("div", "band band-bottom");
      const bottomWrap = el("div", "wrap bottom");

      if (payload.quiet_line) {
        bottomWrap.appendChild(el("div", "quiet-line", payload.quiet_line));
      } else {
        if ((payload.needs_attention || []).length) {
          bottomWrap.appendChild(el("h2", "section-heading", "Needs attention"));
          payload.needs_attention.forEach((item, i) => bottomWrap.appendChild(renderItem(item, i)));
        }
        if ((payload.resolved || []).length) {
          bottomWrap.appendChild(el("h2", "section-heading", "Resolved"));
          payload.resolved.forEach((item, i) => bottomWrap.appendChild(renderItem(item, i)));
        }
      }

      (payload.sections || []).forEach((section) => {
        if (!section.items || !section.items.length) return;
        bottomWrap.appendChild(el("h2", "section-heading", section.heading));
        section.items.forEach((item, i) => bottomWrap.appendChild(renderItem(item, i)));
      });

      bottom.appendChild(bottomWrap);
      briefRoot.appendChild(bottom);
    }

    await loadBrief();
  },
};
