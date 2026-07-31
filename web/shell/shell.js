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
import { renderPasskeyList } from "./passkeys.js";
import {
  loadDashboardBackground,
  loadTopBarLayout,
  wireDashboardBackgroundSetting,
  wireTopBarLayoutSetting,
} from "./dashboard-background.js";
import { lookupIp } from "./ip-lookup.js";
import { wireBriefScheduleSetting } from "./brief-schedule.js";
import { mountLogDrawer } from "./log-drawer.js";
import { wireAdminPanel } from "./admin.js";

const gateEl = document.getElementById("gate");
const appEl = document.getElementById("app");
const gateMsg = document.getElementById("gate-msg");
const navEl = document.getElementById("module-nav");
const contentEl = document.getElementById("module-content");
const settingsPanel = document.getElementById("settings-panel");
const navEdgeTabs = document.getElementById("nav-edge-tabs");
const themeColorMeta = document.getElementById("theme-color-meta");

let logDrawer = null;

// Nav buttons always live in the fixed right-edge tab stack (alongside
// Log, see shell.css's .edge-tab-stack), on every screen size -- not just
// wide ones. Used to be desktop-only, with phones instead getting
// #module-nav tucked inside the hamburger-triggered #side-nav drawer. That
// split is exactly what caused the 2026-07-31 collision Dario hit: the
// hamburger trigger lives in .top-bar-group, a grid cell shell.css also
// lets grow tall/reflow whenever the driftstatus strip
// (#top-bar-service-status, a sibling cell in the same row) expands on a
// narrow screen -- so opening driftstatus could push the one and only way
// to reach the nav drawer out of easy reach. The edge-tab stack is
// position:fixed and totally outside that grid, so it can never be
// affected by anything else in the top bar -- same reasoning as why
// settings/sign-out already get this treatment on desktop. #module-nav
// itself is never rebuilt here, just parented once -- module-registry.js
// doesn't need to know where it lives.
navEdgeTabs.appendChild(navEl);

// Keeps the browser chrome (status bar area) matching whichever screen
// is actually showing -- see index.html's meta tag comment for why this
// exists at all (a mismatched, default-light status bar over the dark
// gate reads as the page not actually filling the screen).
function setThemeColor(hex) {
  themeColorMeta.setAttribute("content", hex);
}

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
  const adminPanel = wireAdminPanel(supabase);
  wireGate(supabase, {
    gateEl, appEl, gateMsg,
    sessionTimerEl: document.getElementById("session-timer"),
    onAuthenticated: async (session) => {
      setThemeColor("#FCFCFB"); // --bg, tokens.css
      renderNetworkStatus(document.getElementById("network-status"));
      loadDashboardBackground(supabase);
      loadTopBarLayout(supabase, document.getElementById("top-bar-layout-toggle"));
      try {
        await adminPanel.forSession(session);
        await refreshDeviceList();
        await refreshPasskeyList();
        const preferredInitialId = "command-center";
        const ctx = {
          supabase,
          session,
          el,
          renderItem,
          isSafeSvg,
          decryptPayload,
          lookupIp,
        };
        await initModules(navEl, contentEl, ctx, preferredInitialId);
        // Log is global chrome, not tied to any one module's mount/
        // unmount lifecycle -- mounted once, ever, so a sign-out followed
        // by signing back in doesn't stack up duplicate tabs. ToDo went
        // back to living inside the Morning Brief module itself
        // (2026-07-25) as a collapsible card -- see that module's own
        // mountTodoCard.
        if (!logDrawer) logDrawer = mountLogDrawer(navEdgeTabs, ctx);
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
      setThemeColor("#0A0A0C"); // --gate-bg, tokens.css
      contentEl.innerHTML = "";
      settingsPanel.classList.remove("open");
      logDrawer?.close();
      adminPanel.clear();
    },
  });

  wireSecurityPanel(supabase, {
    panelEl: settingsPanel,
    openBtn: document.getElementById("open-settings-btn"),
    closeBtn: settingsPanel.querySelector(".close-btn"),
    // onEnroll fires after a *passkey* registration (see auth.js) — it's
    // wired to refreshDeviceList too because opening the panel is also a
    // reasonable moment to make sure the (unrelated) encryption-key list
    // is current, not because the two are actually connected.
    onEnroll: async () => {
      await refreshDeviceList();
      await refreshPasskeyList();
    },
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

  wireTopBarLayoutSetting(supabase, {
    toggleEl: document.getElementById("top-bar-layout-toggle"),
    msgEl: document.getElementById("top-bar-layout-msg"),
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

  wireDashboardBackgroundSetting(supabase, {
    colorInputEl: document.getElementById("dashboard-bg-color-input"),
    resetBtnEl: document.getElementById("dashboard-bg-color-reset"),
    visibleToggleEl: document.getElementById("dashboard-bg-visible-toggle"),
    uploadInputEl: document.getElementById("dashboard-bg-upload-input"),
    msgEl: document.getElementById("dashboard-bg-msg"),
  });

  wireBriefScheduleSetting(supabase, {
    enabledToggleEl: document.getElementById("brief-schedule-enabled-toggle"),
    startSelectEl: document.getElementById("brief-schedule-start-select"),
    endSelectEl: document.getElementById("brief-schedule-end-select"),
    intervalSelectEl: document.getElementById("brief-schedule-interval-select"),
    msgEl: document.getElementById("brief-schedule-msg"),
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

async function refreshPasskeyList() {
  const listEl = document.getElementById("passkey-list");
  if (listEl) await renderPasskeyList(supabase, listEl);
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
