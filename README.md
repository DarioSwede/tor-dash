# Tor's dashboard

A personal morning/evening briefing, hosted as a static site on GitHub Pages,
backed by Supabase so it can grow into more than just the brief later
(Sarek gear list, stocks watchlist).

```
tor-dashboard/
├── supabase/migrations/0001_init.sql   # database schema + row-level security
├── web/                                # the GitHub Pages site
│   ├── index.html
│   ├── app.js
│   └── config.example.js               # copy to config.js and fill in
├── scripts/push_snapshot.py            # writes one brief into Supabase
└── .github/workflows/pages.yml         # auto-deploys web/ on every push
```

## Why this shape

- **GitHub Pages is public by default.** Rather than fight that, the page
  itself is public but empty without login — Supabase Auth (magic link)
  gates the data, and Row Level Security restricts every row in the
  database to `darioswede@gmail.com` specifically, not just "anyone with
  an account." Anon key being visible in the page source is expected and
  safe with Supabase; the security boundary is the database policy, not
  hiding the key.
- **Claude does the gathering, Supabase just stores the result.** Claude's
  scheduled task already has the mail/calendar/chat connections and does
  the gather → sort → write reasoning. It writes one JSON snapshot per
  run; `push_snapshot.py` is the only thing that talks to Supabase, using
  a service-role key that never reaches the browser.
- **Two more tables already exist** (`sarek_gear`, `stocks_watchlist`) so
  wiring those up later doesn't require a schema migration first — just a
  new push script and a new section in the frontend.

## Command Center

The signed-in landing page is `web/modules/command-center/`. It is a
responsive operational overview that reuses the latest brief, open todos,
portfolio and Sarek pack list without replacing their full modules.

`adapters.js` is the data boundary. The view only consumes its normalized
output, so Marketplace and Veteran can use clearly labelled mock data today
and later switch to private APIs without changing the layout. All adapters
fail soft: an unavailable source renders an honest empty/unknown state
instead of preventing the rest of the dashboard from loading.

For calendars already visible in Apple Calendar, `mac-bridge/` is the
source. Its small EventKit app receives read-only Calendar access and encrypts
the complete rolling event window once for every registered dashboard device
before uploading it through the token-scoped `calendar-sync` function. It runs
every 15 minutes with a user LaunchAgent. Supabase stores only ECDH/AES-GCM
envelopes in `calendar_snapshots`; titles, locations, calendar names and dates
are never stored in plaintext. The browser can decrypt its envelope only after
YubiKey/passkey sign-in, using its non-extractable local private key.

### Automatic local preview

Run `scripts/install-local-preview.sh` once to install the macOS LaunchAgent.
It serves `web/` at `http://127.0.0.1:4173/`, starts automatically at login,
and restarts if the process stops. The installer copies the current preview
into `~/Library/Application Support/TorDash/preview` because macOS background
services cannot reliably read project files from Documents. Run the installer
again after local code changes, or `scripts/uninstall-local-preview.sh` to
remove it.

## Workflow

