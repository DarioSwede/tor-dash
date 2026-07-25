#!/usr/bin/env python3
"""
Summarize the sprylar-mngr sales pipeline (bud / sålda / betalda /
frakthandling / inlämnade) for use in the brief's "Sprylar" section --
reads the same public data/store.json that assets/app.js renders as a
kanban board, and mirrors its cat()/groups()/stage() logic in Python so
the counts match what the sprylar-mngr page itself shows.

Usage:
    python3 scripts/sprylar_flow.py
    python3 scripts/sprylar_flow.py --store-url https://raw.githubusercontent.com/DarioSwede/sprylar-mngr/main/data/store.json

Prints one JSON object to stdout:
    {
      "unsold_count": 5, "unsold_bids": 3,
      "bid_items": [
        {"title": "...", "bids": 1, "price": 99, "end_date": "2026-07-25T18:52:24Z", "url": "..."}
      ],
      "sold_count": 2, "paid_count": 1, "shipping_count": 0, "receipt_count": 60
    }
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

DEFAULT_STORE_URL = "https://raw.githubusercontent.com/DarioSwede/sprylar-mngr/main/data/store.json"


def cat(e):
    s = (
        (e.get("subject") or "")
        + " "
        + (e.get("from") or "")
        + " "
        + (e.get("snippet") or "")
    ).lower()
    if "betalt objekt" in s or "betalningsbekräftelse" in s:
        return "paid"
    if "sålt objekt" in s or "påmint köparen" in s or "samfraktspris" in s:
        return "sold"
    if "inlämningskvitto" in s or "paket inlämnat" in s:
        return "receipt"
    if "via tradera" in s or s.startswith("ang:") or "nytt meddelande" in s:
        return "message"
    if "frakthandlingar" in s or "fraktsedel" in s:
        return "shipping"
    if "faktura" in s:
        return "invoice"
    return "other"


def groups(emails):
    g, order_map, track_map = {}, {}, {}
    for e in emails:
        if e.get("order"):
            g.setdefault(e["order"], []).append(e)
            if e.get("object_id"):
                order_map[e["object_id"]] = e["order"]
    for e in emails:
        if not e.get("order") and e.get("object_id") and e["object_id"] in order_map:
            o = order_map[e["object_id"]]
            if not any(x["id"] == e["id"] for x in g[o]):
                g[o].append(e)
    for o, items in g.items():
        for e in items:
            for t in (e.get("tracking_number"), e.get("shipment_number")):
                if t and len(t) >= 8:
                    track_map[t] = o
    for e in emails:
        if e.get("order") or e.get("object_id"):
            continue
        t = e.get("tracking_number") or e.get("shipment_number")
        if not t or len(t) < 8:
            continue
        o = track_map.get(t)
        if not o:
            k = next((x for x in track_map if x.startswith(t) or t.startswith(x)), None)
            if k:
                o = track_map[k]
        if o and not any(x["id"] == e["id"] for x in g[o]):
            g[o].append(e)
    return g


def stage(items):
    cats = {cat(e) for e in items}
    if "receipt" in cats:
        return "receipt"
    if "shipping" in cats:
        return "shipping"
    if "paid" in cats:
        return "paid"
    if "sold" in cats:
        return "sold"
    return "unsold"


def fetch_store(url):
    with urllib.request.urlopen(url, timeout=20) as resp:
        return json.loads(resp.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store-url", default=DEFAULT_STORE_URL)
    args = ap.parse_args()

    store = fetch_store(args.store_url)
    listings = store.get("listings", [])
    order_groups = groups(store.get("emails", []))

    counts = {"sold": 0, "paid": 0, "shipping": 0, "receipt": 0}
    for items in order_groups.values():
        st = stage(items)
        if st in counts:
            counts[st] += 1

    bid_items = [
        {
            "title": l.get("title", ""),
            "bids": l.get("bids", 0),
            "price": l.get("price", 0),
            "end_date": l.get("end_date", ""),
            "url": l.get("url", ""),
        }
        for l in listings
        if l.get("bids", 0) > 0
    ]
    bid_items.sort(key=lambda x: x["end_date"])

    out = {
        "unsold_count": len(listings),
        "unsold_bids": sum(l.get("bids", 0) for l in listings),
        "bid_items": bid_items,
        "sold_count": counts["sold"],
        "paid_count": counts["paid"],
        "shipping_count": counts["shipping"],
        "receipt_count": counts["receipt"],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as exc:
        print(f"Kunde inte nå sprylar-mngr:s store.json: {exc}", file=sys.stderr)
        sys.exit(1)
