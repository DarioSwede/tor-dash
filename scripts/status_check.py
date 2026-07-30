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

Sources: Telia and OpenInfra (HTML scrapes), Gmail (Google's Workspace status JSON feed --
real JSON, but not Statuspage and not CORS-open, so it can't be read from
the browser either) and Loopia mail (a live reachability check of the mail
server for torbjornzimmerman.se -- IMAPS greeting, falling back to webmail
over HTTPS, falling back to DNS).

Usage:
    python3 scripts/status_check.py                  # all sources below
    python3 scripts/status_check.py --only openinfra

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
   google.com and loopia.se (the proxy answers 403 to CONNECT), and times
   out on raw TCP to any mail port, so the phrase lists and the Gmail feed's
   field names come from documented/standard shapes rather than observed
   responses. The first real run is the real test -- if something reports
   "unknown" with a network error, that's this caveat, not a bug in the
   caller.
3. The scheduled task's environment has its own network allowlist, and each
   check needs its hosts on it or it returns "unknown" every run -- same
   constraint push_snapshot.py documents for *.supabase.co:
     Telia        telia.se                       (HTTPS)
     OpenInfra    openinfra.com                  (HTTPS)
     Gmail        www.google.com                 (HTTPS)
     Loopia mail  mailcluster.loopia.se:993      (raw TCP -- the real check)
                  webmail.loopia.se              (HTTPS -- weaker fallback)
   Measured in the dev environment 2026-07-26: DNS resolution works, raw TCP
   to 993/143/465 times out, non-allowlisted HTTPS 403s. If raw TCP can't be
   allowed at all, Loopia mail degrades to the webmail HTTPS check, which
   only proves the front end is serving -- an external uptime monitor doing
   a real IMAP probe would be the stronger answer.
4. Every check is written to fail *soft*: any network error, unexpected
   shape or unrecognized wording returns level "unknown" (a neutral grey
   dot in the UI, with the reason in its tooltip) rather than a confident
   "ok". A status check that wrongly says "fine" is worse than one that
   admits it doesn't know.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import re
import sys
import time
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
# OpenInfra -- official status page, but no documented public API.
#
# The page currently states "Vi har förnärvarande inga driftstörningar".
# Match the meaning rather than that typo, and fail closed if the wording or
# page structure changes. The generic word "driftstörningar" alone must not
# count as a fault because it also appears in the all-clear sentence.
# ---------------------------------------------------------------------------

OPENINFRA_LINK = "https://openinfra.com/inga-driftstorningar/"

_OPENINFRA_RULES = [
    ("ok", [
        r"inga\s+driftst(ö|o)rningar",
        r"inga\s+k(ä|a)nda\s+driftst(ö|o)rningar",
        r"inga\s+p(å|a)g(å|a)ende\s+st(ö|o)rningar",
    ]),
    ("down", [
        r"omfattande\s+driftst(ö|o)rning",
        r"st(ö|o)rre\s+driftst(ö|o)rning",
    ]),
    ("warn", [
        r"p(å|a)g(å|a)ende\s+driftst(ö|o)rning",
        r"p(å|a)g(å|a)ende\s+st(ö|o)rning",
        r"planerat\s+underh(å|a)ll",
    ]),
]


