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
2. It was NOT verified against the live page when written: the environment
   it was developed in blocks outbound requests to telia.se (the proxy
   answers 403 to CONNECT), so the phrase list below is based on Telia's
   documented/standard wording rather than an observed response. The first
   real run is the real test -- if it reports "unknown" with an HTTP error,
   that's this caveat, not a bug in the caller.
3. The scheduled task's environment has its own network allowlist. telia.se
   has to be on it, or every run here returns "unknown". That's the same
   constraint push_snapshot.py documents for *.supabase.co.
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
        req = urllib.request.Request(TELIA_LINK, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            html = resp.read().decode("utf-8", "replace")
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


CHECKS = {"telia": check_telia}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=sorted(CHECKS), help="Run just one source instead of all of them")
    args = ap.parse_args()

    names = [args.only] if args.only else sorted(CHECKS)
    print(json.dumps([CHECKS[n]() for n in names], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
