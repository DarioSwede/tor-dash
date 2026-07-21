# Security checklist

A living list, not a one-time setup doc. Check items off directly here on
GitHub (open the file, hit edit, tick the box, commit) as you do them —
GitHub also lets you toggle task-list checkboxes straight from the file
view if you have write access.

## One-time hardening

- [ ] 2FA enabled on the GitHub account itself — github.com/settings/security.
      This is the actual weakest link: whoever can push to `main` controls
      every line of code every visitor's browser runs, including the
      passkey and encryption logic. Prefer a security key/passkey over
      SMS if you turn it on.
- [ ] 2FA enabled on the Supabase account (dashboard login) — this becomes
      the *only* account-recovery path once magic link is off below, so
      it needs to be at least as strong as the thing it's backing up.
- [ ] Email/magic-link sign-in disabled in Supabase: Authentication →
      Providers → Email, turn the whole provider off (not just "Confirm
      email").
- [ ] "Allow new users to sign up" disabled in Supabase: Authentication →
      Settings — belt-and-suspenders alongside the above.
- [ ] At least two independent passkeys registered (Settings → "Add a
      passkey") — primary device plus a backup (hardware security key,
      or a second device's Touch ID/Windows Hello).
- [ ] Backup passkey stored physically separate from the primary device.
- [ ] Backup passkey actually tested — signed in using *only* it, not
      just registered and assumed to work.
- [ ] All migrations through the latest number in `supabase/migrations/`
      have been run in the Supabase SQL Editor, in order.
- [ ] `log-access` Edge Function deployed: `supabase functions deploy log-access`
      (needs the Supabase CLI logged in and linked to the project). Until
      this is deployed, gate views/sign-in attempts silently stop being
      logged — the fetch fails quietly by design (logging must never
      block sign-in), so there's no visible error if you forget this step.

## Recurring

- [ ] Skim the dashboard's Log tab now and then for unexpected
      `signin_attempt` / `signin_failure` rows.
- [ ] Bump the pinned `@supabase/supabase-js` CDN version in
      `web/index.html` occasionally (see the comment in
      `web/shell/supabase-client.js` — no auto-update).
- [ ] Re-check GitHub 2FA status once in a while — it can lapse silently
      if a recovery method gets removed.

## Known trade-offs (accepted, not bugs — just worth remembering)

- `access_log` writes are rate-limited per IP (20/10min, see
  `supabase/migrations/0010_access_log_rate_limit.sql`) but have no
  CAPTCHA/Turnstile-style check — a distributed spammer could still
  trickle entries in slowly. Fine for a personal single-user log.
- No password/email fallback exists once magic link is off. If every
  registered passkey is ever lost, the Supabase dashboard (Authentication
  → Users) is the only way back in — which is exactly why the two items
  above about Supabase 2FA and a tested backup passkey matter.
- The GitHub repo is public: the full source, database schema, and
  architecture are visible to anyone, not just whatever `web/` serves to
  the deployed page. Not exploitable on its own (RLS + WebAuthn are the
  real gate), but worth being deliberate about what goes in commit
  messages, code comments, and the README.
