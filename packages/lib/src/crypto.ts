import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = "v1";

// Built-in key material is allowed only in local development and test runs
// (an unset NODE_ENV counts as development). Every other environment, staging
// and preview included, must supply real key material or refuse to start.
function nodeEnvRequiringKeyMaterial(): string | null {
  const nodeEnv = process.env.NODE_ENV || "development";
  return nodeEnv === "development" || nodeEnv === "test" ? null : nodeEnv;
}

// Fixed, public salt used only in development and test when STRATUM_HKDF_SALT
// is unset. It must stay stable: a per-process salt would make every value
// encrypted by an earlier process (or another replica) undecryptable. An HKDF
// salt is not secret; the key material is. Every other environment requires an
// explicit STRATUM_HKDF_SALT.
const NON_PRODUCTION_DEFAULT_SALT = "stratum-non-production-hkdf-salt-v1";

const HKDF_SALT: Buffer = (() => {
  if (process.env.STRATUM_HKDF_SALT) {
    return Buffer.from(process.env.STRATUM_HKDF_SALT, "hex");
  }
  const strictEnv = nodeEnvRequiringKeyMaterial();
  if (strictEnv) {
    throw new Error(`STRATUM_HKDF_SALT must be set in ${strictEnv}`);
  }
  return Buffer.from(NON_PRODUCTION_DEFAULT_SALT, "utf8");
})();

function hkdfDeriveKey(keyMaterial: string, salt: Buffer = HKDF_SALT, info = "stratum-aes-key"): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyMaterial, "utf8"), salt, info, 32),
  );
}

function getEncryptionKeyMaterial(): string {
  const envKey = process.env.STRATUM_ENCRYPTION_KEY ?? process.env.WEBHOOK_ENCRYPTION_KEY;
  if (envKey) {
    return envKey;
  }
  const strictEnv = nodeEnvRequiringKeyMaterial();
  if (strictEnv) {
    throw new Error(`STRATUM_ENCRYPTION_KEY must be set in ${strictEnv}`);
  }
  // Development and test only fallback
  return "stratum-dev-key";
}

function getEncryptionKey(): Buffer {
  return hkdfDeriveKey(getEncryptionKeyMaterial());
}

// A hex salt argument follows the STRATUM_HKDF_SALT format. No argument means the configured salt.
function deriveKey(keyMaterial: string, saltHex?: string): Buffer {
  return hkdfDeriveKey(keyMaterial, saltHex ? Buffer.from(saltHex, "hex") : HKDF_SALT);
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${CURRENT_KEY_VERSION}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptWithKey(encrypted: string, key: Buffer): string {
  const parts = encrypted.split(":");
  let ivHex: string, authTagHex: string, ciphertextHex: string;
  if (parts.length === 4 && parts[0].startsWith("v")) {
    // Versioned: v1:iv:authTag:ciphertext
    [, ivHex, authTagHex, ciphertextHex] = parts as [string, string, string, string];
  } else if (parts.length === 3) {
    // Legacy: iv:authTag:ciphertext
    [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  } else {
    throw new Error("Invalid encrypted value format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/** Encrypts a value. Returns versioned format: v1:iv:authTag:ciphertext (all hex) */
export function encrypt(plaintext: string): string {
  return encryptWithKey(plaintext, getEncryptionKey());
}

/** Decrypts a versioned encrypted value. Supports v1 format and legacy (no version prefix).
 * If the current key and salt fail, it tries the previous pair: STRATUM_ENCRYPTION_KEY_PREVIOUS
 * and STRATUM_HKDF_SALT_PREVIOUS. A previous variable that is unset uses the current value.
 * This keeps values readable during a rolling deployment and until a rotation finishes. */
export function decrypt(encrypted: string): string {
  try {
    return decryptWithKey(encrypted, getEncryptionKey());
  } catch (err) {
    const previousKey = process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS;
    const previousSalt = process.env.STRATUM_HKDF_SALT_PREVIOUS;
    if (previousKey || previousSalt) {
      try {
        return decryptWithKey(encrypted, deriveKey(previousKey || getEncryptionKeyMaterial(), previousSalt));
      } catch {
        // Both pairs failed: throw the original error
      }
    }
    throw err;
  }
}

/** Encrypts a value with the key derived from `keyMaterial` and `saltHex`.
 * If `saltHex` is not given, the configured salt applies.
 * Key rotation uses it because it must not read or change process.env. */
export function encryptWithKeyMaterial(plaintext: string, keyMaterial: string, saltHex?: string): string {
  return encryptWithKey(plaintext, deriveKey(keyMaterial, saltHex));
}

/** Returns the plaintext, or null when the value does not decrypt with the key derived from `keyMaterial` and `saltHex`.
 * If `saltHex` is not given, the configured salt applies.
 * Key rotation uses the null result to try the next key instead of failing. */
export function decryptWithKeyMaterial(encrypted: string, keyMaterial: string, saltHex?: string): string | null {
  try {
    return decryptWithKey(encrypted, deriveKey(keyMaterial, saltHex));
  } catch {
    return null;
  }
}
