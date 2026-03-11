import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = "v1";

function getEncryptionKey(): Buffer {
  const envKey = process.env.STRATUM_ENCRYPTION_KEY ?? process.env.WEBHOOK_ENCRYPTION_KEY;
  if (envKey) {
    return crypto.createHash("sha256").update(envKey).digest();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("STRATUM_ENCRYPTION_KEY must be set in production");
  }
  return crypto.createHash("sha256").update("stratum-dev-key").digest();
}

/** Encrypts a value. Returns versioned format: v1:iv:authTag:ciphertext (all hex) */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${CURRENT_KEY_VERSION}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypts a versioned encrypted value. Supports v1 format and legacy (no version prefix). */
export function decrypt(encrypted: string): string {
  const parts = encrypted.split(":");
  // Support legacy format (no version prefix): iv:authTag:ciphertext
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
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/** Re-encrypts a value with a new key. Used for key rotation. */
export function reEncrypt(encrypted: string, oldKeyEnv: string, newKeyEnv: string): string {
  const origKey = process.env.STRATUM_ENCRYPTION_KEY;
  try {
    process.env.STRATUM_ENCRYPTION_KEY = oldKeyEnv;
    const plaintext = decrypt(encrypted);
    process.env.STRATUM_ENCRYPTION_KEY = newKeyEnv;
    return encrypt(plaintext);
  } finally {
    if (origKey !== undefined) {
      process.env.STRATUM_ENCRYPTION_KEY = origKey;
    } else {
      delete process.env.STRATUM_ENCRYPTION_KEY;
    }
  }
}
