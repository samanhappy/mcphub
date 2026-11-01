FROM node:22-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
COPY package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY scripts/build-mcp-client.js ./scripts/build-mcp-client.js
COPY locales ./locales
COPY servers.json ./
COPY tests/docker/replicas ./tests/docker/replicas
RUN pnpm backend:build
ENV DISABLE_WEB=true
CMD ["node", "dist/index.js"]
