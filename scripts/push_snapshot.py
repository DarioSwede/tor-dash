#!/usr/bin/env python3
"""
Upsert one briefing snapshot into Supabase.

Called by the scheduled Claude task (morning/evening brief) after it has
gathered and sorted the day's content into a JSON payload matching the shape
the frontend (web/app.js) expects. This script does the actual network
write; Claude's own gather/sort/write reasoning stays in the schedule
instructions, not here.

Usage:
    SUPABASE_URL=https://xxxx.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=eyJ... \
    python3 push_snapshot.py --kind morning --date 2026-07-19 --payload-file brief.json

The service_role key bypasses Row Level Security, which is why it must
never be committed to the repo or exposed to the browser -- it only ever
lives in an environment variable at push time.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", required=True, choices=["morning", "evening"])
    parser.add_argument("--date", required=True, help="YYYY-MM-DD, the for_date column")
    parser.add_argument("--payload-file", required=True, help="Path to a JSON file with the brief payload")
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.", file=sys.stderr)
        sys.exit(1)

    with open(args.payload_file, "r", encoding="utf-8") as f:
        payload = json.load(f)

    body = json.dumps([
        {
            "kind": args.kind,
            "for_date": args.date,
            "payload": payload,
        }
    ]).encode("utf-8")

    url = f"{supabase_url.rstrip('/')}/rest/v1/briefing_snapshots?on_conflict=kind,for_date"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", service_key)
    req.add_header("Authorization", f"Bearer {service_key}")
    req.add_header("Content-Type", "application/json")
    # merge-duplicates == upsert on the unique (kind, for_date) constraint
    req.add_header("Prefer", "resolution=merge-duplicates,return=minimal")

    try:
        with urllib.request.urlopen(req) as resp:
            print(f"OK ({resp.status}): {args.kind} snapshot for {args.date} pushed.")
    except urllib.error.HTTPError as e:
        print(f"Supabase rejected the write ({e.code}): {e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(
            "Could not reach Supabase. If this is a Claude scheduled task, "
            "make sure the project's *.supabase.co domain is added under "
            f"Settings -> Capabilities (network allowlist). Details: {e}",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
