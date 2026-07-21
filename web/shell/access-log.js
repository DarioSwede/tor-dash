// Records who's hitting the gate: page views, sign-in attempts,
// successes, and failures, each tagged with IP + best-effort ISP name
// (reusing network.js's fetchNetworkStatus). Insert-only from here —
// anyone can write a row (see supabase/migrations/0009_access_log.sql),
// nobody but the owner can read them back. This is deliberately
// unauthenticated logging: the whole point is to see attempts from
// people who never got in, so it can't require a session to write.

import { fetchNetworkStatus } from "./network.js";

// statusPromise lets callers that fire several events per page view (the
// gate: view, then attempt, then success/failure) share one network
// lookup instead of tripling the ipify/ipapi.co round trips per visit —
// pass the same in-flight fetchNetworkStatus() promise to each call.
export async function logAccessEvent(supabase, event, { method, detail, statusPromise } = {}) {
  try {
    const status = await (statusPromise || fetchNetworkStatus());
    await supabase.from("access_log").insert({
      event,
      method: method || null,
      ip_v4: status.v4,
      ip_v6: status.v6,
      org: status.org,
      user_agent: navigator.userAgent.slice(0, 300),
      detail: detail ? String(detail).slice(0, 300) : null,
    });
  } catch {
    // Logging must never block or break sign-in — a failed insert
    // (offline, RLS hiccup, etc.) is silently swallowed.
  }
}
