#!/usr/bin/env python3
"""
Fetch a structured weather snapshot from Open-Meteo (free, no API key) for
use in the brief's "Väder <ort>" section -- replaces asking Claude to eyeball
a web search for the same facts, which is slower and occasionally wrong on
specifics like the overnight low.

Usage:
    python3 scripts/weather.py                       # Stockholm, today+tonight+tomorrow
    python3 scripts/weather.py --lat 59.33 --lon 18.07 --place Stockholm

Prints one JSON object to stdout:
    {
      "place": "Stockholm",
      "current": {"temp_c": 21.4, "condition": "Klart", "icon_svg": "<svg ...>...</svg>"},
      "today": {"max_c": 23.1, "min_c": 14.2, "condition": "Klart", "icon_svg": "..."},
      "tonight_low_c": 14.2,
      "tomorrow": {"max_c": 21.0, "min_c": 13.5, "condition": "Växlande molnighet", "icon_svg": "..."}
    }

`icon_svg` is a small pre-rendered <svg viewBox="0 0 240 70"> matching the
brief's existing drawing style (see web/README.md's payload.svg field) --
picked from a handful of hand-drawn conditions (sun / partly cloudy / cloudy
/ fog / rain / snow / thunder) by WMO weather_code, so the brief's header
icon actually matches what condition() says instead of Claude guessing a
fresh drawing (or the same fixed sun/cloud) every time. Only uses tags on
web/scripts/push_snapshot.py's is_safe_svg() allowlist.
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

API_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather codes (shared by Open-Meteo's current/daily conditions),
# collapsed to short Swedish phrases -- only as granular as the brief's
# one-line sentences actually need.
_WMO_SV = {
    0: "Klart", 1: "Mest klart", 2: "Växlande molnighet", 3: "Mulet",
    45: "Dimma", 48: "Rimfrostdimma",
    51: "Lätt duggregn", 53: "Duggregn", 55: "Tätt duggregn",
    56: "Underkylt duggregn", 57: "Tätt underkylt duggregn",
    61: "Lätt regn", 63: "Regn", 65: "Kraftigt regn",
    66: "Underkylt regn", 67: "Kraftigt underkylt regn",
    71: "Lätt snöfall", 73: "Snöfall", 75: "Kraftigt snöfall", 77: "Snökorn",
    80: "Lätta regnskurar", 81: "Regnskurar", 82: "Kraftiga regnskurar",
    85: "Lätta snöbyar", 86: "Kraftiga snöbyar",
    95: "Åska", 96: "Åska med hagel", 99: "Kraftig åska med hagel",
}


def condition(code):
    return _WMO_SV.get(code, f"Väderkod {code}")


# Shared building blocks, all centered around the same (120, ~30) drawing
# area and closing with the same horizon line -- so any combination below
# reads as "one icon family" instead of mismatched drawings.
_HORIZON = '<line x1="0" y1="58" x2="240" y2="58" stroke="#D8D6CC"/>'


def _sun(cx=120, cy=32, r=14):
    return (
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#E8A23D"/>'
        f'<line x1="{cx}" y1="{cy - r - 12}" x2="{cx}" y2="{cy - r - 4}" stroke="#E8A23D" stroke-width="2"/>'
        f'<line x1="{cx - r - 10}" y1="{cy - r - 4}" x2="{cx - r - 4}" y2="{cy - r + 2}" stroke="#E8A23D" stroke-width="2"/>'
        f'<line x1="{cx + r + 10}" y1="{cy - r - 4}" x2="{cx + r + 4}" y2="{cy - r + 2}" stroke="#E8A23D" stroke-width="2"/>'
    )


def _cloud(cx=120, cy=34, rx=34, ry=16):
    return (
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#B9BFC7"/>'
        f'<circle cx="{cx - rx * 0.6}" cy="{cy - ry * 0.5}" r="{rx * 0.4}" fill="#B9BFC7"/>'
        f'<circle cx="{cx + rx * 0.15}" cy="{cy - ry * 0.55}" r="{rx * 0.47}" fill="#B9BFC7"/>'
    )


def _drops(n, cy, color="#6E93C4"):
    xs = [120 - 28 + i * (56 / max(n - 1, 1)) for i in range(n)]
    return "".join(
        f'<line x1="{x}" y1="{cy}" x2="{x - 4}" y2="{cy + 10}" stroke="{color}" stroke-width="2.5" stroke-linecap="round"/>'
        for x in xs
    )


def _snow(n, cy, color="#AEB9C6"):
    xs = [120 - 28 + i * (56 / max(n - 1, 1)) for i in range(n)]
    return "".join(f'<circle cx="{x}" cy="{cy + 5}" r="2.6" fill="{color}"/>' for x in xs)


def _fog(cy):
    return "".join(
        f'<line x1="{70 + i * 6}" y1="{y}" x2="{170 - i * 6}" y2="{y}" stroke="#C7CBC4" stroke-width="3" stroke-linecap="round"/>'
        for i, y in enumerate([cy, cy + 9, cy + 18])
    )


def _bolt():
    return '<polygon points="122,40 110,54 118,54 112,68 130,50 121,50" fill="#E8A23D"/>'


def icon_svg(code):
    if code == 0:
        body = _sun()
    elif code == 1:
        body = _sun(cx=100, cy=26, r=11) + _cloud(cx=145, cy=42, rx=28, ry=13)
    elif code == 2:
        body = _sun(cx=95, cy=24, r=11) + _cloud(cx=140, cy=40, rx=30, ry=14)
    elif code == 3:
        body = _cloud()
    elif code in (45, 48):
        body = _cloud(cy=26, ry=13) + _fog(46)
    elif code in (51, 53, 55, 56, 57):
        body = _cloud(cy=26, ry=13) + _drops(3, 46)
    elif code in (61, 63, 65, 66, 67, 80, 81, 82):
        body = _cloud(cy=24, ry=13) + _drops(4, 44)
    elif code in (71, 73, 75, 77, 85, 86):
        body = _cloud(cy=24, ry=13) + _snow(4, 44)
    elif code in (95, 96, 99):
        body = _cloud(cy=22, ry=12) + _bolt()
    else:
        body = _cloud()
    return f'<svg viewBox="0 0 240 70">{body}{_HORIZON}</svg>'


def fetch(lat, lon, tz):
    params = (
        f"latitude={lat}&longitude={lon}&timezone={urllib.parse.quote(tz)}"
        "&current=temperature_2m,weather_code"
        "&daily=temperature_2m_max,temperature_2m_min,weather_code"
        "&forecast_days=2"
    )
    with urllib.request.urlopen(f"{API_URL}?{params}", timeout=15) as resp:
        return json.loads(resp.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=59.3293)
    ap.add_argument("--lon", type=float, default=18.0686)
    ap.add_argument("--place", default="Stockholm")
    ap.add_argument("--tz", default="Europe/Stockholm")
    args = ap.parse_args()

    data = fetch(args.lat, args.lon, args.tz)
    daily = data["daily"]
    current = data["current"]

    out = {
        "place": args.place,
        "current": {
            "temp_c": current["temperature_2m"],
            "condition": condition(current["weather_code"]),
            "icon_svg": icon_svg(current["weather_code"]),
        },
        "today": {
            "max_c": daily["temperature_2m_max"][0],
            "min_c": daily["temperature_2m_min"][0],
            "condition": condition(daily["weather_code"][0]),
            "icon_svg": icon_svg(daily["weather_code"][0]),
        },
        "tonight_low_c": daily["temperature_2m_min"][0],
        "tomorrow": {
            "max_c": daily["temperature_2m_max"][1],
            "min_c": daily["temperature_2m_min"][1],
            "condition": condition(daily["weather_code"][1]),
            "icon_svg": icon_svg(daily["weather_code"][1]),
        },
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as exc:
        print(f"Kunde inte nå Open-Meteo: {exc}", file=sys.stderr)
        sys.exit(1)
