---
sidebar_position: 12
title: Field-Level Encryption
---

# Field-Level Encryption

Stratum encrypts sensitive data at rest using AES-256-GCM. This applies to webhook secrets, sensitive configuration values, and any field marked as requiring encryption.

## Encryption Format

Encrypted values use a versioned format that supports future key rotation:

```
v1:iv:authTag:ciphertext
```

| Component | Description |
|-----------|-------------|
| `v1` | Format version (allows future algorithm changes) |
| `iv` | Initialization vector (hex-encoded, unique per encryption) |
| `authTag` | GCM authentication tag (hex-encoded, ensures integrity) |
| `ciphertext` | The encrypted data (hex-encoded) |

---

## What Gets Encrypted

| Field | Table | When |
|-------|-------|------|
| Webhook secrets | `webhooks` | On webhook creation/update |
| Sensitive config values | `config_entries` | When `sensitive: true` is set |

Encrypted fields are never exposed in API responses. Webhook secrets are decrypted only at the point of delivery to compute HMAC signatures. Sensitive config values are decrypted only when explicitly requested by application code.

---

## Marking Config as Sensitive

When setting a configuration value, mark it as sensitive to enable encryption:

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_...",
});

// Store an encrypted config value
await s.setConfig("TENANT_UUID", "database_password", {
  value: "super-secret-password",
  sensitive: true,
});

// Non-sensitive values are stored in plaintext
await s.setConfig("TENANT_UUID", "feature_flags", {
  value: JSON.stringify({ darkMode: true }),
  sensitive: false,
});
```

### Via REST API

```bash
curl -X POST http://localhost:3001/api/v1/tenants/TENANT_UUID/config \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{
    "key": "database_password",
    "value": "super-secret-password",
    "sensitive": true
  }'
```

When retrieving config, sensitive values are redacted in the response:

```json
{
  "key": "database_password",
  "sensitive": true,
  "value": "[REDACTED]"
}
```

---

## Environment Configuration

Set the encryption key via environment variable:

```bash
export STRATUM_ENCRYPTION_KEY="your-32-byte-or-longer-secret-key"
```

### Key Resolution Order

1. `STRATUM_ENCRYPTION_KEY` — primary encryption key
2. `WEBHOOK_ENCRYPTION_KEY` — fallback (for backward compatibility)
3. Development fallback — a deterministic key used automatically in non-production environments

:::danger
Never use the development fallback in production. Always set an explicit encryption key with at least 32 bytes of entropy.
:::

### Generating a Key

```bash
# Generate a cryptographically secure 32-byte key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Library Functions

The `@stratum/lib` crypto module exposes `encrypt()` and `decrypt()` for direct use:

```typescript
import { encrypt, decrypt } from "@stratum/lib/crypto";

const encrypted = encrypt("plaintext-value");
// → "v1:abc123...:def456...:789ghi..."

const decrypted = decrypt(encrypted);
// → "plaintext-value"
```

These functions use the encryption key from the environment. They throw if no key is available and the environment is production.

---

## Key Rotation

The versioned encryption format (`v1:...`) is designed to support key rotation in future releases. When key rotation is implemented:

1. New encryptions will use the current key with an incremented version prefix
2. Decryption will detect the version and use the corresponding key
3. A migration command will re-encrypt existing values with the new key

---

## Security Considerations

- **Authenticated encryption** — GCM mode provides both confidentiality and integrity. Tampered ciphertext will fail decryption.
- **Unique IVs** — every encryption operation generates a fresh random IV, ensuring identical plaintext values produce different ciphertext.
- **No key in responses** — encrypted fields are either redacted or omitted from API responses entirely.
- **Decrypt at point of use** — values remain encrypted in memory until the moment they are needed, minimizing the window of exposure.
