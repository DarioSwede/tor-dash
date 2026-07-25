#!/usr/bin/env python3
"""
Check the service-status sources the *browser* can't read, and emit them in
the shape the brief's Driftstatus card expects (payload.service_status).

Division of labour, so this script stays small: anything published as an
Atlassian Statuspage (GitHub, Supabase, BankID, Claude, OpenAI, ...) is
fetched live in the browser instead -- those endpoints are CORS-open, and
a live check beats an hour-stale one. See
web/modules/morning-brief/status-check.js. What's left, and all this script
handles, is the sources that *can't* be read client-side: Swedish telcos
and banks, which publish driftinformation as plain HTML with no CORS
headers and no JSON API.

Sources: Telia (HTML scrape), Gmail (Google's Workspace status JSON feed --
real JSON, but not Statuspage and not CORS-open, so it can't be read from
the browser either) and Loopia (HTML scrape of driftbloggen.se).

Usage:
    python3 scripts/status_check.py                  # all sources below
    python3 scripts/status_check.py --only telia

Prints one JSON array to stdout, ready to drop into the brief payload as
`service_status`:
    [
      {"name": "Telia", "level": "ok", "text": "Inga kända driftstörningar",
       "link": "https://www.telia.se/privat/support/driftinformation"}
    ]

`level` is one of ok / warn / down / unknown, matching the dot colours in
web/modules/morning-brief/module.css.

-------------------------------------------------------------------------
IMPORTANT -- read before trusting this
-------------------------------------------------------------------------
1. Telia publishes no API. This reads their public driftinformation page
   and looks for known Swedish phrasing. That is a scrape, and Dario
   explicitly accepted the risk: it can break silently whenever Telia
   rewords or restructures that page. It is written to be as
   markup-independent as possible (it matches on visible *phrases*, not on
   CSS classes or DOM structure, which change far more often) and to fail
   to "unknown" rather than to a confident wrong answer -- but it is still
   a scrape, not a contract.
2. NONE of these were verified against their live sources when written: the
   environment they were developed in blocks outbound requests to telia.se,
   google.com and driftbloggen.se (the proxy answers 403 to CONNECT), so
   the phrase lists and the Gmail feed's field names come from documented/
   standard shapes rather than observed responses. The first real run is
   the real test -- if something reports "unknown" with an HTTP error,
   that's this caveat, not a bug in the caller.
3. The scheduled task's environment has its own network allowlist.
   telia.se, www.google.com and driftbloggen.se each have to be on it, or
   that source returns "unknown" every run. Same constraint
   push_snapshot.py documents for *.supabase.co.
4. Every check is written to fail *soft*: any network error, unexpected
   shape or unrecognized wording returns level "unknown" (a neutral grey
   dot in the UI, with the reason in its tooltip) rather than a confident
   "ok". A status check that wrongly says "fine" is worse than one that
   admits it doesn't know.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

# A browser-ish UA: not to disguise anything, just because some Swedish
# telco sites answer a bare urllib UA with a bot-block page instead of the
# real content, which would make every run report a false "unknown".
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

TELIA_LINK = "https://www.telia.se/privat/support/driftinformation"

# Checked in order, first match wins -- so the "no disruptions" all-clear
# has to be matched *before* the looser disruption keywords, since that
# sentence itself contains the word "driftstörningar".
_TELIA_RULES = [
    ("ok", [
        r"inga\s+k(ä|a)nda\s+driftst(ö|o)rningar",
        r"inga\s+driftst(ö|o)rningar",
        r"inga\s+p(å|a)g(å|a)ende\s+st(ö|o)rningar",
        r"alla\s+tj(ä|a)nster\s+fungerar",
    ]),
    ("down", [
        r"st(ö|o)rre\s+driftst(ö|o)rning",
        r"omfattande\s+st(ö|o)rning",
        r"allvarlig\s+st(ö|o)rning",
    ]),
    ("warn", [
        r"p(å|a)g(å|a)ende\s+driftst(ö|o)rning",
        r"p(å|a)g(å|a)ende\s+st(ö|o)rning",
        r"vi\s+har\s+problem",
        r"planerat\s+underh(å|a)ll",
        r"driftst(ö|o)rning",
    ]),
]

_TEXT_BY_LEVEL = {
    "ok": "Inga kända driftstörningar",
    "warn": "Möjlig driftstörning – kolla sidan",
    "down": "Större driftstörning",
    "unknown": "Kunde inte kontrolleras",
}


def _fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def _strip_html(html: str) -> str:
    """Visible text only, lowercased, whitespace-collapsed.

    Scripts and styles go first: Telia's pages ship a lot of inline JSON
    and CSS, and matching phrases inside those would produce confident
    nonsense (a JS string "driftstorning" in an analytics blob is not a
    statement about the network).
    """
    html = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html)
    html = re.sub(r"(?s)<!--.*?-->", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    text = (
        text.replace("&nbsp;", " ").replace("&amp;", "&")
        .replace("&auml;", "ä").replace("&ouml;", "ö").replace("&aring;", "å")
    )
    return re.sub(r"\s+", " ", text).lower()


def check_telia(timeout=20):
    try:
        html = _fetch(TELIA_LINK, timeout)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        # Never raise: a failed status check must not be able to take the
        # whole brief push down with it.
        return {
            "name": "Telia", "level": "unknown",
            "text": f"Kunde inte nå driftinformation ({exc.__class__.__name__})",
            "link": TELIA_LINK,
        }

    text = _strip_html(html)
    for level, patterns in _TELIA_RULES:
        if any(re.search(p, text) for p in patterns):
            return {"name": "Telia", "level": level, "text": _TEXT_BY_LEVEL[level], "link": TELIA_LINK}

    # Page fetched fine but said nothing recognizable -- most likely Telia
    # reworded it. "unknown" is the honest answer; claiming "ok" here is
    # exactly the failure mode worth avoiding, since it would look like a
    # working check right up until it mattered.
    return {
        "name": "Telia", "level": "unknown",
        "text": "Okänt svar från driftinformation",
        "link": TELIA_LINK,
    }


# ---------------------------------------------------------------------------
# Gmail -- Google Workspace Status Dashboard.
#
# Not an Atlassian Statuspage, so it can't join the browser-side list, but
# unlike Telia it *is* real JSON rather than a scrape: the dashboard's own
# "JSON History" export, which Google documents for exactly this purpose
# (pulling status into your own monitoring). Each entry looks roughly like:
#   { "id": ..., "begin": "...", "end": "...",           # `end` absent while active
#     "external_desc": "Gmail is experiencing ...",
#     "status_impact": "SERVICE_DISRUPTION" | "SERVICE_OUTAGE" | "SERVICE_INFORMATION",
#     "affected_products": [ { "title": "Gmail", ... } ], ... }
# so "is Gmail broken right now" is: any entry naming Gmail that has no
# `end` yet. Everything is read defensively (.get, isinstance) -- an
# unexpected shape must degrade to "unknown", never raise.
# ---------------------------------------------------------------------------

GMAIL_FEED = "https://www.google.com/appsstatus/dashboard/incidents.json"
GMAIL_LINK = "https://www.google.com/appsstatus/dashboard/"

_GMAIL_LEVEL_BY_IMPACT = {
    "SERVICE_OUTAGE": "down",
    "SERVICE_DISRUPTION": "warn",
    "SERVICE_INFORMATION": "warn",
}


def _mentions_gmail(incident):
    products = incident.get("affected_products")
    if isinstance(products, list):
        for p in products:
            if isinstance(p, dict) and "gmail" in str(p.get("title", "")).lower():
                return True
    # Older/simpler entries carry the service on the incident itself.
    return "gmail" in f"{incident.get('service_name','')} {incident.get('service_key','')}".lower()


def check_gmail(timeout=20):
    try:
        raw = _fetch(GMAIL_FEED, timeout)
        data = json.loads(raw)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return {
            "name": "Gmail", "level": "unknown",
            "text": f"Kunde inte nå Googles statusflöde ({exc.__class__.__name__})",
            "link": GMAIL_LINK,
        }

    if not isinstance(data, list):
        return {"name": "Gmail", "level": "unknown", "text": "Oväntat svar från Googles statusflöde", "link": GMAIL_LINK}

    # No `end` == still open. The feed is history, so the vast majority of
    # entries are resolved and simply don't apply.
    active = [
        i for i in data
        if isinstance(i, dict) and not i.get("end") and _mentions_gmail(i)
    ]
    if not active:
        return {"name": "Gmail", "level": "ok", "text": _TEXT_BY_LEVEL["ok"], "link": GMAIL_LINK}

    # Report the most severe open incident, not just the first one listed.
    _RANK = {"down": 2, "warn": 1}
    worst = max(active, key=lambda i: _RANK.get(_GMAIL_LEVEL_BY_IMPACT.get(i.get("status_impact"), "warn"), 1))
    level = _GMAIL_LEVEL_BY_IMPACT.get(worst.get("status_impact"), "warn")
    desc = (worst.get("external_desc") or "").strip().replace("\n", " ")
    if len(desc) > 140:
        desc = desc[:137].rstrip() + "…"
    return {"name": "Gmail", "level": level, "text": desc or _TEXT_BY_LEVEL[level], "link": GMAIL_LINK}


# ---------------------------------------------------------------------------
# Loopia -- no status API and no status page of their own; their support wiki
# points at driftbloggen.se for current/planned disruptions. So this is a
# scrape with the same caveats as Telia, and one extra: a *blog* is a poor
# "is it down right now" source, because a two-year-old post about an
# outage matches the same words as a live one. This therefore only reports
# a problem when disruption wording appears alongside a current-year date
# near the top of the page, and otherwise says "ok" only on an explicit
# all-clear -- falling back to "unknown" rather than guessing.
#
# Of the three sources here this is the least certain, precisely because
# Loopia publishes no status contract at all. If Dario has a page he
# actually trusts for Loopia, pointing LOOPIA_LINK at it is the whole fix.
# ---------------------------------------------------------------------------

LOOPIA_LINK = "https://www.driftbloggen.se/"

_LOOPIA_DISRUPTION = [
    r"p(å|a)g(å|a)ende\s+driftst(ö|o)rning",
    r"akut\s+driftst(ö|o)rning",
    r"driftst(ö|o)rning",
    r"st(ö|o)rning",
]
_LOOPIA_CLEAR = [
    r"inga\s+k(ä|a)nda\s+driftst(ö|o)rningar",
    r"inga\s+p(å|a)g(å|a)ende\s+driftst(ö|o)rningar",
    r"inga\s+aktuella\s+st(ö|o)rningar",
]


def check_loopia(timeout=20):
    from datetime import datetime

    try:
        html = _fetch(LOOPIA_LINK, timeout)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "name": "Loopia", "level": "unknown",
            "text": f"Kunde inte nå driftbloggen ({exc.__class__.__name__})",
            "link": LOOPIA_LINK,
        }

    text = _strip_html(html)
    if any(re.search(p, text) for p in _LOOPIA_CLEAR):
        return {"name": "Loopia", "level": "ok", "text": _TEXT_BY_LEVEL["ok"], "link": LOOPIA_LINK}

    # Only the top of the page: on a reverse-chronological blog that's the
    # recent material, and it keeps an old archived incident further down
    # from reading as today's news.
    head = text[:2500]
    year = str(datetime.now().year)
    if year in head and any(re.search(p, head) for p in _LOOPIA_DISRUPTION):
        return {
            "name": "Loopia", "level": "warn",
            "text": "Möjlig driftstörning i år – kolla driftbloggen",
            "link": LOOPIA_LINK,
        }

    return {
        "name": "Loopia", "level": "unknown",
        "text": "Ingen tydlig statusuppgift på driftbloggen",
        "link": LOOPIA_LINK,
    }


CHECKS = {"telia": check_telia, "gmail": check_gmail, "loopia": check_loopia}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=sorted(CHECKS), help="Run just one source instead of all of them")
    args = ap.parse_args()

    names = [args.only] if args.only else sorted(CHECKS)
    print(json.dumps([CHECKS[n]() for n in names], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
