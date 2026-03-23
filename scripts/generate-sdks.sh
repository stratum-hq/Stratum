#!/usr/bin/env bash
#
# generate-sdks.sh — Generate Python and Go SDKs from the Stratum OpenAPI spec.
#
# Prerequisites:
#   - Java 11+ (required by openapi-generator-cli)
#   - openapi-generator-cli installed globally:
#       npm install -g @openapitools/openapi-generator-cli
#     OR via Homebrew:
#       brew install openapi-generator
#     OR use the Docker image (no install needed):
#       docker run --rm -v "${PWD}:/work" openapitools/openapi-generator-cli generate ...
#
# Usage:
#   ./scripts/generate-sdks.sh              # Generate both Python and Go SDKs
#   ./scripts/generate-sdks.sh python       # Generate only Python SDK
#   ./scripts/generate-sdks.sh go           # Generate only Go SDK
#   ./scripts/generate-sdks.sh --live       # Extract spec from running control plane first
#
# The script is idempotent — output directories are cleaned before each generation.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEC_FILE="${SCRIPT_DIR}/openapi-spec.json"
PYTHON_CONFIG="${SCRIPT_DIR}/openapi-generator-config-python.json"
GO_CONFIG="${SCRIPT_DIR}/openapi-generator-config-go.json"
PYTHON_OUTPUT="${SCRIPT_DIR}/generated/python"
GO_OUTPUT="${SCRIPT_DIR}/generated/go"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[generate-sdks]${NC} $*"; }
warn()  { echo -e "${YELLOW}[generate-sdks]${NC} $*"; }
error() { echo -e "${RED}[generate-sdks]${NC} $*" >&2; }

# Detect which openapi-generator command is available
detect_generator() {
  if command -v openapi-generator-cli &>/dev/null; then
    GENERATOR_CMD="openapi-generator-cli"
  elif command -v openapi-generator &>/dev/null; then
    GENERATOR_CMD="openapi-generator"
  elif command -v docker &>/dev/null; then
    GENERATOR_CMD="docker"
    warn "Using Docker for openapi-generator. This may be slower."
  else
    error "openapi-generator-cli not found."
    error ""
    error "Install it via one of:"
    error "  npm install -g @openapitools/openapi-generator-cli"
    error "  brew install openapi-generator"
    error "  Or ensure Docker is available."
    exit 1
  fi
}

# Run openapi-generator with the detected method
run_generator() {
  local generator_name="$1"
  local output_dir="$2"
  local config_file="$3"

  if [[ "${GENERATOR_CMD}" == "docker" ]]; then
    docker run --rm \
      -v "${SCRIPT_DIR}:/work" \
      openapitools/openapi-generator-cli generate \
      -i "/work/openapi-spec.json" \
      -g "${generator_name}" \
      -o "/work/generated/${generator_name##*-}" \
      -c "/work/$(basename "${config_file}")"
  else
    ${GENERATOR_CMD} generate \
      -i "${SPEC_FILE}" \
      -g "${generator_name}" \
      -o "${output_dir}" \
      -c "${config_file}"
  fi
}

# --------------------------------------------------------------------------
# Live spec extraction (optional)
# --------------------------------------------------------------------------

