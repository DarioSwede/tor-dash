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

export async function renderNetworkStatus(targetEl) {
  if (!targetEl) return;
  const label = formatNetworkLabel(await fetchNetworkStatus());
  targetEl.textContent = label || "";
  targetEl.style.display = label ? "" : "none";
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
