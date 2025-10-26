#!/bin/bash

DATA_DIR=${MCP_DATA_DIR:-/app/data}
SERVERS_DIR=${MCP_SERVERS_DIR:-$DATA_DIR/servers}
NPM_SERVER_DIR=${MCP_NPM_DIR:-$SERVERS_DIR/npm}
PYTHON_SERVER_DIR=${MCP_PYTHON_DIR:-$SERVERS_DIR/python}
PNPM_HOME=${PNPM_HOME:-$DATA_DIR/pnpm}
NPM_CONFIG_PREFIX=${NPM_CONFIG_PREFIX:-$DATA_DIR/npm-global}
NPM_CONFIG_CACHE=${NPM_CONFIG_CACHE:-$DATA_DIR/npm-cache}
UV_TOOL_DIR=${UV_TOOL_DIR:-$DATA_DIR/uv/tools}
UV_CACHE_DIR=${UV_CACHE_DIR:-$DATA_DIR/uv/cache}

mkdir -p \
  "$PNPM_HOME" \
  "$NPM_CONFIG_PREFIX/bin" \
  "$NPM_CONFIG_PREFIX/lib/node_modules" \
  "$NPM_CONFIG_CACHE" \
  "$UV_TOOL_DIR" \
  "$UV_CACHE_DIR" \
  "$NPM_SERVER_DIR" \
  "$PYTHON_SERVER_DIR"

export PATH="$PNPM_HOME:$NPM_CONFIG_PREFIX/bin:$UV_TOOL_DIR/bin:$PATH"

NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org/}
echo "Setting npm registry to ${NPM_REGISTRY}"
npm config set registry "$NPM_REGISTRY"

# Handle HTTP_PROXY and HTTPS_PROXY environment variables
if [ -n "$HTTP_PROXY" ]; then
  echo "Setting HTTP proxy to ${HTTP_PROXY}"
  npm config set proxy "$HTTP_PROXY"
  export HTTP_PROXY="$HTTP_PROXY"
fi

if [ -n "$HTTPS_PROXY" ]; then
  echo "Setting HTTPS proxy to ${HTTPS_PROXY}"
  npm config set https-proxy "$HTTPS_PROXY"
  export HTTPS_PROXY="$HTTPS_PROXY"
fi

echo "Using REQUEST_TIMEOUT: $REQUEST_TIMEOUT"

# Auto-start Docker daemon if Docker is installed
if command -v dockerd >/dev/null 2>&1; then
  echo "Docker daemon detected, starting dockerd..."
  
  # Create docker directory if it doesn't exist
  mkdir -p /var/lib/docker
  
  # Start dockerd in the background
  dockerd --host=unix:///var/run/docker.sock --storage-driver=vfs > /var/log/dockerd.log 2>&1 &
  
  # Wait for Docker daemon to be ready
  echo "Waiting for Docker daemon to be ready..."
  TIMEOUT=15
  ELAPSED=0
  while ! docker info >/dev/null 2>&1; do
    if [ $ELAPSED -ge $TIMEOUT ]; then
      echo "WARNING: Docker daemon failed to start within ${TIMEOUT} seconds"
      echo "Check /var/log/dockerd.log for details"
      break
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done
  
  if docker info >/dev/null 2>&1; then
    echo "Docker daemon started successfully"
  fi
fi

exec "$@"
