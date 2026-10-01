import crypto from "node:crypto";

/**
 * The database lines of a generated .env.stratum: the application login and
 * the admin login of the role model (see the "Hardening: separate admin and
 * app roles" guide and `stratum scaffold docker`).
 */
export function databaseEnvLines(): string {
  return `# Application login (NOSUPERUSER NOBYPASSRLS), so row-level security applies.
DATABASE_URL=postgres://stratum_app:stratum_dev@localhost:5432/stratum
# Admin login: a member of the stratum_control role, neither superuser nor
# BYPASSRLS. Stratum's migrations and cross-tenant work run on it: adminPool
# in @stratum-hq/lib, DATABASE_ADMIN_URL for the control plane and the CLI.
DATABASE_ADMIN_URL=postgres://stratum_admin:stratum_dev@localhost:5432/stratum`;
}

/**
 * The secret lines of a generated .env.stratum, with fresh random values
 * that satisfy the rules @stratum-hq/lib applies outside development.
 */
export function secretEnvLines(): string {
  const encryptionKey = crypto.randomBytes(32).toString("base64url");
  const hkdfSalt = crypto.randomBytes(16).toString("hex");
  const hmacSecret = crypto.randomBytes(32).toString("base64url");
  return `# Secrets, generated with random values for local development.
# Rules outside development and test (any other NODE_ENV):
#   - Stratum refuses to start without STRATUM_ENCRYPTION_KEY (at least 32
#     bytes, not the built-in development key) and STRATUM_HKDF_SALT (an
#     even-length hex string, not the built-in development salt).
#   - STRATUM_API_KEY_HMAC_SECRET, when set, must be at least 32 bytes. New API
#     keys are then stored as HMAC hashes.
#   - Generate new values for each environment, keep them in a secret manager,
#     and never commit them. Do not reuse these development values.
#   - Keep them stable once data exists: a different encryption key or salt
#     cannot decrypt values encrypted before (use Stratum's key rotation), and
#     a different HMAC secret no longer matches the API keys hashed with it.
STRATUM_ENCRYPTION_KEY=${encryptionKey}
STRATUM_HKDF_SALT=${hkdfSalt}
STRATUM_API_KEY_HMAC_SECRET=${hmacSecret}`;
}