- **Restore point before any large/risky change.** Before a big visual
  redesign, a structural rewrite, or anything else non-trivial to hand-undo,
  push a `backup/<short-description>-<date>` branch at the current `main`
  HEAD first (`git branch backup/... && git push -u origin backup/...`),
  *then* make the change directly on `main` as usual. Reverting is then
  just checking that branch back out — no need to hand-reconstruct what
  changed. (Annotated tags would be the more usual tool for this, but this
  repo's environment's git proxy 403s on tag pushes — a plain branch works
  fine and is just as easy to restore from, so that's the standard here.)
  Small, easily-reversible tweaks (a color, a spacing value, a copy change)
  don't need one — use judgment.

## One-time setup

1. **Create a Supabase project** at supabase.com (free tier is enough).
   Note down, from Project Settings → API:
   - Project URL
   - `anon` `public` key
   - `service_role` key (keep this one secret — never commit it)

2. **Run the schema.** In the Supabase SQL Editor, paste and run
   `supabase/migrations/0001_init.sql`.

3. **Turn on email auth.** Authentication → Providers → Email should
   already be on by default; that's what powers the magic-link sign-in.
   Optionally, under Authentication → Settings, restrict sign-ups so only
   `darioswede@gmail.com` can request a link (the RLS policy already
   blocks everyone else from seeing data either way — this is belt and
   suspenders).

4. **Fill in the frontend config.**
   ```
   cp web/config.example.js web/config.js
   ```
   Edit `web/config.js` with the Project URL and `anon` key from step 1.
   This file is safe to commit (see "Why this shape" above).

5. **Push to GitHub**, then in the repo: Settings → Pages → Source:
   "GitHub Actions". The included workflow (`.github/workflows/pages.yml`)
   deploys `web/` automatically on every push to `main`.

6. **Let Claude reach Supabase.** In Claude/Cowork Settings → Capabilities,
   add the project's `*.supabase.co` domain to the network allowlist —
   without this, the scheduled task's push step will fail to connect.

7. **Wire up the scheduled task.** Update the existing `morning-brief`
   scheduled task (and add an `evening-brief` one) so that after it
   gathers and sorts the day's content, it also:
   - writes the result as JSON matching the payload shape below to a file
     (e.g. `brief.json`)
   - runs:
     ```
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
       python3 scripts/push_snapshot.py --kind morning --date 2026-07-19 --payload-file brief.json
     ```
   Ask Claude to do this step once the Supabase project exists — it needs
   the URL and service-role key to fill in.

## Payload shape

`app.js` renders whatever JSON is in `briefing_snapshots.payload`. Shape:

```jsonc
{
  "day_name": "Sunday",
  "date_label": "July 19 2026",
  "headline": "The whole day is yours, Tor — good day to get the Sarek list sorted.",
  "svg": "<svg viewBox=\"0 0 840 170\">...</svg>",   // pre-rendered terrain drawing
  "acts": [
    { "time": "7 AM – 12 PM", "note": "No meetings on the calendar." },
    { "time": "12 – 5 PM", "note": "Still nothing scheduled." },
    { "time": "5 PM onward", "note": "Open through the evening too." }
  ],
  "tomorrow_line": "Last day of Vindelälvsloppet.",    // optional one-line heads-up on tomorrow; omit/null for none
  "quiet_line": "Nothing needs you this morning.",     // or null if the two lists below have content
  "needs_attention": [
    { "title": "...", "url": null, "sentence": "...", "button": { "label": "...", "href": "https://..." } }
  ],
  "resolved": [
    { "title": "...", "url": null, "sentence": "..." }
  ],
  "sections": [
    { "heading": "Tasks/to-dos", "items": [ { "title": "...", "sentence": "..." } ] },
    { "heading": "Bakgrund", "plain": true, "items": [ { "title": "...", "sentence": "..." } ] },
    { "heading": "Väder Stockholm", "plain": true, "source": "Open-Meteo", "items": [ { "title": "...", "sentence": "..." } ] }
  ],
  "service_status": [                                  // optional, see "Driftstatus" below
    { "name": "Telia", "level": "ok", "text": "Inga kända driftstörningar", "link": "https://..." }
  ]
}
```

`url` and `button` are optional per item; omit or set to `null` when there's
nothing to link.

A section's optional `source` renders as a small, deliberately muted line
right under its heading — provenance (e.g. `"Open-Meteo"`), not content.
Omit it when a section's content doesn't come from one attributable place.

A section whose `heading` is exactly `"Väder Stockholm"` is special-cased
by module.js: instead of appearing in the normal sections list, its first
item (+ `source`) renders as a hero block right under the header, centered
under the `svg` weather icon — matched by heading text, not a dedicated
payload field, so the payload shape itself doesn't change. Keep that exact
heading string when building it.

A section's `plain: true` renders its items as an always-visible title +
sentence (no chevron, no tap-to-expand) instead of the normal collapsed-
until-tapped list. Use it for short, low-stakes context that's meant to be
read at a glance, not investigated — right now that's just the multi-day
calendar background items below, but the flag itself isn't specific to
those.

**Multi-day calendar events** (someone's vacation, a race/event spanning
several days) that are still running today are worth a line even though
they're not actionable — put them in a `"plain": true` "Bakgrund" section.
State how long the event runs and how much is left, plus which calendar it
came from, abbreviated (a short name, not "according to the X calendar"):
e.g. `"13 juli–10 augusti, 18 dagar kvar · Nettan"` rather than "Enligt
Nettans kalender, till 10 augusti."

**`tomorrow_line`** is a single short fact about tomorrow (a meeting worth
knowing about a day ahead, the last day of a running event, anything that's
useful to see today rather than only in tomorrow's own brief). The frontend
prefixes it with "Imorgon: " itself, so the string should just be the fact
("Vindelälvsloppets sista dag."), not restate "tomorrow". Omit or set to
`null` on days with nothing worth a heads-up about — most days.

**Driftstatus (service status):** the brief shows a Driftstatus card as one
horizontal strip of service dots. A healthy day is just a line of green
with nothing to read; only degraded services get a written explanation
underneath (amber for a disruption, red for an outage, worst first).
`unknown` — a check that couldn't run — stays a quiet grey dot with the
reason in its tooltip, and deliberately counts as neither, since "I
couldn't check" is not evidence of an outage.

Most of the card is *not* pushed in the payload: it's fetched live in the
browser on every render, because an hour-stale "BankID fungerar" is worth
nothing at the moment you actually need it. Anything published as an
Atlassian Statuspage (GitHub, Supabase, BankID, Claude, OpenAI — see
`STATUSPAGE_SOURCES` in `web/modules/morning-brief/status-check.js`) is
read client-side from its public, CORS-open `/api/v2/summary.json`. Adding
another such service is one line in that list; nothing here changes.

`service_status` is only for sources the browser *can't* read — currently
Telia, Gmail and Loopia. Fill it from `scripts/status_check.py`:
```
python3 scripts/status_check.py                     # -> JSON array, paste in as service_status
python3 scripts/status_check.py --only gmail
```
`level` is one of `ok` / `warn` / `down` / `unknown`. Why each one is stuck
server-side, and how much to trust it:

| Source | Why not client-side | Reliability |
|---|---|---|
| Gmail | Google's Workspace dashboard, not Statuspage, and not CORS-open | Good — real documented JSON feed, not a scrape |
| Telia | HTML only, no CORS, no API | Scrape; matches visible phrases, not markup |
| Loopia mail | Needs a raw TCP socket, which no browser has | Best of the three *when the network allows it* — it talks to the actual mail server instead of reading about it |

**Loopia mail** answers a deliberately narrow question — "is the mailbox for
`torbjornzimmerman.se` reachable right now" — and does it by probing rather
than by reading a status page, in three layers, most conclusive first:

1. **IMAPS greeting** on `mailcluster.loopia.se:993`. A real `* OK …` is
   proof the mail service is serving, which no status page can give you. No
   credentials are involved — the greeting precedes any `LOGIN`.
2. **HTTPS to `webmail.loopia.se`** — weaker (the front end being up doesn't
   prove IMAP is), but survives environments that only allow HTTP(S).
3. **DNS**. If the mail host doesn't resolve, something is genuinely wrong;
   if it resolves but neither probe could run, that's `unknown`, not `ok`.

The layering matters because a blocked probe must never read as an outage —
a firewall on our side is not evidence about Loopia. Measured in the dev
environment 2026-07-26: DNS works, raw TCP to 993/143/465 times out, and
non-allowlisted HTTPS 403s, so without an allowlist entry this correctly
degrades to `unknown`. If raw TCP can't be allowed at all, an external
uptime monitor doing a real IMAP probe (UptimeRobot's free tier does port
checks and has a JSON API) would be the stronger answer.

Services in `SERVER_CHECKED` render a chip **whether or not** the payload
carries a result for them — an unchecked service shows grey with the reason
in its tooltip rather than disappearing. Without that, a service silently
vanishes whenever the snapshot predates the check, which reads as a bug.

Every check fails **soft**: any network error, unexpected shape or
unrecognized wording returns `unknown` rather than a confident `ok`, since
a status check that wrongly says "fine" is worse than one that admits it
doesn't know. Omit `service_status` entirely and the card just shows the
live-checked services.

Two operational caveats: none of the three were verifiable against their
live sources when written (this dev environment's proxy 403s telia.se,
google.com and loopia.se, and times out on raw TCP to any mail port), and
each check's hosts have to be on the scheduled task's network allowlist —
same constraint as `*.supabase.co` — or it returns `unknown` every run:
`telia.se`, `www.google.com`, and for Loopia mail
`mailcluster.loopia.se:993` (the real check) plus `webmail.loopia.se` (the
HTTPS fallback).

Downdetector is deliberately not a source anywhere here: it has no official
public API, so every "Downdetector API" in the wild is an unofficial
scraper of a Cloudflare-protected page. StatusGator does have an API on all
plans including free, and covers ~3 500 services (Telia, Tele2, Swedbank…) —
worth revisiting if the scrapes above become annoying, but it needs an
account and an API key.

**Väder (weather) section:** built from `scripts/weather.py`, not a web
search — it calls Open-Meteo (free, no API key) and prints structured
JSON (current condition, today's high/low, tonight's low, tomorrow's
outlook). Run it before writing the brief:
```
python3 scripts/weather.py                          # Stockholm by default
python3 scripts/weather.py --lat 59.33 --lon 18.07 --place Stockholm
```
and turn the result into the "Väder Stockholm" plain section's one-line
sentence. Requires `api.open-meteo.com` on the scheduled task's network
allowlist (same mechanism as the Supabase domain in step 6 above).

## Arkiv (receipts & bookings)

Its own module (`web/modules/archive/`), backed by
`supabase/migrations/0018_archive.sql`. Exists for a concrete need: trips
like Sarek and Holland generate receipts that later have to be reported,
and those must not sit scattered in an inbox where they get missed — which
is exactly how the IKEA receipt was lost on 2026-07-26.

Two design points worth keeping:

**Review queue, not direct filing.** The hourly Routine may only insert
rows with `status = 'review'`; nothing counts as archived until Dario
presses Spara in the UI. A misread newsletter landing in an expense report
is worse than a missed receipt, because nobody notices until someone else
audits it. The queue renders at the top of the page and disappears entirely
when empty.

**Both a link and the file.** `email_link` takes you to the original in
context; `file_path` is what survives the mail being deleted and what you
can actually hand over when reporting. The `archive-files` bucket is
**private** (unlike `gate-backgrounds`, which must be public because it
renders before sign-in), so the UI uses `createSignedUrl`, never
`getPublicUrl` — a receipt should not be reachable from a guessed URL.

`email_message_id` carries a partial unique index. That's the dedupe: the
Routine sweeps the same 7-day window every hour and would otherwise
recreate the same receipt endlessly, including ones already discarded.

Amounts are summed **per currency, never across** — 3 499 SEK + 412 EUR is
not 3 911 of anything, and a Holland trip will have both.

## Not done yet (on purpose)

- `sarek_gear` and `stocks_watchlist` tables exist but nothing writes to
  or reads from them yet — next steps when that's prioritized.
- Attachments are uploaded by hand for now. The Routine files the metadata
  and the link; pulling the PDF out of the mail and into the bucket
  server-side is the obvious next step.

**Resolved 2026-07-26:** `mail@torbjornzimmerman.se` (Loopia) used to be
outside the automated gather step, since no IMAP connector exists. Loopia
now forwards it server-side to the connected Gmail, so it is covered. Note
that the forward was the right fix rather than Gmail's own "check mail from
other accounts": that uses POP3 and races the Outlook app on the same
mailbox — evidence being exactly one fetched message in ten days, archived
straight past the inbox.
