#!/bin/sh
set -eu

# The demo seed mints a random bootstrap API key and writes it to DEMO_KEY_FILE on
# a volume shared with this container. Wait for it, then bake it into config.js so
# the SPA can authenticate. Nothing here is committed: the key exists only at runtime.
KEY_FILE="${DEMO_KEY_FILE:-/demo-shared/api-key}"
CONFIG_JS="/usr/share/nginx/html/config.js"
DEADLINE=$(( $(date +%s) + 300 ))

echo "Waiting for demo API key at ${KEY_FILE}..."
while [ ! -s "${KEY_FILE}" ]; do
  if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
    echo "  timed out waiting for the seed; serving with an empty key." >&2
    break
  fi
  sleep 2
done

if [ -s "${KEY_FILE}" ]; then
  KEY="$(cat "${KEY_FILE}")"
  printf 'window.__DEMO_API_KEY__ = "%s";\n' "${KEY}" > "${CONFIG_JS}"
  echo "Injected demo API key into ${CONFIG_JS}."
fi

exec nginx -g 'daemon off;'
