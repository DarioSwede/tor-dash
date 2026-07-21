// Auth wiring: passkey (security key) sign-in only — no email/magic-link
// path, so a leaked or guessed email address can't get anyone signed in —
// plus a re-authentication guard that signs you back out after a period of
// inactivity or after the tab/app has been backgrounded for a while — the
// practical stand-in for "the key must be at hand," since no browser API
// can truly sense continuous hardware presence on a phone (see the plan
// doc's WebUSB/WebHID research).
//
// Fixes a confirmed bug from the previous single-file app.js: that version
// called both `onAuthStateChange` (which fires an INITIAL_SESSION event on
// subscribe) *and* a separate `getSession().then()` right after — both
// raced into loadBrief() with no de-dup guard, stacking duplicate
// "No brief yet." messages. This version only ever subscribes once.

import { logAccessEvent } from "./access-log.js";
import { fetchNetworkStatus } from "./network.js";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 min of no interaction
const BACKGROUND_TIMEOUT_MS = 5 * 60 * 1000; // 5 min hidden re-triggers a lock

// Swipe-up-to-sign-in thresholds, tuned to read as a deliberate upward
// swipe anywhere on the gate without fighting iOS's own edge gestures
// (which own the bottom ~20px home-indicator strip regardless).
const SWIPE_MIN_DISTANCE_PX = 80;
const SWIPE_MAX_DRIFT_PX = 60;
const SWIPE_MAX_DURATION_MS = 800;

let idleTimer = null;
let hiddenAt = null;
let listenersWired = false;

export function wireGate(supabase, { gateEl, appEl, gateMsg, onAuthenticated, onSignedOut }) {
  // One network lookup per gate view, shared by every log call below
  // (view, attempt, outcome) instead of each re-fetching it independently.
  const networkStatusPromise = fetchNetworkStatus();
  logAccessEvent(supabase, "gate_view", { statusPromise: networkStatusPromise });

  const triggerPasskeySignIn = async (method) => {
    gateMsg.textContent = "Waiting for your security key…";
    logAccessEvent(supabase, "signin_attempt", { method, statusPromise: networkStatusPromise });
    const { error } = await supabase.auth.signInWithPasskey();
    if (error) {
      gateMsg.textContent = `Couldn't sign in: ${error.message}`;
      logAccessEvent(supabase, "signin_failure", { method, detail: error.message, statusPromise: networkStatusPromise });
    } else {
      gateMsg.textContent = "";
      logAccessEvent(supabase, "signin_success", { method, statusPromise: networkStatusPromise });
    }
  };

  document.getElementById("passkey-signin-btn").addEventListener("click", () => triggerPasskeySignIn("tap"));
  wireSwipeToSignIn(gateEl, () => triggerPasskeySignIn("swipe"));

  document.getElementById("signout-btn").addEventListener("click", () => supabase.auth.signOut());

  // The single source of truth for session state — no duplicate
  // getSession() call alongside this, which is what caused the dup-render
  // race in the previous version.
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      gateEl.style.display = "none";
      appEl.style.display = "block";
      startReauthGuard(supabase);
      onAuthenticated(session);
    } else {
      gateEl.style.display = "flex";
      appEl.style.display = "none";
      stopReauthGuard();
      onSignedOut();
    }
  });
}

export function wireSecurityPanel(supabase, { panelEl, openBtn, closeBtn, onEnroll }) {
  openBtn.addEventListener("click", () => panelEl.classList.add("open"));
  closeBtn.addEventListener("click", () => panelEl.classList.remove("open"));

  const registerBtn = panelEl.querySelector("#register-passkey-btn");
  const securityMsg = panelEl.querySelector("#security-msg");
  registerBtn.addEventListener("click", async () => {
    securityMsg.textContent = "Waiting for your security key…";
    const { error } = await supabase.auth.registerPasskey();
    if (error) {
      securityMsg.textContent = `Couldn't register: ${error.message}`;
      return;
    }
    securityMsg.textContent = "Passkey registered.";
    onEnroll();
  });
}

function startReauthGuard(supabase) {
  clearTimeout(idleTimer);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => supabase.auth.signOut(), IDLE_TIMEOUT_MS);
  };

  // Activity/visibility listeners are wired once for the page's lifetime,
  // not once per sign-in — otherwise repeated sign-out/sign-in cycles in a
  // single long-lived tab would accumulate duplicate listeners.
  if (!listenersWired) {
    listenersWired = true;
    ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((evt) =>
      document.addEventListener(evt, () => { if (idleTimer) resetIdle(); }, { passive: true })
    );
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && idleTimer && Date.now() - hiddenAt > BACKGROUND_TIMEOUT_MS) {
        supabase.auth.signOut();
      }
    });
  }
  resetIdle();
}

function stopReauthGuard() {
  clearTimeout(idleTimer);
  idleTimer = null;
  hiddenAt = null;
}

// A single-touch swipe anywhere on the gate, mostly vertical and upward,
// triggers the same sign-in the button does — the button stays as the
// visible/accessible affordance, this is just a faster path for anyone
// who knows it's there.
function wireSwipeToSignIn(gateEl, onSwipeUp) {
  let startX = 0, startY = 0, startT = 0, tracking = false;

  gateEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    tracking = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startT = Date.now();
  }, { passive: true });

  gateEl.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = Math.abs(touch.clientX - startX);
    const dy = startY - touch.clientY; // positive = moved up
    const dt = Date.now() - startT;
    if (dy > SWIPE_MIN_DISTANCE_PX && dx < SWIPE_MAX_DRIFT_PX && dt < SWIPE_MAX_DURATION_MS) {
      onSwipeUp();
    }
  }, { passive: true });
}
