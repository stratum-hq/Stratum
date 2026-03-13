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
- **Key Derivation**: HKDF-SHA256 with application-specific info string to derive a 32-byte key

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

### Via the Maintenance API

The recommended approach for production key rotation:

```bash
curl -X POST http://localhost:3001/api/v1/maintenance/rotate-encryption-key \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"old_key": "current-key", "new_key": "new-key"}'
```

This re-encrypts all sensitive config entries and webhook secrets in a single atomic transaction. Response:

```json
{
  "config_entries_rotated": 12,
  "webhooks_rotated": 5
}
```

### Rotation Process

1. Generate a new encryption key
2. Call the rotation API with both old and new keys
3. Update `STRATUM_ENCRYPTION_KEY` to the new key in your environment
4. Restart the control plane

The rotation is atomic — either all values are re-encrypted or none are. The `reEncrypt` function uses explicit key parameters and never mutates `process.env`, making it safe for concurrent operations.

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
| Key safety | Keys derived via HKDF-SHA256, never stored in plaintext |
| Versioning | Format prefix allows algorithm migration |
| Concurrency | Re-encryption is stateless, safe under parallel access |
