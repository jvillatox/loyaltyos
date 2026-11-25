#!/bin/sh
set -eu

# Write the SPA runtime config (src/lib/program.ts) from PORTAL_PROGRAM_ID at
# boot, so the portal's program can be changed without rebuilding the image.
# The placeholder in apps/portal/public/config.js is overwritten here.
CONFIG_FILE="/usr/share/nginx/html/config.js"
if [ -n "${PORTAL_PROGRAM_ID:-}" ]; then
  printf 'window.__LOYALTYOS_CONFIG__ = { programId: "%s" };\n' "$PORTAL_PROGRAM_ID" > "$CONFIG_FILE"
else
  printf 'window.__LOYALTYOS_CONFIG__ = {};\n' > "$CONFIG_FILE"
fi

exec nginx -g 'daemon off;'
