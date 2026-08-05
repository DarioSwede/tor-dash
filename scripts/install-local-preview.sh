#!/bin/zsh
set -euo pipefail

service_label="se.tordash.local-preview"
script_dir="${0:A:h}"
source_plist="${script_dir}/${service_label}.plist"
target_plist="/Users/torbjornzimmerman/Library/LaunchAgents/${service_label}.plist"
log_dir="/Users/torbjornzimmerman/Library/Logs/TorDash"
source_web="${script_dir:h}/web"
preview_dir="/Users/torbjornzimmerman/Library/Application Support/TorDash/preview"
user_domain="gui/$(id -u)"

mkdir -p "${target_plist:h}" "${log_dir}" "${preview_dir:h}"
rm -rf "${preview_dir}"
ditto "${source_web}" "${preview_dir}"
cp "${source_plist}" "${target_plist}"

# Reinstall safely when the service already exists.
launchctl bootout "${user_domain}/${service_label}" 2>/dev/null || true
launchctl bootstrap "${user_domain}" "${target_plist}"
launchctl enable "${user_domain}/${service_label}"
launchctl kickstart -k "${user_domain}/${service_label}"

echo "Tor Dash lokalserver är installerad."
echo "Öppna http://127.0.0.1:4173/#morning-brief"
