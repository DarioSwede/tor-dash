// The one configured Supabase client for the whole app. `window.supabase`
// comes from the pinned CDN <script> tag in index.html (must be
// @supabase/supabase-js >=2.105.0 for the Passkeys API used in auth.js —
// currently pinned to 2.110.7, the latest at time of writing; bump the
// index.html script tag manually on occasion, there's no auto-update).
//
// RLS in supabase/migrations/0001_init.sql restricts every row to one
// email, so the anon key in config.js being public is fine by design.

const cfg = window.DASHBOARD_CONFIG || {};

export const configOk = Boolean(cfg.SUPABASE_URL) && !cfg.SUPABASE_URL.includes("YOUR-PROJECT-REF");

export const supabase = configOk
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { experimental: { passkey: true } },
    })
  : null;
