#!/bin/sh
set -e

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://control-plane:3001/api/v1}"
DATABASE_URL="${DATABASE_URL:-postgres://stratum_app:stratum_dev@db:5432/stratum}"

echo "Waiting for control plane to be ready..."
until wget -qO- "${CONTROL_PLANE_URL}/health" > /dev/null 2>&1; do
  echo "  control-plane not ready, retrying in 3s..."
  sleep 3
done
echo "Control plane is up."

# The seed script mints the bootstrap API key, inserts it, seeds demo data, prints
# the key once, and writes it to DEMO_KEY_FILE for the web container to pick up.
echo "Running seed script..."
node packages/demo/api/dist/seed.js
