// Price alerts -- fires a browser notification on a fresh threshold
// crossing (not every refresh). Ported from FortPolio's js/core/alerts.js.
// Only works while this tab is open -- no backend to send a real push
// notification from.

export async function ensurePermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try { return (await Notification.requestPermission()) === "granted"; } catch { return false; }
}

// Returns true if currently triggered (for a 🔔 badge); fires a
// notification only the first time it crosses, tracked via a
// `triggered` flag written onto the alert object itself.
export function check(priceAlerts, id, label, price) {
  const alert = priceAlerts[id];
  if (!alert || price == null) return false;
  const hitAbove = alert.above != null && price >= alert.above;
  const hitBelow = alert.below != null && price <= alert.below;
  const isTriggered = hitAbove || hitBelow;
  if (isTriggered && !alert.triggered) {
    fire(`🔔 ${label}`, hitAbove ? `Över ${alert.above} (nu ${price})` : `Under ${alert.below} (nu ${price})`);
  }
  alert.triggered = isTriggered;
  return isTriggered;
}

function fire(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body }); } catch { /* some browsers require a service worker for this */ }
  }
}
