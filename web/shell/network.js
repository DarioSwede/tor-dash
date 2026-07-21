// Public IP + best-effort VPN indicator, shown as a small line at the top
// of the dashboard (and optionally the gate, see the toggle below).
//
// There is no reliable way to detect VPN use from the browser alone —
// FortPolio's network.js (a sibling app) already concluded this and
// deliberately skips VPN detection. Here we take a narrower, explicitly
// best-effort approach instead: fetch the ISP/org name for the current IP
// and match it against known VPN provider names. A provider not on the
// list reads as "Direct" even when it isn't — treat the label as a hint,
// not a guarantee.
//
// The show-on-gate toggle is stored in public.app_settings (same
// anon-readable pattern as gate_background, see
// supabase/migrations/0004_app_settings.sql and
// 0007_show_network_on_gate_setting.sql) because the gate itself, shown
// before sign-in, needs to read it without an authenticated session.
// Off by default: this line puts a real IP address on a public,
// internet-facing page, and should only appear there deliberately.

const GATE_SETTING_KEY = "show_network_on_gate";

const VPN_ORG_PATTERNS = [
  /mullvad/i, /nordvpn/i, /nord security/i, /protonvpn/i, /proton ag/i,
  /surfshark/i, /expressvpn/i, /private internet access/i, /\bpia\b/i,
  /cyberghost/i, /windscribe/i, /\bivpn\b/i, /tunnelbear/i, /hidemyass/i,
  /vpn\.ac/i, /perfect privacy/i, /airvpn/i, /torguard/i, /vyprvpn/i,
];

export async function fetchNetworkStatus() {
  const status = { v4: null, v6: null, org: null, isVpn: false };

  const [v4, v6, info] = await Promise.allSettled([
    fetch("https://api.ipify.org?format=json").then((r) => (r.ok ? r.json() : null)),
    fetch("https://api6.ipify.org?format=json").then((r) => (r.ok ? r.json() : null)),
    fetch("https://ipapi.co/json/").then((r) => (r.ok ? r.json() : null)),
  ]);

  if (v4.status === "fulfilled" && v4.value) status.v4 = v4.value.ip;
  if (v6.status === "fulfilled" && v6.value) status.v6 = v6.value.ip;
  if (info.status === "fulfilled" && info.value?.org) {
    status.org = info.value.org;
    status.isVpn = VPN_ORG_PATTERNS.some((pattern) => pattern.test(status.org));
  }

  return status;
}

export function formatNetworkLabel(status) {
  const ips = [status.v4, status.v6].filter(Boolean);
  if (!ips.length) return null;
  const ipText = ips.join(" · ");
  if (!status.org) return ipText;
  return `${ipText} · ${status.isVpn ? "VPN" : "Direct"} (${status.org})`;
}

const SHIELD_PATH = "M12 2l8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-4z";

function badge(text, title) {
  const span = document.createElement("span");
  span.className = "net-badge";
  span.textContent = text;
  span.title = title;
  return span;
}

function shieldIcon(isVpn) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("class", "net-shield" + (isVpn ? " net-shield-vpn" : ""));
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", SHIELD_PATH);
  path.setAttribute("fill", isVpn ? "currentColor" : "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

// Builds { v4: "1.2.3.4" · v6: "2001:..." · [shield] VPN (Mullvad) } as
// real DOM (never innerHTML, per this project's XSS-hygiene convention —
// see svg-sanitize.js's rationale — even though org/IP here come from a
// third-party API rather than user input) so IPv4/IPv6/VPN each get their
// own small icon instead of one plain text line.
export async function renderNetworkStatus(targetEl) {
  if (!targetEl) return;
  const status = await fetchNetworkStatus();
  targetEl.innerHTML = "";
  const ips = [status.v4, status.v6].filter(Boolean);
  if (!ips.length) {
    targetEl.style.display = "none";
    return;
  }
  targetEl.style.display = "";
  // classList.add rather than a hard-coded className: this same function
  // renders into both #network-status (class "network-status", inside
  // the dashboard's .top-bar) and #gate-network-status (class
  // "gate-network-status", on the signed-out gate) -- overwriting
  // className outright would clobber whichever of those two it actually
  // is.
  targetEl.classList.add("net-pill");

  if (status.v4) {
    const item = document.createElement("span");
    item.className = "net-item";
    item.appendChild(badge("v4", "IPv4"));
    item.append(status.v4);
    targetEl.appendChild(item);
  }
  if (status.v6) {
    const item = document.createElement("span");
    item.className = "net-item";
    item.appendChild(badge("v6", "IPv6"));
    item.append(status.v6);
    targetEl.appendChild(item);
  }
  if (status.org) {
    const item = document.createElement("span");
    item.className = "net-item" + (status.isVpn ? " net-vpn" : " net-direct");
    item.appendChild(shieldIcon(status.isVpn));
    item.append(` ${status.isVpn ? "VPN" : "Direct"} (${status.org})`);
    targetEl.appendChild(item);
  }
}

export async function fetchShowOnGate(supabase) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", GATE_SETTING_KEY)
    .maybeSingle();
  return data?.value === true;
}

export async function saveShowOnGate(supabase, value) {
  // upsert rather than update: an update against a key that doesn't
  // exist yet (migration not run, or the row was never seeded) silently
  // matches zero rows and reports success anyway — this creates the row
  // if it's missing instead of quietly no-op'ing.
  return supabase
    .from("app_settings")
    .upsert({ key: GATE_SETTING_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export function wireNetworkSettingToggle(supabase, { checkboxEl, msgEl }) {
  fetchShowOnGate(supabase).then((value) => { checkboxEl.checked = value; });

  checkboxEl.addEventListener("change", async () => {
    const next = checkboxEl.checked;
    msgEl.textContent = "Saving…";
    const { error } = await saveShowOnGate(supabase, next);
    if (error) {
      msgEl.textContent = `Couldn't save: ${error.message}`;
      checkboxEl.checked = !next;
      return;
    }
    msgEl.textContent = "Saved.";
  });
}
