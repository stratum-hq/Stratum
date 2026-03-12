# Field-Level Encryption

Stratum encrypts sensitive data at rest using AES-256-GCM authenticated encryption with key versioning.

## What Gets Encrypted

- **Webhook secrets** — stored encrypted in the `webhooks` table
- **Sensitive config values** — when marked as sensitive

## How It Works

### Algorithm

- **Cipher**: AES-256-GCM (authenticated encryption with associated data)
- **IV**: 12 bytes, randomly generated per encryption
- **Auth Tag**: 16 bytes (built into GCM mode)
- **Key Derivation**: SHA-256 hash of key material to produce a 32-byte key

### Ciphertext Format

Encrypted values are stored as a versioned string:

```
v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
```

The `v1` prefix enables future algorithm changes without breaking existing data. Legacy format (3-part, no version prefix) is still supported for backward compatibility.

## Configuration

Set the encryption key via environment variable:

```bash
# Primary (preferred)
export STRATUM_ENCRYPTION_KEY="your-secret-key-here"

# Fallback (for backward compatibility)
export WEBHOOK_ENCRYPTION_KEY="your-secret-key-here"
```

In development, a default key (`stratum-dev-key`) is used automatically. In production (`NODE_ENV=production`), a missing key will trigger an error.

### Generating a Strong Key

```bash
# Generate a 256-bit key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Key Rotation

Stratum supports re-encrypting data with a new key without downtime:

### Via the Library

```typescript
import { reEncrypt } from "@stratum/lib";

const oldKey = "old-encryption-key";
const newKey = "new-encryption-key";

// Re-encrypt a single value
const newCiphertext = reEncrypt(existingCiphertext, oldKey, newKey);
```

### Rotation Process

1. Set the new key in your environment
2. Re-encrypt all stored values using `reEncrypt(value, oldKey, newKey)`
3. Remove the old key from your environment

The `reEncrypt` function uses explicit key parameters — it never mutates `process.env`, making it safe for concurrent operations.

## Using Encryption Directly

```typescript
import { encrypt, decrypt } from "@stratum/lib";

// Encrypt a value
const ciphertext = encrypt("sensitive-data");
// → "v1:a1b2c3...:d4e5f6...:789abc..."

// Decrypt it
const plaintext = decrypt(ciphertext);
// → "sensitive-data"
```

## Security Properties

| Property | Guarantee |
|----------|-----------|
| Confidentiality | AES-256 encryption |
| Integrity | GCM authentication tag prevents tampering |
| Uniqueness | Random IV per encryption prevents pattern analysis |
| Key safety | Keys derived via SHA-256, never stored in plaintext |
| Versioning | Format prefix allows algorithm migration |
| Concurrency | Re-encryption is stateless, safe under parallel access |