extract_live_spec() {
  log "Extracting live OpenAPI spec from control plane..."

  local CP_PORT="${STRATUM_CP_PORT:-3000}"
  local CP_URL="http://localhost:${CP_PORT}/api/docs/json"
  local TEMP_SPEC
  TEMP_SPEC=$(mktemp)

  # Start control plane in the background if not running
  local started_cp=false
  if ! curl -sf "http://localhost:${CP_PORT}/api/v1/health" &>/dev/null; then
    log "Starting control plane on port ${CP_PORT}..."
    pushd "${SCRIPT_DIR}/.." >/dev/null
    npm run --workspace=packages/control-plane start &
    local CP_PID=$!
    popd >/dev/null
    started_cp=true

    # Wait for it to become healthy
    local retries=30
    while ! curl -sf "http://localhost:${CP_PORT}/api/v1/health" &>/dev/null; do
      retries=$((retries - 1))
      if [[ ${retries} -le 0 ]]; then
        error "Control plane did not become healthy in time."
        kill "${CP_PID}" 2>/dev/null || true
        exit 1
      fi
      sleep 1
    done
    log "Control plane is healthy."
  fi

  # Fetch the spec
  if curl -sf "${CP_URL}" -o "${TEMP_SPEC}"; then
    cp "${TEMP_SPEC}" "${SPEC_FILE}"
    log "Spec saved to ${SPEC_FILE}"
  else
    error "Failed to fetch spec from ${CP_URL}"
    [[ "${started_cp}" == "true" ]] && kill "${CP_PID}" 2>/dev/null || true
    rm -f "${TEMP_SPEC}"
    exit 1
  fi

  rm -f "${TEMP_SPEC}"

  # Stop control plane if we started it
  if [[ "${started_cp}" == "true" ]]; then
    log "Stopping control plane (PID ${CP_PID})..."
    kill "${CP_PID}" 2>/dev/null || true
    wait "${CP_PID}" 2>/dev/null || true
  fi
}

# --------------------------------------------------------------------------
# SDK generation
# --------------------------------------------------------------------------

generate_python() {
  log "Generating Python SDK..."
  rm -rf "${PYTHON_OUTPUT}"
  mkdir -p "${PYTHON_OUTPUT}"
  run_generator "python" "${PYTHON_OUTPUT}" "${PYTHON_CONFIG}"
  log "Python SDK generated at ${PYTHON_OUTPUT}"
}

generate_go() {
  log "Generating Go SDK..."
  rm -rf "${GO_OUTPUT}"
  mkdir -p "${GO_OUTPUT}"
  run_generator "go" "${GO_OUTPUT}" "${GO_CONFIG}"
  log "Go SDK generated at ${GO_OUTPUT}"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

main() {
  local target="all"
  local live=false

  for arg in "$@"; do
    case "${arg}" in
      python) target="python" ;;
      go)     target="go" ;;
      --live) live=true ;;
      --help|-h)
        echo "Usage: $0 [python|go] [--live]"
        echo ""
        echo "Options:"
        echo "  python    Generate only the Python SDK"
        echo "  go        Generate only the Go SDK"
        echo "  --live    Extract spec from running control plane before generating"
        echo ""
        exit 0
        ;;
      *)
        error "Unknown argument: ${arg}"
        exit 1
        ;;
    esac
  done

  detect_generator

  if [[ "${live}" == "true" ]]; then
    extract_live_spec
  fi

  # Validate spec file exists
  if [[ ! -f "${SPEC_FILE}" ]]; then
    error "OpenAPI spec not found at ${SPEC_FILE}"
    error "Run with --live to extract from the control plane, or ensure the static spec exists."
    exit 1
  fi

  # Check spec freshness against control plane source
  local CP_SRC_DIR="${SCRIPT_DIR}/../packages/control-plane/src"
  if [[ -d "${CP_SRC_DIR}" ]]; then
    local spec_mtime
    local newest_source
    spec_mtime=$(stat -c %Y "${SPEC_FILE}" 2>/dev/null || stat -f %m "${SPEC_FILE}" 2>/dev/null || echo 0)
    newest_source=$(find "${CP_SRC_DIR}" -name '*.ts' -newer "${SPEC_FILE}" 2>/dev/null | head -1)
    if [[ -n "${newest_source}" ]]; then
      warn "OpenAPI spec may be stale — control plane source has been modified since spec was generated."
      warn "Run with --live to regenerate from the running control plane, or update the spec manually."
    fi
  fi

  log "Using spec: ${SPEC_FILE}"

  case "${target}" in
    python) generate_python ;;
    go)     generate_go ;;
    all)
      generate_python
      generate_go
      ;;
  esac

  log "Done."
}

main "$@"
