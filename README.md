# MCPHub: The Unified Hub for Model Context Protocol (MCP) Servers

English | [Türkçe](README.tr.md)

MCPHub makes it easy to manage and scale multiple MCP (Model Context Protocol) servers by organizing them into flexible Streamable HTTP (SSE) endpoints—supporting access to all servers, individual servers, or logical server groups.

![Dashboard Preview](assets/dashboard.png)

## 🌐 Live Demo & Docs

- **Documentation**: [github.com/vaur94/mcphub](https://github.com/vaur94/mcphub)

## 🚀 Features

- **Centralized Management** - Monitor and control all MCP servers from a unified dashboard
- **Flexible Routing** - Access all servers, specific groups, or individual servers via HTTP/SSE
- **Smart Routing** - AI-powered tool discovery using vector semantic search ([Learn more](https://github.com/vaur94/mcphub))
- **Hot-Swappable Config** - Add, remove, or update servers without downtime
- **OAuth 2.0 Support** - Both client and server modes for secure authentication ([Learn more](https://github.com/vaur94/mcphub))
- **Social Login** - Seamless GitHub and Google login support with Better Auth integration (requires Database Mode)
- **Database Mode** - Store configuration in PostgreSQL for production environments ([Learn more](https://github.com/vaur94/mcphub))
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

📖 See [Configuration Guide](https://github.com/vaur94/mcphub) for full options including OAuth, environment variables, and more.

### Docker Deployment

```bash
# Run with custom config (recommended)
docker run -p 3000:3000 -v ./mcp_settings.json:/app/mcp_settings.json -v ./data:/app/data ghcr.io/vaur94/mcphub

# Or run with default settings
docker run -p 3000:3000 ghcr.io/vaur94/mcphub
```

### Access Dashboard

Open `http://localhost:3000` and log in with default credentials: `admin` / `admin123`

### Connect AI Clients

Connect AI clients (Claude Desktop, Cursor, etc.) via:

```
http://localhost:3000/mcp           # All servers
http://localhost:3000/mcp/{group}   # Specific group
http://localhost:3000/mcp/{server}  # Specific server
http://localhost:3000/mcp/$smart    # Smart routing
http://localhost:3000/mcp/$smart/{group}  # Smart routing within group
```

> **Security note**: MCP endpoints require authentication by default to prevent accidental exposure. To allow unauthenticated MCP access, disable **Enable Bearer Authentication** in the Keys section. **Skip Authentication** only affects dashboard login. Use these only in trusted environments.

📖 See [API Reference](https://github.com/vaur94/mcphub) for detailed endpoint documentation.

## 📚 Documentation

| Topic                                             | Description                       |
| ------------------------------------------------- | --------------------------------- |
| [Quick Start](https://github.com/vaur94/mcphub)   | Get started in 5 minutes          |
| [Configuration](https://github.com/vaur94/mcphub) | MCP server configuration options  |
| [Database Mode](https://github.com/vaur94/mcphub) | PostgreSQL setup for production   |
| [OAuth](https://github.com/vaur94/mcphub)         | OAuth 2.0 client and server setup |
| [Smart Routing](https://github.com/vaur94/mcphub) | AI-powered tool discovery         |
| [Docker Setup](https://github.com/vaur94/mcphub)  | Docker deployment guide           |

## 🧑‍💻 Local Development

```bash
git clone https://github.com/vaur94/mcphub.git
cd mcphub
pnpm install
pnpm dev
```

> For Windows users, start backend and frontend separately: `pnpm backend:dev`, `pnpm frontend:dev`

📖 See [Development Guide](https://github.com/vaur94/mcphub) for detailed setup instructions.

## 🔍 Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: React, Vite, Tailwind CSS
- **Auth**: JWT & bcrypt
- **Protocol**: Model Context Protocol SDK

## 👥 Contributing

Contributions welcome! Please open an issue or a pull request.

## 📄 License

Licensed under the [Apache 2.0 License](LICENSE).
