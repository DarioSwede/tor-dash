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
      "current": {"temp_c": 21.4, "condition": "Klart"},
      "today": {"max_c": 23.1, "min_c": 14.2, "condition": "Klart"},
      "tonight_low_c": 14.2,
      "tomorrow": {"max_c": 21.0, "min_c": 13.5, "condition": "Växlande molnighet"}
    }
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
        },
        "today": {
            "max_c": daily["temperature_2m_max"][0],
            "min_c": daily["temperature_2m_min"][0],
            "condition": condition(daily["weather_code"][0]),
        },
        "tonight_low_c": daily["temperature_2m_min"][0],
        "tomorrow": {
            "max_c": daily["temperature_2m_max"][1],
            "min_c": daily["temperature_2m_min"][1],
            "condition": condition(daily["weather_code"][1]),
        },
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as exc:
        print(f"Kunde inte nå Open-Meteo: {exc}", file=sys.stderr)
        sys.exit(1)
