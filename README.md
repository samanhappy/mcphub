# MCPHub

> An open-source, self-hosted MCP gateway and control plane for connecting, controlling, and operating MCP servers.

[![MCP Toplist](https://mcptoplist.com/badge/glama%2Fsamanhappy%2Fmcphub.svg)](https://mcptoplist.com/server/glama%2Fsamanhappy%2Fmcphub)
[![CI](https://github.com/samanhappy/mcphub/actions/workflows/ci.yml/badge.svg)](https://github.com/samanhappy/mcphub/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@samanhappy/mcphub)](https://www.npmjs.com/package/@samanhappy/mcphub)
[![Docker pulls](https://img.shields.io/docker/pulls/samanhappy/mcphub)](https://hub.docker.com/r/samanhappy/mcphub)
[![License](https://img.shields.io/github/license/samanhappy/mcphub)](LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/2BJehJZVH5)
[![GitHub stars](https://img.shields.io/github/stars/samanhappy/mcphub?style=social)](https://github.com/samanhappy/mcphub/stargazers)

English | [Français](README.fr.md) | [中文版](README.zh.md)

MCPHub provides a unified control point between AI clients and MCP servers. Connect local and remote MCP servers once, organize and route their capabilities through stable endpoints, control access with authentication, scoped credentials, and per-user visibility, and operate everything with centralized logs, activity tracking, and health monitoring.

It works with MCP clients such as Claude Code, Cursor, Cherry Studio, OpenWebUI, and other MCP-compatible applications.

![Dashboard Preview](assets/dashboard.png)

## 🌐 Website, Demo & Docs

- **Website**: [mcphub.app](https://www.mcphub.app/)
- **Documentation**: [docs.mcphub.app](https://docs.mcphub.app/)
- **Demo Environment**: [demo.mcphub.app](https://demo.mcphub.app/)

## 🚀 Features

### Connect once, expose everywhere

- **Smart Routing** ⭐ - AI-powered tool discovery using vector semantic search ([Learn more](https://docs.mcphub.app/features/smart-routing))
- **Unified MCP Gateway** - Expose all connected servers through stable MCP endpoints, including routes for groups and individual servers
- **Server Aliases and Routing** - Define aliases and route clients to all servers, specific groups, individual servers, or smart routing
- **SSE / Streamable HTTP / stdio Support** - Connect local and remote MCP servers over the supported transports
- **Hot-Swappable Config** - Add, remove, or update servers without downtime

### Control access and credentials

- **Per-user Credentials** ⭐ - Bind personal keys to one shared server, with encrypted storage and isolated stdio runtimes ([Learn more](docs/features/per-user-credentials.mdx))
- **Authentication and Access Control** - Use OAuth 2.0, bearer keys, and server or group visibility controls to manage access
- **OAuth 2.0 Support** ⭐ - Both client and server modes for secure authentication ([Learn more](https://docs.mcphub.app/features/oauth))
- **Social Login** - Seamless GitHub and Google login support with Better Auth integration (requires Database Mode)
- **Server and Group Management** - Organize servers into groups, manage visibility, and control Tool, Prompt, and Resource exposure

### Operate with confidence

- **Logs and Observability** - Inspect tool-call activity, request status, latency, and server logs
- **Health Checks** - Monitor connection health and server status from one place
- **Web Dashboard** - Manage server configuration and runtime operations from a browser
- **MCP Apps Proxy** - Transparently forward interactive MCP Apps on single-server routes ([Learn more](https://docs.mcphub.app/features/mcp-apps))
- **Tool Result Compression** - Transparently reduce large text tool outputs before they reach clients
- **Database Mode** - Store configuration in PostgreSQL for production environments ([Learn more](https://docs.mcphub.app/configuration/database-configuration))
- **Docker-Ready** - Deploy instantly with containerized setup

## 🔧 Quick Start

### Prerequisites

- **Docker** (recommended) — the fastest way to run MCPHub; all commands below use it
- **Node.js** `^18.0.0 || >=20.0.0` and **pnpm** `10.12.4` — only needed to run from source or develop locally (see [Local Development](#local-development))

### Run in 30 seconds

```bash
docker run -p 3000:3000 -v ./data:/app/data -e MCPHUB_SETTING_PATH=/app/data/mcp_settings.json samanhappy/mcphub
```

Open `http://localhost:3000` and log in with username `admin`. On first launch, if no `ADMIN_PASSWORD` environment variable is set, a random password is generated and printed to the server logs.

Settings, users, and credential bindings all persist in `./data` (via `MCPHUB_SETTING_PATH`).

Want your own servers? Write a `mcp_settings.json` (see [Configuration](#configuration)), copy it into `./data/`, and run the same command:

```bash
cp mcp_settings.json data/
docker run -p 3000:3000 -v ./data:/app/data -e MCPHUB_SETTING_PATH=/app/data/mcp_settings.json samanhappy/mcphub
```

### Configuration

Create a `mcp_settings.json` file:

```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "time-mcp"]
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}
```

📖 See [Configuration Guide](https://docs.mcphub.app/configuration/mcp-settings) for full options including OAuth, environment variables, and more.

### Docker Deployment

See [Run in 30 seconds](#run-in-30-seconds) for the copy-paste commands. Always mount `./data` together with `-e MCPHUB_SETTING_PATH=/app/data/mcp_settings.json` so settings, users, and credential bindings survive restarts.

Two image variants are published under `samanhappy/mcphub`:

- **`latest`** — the default image. Includes Node.js/pnpm, Python, uv/uvx, Git, and build tools. Covers most MCP servers.
- **`latest-full`** — the extended image. Adds Rust toolchain (Cargo/rustc), Docker Engine, and Playwright browsers (Chrome + Firefox, amd64 only). Use this for Rust-based servers or container-in-container workflows. Larger download.

See [Docker Setup](https://docs.mcphub.app/configuration/docker-setup) for build options and Docker-in-Docker configuration.

### Access Dashboard

Open `http://localhost:3000` (see [Run in 30 seconds](#run-in-30-seconds) for login details). You can also pre-set the password:

```bash
# Docker: set admin password via environment variable
docker run -p 3000:3000 -e ADMIN_PASSWORD=your-secure-password samanhappy/mcphub
```

> **Tip:** Change the admin password after first login for security.

> **Headless mode:** Set `DISABLE_WEB=true` to skip serving the bundled dashboard UI and run MCPHub with only the backend/API and MCP endpoints. This is useful when you want to manage servers directly from `mcp_settings.json`.

### Connect AI Clients

Connect AI clients (Claude Desktop, Cursor, etc.) via:

```
http://localhost:3000/mcp           # All servers
http://localhost:3000/mcp/{group}   # Specific group
http://localhost:3000/mcp/{server}  # Specific server
http://localhost:3000/mcp/$smart    # Smart routing
http://localhost:3000/mcp/$smart/{group}  # Smart routing within group
```

> **Security note**: MCP endpoints require authentication by default to prevent accidental exposure. To allow unauthenticated MCP access, disable **Enable Bearer Authentication** in the Keys section. **Skip Authentication** only affects dashboard login. Use only in trusted environments.

📖 See [API Reference](https://docs.mcphub.app/api-reference) for detailed endpoint documentation.

## 📚 Documentation

| Topic                                                                          | Description                       |
| ------------------------------------------------------------------------------ | --------------------------------- |
| [Quick Start](https://docs.mcphub.app/quickstart)                             | Get started in 5 minutes          |
| [Configuration](https://docs.mcphub.app/configuration/mcp-settings)           | MCP server configuration options  |
| [Database Mode](https://docs.mcphub.app/configuration/database-configuration) | PostgreSQL setup for production   |
| [OAuth](https://docs.mcphub.app/features/oauth)                               | OAuth 2.0 client and server setup |
| [Smart Routing](https://docs.mcphub.app/features/smart-routing)               | AI-powered tool discovery         |
| [MCP Apps](https://docs.mcphub.app/features/mcp-apps)                         | Interactive Apps transparent proxy |
| [CLI Guide](https://docs.mcphub.app/features/cli)                             | Manage and call the hub from a terminal |
| [Docker Setup](https://docs.mcphub.app/configuration/docker-setup)            | Docker deployment guide           |

## 🧑‍💻 Local Development

```bash
git clone https://github.com/samanhappy/mcphub.git
cd mcphub
pnpm install
pnpm dev
```

Local development uses `admin` / `admin123` and stores its writable settings copy at `data/mcp_settings.dev.json`, so the repository `mcp_settings.json` stays credential-free.

> For Windows users, start backend and frontend separately: `pnpm backend:dev`, `pnpm frontend:dev`

📖 See [Development Guide](https://docs.mcphub.app/development) for detailed setup instructions.

## 🔍 Tech Stack

- **Backend**: Node.js, Express, TypeScript (ESM)
- **Frontend**: React, Vite, Tailwind CSS
- **Storage**: file-based `mcp_settings.json` by default; PostgreSQL via TypeORM with pgvector for Smart Routing
- **Auth**: JWT + bcrypt for local accounts; bearer keys; built-in OAuth 2.0 server (`@node-oauth/oauth2-server`); optional Better Auth for GitHub/Google login
- **Protocol**: Model Context Protocol SDK

## 🏢 Production Support

Running MCPHub in production?

Work directly with the maintainer on production architecture, OAuth/OIDC,
identity and access control, credential management, audit, Kubernetes, and HA readiness.

[Discuss a production pilot →](https://www.mcphub.app/pricing)

## 👥 Contributing

Contributions welcome! See our [Discord community](https://discord.gg/2BJehJZVH5) for discussions and support.

## ❤️ Sponsor

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/samanhappy)

Chinese users can also support via WeChat Pay — see [中文版](README.zh.md).

## 🌟 Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=samanhappy/mcphub&type=Date)](https://star-history.dera.page/#samanhappy/mcphub&Date)

## 📄 License

Licensed under the [Apache 2.0 License](LICENSE).
