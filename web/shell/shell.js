// Bootstrap: wires auth, the settings panel (appearance + security/
// encryption), and the module registry together. This file owns the
// top-level page structure only — all per-module rendering logic lives
// under modules/.

import { supabase, configOk } from "./supabase-client.js";
import { wireGate, wireSecurityPanel } from "./auth.js";
import { hasDeviceKey, setupEncryption, decryptPayload } from "./crypto.js";
import { isSafeSvg } from "./svg-sanitize.js";
import { el, renderItem } from "./dom-utils.js";
import { initModules } from "./module-registry.js";
import { loadGateBackground, wireAppearanceUpload } from "./appearance.js";
import { renderNetworkStatus, fetchShowOnGate, wireNetworkSettingToggle } from "./network.js";
import { loadGateTitle, wireGateTitleSetting } from "./gate-title.js";
import { loadGateButton, wireGateButtonSetting } from "./gate-button.js";

const gateEl = document.getElementById("gate");
const appEl = document.getElementById("app");
const gateMsg = document.getElementById("gate-msg");
const navEl = document.getElementById("module-nav");
const contentEl = document.getElementById("module-content");
const settingsPanel = document.getElementById("settings-panel");

if (!configOk) {
  gateMsg.textContent =
    "config.js is not set up yet — copy config.example.js to config.js and fill in your Supabase project values.";
} else {
  loadGateBackground(supabase);
  loadGateTitle(supabase);
  loadGateButton(supabase);
  fetchShowOnGate(supabase).then((show) => {
    if (show) renderNetworkStatus(document.getElementById("gate-network-status"));
  });
  boot();
}

function boot() {
  wireGate(supabase, {
    gateEl, appEl, gateMsg,
    onAuthenticated: async (session) => {
      renderNetworkStatus(document.getElementById("network-status"));
      try {
        await refreshDeviceList();
        await initModules(navEl, contentEl, {
          supabase,
          session,
          el,
          renderItem,
          isSafeSvg,
          decryptPayload,
        });
      } catch (e) {
        // Last-resort net: anything unexpected here previously meant a
        // silently blank page (an unhandled rejection inside an
        // onAuthStateChange callback surfaces nowhere in the UI). Now it
        // at least says so.
        console.error("Failed to initialize the dashboard after sign-in:", e);
        contentEl.innerHTML = "";
        contentEl.appendChild(el("div", "module-error", `Something went wrong loading the dashboard: ${e.message || e}`));
      }
    },
    onSignedOut: () => {
      contentEl.innerHTML = "";
      settingsPanel.classList.remove("open");
    },
  });

  wireSecurityPanel(supabase, {
    panelEl: settingsPanel,
    openBtn: document.getElementById("open-settings-btn"),
    closeBtn: settingsPanel.querySelector(".close-btn"),
    onEnroll: refreshDeviceList,
  });

  wireAppearanceUpload(supabase, {
    msgEl: document.getElementById("appearance-msg"),
    uploadInputEl: document.getElementById("bg-upload-input"),
    visibleToggleEl: document.getElementById("bg-visible-toggle"),
  });

  wireNetworkSettingToggle(supabase, {
    checkboxEl: document.getElementById("show-network-gate-toggle"),
    msgEl: document.getElementById("network-settings-msg"),
  });

  wireGateTitleSetting(supabase, {
    inputEl: document.getElementById("gate-title-input"),
    msgEl: document.getElementById("gate-title-msg"),
  });

  wireGateButtonSetting(supabase, {
    textInputEl: document.getElementById("gate-button-text-input"),
    hiddenToggleEl: document.getElementById("gate-button-hidden-toggle"),
    msgEl: document.getElementById("gate-button-msg"),
  });
}

async function refreshDeviceList() {
  const listEl = document.getElementById("device-list");
  const registerBtn = document.getElementById("register-device-key-btn");
  const alreadyHere = await hasDeviceKey();
  registerBtn.textContent = alreadyHere ? "Re-register this device's encryption key" : "Set up encryption on this device";

  const { data, error } = await supabase
    .from("encryption_keys")
    .select("device_label, created_at, active")
    .eq("active", true)
    .order("created_at", { ascending: true });

  listEl.innerHTML = "";
  if (error || !data || !data.length) {
    listEl.appendChild(el("p", null, "No devices registered yet."));
    return;
  }
  for (const row of data) {
    const line = el("div", "device-row");
    line.appendChild(el("span", null, row.device_label || "Unnamed device"));
    line.appendChild(el("span", null, new Date(row.created_at).toLocaleDateString()));
    listEl.appendChild(line);
  }
}

// registerPasskey() (wired in auth.js) only handles the login credential;
// this is a distinct concern — the local encryption keypair (see
// crypto.js) — with its own button, wired here rather than in auth.js
// since it isn't an auth action.
document.getElementById("register-device-key-btn")?.addEventListener("click", async () => {
  if (!configOk) return;
  const label = prompt("Label this device (e.g. \"MacBook\", \"iPhone\"):", guessDeviceLabel());
  if (label === null) return;
  await setupEncryption(supabase, label || "Unnamed device");
  await refreshDeviceList();
});

function guessDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  return "";
}
