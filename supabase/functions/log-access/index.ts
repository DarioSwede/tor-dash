// Rate-limited write path for access_log. The browser used to insert
// into access_log directly under an "anyone can insert" RLS policy --
// necessary since unauthenticated attempts have to be loggable by
// definition, but with no rate limit anyone could flood the table and
// bury real signal in spam (see supabase/migrations/0010_access_log_
// rate_limit.sql). This function is now the only way in: it checks the
// *actual* request source IP -- read from the platform-set
// X-Forwarded-For header, not anything the client claims -- against a
// per-IP rate limit, then writes using the service_role key (bypasses
// RLS, since the table no longer grants anon/authenticated insert at
// all after that migration).
//
// The client still does its own ipify/ipapi.co lookup (see
// web/shell/network.js) for the *displayed* IP/ISP in the log -- that's
// cosmetic, shown back to the visitor's own browser, and unrelated to
// the rate-limit decision here, which only ever looks at the network-
// level source IP.
//
// Deploy: supabase functions deploy log-access
// (verify_jwt = false is set in supabase/config.toml -- this must be
// callable by signed-out visitors, who have no Supabase session/JWT.)

import { createClient } from "npm:@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 min
const ALLOWED_EVENTS = new Set(["gate_view", "signin_attempt", "signin_success", "signin_failure"]);

// Update this if the site ever moves off GitHub Pages / gets a custom domain.
const ALLOWED_ORIGIN = "https://darioswede.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function clip(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length ? value.slice(0, max) : null;
}

Deno.serve(async (req) => {
  const headers = corsHeaders();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers });
  }

  const sourceIp = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: allowed, error: rlError } = await supabase.rpc("check_and_bump_rate_limit", {
    p_ip: sourceIp,
    p_max: RATE_LIMIT_MAX,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (rlError) {
    return new Response(JSON.stringify({ error: "rate limit check failed" }), { status: 500, headers });
  }
  if (!allowed) {
    return new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers });
  }

  const event = body.event;
  if (typeof event !== "string" || !ALLOWED_EVENTS.has(event)) {
    return new Response(JSON.stringify({ error: "invalid event" }), { status: 400, headers });
  }

  const { error: insertError } = await supabase.from("access_log").insert({
    event,
    method: clip(body.method, 40),
    ip_v4: clip(body.ip_v4, 64),
    ip_v6: clip(body.ip_v6, 64),
    org: clip(body.org, 200),
    user_agent: clip(body.user_agent, 300),
    detail: clip(body.detail, 300),
  });
  if (insertError) {
    return new Response(JSON.stringify({ error: "insert failed" }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
});
