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
    { "heading": "Bakgrund", "plain": true, "items": [ { "title": "...", "sentence": "..." } ] }
  ]
}
```

`url` and `button` are optional per item; omit or set to `null` when there's
nothing to link.

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

## Not done yet (on purpose)

- `mail@torbjornzimmerman.se` (Loopia IMAP) isn't part of the automated
  gather step — there's no IMAP connector available yet, so that mailbox
  is still manual (webmail) until either a connector shows up or
  forwarding to the connected Gmail is set up.
- `sarek_gear` and `stocks_watchlist` tables exist but nothing writes to
  or reads from them yet — next steps when that's prioritized.
