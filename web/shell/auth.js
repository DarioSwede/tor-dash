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
let idleDeadline = null;
let sessionTimerEl = null;
let tickInterval = null;

export function wireGate(supabase, { gateEl, appEl, gateMsg, sessionTimerEl: timerEl, onAuthenticated, onSignedOut }) {
  // One network lookup per gate view, shared by every log call below
  // (view, attempt, outcome) instead of each re-fetching it independently.
  const networkStatusPromise = fetchNetworkStatus();
  logAccessEvent(supabase, "gate_view", { statusPromise: networkStatusPromise });

  const triggerPasskeySignIn = async (method) => {
    gateMsg.textContent = "Waiting for your security key…";
    logAccessEvent(supabase, "signin_attempt", { method, statusPromise: networkStatusPromise });
    // WebAuthn requires the document to actually have focus at call time.
    // Tapping the button naturally focuses it; a swipe on the plain
    // #gate div doesn't focus anything on its own, which is what
    // produced "Couldn't sign in: The document is not focused." on that
    // path specifically. window.focus() alone (an earlier attempt at
    // this fix) turned out not to be reliable — browsers are
    // inconsistent about honoring a window self-focusing itself.
    // Focusing a concrete element is the primitive that actually works;
    // gateEl (tabindex="-1" in index.html) is used rather than the
    // button itself so this still works when "hide the button entirely"
    // is on and there's no button to focus.
    gateEl.focus({ preventScroll: true });
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
      startReauthGuard(supabase, timerEl);
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

  // Click anywhere outside the panel closes it too, not just the ×
  // button -- the more common way to dismiss this kind of slide-out
  // panel. openBtn itself is excluded so the click that *opens* the
  // panel (which bubbles to this same document listener) doesn't
  // immediately close it again. The × stays as the only way to close
  // on a phone screen, though -- there the panel is full-width/full-
  // height (see shell.css's max-width:640px rule), so there's no
  // "outside" left to click.
  document.addEventListener("click", (e) => {
    if (!panelEl.classList.contains("open")) return;
    if (panelEl.contains(e.target) || openBtn.contains(e.target)) return;
    panelEl.classList.remove("open");
  });

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

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Ticks once a second while signed in, purely a display concern — the
// actual sign-out is still driven by idleTimer/setTimeout above,
// independent of whether this element exists or this interval is even
// running.
function updateSessionTimerDisplay() {
  if (!sessionTimerEl) return;
  if (!idleDeadline) {
    sessionTimerEl.style.display = "none";
    return;
  }
  const remaining = idleDeadline - Date.now();
  sessionTimerEl.style.display = "";
  sessionTimerEl.classList.toggle("session-timer-warn", remaining < 60 * 1000);
  sessionTimerEl.textContent = `Utloggning om ${formatCountdown(remaining)}`;
  sessionTimerEl.title = "Loggas ut automatiskt efter 15 min utan aktivitet";
}

function startReauthGuard(supabase, timerEl) {
  sessionTimerEl = timerEl || sessionTimerEl;
  clearTimeout(idleTimer);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleDeadline = Date.now() + IDLE_TIMEOUT_MS;
    idleTimer = setTimeout(() => supabase.auth.signOut(), IDLE_TIMEOUT_MS);
    updateSessionTimerDisplay();
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

  clearInterval(tickInterval);
  tickInterval = setInterval(updateSessionTimerDisplay, 1000);
}

function stopReauthGuard() {
  clearTimeout(idleTimer);
  idleTimer = null;
  hiddenAt = null;
  idleDeadline = null;
  clearInterval(tickInterval);
  tickInterval = null;
  updateSessionTimerDisplay();
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
