#!/bin/sh
set -e

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://control-plane:3001/api/v1}"
DATABASE_URL="${DATABASE_URL:-postgres://stratum_app:stratum_dev@db:5432/stratum}"
API_KEY="${API_KEY:-sk_live_demo_key}"

echo "Waiting for control plane to be ready..."
until wget -qO- "${CONTROL_PLANE_URL}/health" > /dev/null 2>&1; do
  echo "  control-plane not ready, retrying in 3s..."
  sleep 3
done
echo "Control plane is up."

echo "Inserting bootstrap API key into database..."
# Use node to run a quick pg INSERT so we don't need psql in the image
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(\`
  INSERT INTO api_keys (id, tenant_id, key_hash, key_prefix, name, scopes)
  VALUES (
    'a0000000-0000-0000-0000-000000000001',
    NULL,
    '4ce0f9725485398b04b656849919e252167d33adb12b8f0addd7d8b1a7f43e48',
    'sk_live_demo_',
    'Demo Bootstrap Key',
    '{read,write,admin}'
  )
  ON CONFLICT DO NOTHING
\`).then(() => pool.end()).catch(err => { console.error(err); process.exit(1); });
"

echo "Running seed script..."
node packages/demo/api/dist/seed.js
