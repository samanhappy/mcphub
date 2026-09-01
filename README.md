# MCPHub

> A self-hosted MCP gateway and management platform for connecting, managing, and operating MCP servers.

[![MCP Toplist](https://mcptoplist.com/badge/glama%2Fsamanhappy%2Fmcphub.svg)](https://mcptoplist.com/server/glama%2Fsamanhappy%2Fmcphub)

English | [Français](README.fr.md) | [中文版](README.zh.md)

MCPHub provides a unified way to connect and manage multiple MCP servers, organize them into groups, control access, and expose stable MCP endpoints for clients such as Claude Code, Cursor, Cherry Studio, OpenWebUI, and other MCP-compatible applications.

![Dashboard Preview](assets/dashboard.png)

## 🌐 Website, Demo & Docs

- **Website**: [mcphub.app](https://www.mcphub.app/)
- **Documentation**: [docs.mcphub.app](https://docs.mcphub.app/)
- **Demo Environment**: [demo.mcphub.app](https://demo.mcphub.app/)

## 🚀 Features

- **Unified MCP Gateway** - Expose all connected servers through stable MCP endpoints, including routes for groups and individual servers
- **Server and Group Management** - Organize servers into groups, manage visibility, and control Tool, Prompt, and Resource exposure
- **SSE / Streamable HTTP / stdio Support** - Connect local and remote MCP servers over the supported transports
- **Authentication and Access Control** - Use OAuth 2.0, bearer keys, and server or group visibility controls to manage access
- **Server Aliases and Routing** - Define aliases and route clients to all servers, specific groups, individual servers, or smart routing
- **Logs and Observability** - Inspect tool-call activity, request status, latency, and server logs
- **Health Checks** - Monitor connection health and server status from one place
- **Web Dashboard** - Manage server configuration and runtime operations from a browser
- **Smart Routing** - AI-powered tool discovery using vector semantic search ([Learn more](https://docs.mcphub.app/features/smart-routing))
- **MCP Apps Proxy** - Transparently forward interactive MCP Apps on single-server routes ([Learn more](https://docs.mcphub.app/features/mcp-apps))
- **Tool Result Compression** - Transparently reduce large text tool outputs before they reach clients
- **Hot-Swappable Config** - Add, remove, or update servers without downtime
- **OAuth 2.0 Support** - Both client and server modes for secure authentication ([Learn more](https://docs.mcphub.app/features/oauth))
- **Social Login** - Seamless GitHub and Google login support with Better Auth integration (requires Database Mode)
- **Database Mode** - Store configuration in PostgreSQL for production environments ([Learn more](https://docs.mcphub.app/configuration/database-configuration))
- **Docker-Ready** - Deploy instantly with containerized setup

## 🔧 Quick Start

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

```bash
# Run with custom config (recommended)
docker run -p 3000:3000 -v ./mcp_settings.json:/app/mcp_settings.json -v ./data:/app/data samanhappy/mcphub

# Or run with default settings (also mount ./data so credentials and state survive restarts)
docker run -p 3000:3000 -v ./data:/app/data samanhappy/mcphub
```

Two image variants are published under `samanhappy/mcphub`:

- **`latest`** — the default image. Includes Node.js/pnpm, Python, uv/uvx, Git, and build tools. Covers most MCP servers.
- **`latest-full`** — the extended image. Adds Rust toolchain (Cargo/rustc), Docker Engine, and Playwright browsers (Chrome + Firefox, amd64 only). Use this for Rust-based servers or container-in-container workflows. Larger download.

See [Docker Setup](https://docs.mcphub.app/configuration/docker-setup) for build options and Docker-in-Docker configuration.

### Access Dashboard

Open `http://localhost:3000` and log in with username `admin`. On first launch, if no `ADMIN_PASSWORD` environment variable is set, a random password is generated and printed to the server logs. You can also pre-set the password:

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

### Manage From the Terminal

The same `mcphub` binary doubles as a CLI for the running hub — no extra install needed.

```bash
mcphub login --url http://localhost:3000 --username admin
mcphub servers list
mcphub servers add fetch --type stdio --command uvx --arg mcp-server-fetch
mcphub tools list                              # discover what tools are available
mcphub tools get fetch_url                     # see required params + sample command
mcphub call fetch_url url=https://example.com --json
mcphub keys create --name ci --access-type all
```

It also speaks the public marketplace API (`mcphub discover`, `mcphub install ...`) so server lookup and one-command install work against any hub with discovery enabled.

📖 See [CLI Guide](https://docs.mcphub.app/features/cli) for every subcommand, profiles, and CI usage.

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

Work directly with the maintainer on production deployment, OAuth/OIDC,
access control, credential management, audit, Kubernetes, and HA readiness.

[Discuss a production pilot →](https://www.mcphub.app/pricing)

## 👥 Contributing

Contributions welcome! See our [Discord community](https://discord.gg/2BJehJZVH5) for discussions and support.

## ❤️ Sponsor

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/samanhappy)

## 🌟 Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=samanhappy/mcphub&type=Date)](https://star-history.dera.page/#samanhappy/mcphub&Date)

## 📄 License

Licensed under the [Apache 2.0 License](LICENSE).
