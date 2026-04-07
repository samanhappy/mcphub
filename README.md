# MCPHub: The Unified Hub for Model Context Protocol (MCP) Servers

English | [Français](README.fr.md) | [中文版](README.zh.md)

MCPHub makes it easy to manage and scale multiple MCP (Model Context Protocol) servers by organizing them into flexible Streamable HTTP (SSE) endpoints—supporting access to all servers, individual servers, or logical server groups.

![Dashboard Preview](assets/dashboard.png)

## 🌐 Live Demo & Docs

- **Documentation**: [docs.mcphub.app](https://docs.mcphub.app/)
- **Demo Environment**: [demo.mcphub.app](https://demo.mcphub.app/)

## 🚀 Features

- **Centralized Management** - Monitor and control all MCP servers from a unified dashboard
- **Flexible Routing** - Access all servers, specific groups, or individual servers via HTTP/SSE
- **Granular Group Visibility** - Control Tool, Prompt, and Resource visibility independently for each server inside a group
- **Smart Routing** - AI-powered tool discovery using vector semantic search ([Learn more](https://docs.mcphub.app/features/smart-routing))
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

# Or run with default settings
docker run -p 3000:3000 samanhappy/mcphub
```

### Access Dashboard

Open `http://localhost:3000` and log in with username `admin`. On first launch, if no `ADMIN_PASSWORD` environment variable is set, a random password is generated and printed to the server logs. You can also pre-set the password:

```bash
# Docker: set admin password via environment variable
docker run -p 3000:3000 -e ADMIN_PASSWORD=your-secure-password samanhappy/mcphub
```

> **Tip:** Change the admin password after first login for security.

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
| [Docker Setup](https://docs.mcphub.app/configuration/docker-setup)            | Docker deployment guide           |

## 🧑‍💻 Local Development

```bash
git clone https://github.com/samanhappy/mcphub.git
cd mcphub
pnpm install
pnpm dev
```

> For Windows users, start backend and frontend separately: `pnpm backend:dev`, `pnpm frontend:dev`

📖 See [Development Guide](https://docs.mcphub.app/development) for detailed setup instructions.

## 🔍 Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: React, Vite, Tailwind CSS
- **Auth**: JWT & bcrypt
- **Protocol**: Model Context Protocol SDK

## 👥 Contributing

Contributions welcome! See our [Discord community](https://discord.gg/qMKNsn5Q) for discussions and support.

## ❤️ Sponsor

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/samanhappy)

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=samanhappy/mcphub&type=Date)](https://www.star-history.com/#samanhappy/mcphub&Date)

## 📄 License

Licensed under the [Apache 2.0 License](LICENSE).
