#!/bin/zsh
set -euo pipefail

service_label="se.tordash.local-preview"
target_plist="/Users/torbjornzimmerman/Library/LaunchAgents/${service_label}.plist"
preview_dir="/Users/torbjornzimmerman/Library/Application Support/TorDash/preview"
user_domain="gui/$(id -u)"

launchctl bootout "${user_domain}/${service_label}" 2>/dev/null || true
rm -f "${target_plist}"
rm -rf "${preview_dir}"

echo "Tor Dash lokalserver är avinstallerad."
