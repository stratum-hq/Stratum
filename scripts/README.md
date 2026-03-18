# SDK Generation Scripts

This directory contains the infrastructure for generating Python and Go SDKs from the Stratum Control Plane OpenAPI spec.

The generated SDKs are intended to be copied into their respective repositories:
- **Python**: [stratum-hq/stratum-python](https://github.com/stratum-hq/stratum-python)
- **Go**: [stratum-hq/stratum-go](https://github.com/stratum-hq/stratum-go)

## Prerequisites

### openapi-generator-cli

Install via one of these methods:

```bash
# npm (recommended)
npm install -g @openapitools/openapi-generator-cli

# Homebrew (macOS)
brew install openapi-generator

# Docker (no install required — the script auto-detects Docker)
docker pull openapitools/openapi-generator-cli
```

openapi-generator requires **Java 11+**. Verify with:

```bash
java -version
```

## Files

| File | Purpose |
|------|---------|
| `openapi-spec.json` | Static OpenAPI 3.0.3 spec (source of truth for SDK generation) |
| `generate-sdks.sh` | Main generation script |
| `openapi-generator-config-python.json` | Python generator configuration |
| `openapi-generator-config-go.json` | Go generator configuration |
| `generated/python/` | Generated Python SDK output (gitignored) |
| `generated/go/` | Generated Go SDK output (gitignored) |

## Usage

### Generate both SDKs

```bash
./scripts/generate-sdks.sh
```

### Generate a specific SDK

```bash
./scripts/generate-sdks.sh python
./scripts/generate-sdks.sh go
```

### Extract spec from a running control plane

If you want to regenerate the static spec from a live instance:

```bash
./scripts/generate-sdks.sh --live
```

This starts the control plane temporarily (if not already running), fetches the OpenAPI JSON from `/api/docs/json`, saves it to `openapi-spec.json`, then generates the SDKs. Set `STRATUM_CP_PORT` to override the default port (3000).

## Workflow

The full workflow for updating SDKs after API changes:

1. **Update the API** — modify route handlers in `packages/control-plane/src/routes/`
2. **Update the spec** — either:
   - Edit `scripts/openapi-spec.json` manually, or
   - Run `./scripts/generate-sdks.sh --live` to extract from the running server
3. **Generate SDKs** — `./scripts/generate-sdks.sh`
4. **Copy to SDK repos** — copy the generated output to each SDK repo:
   ```bash
   # Python
   cp -r scripts/generated/python/* ../stratum-python/

   # Go
   cp -r scripts/generated/go/* ../stratum-go/
   ```
5. **Review, test, and commit** in each SDK repo
6. **Publish**:
   - Python: `cd ../stratum-python && python -m build && twine upload dist/*`
   - Go: tag and push (`git tag v0.1.0 && git push --tags`)

## Publishing

### Python (PyPI)

```bash
cd scripts/generated/python

# Install build tools
pip install build twine

# Build
python -m build

# Upload to PyPI (or TestPyPI first)
twine upload dist/*

# Or TestPyPI:
twine upload --repository testpypi dist/*
```

### Go (Go Modules)

Go modules are published by tagging a release in the Git repository:

```bash
cd ../stratum-go
git add .
git commit -m "chore: regenerate SDK from spec v0.1.0"
git tag v0.1.0
git push origin main --tags
```

Users consume it with:

```go
import "github.com/stratum-hq/stratum-go"
```

## Customizing Generation

The generator config files control how the SDK is shaped. Common options:

### Python (`openapi-generator-config-python.json`)
- `packageName` — Python package name (import name)
- `projectName` — Project/distribution name
- `packageVersion` — Version string
- `library` — HTTP library (`urllib3` or `asyncio`)

### Go (`openapi-generator-config-go.json`)
- `packageName` — Go package name
- `moduleName` — Go module path
- `generateInterfaces` — Generate interface types for API clients
- `withGoMod` — Generate go.mod file

See the [openapi-generator docs](https://openapi-generator.tech/docs/generators/) for the full list of options per language.
