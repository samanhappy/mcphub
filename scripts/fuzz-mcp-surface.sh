#!/usr/bin/env bash
# Start MCPHub with the integration-test fixture and run mcp-fuzzer in tools mode
# against the streamable HTTP /mcp/:group surface. Protocol fuzzing is for spec
# implementations (SDKs/transports); hubs should fuzz tools/call through the proxy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FUZZ_IMAGE="${MCP_FUZZER_IMAGE:-princekrroshan01/mcp-fuzzer:v0.4.0}"
FUZZ_RUNS="${MCP_FUZZ_RUNS:-3}"
FUZZ_TIMEOUT="${MCP_FUZZ_TIMEOUT:-30}"
OUTPUT_DIR="${MCP_FUZZ_OUTPUT:-$ROOT/fuzz-output}"
AUTH_CONFIG="$ROOT/scripts/mcp-fuzzer-auth.json"
SERVER_LOG="${TMPDIR:-/tmp}/mcphub-fuzz-server-$$.log"
FINDINGS_FILE="$OUTPUT_DIR/findings.json"
FUZZER_LOG="$OUTPUT_DIR/fuzzer.log"

mkdir -p "$OUTPUT_DIR"
chmod -R a+rwX "$OUTPUT_DIR"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

if [[ ! -f "$AUTH_CONFIG" ]]; then
  echo "missing auth config: $AUTH_CONFIG" >&2
  exit 1
fi

echo "starting MCPHub fuzz fixture..."
pnpm exec tsx scripts/fuzz-mcp-server.ts >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

READY_JSON=""
for _ in $(seq 1 120); do
  if READY_JSON="$(grep -E '^\{.*"ready"[[:space:]]*:[[:space:]]*true.*\}$' "$SERVER_LOG" 2>/dev/null | tail -1)"; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "fuzz fixture server exited before ready:" >&2
    cat "$SERVER_LOG" >&2
    exit 1
  fi
  sleep 2
done

if [[ -z "$READY_JSON" ]]; then
  echo "timed out waiting for fuzz fixture server (240s)" >&2
  cat "$SERVER_LOG" >&2
  exit 1
fi

MCP_ENDPOINT="$(READY_JSON="$READY_JSON" node -e 'const d=JSON.parse(process.env.READY_JSON); console.log(d.endpoint)')"
TOOL_COUNT="$(READY_JSON="$READY_JSON" node -e 'const d=JSON.parse(process.env.READY_JSON); console.log(d.toolCount)')"
if [[ -z "$TOOL_COUNT" || "$TOOL_COUNT" -lt 1 ]]; then
  echo "fixture reported ready but toolCount is zero" >&2
  cat "$SERVER_LOG" >&2
  exit 1
fi

echo "mcp endpoint: $MCP_ENDPOINT (tools=$TOOL_COUNT)"

DOCKER_ARGS=(--rm --user "$(id -u):$(id -g)")
if [[ "$(uname -s)" == "Linux" ]]; then
  DOCKER_ARGS+=(--network host)
else
  MCP_ENDPOINT="${MCP_ENDPOINT//localhost/host.docker.internal}"
  MCP_ENDPOINT="${MCP_ENDPOINT//127.0.0.1/host.docker.internal}"
fi

if [[ "${MCP_FUZZER_SKIP_PULL:-0}" == "1" ]]; then
  echo "using local mcp-fuzzer image $FUZZ_IMAGE"
else
  echo "pulling $FUZZ_IMAGE"
  docker pull "$FUZZ_IMAGE"
fi

echo "running mcp-fuzzer (mode=tools runs=$FUZZ_RUNS timeout=${FUZZ_TIMEOUT}s)"
set +e
docker run "${DOCKER_ARGS[@]}" \
  -e MCP_FUZZER_FS_ROOT=/output/.mcp_fuzzer \
  -v "$OUTPUT_DIR:/output:rw" \
  -v "$AUTH_CONFIG:/auth.json:ro" \
  "$FUZZ_IMAGE" \
  --mode tools \
  --protocol streamablehttp \
  --endpoint "$MCP_ENDPOINT" \
  --auth-config /auth.json \
  --fs-root /output/.mcp_fuzzer \
  --security-audit \
  --fail-if-no-tools \
  --runs "$FUZZ_RUNS" \
  --timeout "$FUZZ_TIMEOUT" \
  --output-dir /output 2>&1 | tee "$FUZZER_LOG"
FUZZ_EXIT=${PIPESTATUS[0]}
set -e

if [[ ! -f "$FINDINGS_FILE" ]]; then
  echo "missing fuzz report: $FINDINGS_FILE" >&2
  exit 1
fi

node scripts/verify-mcp-fuzz-output.js "$OUTPUT_DIR"

if [[ "$FUZZ_EXIT" -ne 0 ]]; then
  echo "mcp-fuzzer exited with status $FUZZ_EXIT" >&2
  exit "$FUZZ_EXIT"
fi

echo "fuzz complete; reports in $OUTPUT_DIR"
