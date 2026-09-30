import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = "v1";

// Fixed, public salt used only outside production when STRATUM_HKDF_SALT is
// unset. It must stay stable: a per-process salt would make every value
// encrypted by an earlier process (or another replica) undecryptable. An HKDF
// salt is not secret; the key material is. Production still requires an
// explicit STRATUM_HKDF_SALT.
const NON_PRODUCTION_DEFAULT_SALT = "stratum-non-production-hkdf-salt-v1";

const HKDF_SALT: Buffer = (() => {
  if (process.env.STRATUM_HKDF_SALT) {
    return Buffer.from(process.env.STRATUM_HKDF_SALT, "hex");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("STRATUM_HKDF_SALT must be set in production");
  }
  return Buffer.from(NON_PRODUCTION_DEFAULT_SALT, "utf8");
})();

function hkdfDeriveKey(keyMaterial: string, info = "stratum-aes-key"): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyMaterial, "utf8"), HKDF_SALT, info, 32),
  );
}

function getEncryptionKey(): Buffer {
  const envKey = process.env.STRATUM_ENCRYPTION_KEY ?? process.env.WEBHOOK_ENCRYPTION_KEY;
  if (envKey) {
    return hkdfDeriveKey(envKey);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("STRATUM_ENCRYPTION_KEY must be set in production");
  }
  // Dev-only fallback — never use in staging or production
  return hkdfDeriveKey("stratum-dev-key");
}

function deriveKey(keyMaterial: string): Buffer {
  return hkdfDeriveKey(keyMaterial, "stratum-aes-key");
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
 * Falls back to STRATUM_ENCRYPTION_KEY_PREVIOUS if primary key decryption fails,
 * enabling dual-key reads during rolling deployments. */
export function decrypt(encrypted: string): string {
  try {
    return decryptWithKey(encrypted, getEncryptionKey());
  } catch (err) {
    const previousKey = process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS;
    if (previousKey) {
      try {
        return decryptWithKey(encrypted, hkdfDeriveKey(previousKey));
      } catch {
        // Both keys failed — throw the original error
      }
    }
    throw err;
  }
}

/** Re-encrypts a value with a new key. Used for key rotation. Safe under concurrency — does not mutate process.env. */
export function reEncrypt(encrypted: string, oldKeyMaterial: string, newKeyMaterial: string): string {
  const plaintext = decryptWithKey(encrypted, deriveKey(oldKeyMaterial));
  return encryptWithKey(plaintext, deriveKey(newKeyMaterial));
}

/** Returns true when the value decrypts with the key derived from `keyMaterial`.
 * Key rotation uses it to find values that an earlier, interrupted run already rotated. */
export function decryptsWithKey(encrypted: string, keyMaterial: string): boolean {
  try {
    decryptWithKey(encrypted, deriveKey(keyMaterial));
    return true;
  } catch {
    return false;
  }
}
