import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_ENVELOPES = 20;
const MAX_BODY_BYTES = 8_000_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  const epk = envelope.epk as Record<string, unknown> | null;
  return envelope.v === 1
    && envelope.alg === "ECDH-P256+HKDF-SHA256+AES-256-GCM"
    && typeof envelope.key_id === "string"
    && typeof envelope.iv === "string"
    && typeof envelope.ciphertext === "string"
    && envelope.iv.length <= 64
    && envelope.ciphertext.length <= MAX_BODY_BYTES
    && epk?.kty === "EC"
    && epk?.crv === "P-256"
    && typeof epk?.x === "string"
    && typeof epk?.y === "string";
}

Deno.serve(async (req) => {
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method not allowed" }, 405);
  const token = req.headers.get("x-calendar-bridge-token") || "";
  if (token.length < 32 || token.length > 256) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const tokenHash = await sha256(token);
  const { data: credential, error: credentialError } = await supabase
    .from("calendar_bridge_tokens")
    .select("owner_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (credentialError || !credential?.owner_id) return json({ error: "unauthorized" }, 401);

  // Public device keys are safe to return to the authenticated bridge. The
  // corresponding private keys are non-extractable and remain in each
  // registered dashboard browser's IndexedDB.
  if (req.method === "GET") {
    const { data: keys, error } = await supabase
      .from("encryption_keys")
      .select("id, public_key_jwk")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(MAX_ENVELOPES);
    if (error) return json({ error: "could not read device keys" }, 500);
    return json({ keys: keys || [] });
  }

  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const envelopes = Array.isArray(body.envelopes) ? body.envelopes : null;
  if (!envelopes?.length || envelopes.length > MAX_ENVELOPES || !envelopes.every(validEnvelope)) {
    return json({ error: "invalid encrypted payload" }, 400);
  }

  const { data: activeKeys, error: keyError } = await supabase
    .from("encryption_keys")
    .select("id")
    .eq("active", true);
  if (keyError) return json({ error: "could not validate device keys" }, 500);
  const allowed = new Set((activeKeys || []).map((key) => key.id));
  if (envelopes.some((envelope) => !allowed.has(envelope.key_id as string))) {
    return json({ error: "unknown device key" }, 400);
  }

  const { error: writeError } = await supabase.from("calendar_snapshots").upsert({
    owner_id: credential.owner_id,
    payload_encrypted: envelopes,
    created_at: new Date().toISOString(),
  }, { onConflict: "owner_id" });
  if (writeError) return json({ error: "encrypted calendar write failed" }, 500);
  return json({ ok: true, envelopes: envelopes.length });
});
