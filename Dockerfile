FROM python:3.13-slim-bookworm AS base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

RUN apt-get update && apt-get install -y curl gnupg git \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

ENV MCP_DATA_DIR=/app/data
ENV MCP_SERVERS_DIR=$MCP_DATA_DIR/servers
ENV MCP_NPM_DIR=$MCP_SERVERS_DIR/npm
ENV MCP_PYTHON_DIR=$MCP_SERVERS_DIR/python
ENV PNPM_HOME=$MCP_DATA_DIR/pnpm
ENV NPM_CONFIG_PREFIX=$MCP_DATA_DIR/npm-global
ENV NPM_CONFIG_CACHE=$MCP_DATA_DIR/npm-cache
ENV UV_TOOL_DIR=$MCP_DATA_DIR/uv/tools
ENV UV_CACHE_DIR=$MCP_DATA_DIR/uv/cache
ENV PATH=$PNPM_HOME:$NPM_CONFIG_PREFIX/bin:$UV_TOOL_DIR/bin:$PATH
RUN mkdir -p \
  $PNPM_HOME \
  $NPM_CONFIG_PREFIX/bin \
  $NPM_CONFIG_PREFIX/lib/node_modules \
  $NPM_CONFIG_CACHE \
  $UV_TOOL_DIR \
  $UV_CACHE_DIR \
  $MCP_NPM_DIR \
  $MCP_PYTHON_DIR && \
  pnpm add -g @amap/amap-maps-mcp-server @playwright/mcp@latest tavily-mcp@latest @modelcontextprotocol/server-github @modelcontextprotocol/server-slack

ARG INSTALL_EXT=false
RUN if [ "$INSTALL_EXT" = "true" ]; then \
  ARCH=$(uname -m); \
  if [ "$ARCH" = "x86_64" ]; then \
  npx -y playwright install --with-deps chrome; \
  else \
  echo "Skipping Chrome installation on non-amd64 architecture: $ARCH"; \
  fi; \
  # Install Docker Engine (includes CLI and daemon) \
  apt-get update && \
  apt-get install -y ca-certificates curl iptables && \
  install -m 0755 -d /etc/apt/keyrings && \
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
  chmod a+r /etc/apt/keyrings/docker.asc && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
  apt-get update && \
  apt-get install -y docker-ce docker-ce-cli containerd.io && \
  apt-get clean && rm -rf /var/lib/apt/lists/*; \
  fi

RUN uv tool install mcp-server-fetch

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .

# Download the latest servers.json from mcpm.sh and replace the existing file
RUN curl -s -f --connect-timeout 10 https://mcpm.sh/api/servers.json -o servers.json || echo "Failed to download servers.json, using bundled version"

RUN pnpm frontend:build && pnpm build

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["pnpm", "start"]
