// Per-device end-to-end encryption for sensitive module data (currently
// the Morning Brief's needs_attention/resolved/sections text, which quotes
// or paraphrases real email/calendar content).
//
// Each device (laptop, phone, ...) generates its own ECDH P-256 keypair
// the first time "Register this device" is used in the Security panel.
// The private key is stored non-extractable in this browser's IndexedDB —
// it can never be exported by any script, including a compromised one —
// and never leaves the device. Only the public key is sent to Supabase
// (table public.encryption_keys). scripts/push_snapshot.py fetches every
// active device's public key and encrypts the payload once per device, so
// any of your signed-in devices can decrypt with its own local key.
//
// There is deliberately no export/backup path: losing a device's local
// storage means re-registering that device and starting fresh for it —
// see the plan doc for why that tradeoff was chosen over a
// passphrase-exportable key.
//
// Envelope shape (identical on both sides, see scripts/push_snapshot.py):
//   { v, alg, key_id, epk: {kty,crv,x,y}, iv, ciphertext }
// Fixed HKDF salt (32 zero bytes) and info string, hardcoded identically
// in both implementations — never ambiguous between them.

const DB_NAME = "tor-dash-crypto";
const STORE = "device-key";
const RECORD_ID = "current";
const HKDF_INFO = new TextEncoder().encode("tor-dash-envelope-v1");
const HKDF_SALT = new Uint8Array(32);

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(RECORD_ID);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id: RECORD_ID, ...record });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function hasDeviceKey() {
  return Boolean(await idbGet());
}

// Generates this device's keypair, stores the private half locally, and
// registers the public half against the signed-in user in Supabase.
// deviceLabel is just a human-readable hint ("MacBook", "iPhone") shown
// in the Security panel — not used cryptographically.
export async function setupEncryption(supabase, deviceLabel) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);

  const { data, error } = await supabase
    .from("encryption_keys")
    .insert({ device_label: deviceLabel, algorithm: "ECDH-P256", public_key_jwk: jwk })
    .select("id")
    .single();
  if (error) throw error;

  await idbPut({ keyId: data.id, privateKey });
  return data.id;
}

// Decrypts whichever envelope in `envelopes` (an array, one per registered
// device) matches this device's stored key_id. Returns null — not an
// error — if this device hasn't been registered yet, or the row predates
// this device's registration; callers should show a "not readable on this
// device yet" state rather than treat that as a load failure.
export async function decryptPayload(envelopes) {
  if (!Array.isArray(envelopes) || !envelopes.length) return null;
  const record = await idbGet();
  if (!record) return null;

  const envelope = envelopes.find((e) => e.key_id === record.keyId);
  if (!envelope) return null;

  const epk = await crypto.subtle.importKey(
    "jwk", envelope.epk, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: epk }, record.privateKey, 256
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveBits"]);
  const aesBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO }, hkdfKey, 256
  );
  const aesKey = await crypto.subtle.importKey("raw", aesBits, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(envelope.iv) }, aesKey, b64ToBytes(envelope.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
