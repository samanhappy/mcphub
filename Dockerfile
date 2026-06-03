# syntax=docker/dockerfile:1.7

FROM python:3.13-slim-bookworm AS base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

RUN apt-get update && apt-get install -y curl gnupg git build-essential \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

ARG INSTALL_EXT=false
RUN if [ "$INSTALL_EXT" = "true" ]; then \
  ARCH=$(uname -m); \
  if [ "$ARCH" = "x86_64" ]; then \
  npx -y playwright install --with-deps chrome firefox; \
  else \
  echo "Skipping Chrome and Firefox installation on non-amd64 architecture: $ARCH"; \
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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile --offline

COPY . .

# Download the latest servers.json from mcpm.sh and replace the existing file
RUN curl -s -f --connect-timeout 10 https://mcpm.sh/api/servers.json -o servers.json || echo "Failed to download servers.json, using bundled version"

RUN pnpm build

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["pnpm", "start"]