def check_openinfra(timeout=20):
    try:
        html = _fetch(OPENINFRA_LINK, timeout)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "name": "OpenInfra", "level": "unknown",
            "text": f"Kunde inte nå driftinformation ({exc.__class__.__name__})",
            "link": OPENINFRA_LINK,
        }

    text = _strip_html(html)
    for level, patterns in _OPENINFRA_RULES:
        if any(re.search(pattern, text) for pattern in patterns):
            return {
                "name": "OpenInfra",
                "level": level,
                "text": _TEXT_BY_LEVEL[level],
                "link": OPENINFRA_LINK,
            }
    return {
        "name": "OpenInfra", "level": "unknown",
        "text": "Okänt svar från driftinformation",
        "link": OPENINFRA_LINK,
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
# Loopia mail -- the actual question is narrow: "is the mailbox for
# torbjornzimmerman.se reachable right now", not "has Loopia blogged about
# an incident". So this talks to the mail server instead of reading about
# it. Three layers, most conclusive first:
#
#   1. IMAPS banner on the mail host (port 993). A real "* OK ..." greeting
#      is proof the mail service is actually serving, which no status page
#      can give you. No credentials involved -- the greeting comes before
#      any LOGIN.
#   2. HTTPS to Loopia's webmail. Weaker (it says the front end is up, not
#      that IMAP is), but it survives environments where only HTTP(S) egress
#      is permitted.
#   3. DNS. If the mail host doesn't even resolve, something is definitely
#      wrong; if it resolves but nothing above could run, that's "unknown",
#      not "ok".
#
# Layering matters because sandboxes differ: measured in the dev environment
# (2026-07-26), raw TCP to 993/143/465 times out and non-allowlisted HTTPS
# gets a 403 from the proxy, while plain DNS resolution works fine. So step 1
# is the one worth having and the one most likely to be blocked -- and a
# blocked step must read as "couldn't check", never as an outage. A firewall
# on our side is not evidence about Loopia.
# ---------------------------------------------------------------------------

LOOPIA_DOMAIN = "torbjornzimmerman.se"
# Loopia points every hosted domain's MX at this shared cluster, so it is the
# host to test even though the mailbox is domain-specific. (An MX lookup
# would be more principled, but needs a DNS library that isn't in the
# stdlib -- and the answer here is a documented constant, not a guess.)
LOOPIA_MAIL_HOST = "mailcluster.loopia.se"
LOOPIA_WEBMAIL = "https://webmail.loopia.se/"
LOOPIA_LINK = LOOPIA_WEBMAIL


def _imap_banner(host, port=993, timeout=12):
    """Return the IMAPS greeting, or raise. Nothing is sent -- read only."""
    import socket
    import ssl

    ip = socket.gethostbyname(host)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((ip, port))
        with ssl.create_default_context().wrap_socket(sock, server_hostname=host) as tls:
            return tls.recv(200).decode("utf-8", "replace").strip()
    finally:
        try:
            sock.close()
        except OSError:
            pass


def check_loopia(timeout=20):
    import socket

    name = "Loopia mail"

    # --- 1. The real thing: does the IMAP server greet us? ---
    try:
        banner = _imap_banner(LOOPIA_MAIL_HOST, timeout=min(timeout, 12))
        if banner.startswith("* OK"):
            return {
                "name": name, "level": "ok",
                "text": f"IMAP svarar för {LOOPIA_DOMAIN}",
                "link": LOOPIA_LINK,
            }
        # Connected, TLS fine, but the greeting isn't an OK -- e.g. "* BYE
        # temporarily unavailable", which is the server explicitly refusing
        # service rather than a network problem on our side.
        return {
            "name": name, "level": "down",
            "text": f"Mailservern nekar anslutning: {banner[:80]}",
            "link": LOOPIA_LINK,
        }
    except (TimeoutError, socket.timeout, socket.gaierror, OSError):
        # Almost certainly our own egress rather than Loopia (a sandbox that
        # only permits HTTP(S) times out here every time), so fall through to
        # the weaker checks instead of calling it an outage.
        pass

    # --- 2. Fallback: is Loopia's webmail serving over HTTPS? ---
    try:
        req = urllib.request.Request(LOOPIA_WEBMAIL, headers={"User-Agent": _UA}, method="HEAD")
        with urllib.request.urlopen(req, timeout=min(timeout, 15)) as resp:
            if 200 <= resp.status < 400:
                return {
                    "name": name, "level": "ok",
                    "text": "Webmail svarar (IMAP kunde inte testas härifrån)",
                    "link": LOOPIA_LINK,
                }
            return {
                "name": name, "level": "warn",
                "text": f"Webmail svarar med HTTP {resp.status}",
                "link": LOOPIA_LINK,
            }
    except urllib.error.HTTPError as exc:
        # A 4xx/5xx from the webmail host is still Loopia answering.
        if exc.code >= 500:
            return {"name": name, "level": "down", "text": f"Webmail svarar HTTP {exc.code}", "link": LOOPIA_LINK}
        return {"name": name, "level": "ok", "text": "Webmail svarar (IMAP kunde inte testas härifrån)", "link": LOOPIA_LINK}
    except (urllib.error.URLError, TimeoutError, OSError):
        pass

    # --- 3. Last resort: does the mail host even resolve? ---
    try:
        socket.gethostbyname(LOOPIA_MAIL_HOST)
        return {
            "name": name, "level": "unknown",
            "text": "Nätverket här tillåter varken IMAP eller HTTPS mot Loopia",
            "link": LOOPIA_LINK,
        }
    except OSError:
        return {
            "name": name, "level": "down",
            "text": f"{LOOPIA_MAIL_HOST} går inte att slå upp i DNS",
            "link": LOOPIA_LINK,
        }


CHECKS = {
    "telia": check_telia,
    "openinfra": check_openinfra,
    "gmail": check_gmail,
    "loopia": check_loopia,
}

SERVICE_META = {
    "gmail": {"category": "Kommunikation", "priority": 5, "method": "Google Workspace statusflöde"},
    "loopia": {"category": "Kommunikation", "priority": 5, "method": "IMAPS → HTTPS → DNS"},
    "telia": {"category": "Anslutning", "priority": 4, "method": "Telias driftinformationssida"},
    "openinfra": {"category": "Anslutning", "priority": 4, "method": "OpenInfras officiella statussida"},
}


def _friendly_unknown(key, result):
    """Replace transport/library errors with useful Swedish operator text."""
    if result.get("level") != "unknown":
        return result
    reason = {
        "gmail": "Googles statusflöde kunde inte verifieras från kontrollmiljön",
        "loopia": "Loopias mailtjänst kunde inte verifieras från kontrollmiljön",
        "telia": "Telias driftinformation kunde inte verifieras från kontrollmiljön",
        "openinfra": "OpenInfras driftinformation kunde inte verifieras från kontrollmiljön",
    }[key]
    result["text"] = reason
    return result


def run_check(key, attempts=3):
    """Retry unknown results with bounded exponential backoff."""
    started = time.monotonic()
    result = None
    used = 0
    for used in range(1, attempts + 1):
        result = CHECKS[key]()
        if result.get("level") != "unknown" or used == attempts:
            break
        time.sleep(0.5 * (2 ** (used - 1)))

    result = _friendly_unknown(key, result or {})
    meta = SERVICE_META[key]
    result.update({
        "service_key": key,
        "category": meta["category"],
        "priority": meta["priority"],
        "method": meta["method"],
        "verified": result.get("level") != "unknown",
        "response_ms": round((time.monotonic() - started) * 1000),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "attempts": used,
    })
    return result


def _supabase_request(url, key, path, body):
    req = urllib.request.Request(
        f"{url.rstrip('/')}{path}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=20):
        return None


def record_results(results):
    """Persist history when the scheduled environment already has credentials."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return False
    rows = [{
        "service_key": item["service_key"],
        "name": item["name"],
        "category": item["category"],
        "priority": item["priority"],
        "level": item["level"],
        "verified": item["verified"],
        "text": item["text"],
        "method": item["method"],
        "response_ms": item["response_ms"],
        "checked_at": item["checked_at"],
        "details": {"attempts": item["attempts"], "link": item.get("link")},
    } for item in results]
    _supabase_request(url, key, "/rest/v1/service_status_checks", rows)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=sorted(CHECKS), help="Run just one source instead of all of them")
    ap.add_argument("--attempts", type=int, default=3, choices=range(1, 5),
                    help="Maximum attempts for an unverifiable check (default: 3)")
    ap.add_argument("--no-record", action="store_true",
                    help="Do not store history even when Supabase credentials are present")
    args = ap.parse_args()

    names = [args.only] if args.only else sorted(CHECKS)
    results = [run_check(name, args.attempts) for name in names]
    if not args.no_record:
        try:
            record_results(results)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f"Varning: statushistoriken kunde inte sparas ({exc.__class__.__name__})", file=sys.stderr)
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
