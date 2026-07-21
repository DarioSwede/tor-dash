// True "the key must be physically present" enforcement via WebHID --
// desktop Chrome/Edge/Opera only. Safari (macOS *and* iOS) implements
// neither WebHID nor WebUSB at all, so this is a progressive
// enhancement layered on top of auth.js's existing session-based
// re-authentication (idle timeout + backgrounded-tab timeout), never a
// replacement for it -- everywhere this isn't supported just keeps the
// session-based guard as-is.
//
// WebHID device permission is granted per browser profile + origin and
// persists across reloads once given, so requestDevice() (which needs a
// real user gesture, wired from the Settings panel) only has to run
// once. Every later page load can silently re-find the same
// already-granted device via getDevices() -- no repeated prompts.
//
// Filters on Yubico's USB vendor ID only, not a specific serial number:
// WebHID doesn't expose a device's serial without opening it first, and
// for a single-owner app matching "any granted Yubico key" is close
// enough -- this owner has exactly two, both meant to work.
const YUBICO_VENDOR_ID = 0x1050;

const ENABLED_STORAGE_KEY = "hid-presence-enabled";

export function hidSupported() {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

export function isPresenceEnforcementEnabled() {
  return hidSupported() && localStorage.getItem(ENABLED_STORAGE_KEY) === "1";
}

export function setPresenceEnforcementEnabled(enabled) {
  localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "1" : "0");
}

// Opens the browser's device picker -- must be called directly from a
// user gesture (a click handler), not from any async continuation.
export async function grantYubikeyAccess() {
  if (!hidSupported()) throw new Error("WebHID isn't available in this browser.");
  const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: YUBICO_VENDOR_ID }] });
  return devices.length > 0;
}

export async function hasGrantedYubikey() {
  if (!hidSupported()) return false;
  const devices = await navigator.hid.getDevices();
  return devices.some((d) => d.vendorId === YUBICO_VENDOR_ID);
}

let disconnectHandler = null;

// Starts watching for the granted key disappearing. Safe to call
// whether or not a device has actually been granted/is connected --
// it's a no-op in that case, same as everywhere WebHID doesn't exist.
export async function watchYubikeyPresence(onDisconnected) {
  stopWatchingYubikeyPresence();
  if (!hidSupported() || !isPresenceEnforcementEnabled()) return;
  if (!(await hasGrantedYubikey())) return;

  disconnectHandler = (e) => {
    if (e.device.vendorId === YUBICO_VENDOR_ID) onDisconnected();
  };
  navigator.hid.addEventListener("disconnect", disconnectHandler);
}

export function stopWatchingYubikeyPresence() {
  if (disconnectHandler && hidSupported()) {
    navigator.hid.removeEventListener("disconnect", disconnectHandler);
  }
  disconnectHandler = null;
}

export function wireHidPresenceSetting(supabase, { grantBtnEl, toggleEl, msgEl, unsupportedEl }) {
  if (!hidSupported()) {
    grantBtnEl.disabled = true;
    toggleEl.disabled = true;
    unsupportedEl.style.display = "";
    return;
  }

  toggleEl.checked = isPresenceEnforcementEnabled();

  hasGrantedYubikey().then((granted) => {
    msgEl.textContent = granted ? "A security key is granted for this browser." : "No security key granted yet.";
  });

  grantBtnEl.addEventListener("click", async () => {
    msgEl.textContent = "Choose your security key in the browser prompt…";
    try {
      const granted = await grantYubikeyAccess();
      msgEl.textContent = granted ? "Granted. Turn on the toggle below to enforce it." : "No key selected.";
      if (granted && toggleEl.checked) watchYubikeyPresence(() => supabase.auth.signOut());
    } catch (e) {
      msgEl.textContent = `Couldn't grant access: ${e.message}`;
    }
  });

  toggleEl.addEventListener("change", async () => {
    setPresenceEnforcementEnabled(toggleEl.checked);
    if (toggleEl.checked) {
      if (!(await hasGrantedYubikey())) {
        msgEl.textContent = "Grant access to a key first (button above).";
        toggleEl.checked = false;
        setPresenceEnforcementEnabled(false);
        return;
      }
      watchYubikeyPresence(() => supabase.auth.signOut());
      msgEl.textContent = "Enabled -- unplugging the key now signs you out immediately.";
    } else {
      stopWatchingYubikeyPresence();
      msgEl.textContent = "Disabled.";
    }
  });
}
