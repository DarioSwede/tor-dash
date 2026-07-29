import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const allowedOrigins = new Set([
  "https://darioswede.github.io",
  "http://localhost",
  "http://127.0.0.1",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://darioswede.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(req, { error: "Du måste vara inloggad." }, 401);

  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return json(req, { error: "Ogiltig session." }, 401);

  const callerId = userResult.user.id;
  const { data: callerProfile, error: profileError } = await admin
    .from("users").select("role").eq("id", callerId).maybeSingle();
  if (profileError || callerProfile?.role !== "admin") {
    return json(req, { error: "Administratörsbehörighet krävs." }, 403);
  }

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* Empty payload. */ }
  const action = String(payload.action || "list");

  if (action === "list") {
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authError) return json(req, { error: authError.message }, 400);
    const ids = authData.users.map((user) => user.id);
    const { data: profiles, error: profilesError } = ids.length
      ? await admin.from("users").select("id,display_name,role").in("id", ids)
      : { data: [], error: null };
    if (profilesError) return json(req, { error: profilesError.message }, 400);
    const roleById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    return json(req, {
      users: authData.users.map((user) => ({
        id: user.id,
        email: user.email || "",
        displayName: roleById.get(user.id)?.display_name || "",
        role: roleById.get(user.id)?.role || "user",
        confirmedAt: user.email_confirmed_at || user.confirmed_at || null,
        lastSignInAt: user.last_sign_in_at || null,
        createdAt: user.created_at,
      })),
    });
  }

  if (action === "invite") {
    const email = String(payload.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(req, { error: "Ange en giltig e-postadress." }, 400);
    }
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://darioswede.github.io/packlista/",
    });
    if (error) return json(req, { error: error.message }, 400);
    return json(req, { invited: true, userId: data.user?.id || null });
  }

  if (action === "set_role") {
    const userId = String(payload.userId || "");
    const role = String(payload.role || "");
    if (!userId || !["user", "admin"].includes(role)) {
      return json(req, { error: "Ogiltig användare eller roll." }, 400);
    }
    if (userId === callerId && role !== "admin") {
      const { count } = await admin.from("users")
        .select("id", { count: "exact", head: true }).eq("role", "admin");
      if ((count || 0) <= 1) {
        return json(req, { error: "Den sista administratören kan inte nedgraderas." }, 400);
      }
    }
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !target.user) return json(req, { error: "Användaren finns inte." }, 404);
    const { error } = await admin.from("users").upsert({
      id: userId,
      display_name: target.user.email?.split("@")[0] || "",
      role,
      updated_at: new Date().toISOString(),
    });
    if (error) return json(req, { error: error.message }, 400);
    return json(req, { updated: true });
  }

  return json(req, { error: "Okänd åtgärd." }, 400);
});
