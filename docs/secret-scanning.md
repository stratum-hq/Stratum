# Secret scanning

```bash
npm run lint:secrets           # scan the working tree
npm run lint:secrets:staged    # scan only what is staged
```

Exit 0 means nothing credential-shaped is about to be committed. Exit 1 means open the
file and line it names.

The July 2026 audit found this repository's history clean and `.env` correctly gitignored.
This check exists to keep a good state good, so it is **not a ratchet**. The expected count
is zero, there is no `--write` flag, and every finding either gets fixed or gets recorded by
hand in `scripts/secret-allowlist.json` with a reason.

## Layout

| File | Role |
|------|------|
| `scripts/secret-rules.mjs` | Pure detection. Text in, findings out. No file system, no exit. |
| `scripts/check-secrets.mjs` | File discovery, the allowlist, the reporting. |
| `scripts/secret-allowlist.json` | Hand-maintained accepted findings. No generator. |

`check-secrets.mjs` scans everything `git add -A` would sweep up: tracked files plus
untracked files that are not gitignored. Ignored files are excluded, which is what keeps a
correctly gitignored `.env` and every `node_modules` from failing the build on every run.
In `--staged` mode the bytes come from the index rather than the working tree, so a secret
that is staged but since edited out of the file is still caught.

## What it looks for

The design constraint is a **low false-positive rate**. A scanner that cries wolf gets
bypassed with `--no-verify`, and a bypassed scanner protects nothing. So the rules are in
two tiers, and bare high-entropy string scanning, the thing that makes generic scanners
unusable, is deliberately not implemented.

**Tier 1: shape is the evidence.** No entropy gate, no placeholder filter.

| Rule | Fires on |
|------|----------|
| `stratum-api-key` | `sk_live_` or `sk_test_` followed by 32 or more characters. That is what `api-key-service.ts` mints: the prefix plus 32 random bytes as base64url. |
| `provider-token` | AWS, GitHub, Stripe restricted and webhook, Slack, Google, Anthropic, OpenAI, npm, Fly.io, Resend, SendGrid, Twilio, and signed JWTs. |
| `private-key` | A `-----BEGIN ... PRIVATE KEY-----` block. |
| `committed-env-file` | A tracked `.env`. Templates such as `.env.example` are exempt. |

**Tier 2: name plus value.** Much broader, so it is gated hard.

| Rule | Fires on |
|------|----------|
| `hardcoded-key-literal` | An `sk_live_` literal too short to be a minted key, and not placeholder-shaped. |
| `connection-string-password` | A password inline in a `postgres://`, `mysql://`, `mongodb://` or `redis://` URI. |
| `assigned-secret` | A secret-named variable assigned a high-entropy literal: at least 16 characters, Shannon entropy at least 3.5 bits per character, past a placeholder filter. |

## What it deliberately does not fire on

Every one of these is a real line in this repository, and each is covered by a fixture in
`secret-rules.mjs` so it stays that way:

- Documentation placeholders. `sk_live_your_key`, `sk_live_dev` and friends are recognised
  by shape and never reported, so the six READMEs that carry them need no allowlist entry.
- Short `sk_test_` literals. Stratum mints `sk_live_` and nothing else, so a short
  `sk_test_` string is a test fixture by construction, and the control plane's route tests
  hold eleven of them. A `sk_test_` at the minted length is still reported, which is what
  catches a Stripe test key being pasted in.
- Local and containerised database URIs: `localhost`, `db`, `test-db`, `stratum-db` and the
  rest of the docker-compose service names, plus any URI where the user equals the password.
- `process.env` reads, `${VAR}` templates, documented variable names such as
  `STRATUM_API_KEY_HMAC_SECRET`, property access like `row.key_hash`, UUIDs, and masked
  values written as a run of `x`.

## The demo bootstrap key

`docker compose --profile demo up --build` is the headline command in the README. It seeds
an `api_keys` row with `tenant_id NULL` and scopes `{read,write,admin}`, a global admin
grant. That key used to be a committed constant, allowlisted rather than flagged.

**It is no longer committed.** The seed now mints a random key at seed time, prints it once
to stdout, and hands it to the web container out of band (a shared volume the compose file
wires up), so no plaintext lives in the tree and there is nothing to allowlist for it. See
issue #169 and `packages/demo/api/src/seed.ts`. Migration `011_demo_bootstrap.sql` removed
the same key from the schema migrations earlier, for the same reason; this finished that
job. A minted key never appears in a committed file, so if one ever does, the scanner's
`stratum-api-key` rule fails hard and is never allowlisted.

## Adding an allowlist entry

Only after deciding the finding is not a credential. If it is one, **rotate it first**: a
token in a repository is already spent, and arguing about whether it leaked comes second.

Copy the `path` and `id` the check printed, and add a `reason` a reviewer can check:

```json
{
  "path": "packages/react-ui/src/components/storybook-helpers.tsx",
  "id": "6f887261bb27bfe9",
  "rule": "hardcoded-key-literal",
  "reason": "Storybook fixture for a sensitive config value, shown truncated and redacted"
}
```

The `id` is a SHA-256 prefix of the matched text, so accepting a finding never writes the
string back into the repository. A hash only conceals a high-entropy value, which is
another reason a real credential belongs in a rotation, not in this file.

There is no per-line ignore pragma, and there will not be one. An ignore pragma is how a
real leak gets waved through at 2am. The one scanning exemption is `secret-rules.mjs`
itself, whose fixtures are deliberately credential-shaped.

## Self-check

`npm test` is `turbo test` over the workspaces, so there is no root test runner for a
`scripts/` unit test to live in. Rather than add one, `check-secrets.mjs` runs the fixture
table from `secret-rules.mjs` on every invocation. It is pure regex over a dozen short
strings and costs well under a millisecond, and it means a rule cannot be loosened or
tightened without the fixture covering it failing first:

```
The secret rules no longer match their own fixtures, so the scan below
would not mean anything. Fix scripts/secret-rules.mjs before trusting it.
```

## Known gaps

Worth knowing before trusting this more than it deserves:

- **A human-chosen passphrase slips through.** Tier 2 filters out lowercase kebab and snake
  phrases of three or more segments, because they clear the entropy floor on character
  variety alone and are almost always English rather than a credential. A passphrase someone
  actually uses as a secret looks the same.
- **Only what git would stage.** History is not rescanned. The audit did that once; doing it
  on every run would be slow, and remediating a historical hit means rewriting history,
  which is a forbidden action in `CLAUDE.md` and needs a human.
- **No custom in-house token formats** beyond Stratum's own prefix. If a service starts
  minting a new shape, add it to `PROVIDER_TOKENS` with a fixture.
